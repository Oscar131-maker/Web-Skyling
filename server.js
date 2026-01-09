const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const OpenAI = require('openai');
const { Pool } = require('pg');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'skyling_secret_key_change_me',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // true for https
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Trust proxy if behind Railway load balancer (required for secure cookies)
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Logging Middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url} [Auth: ${!!req.session.user}]`);
    next();
});

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// Auth Middleware Logic
const requireAuth = (req, res, next) => {
    if (req.session && req.session.user) {
        return next();
    }
    // If API request, 401. If Page request, redirect/serve login.
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    // Serve login for non-API requests (static files check comes later if we modify order, 
    // but better to intercept explicitly or use specific routes)
    // Actually, express.static is below. We need to handle this carefully.
    // Let's use a specific handler just for root or protect static middleware.
    return res.sendFile(path.join(__dirname, 'public', 'login.html'));
};

const publicRoutes = ['/api/login', '/login.html', '/style.css', '/favicon.ico']; // Add basics if needed

// Intercept requests
app.use((req, res, next) => {
    if (publicRoutes.includes(req.path)) {
        return next();
    }
    // Check auth
    if (req.session.user) {
        return next();
    }

    // Allow login.html to be served if requesting root and not logged in
    if (req.path === '/' || req.path === '/index.html') {
        return res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }

    // Block other static assets if strict (security), but styles might be needed for login?
    // User asked for styles in login.html -> they link to style.css. So style.css MUST be public.
    // app.js probably shouldn't be publicly served if it contains logic, but it's client side code.
    // Let's be safe: Allow style.css.

    // For API calls
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    // For everything else (authed static files), require auth
    // If we are here, we are not authed and not asking for public routes.
    // Redirect to root (which serves login)
    return res.redirect('/');
});


app.use(express.static('public'));

// Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to read file safely
const readFile = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf-8');
        }
        return '';
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        return '';
    }
};

// Initialize Database Schema and Seed Data
const initDB = async () => {
    try {
        // Create Config Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_skyling_config (
                key TEXT PRIMARY KEY,
                value TEXT
            );
        `);

        // Create Templates Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS web_skyling_templates (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Seed Config if empty
        const configCount = await pool.query('SELECT COUNT(*) FROM web_skyling_config');
        if (parseInt(configCount.rows[0].count) === 0) {
            console.log("Seeding database configuration from files...");
            const baseDir = path.join(__dirname, 'rags');

            const seedData = {
                'structure': readFile(path.join(baseDir, 'estructura.txt')),
                'output': readFile(path.join(baseDir, 'output.txt')),
                'limitations': readFile(path.join(baseDir, 'limitaciones.txt')),
                'systemPrompt': readFile(path.join(baseDir, 'systemprompt.txt')),
                'knowledge': ''
            };

            // Knowledge logic
            const txtPath = path.join(baseDir, 'conocimiento_unico_sections.txt');
            if (fs.existsSync(txtPath)) {
                seedData['knowledge'] = fs.readFileSync(txtPath, 'utf-8');
            } else {
                const pdfPath = path.join(baseDir, 'conocimiento_unico_sections.pdf');
                if (fs.existsSync(pdfPath)) {
                    try {
                        const dataBuffer = fs.readFileSync(pdfPath);
                        const data = await pdf(dataBuffer);
                        seedData['knowledge'] = data.text;
                    } catch (e) {
                        console.error("PDF Seed Error:", e);
                    }
                }
            }

            for (const [key, value] of Object.entries(seedData)) {
                if (value) {
                    await pool.query('INSERT INTO web_skyling_config (key, value) VALUES ($1, $2)', [key, value]);
                }
            }
            console.log("Seeding complete.");
        }

        // Migrate existing JSON templates if Table is empty
        const templateCount = await pool.query('SELECT COUNT(*) FROM web_skyling_templates');
        if (parseInt(templateCount.rows[0].count) === 0) {
            const TEMPLATES_FILE = path.join(__dirname, 'templates.json');
            if (fs.existsSync(TEMPLATES_FILE)) {
                try {
                    const jsonTemplates = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
                    if (Array.isArray(jsonTemplates)) {
                        console.log(`Migrating ${jsonTemplates.length} templates from JSON to DB...`);
                        for (const t of jsonTemplates) {
                            await pool.query(
                                'INSERT INTO web_skyling_templates (name, data) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING',
                                [t.name, t.data]
                            );
                        }
                    }
                } catch (e) {
                    console.error("Template Migration Error:", e);
                }
            }
        }

    } catch (e) {
        console.error("Database Initialization Error - Ensure DATABASE_URL is set in .env:", e.message);
    }
};

// Run Init
initDB();


// --- AUTH ENDPOINTS ---

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // Secure comparison (simple for now, assumed env vars)
    const validUser = process.env.USER_USERNAME;
    const validPass = process.env.USER_PASSWORD;

    if (!validUser || !validPass) {
        console.error("Server Misconfiguration: Missing USER_USERNAME or USER_PASSWORD in env");
        return res.status(500).json({ error: "Server Auth Config Error" });
    }

    if (username === validUser && password === validPass) {
        req.session.user = { username };
        return res.json({ success: true });
    }

    return res.status(401).json({ error: "Invalid credentials" });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: "Logout failed" });
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});


// --- API ENDPOINTS ---

// Get Defaults (from DB)
app.get('/api/defaults', async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM web_skyling_config');
        const config = {};
        result.rows.forEach(row => {
            config[row.key] = row.value;
        });

        // Return config, but frontend expects keys: structure, output, limitations, systemPrompt, knowledge
        // Our keys stored match these names (see seedData).

        res.json(config);
    } catch (e) {
        console.error("Error fetching defaults:", e);
        res.status(500).json({ error: "Database error fetching defaults" });
    }
});

// Update Configuration (System Prompt, etc)
app.put('/api/config', async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "Key is required" });

    try {
        await pool.query(
            'INSERT INTO web_skyling_config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
            [key, value]
        );
        res.json({ success: true, key, value });
    } catch (e) {
        console.error("Error updating config:", e);
        res.status(500).json({ error: "Database error updating config" });
    }
});

// Templates CRUD

app.get('/api/templates', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM web_skyling_templates ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (e) {
        console.error("Error fetching templates:", e);
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/templates', async (req, res) => {
    const { name, data } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    try {
        // Upsert by name
        await pool.query(
            'INSERT INTO web_skyling_templates (name, data) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET data = $2',
            [name, data]
        );

        const all = await pool.query('SELECT * FROM web_skyling_templates ORDER BY created_at DESC');
        res.json({ success: true, templates: all.rows });

    } catch (e) {
        console.error("Error saving template:", e);
        res.status(500).json({ error: "Database error" });
    }
});

app.put('/api/templates/:oldName', async (req, res) => {
    const oldName = req.params.oldName;
    const { newName, data } = req.body;

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Check existence
            const check = await client.query('SELECT * FROM web_skyling_templates WHERE name = $1', [oldName]);
            if (check.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Template not found" });
            }

            // If renaming, check content collision
            if (newName && newName !== oldName) {
                const collision = await client.query('SELECT * FROM web_skyling_templates WHERE name = $1', [newName]);
                if (collision.rows.length > 0) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({ error: "Ya existe una plantilla con ese nombre." });
                }
            }

            // Update
            const finalName = newName || oldName;
            await client.query(
                'UPDATE web_skyling_templates SET name = $1, data = $2 WHERE name = $3',
                [finalName, data, oldName]
            );

            await client.query('COMMIT');

            const all = await client.query('SELECT * FROM web_skyling_templates ORDER BY created_at DESC');
            res.json({ success: true, templates: all.rows });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    } catch (e) {
        console.error("Error renaming:", e);
        res.status(500).json({ error: "Database error" });
    }
});

app.delete('/api/templates/:name', async (req, res) => {
    const name = req.params.name;
    try {
        await pool.query('DELETE FROM web_skyling_templates WHERE name = $1', [name]);
        const all = await pool.query('SELECT * FROM web_skyling_templates ORDER BY created_at DESC');
        res.json({ success: true, templates: all.rows });
    } catch (e) {
        console.error("Error deleting:", e);
        res.status(500).json({ error: "Database error" });
    }
});


// Generate API
app.post('/api/generate', async (req, res) => {
    try {
        console.log("Received generation request (Streaming Mode - OpenRouter).");
        const { systemPrompt, userMessage, apiKey } = req.body;

        // Use provided key or env key
        let keyToUse = apiKey || process.env.ANTHROPIC_OPENROUTER_API_KEY;

        if (!keyToUse) {
            console.error("CRITICAL: No API Key found.");
            return res.status(400).json({ error: 'Missing API Key' });
        }

        keyToUse = keyToUse.trim();
        const visible = keyToUse.substring(0, 10) + "..." + keyToUse.substring(keyToUse.length - 4);
        console.log(`Using API Key: ${visible}`);

        const openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: keyToUse,
        });

        console.log("Calling OpenRouter API Stream...");

        // Prepare headers for streaming text
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const stream = await openai.chat.completions.create({
            model: "anthropic/claude-sonnet-4.5",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            temperature: 0.3,
            max_tokens: 64000,
            stream: true,
        }, {
            headers: {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Web Skyling"
            }
        });

        console.log("Stream started.");

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                res.write(content);
            }
        }

        console.log("Stream finished.");
        res.end();

    } catch (e) {
        console.error("Generation Error:", e);
        if (e.status === 401) {
            console.error("Authentication Error: Double check your API Key.");
        }
        // If headers weren't sent yet, send JSON error.
        if (!res.headersSent) {
            res.status(500).json({ error: e.message });
        } else {
            res.end(); // Terminate stream silently if broken halfway
        }
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    if (!process.env.USER_USERNAME || !process.env.USER_PASSWORD) {
        console.warn("WARNING: LOGIN CREDENTIALS NOT SET IN .ENV (USER_USERNAME, USER_PASSWORD)");
    }
});
