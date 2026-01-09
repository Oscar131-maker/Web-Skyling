const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const OpenAI = require('openai');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Logging Middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
    next();
});

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
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
});
