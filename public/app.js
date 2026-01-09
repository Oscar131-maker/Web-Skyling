document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const keywordInput = document.getElementById('keyword-input');
    const briefInput = document.getElementById('client-brief');

    const structureInput = document.getElementById('structure-input');
    const outputInput = document.getElementById('output-input');
    const limitationsInput = document.getElementById('limitations-input');

    const finalOutput = document.getElementById('final-output');

    const viewQueryBtn = document.getElementById('view-query-btn');
    const generateBtn = document.getElementById('generate-btn');
    const copyBtn = document.getElementById('copy-btn');
    const downloadBtn = document.getElementById('download-btn');

    const templateNameInput = document.getElementById('template-name-input');
    const templateSelect = document.getElementById('template-select');
    const saveTemplateBtn = document.getElementById('save-template-btn');
    const deleteTemplateBtn = document.getElementById('delete-template-btn');

    const modal = document.getElementById('query-modal');
    const closeModal = document.getElementById('close-modal');
    const queryPreviewContent = document.getElementById('query-preview-content');

    // System Prompt Modal Elements
    const editSystemPromptBtn = document.getElementById('edit-system-prompt-btn');
    const systemPromptModal = document.getElementById('system-prompt-modal');
    const closeSystemPromptModal = document.getElementById('close-system-prompt-modal');
    const systemPromptEditor = document.getElementById('system-prompt-editor');
    const saveSystemPromptBtn = document.getElementById('save-system-prompt-btn');
    const cancelSystemPromptBtn = document.getElementById('cancel-system-prompt-btn');

    // State
    let systemPrompt = "";
    let knowledgeBase = "";
    let templates = [];
    let currentTemplateName = "";

    // Initialization
    fetchDefaults();
    fetchTemplates();

    const renameTemplateBtn = document.getElementById('rename-template-btn');
    const newTemplateBtn = document.getElementById('new-template-btn');

    async function fetchDefaults() {
        try {
            const res = await fetch('/api/defaults');
            const data = await res.json();

            structureInput.value = data.structure || "";
            outputInput.value = data.output || "";
            limitationsInput.value = data.limitations || "";

            systemPrompt = data.systemPrompt || "";
            knowledgeBase = data.knowledge || "";
        } catch (e) {
            console.error("Error fetching defaults", e);
        }
    }

    async function fetchTemplates() {
        try {
            const res = await fetch('/api/templates');
            templates = await res.json();
            renderTemplateSelect();
        } catch (e) {
            console.error("Error loading templates", e);
        }
    }

    function renderTemplateSelect() {
        templateSelect.innerHTML = '<option value="">-- Mis Plantillas --</option>';
        templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.name;
            option.textContent = t.name;
            templateSelect.appendChild(option);
        });

        if (currentTemplateName && templates.some(t => t.name === currentTemplateName)) {
            templateSelect.value = currentTemplateName;
        } else {
            templateSelect.value = "";
            currentTemplateName = "";
        }
        updateButtonStates();
    }

    function updateButtonStates() {
        const hasSelection = !!currentTemplateName;
        renameTemplateBtn.disabled = !hasSelection;
        deleteTemplateBtn.disabled = !hasSelection;
    }

    function constructUserMessage() {
        const structure = structureInput.value;
        const brief = briefInput.value;
        const output = outputInput.value;
        const limitations = limitationsInput.value;

        // Construct based on user requirements
        return `## PDF con explicacion de estructuras
${knowledgeBase}

## Estructura/layout/Sitemap del wireframe
${structure}

## Brief del servicio
${brief}

## Output y wireframes
${output}

## Limitaciones de caracteres
${limitations}`;
    }

    // Handlers

    // --- System Prompt Handlers ---
    const closePromptModalFunc = () => {
        systemPromptModal.classList.remove('active');
    };

    editSystemPromptBtn.addEventListener('click', () => {
        // Use current memory value
        systemPromptEditor.value = systemPrompt;
        systemPromptModal.classList.add('active');
    });

    closeSystemPromptModal.addEventListener('click', closePromptModalFunc);
    cancelSystemPromptBtn.addEventListener('click', closePromptModalFunc);

    saveSystemPromptBtn.addEventListener('click', async () => {
        const newVal = systemPromptEditor.value;

        // Save to DB
        try {
            saveSystemPromptBtn.disabled = true;
            saveSystemPromptBtn.textContent = "Guardando...";

            const res = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'systemPrompt', value: newVal })
            });

            if (!res.ok) throw new Error("Error saving config");

            systemPrompt = newVal;
            showNotification("System Prompt guardado y actualizado online", "success");
            closePromptModalFunc();
        } catch (e) {
            console.error(e);
            showNotification("Error al guardar System Prompt", "error");
        } finally {
            saveSystemPromptBtn.disabled = false;
            saveSystemPromptBtn.textContent = "Guardar Prompt";
        }
    });

    // --- Helper for Notifications ---
    function showNotification(message, type = 'info') {
        const container = document.getElementById('notification-container');
        if (!container) return console.log(message);

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '⛔';

        toast.innerHTML = `
            <div class="icon">${icon}</div>
            <div class="message">${message}</div>
        `;

        container.appendChild(toast);

        // Auto remove
        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    // --- Template Actions ---

    // NEW
    newTemplateBtn.addEventListener('click', () => {
        // Keeping confirm for destructive/reset action is standard, user asked for "messages" replacement.
        // If user insists on FULL HTML replacement, we'd need a modal. 
        // For now, let's keep confirm but use notifications for feedback.
        if (confirm("¿Limpiar campos para nueva plantilla?")) {
            currentTemplateName = "";
            templateNameInput.value = "";
            templateSelect.value = "";
            fetchDefaults();
            updateButtonStates();
            showNotification("Campos listos para nueva plantilla", "info");
        }
    });

    // SAVE (Create or Update content)
    saveTemplateBtn.addEventListener('click', async () => {
        let nameToSave = templateNameInput.value.trim();

        if (!nameToSave) {
            if (currentTemplateName) {
                nameToSave = currentTemplateName;
            } else {
                return showNotification("Escribe un nombre para guardar la plantilla", "error");
            }
        }

        const data = {
            structure: structureInput.value,
            output: outputInput.value,
            limitations: limitationsInput.value
        };

        try {
            const res = await fetch('/api/templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: nameToSave, data })
            });

            // Check success
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Error");
            }

            const resData = await res.json();
            templates = resData.templates;

            currentTemplateName = nameToSave;
            templateNameInput.value = nameToSave;
            renderTemplateSelect();

            showNotification("Plantilla guardada exitosamente", "success");

        } catch (e) {
            showNotification("Error: " + e.message, "error");
        }
    });

    // RENAME
    renameTemplateBtn.addEventListener('click', async () => {
        if (!currentTemplateName) return;

        const newName = templateNameInput.value.trim();

        if (!newName) {
            return showNotification("Por favor escribe el nuevo nombre", "error");
        }

        if (newName === currentTemplateName) {
            return showNotification("El nombre no ha cambiado", "info");
        }

        const data = {
            structure: structureInput.value,
            output: outputInput.value,
            limitations: limitationsInput.value
        };

        try {
            const res = await fetch(`/api/templates/${encodeURIComponent(currentTemplateName)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newName: newName, data })
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Error");
            }

            const resData = await res.json();
            templates = resData.templates;

            currentTemplateName = newName;
            renderTemplateSelect();

            showNotification("Plantilla renombrada correctamente", "success");

        } catch (e) {
            showNotification("Error al renombrar: " + e.message, "error");
        }
    });

    // DELETE
    deleteTemplateBtn.addEventListener('click', async () => {
        if (!currentTemplateName) return;

        if (!confirm(`¿Eliminar la plantilla "${currentTemplateName}" permanentemente?`)) return;

        try {
            const res = await fetch(`/api/templates/${encodeURIComponent(currentTemplateName)}`, {
                method: 'DELETE'
            });

            const resData = await res.json();
            templates = resData.templates;

            currentTemplateName = "";
            templateNameInput.value = "";
            fetchDefaults();
            renderTemplateSelect();

            showNotification("Plantilla eliminada", "success");

        } catch (e) {
            showNotification("Error al eliminar", "error");
        }
    });

    // SELECT CHANGE
    templateSelect.addEventListener('change', () => {
        const selectedName = templateSelect.value;
        if (!selectedName) {
            currentTemplateName = "";
            templateNameInput.value = "";
            updateButtonStates();
            return;
        }

        const t = templates.find(temp => temp.name === selectedName);
        if (t) {
            currentTemplateName = t.name;
            templateNameInput.value = t.name;

            structureInput.value = t.data.structure || "";
            outputInput.value = t.data.output || "";
            limitationsInput.value = t.data.limitations || "";
        }
        updateButtonStates();
    });

    // View Query Modal
    viewQueryBtn.addEventListener('click', () => {
        const userMsg = constructUserMessage();
        const fullQuery = `--- SYSTEM PROMPT ---\n${systemPrompt}\n\n--- USER MESSAGE ---\n${userMsg}`;
        queryPreviewContent.textContent = fullQuery;
        modal.classList.add('active');
    });

    closeModal.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
        if (e.target === systemPromptModal) systemPromptModal.classList.remove('active');
    });

    // Generate
    generateBtn.addEventListener('click', async () => {
        if (!briefInput.value.trim()) {
            return alert("Por favor ingresa primero el brief del cliente.");
        }

        const userMessage = constructUserMessage();

        generateBtn.disabled = true;
        generateBtn.textContent = "Generando...";
        finalOutput.value = ""; // Clear previous output

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt: systemPrompt,
                    userMessage: userMessage
                })
            });

            if (!response.ok) {
                // Try to parse error if json, else strings
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json();
                    if (errorData.error) errorMessage = errorData.error;
                } catch (e) { }
                throw new Error(errorMessage);
            }

            // Read the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                finalOutput.value += text;
                // Auto-scroll to bottom
                finalOutput.scrollTop = finalOutput.scrollHeight;
            }

        } catch (e) {
            console.error(e);
            finalOutput.value += "\n\n[Error interrumpió la generación: " + e.message + "]";
            alert("Error al generar: " + e.message);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = "Generar texto";
        }
    });

    // Copy
    copyBtn.addEventListener('click', () => {
        if (!finalOutput.value) return;
        navigator.clipboard.writeText(finalOutput.value)
            .then(() => {
                const originalText = copyBtn.textContent;
                copyBtn.textContent = "¡Copiado!";
                setTimeout(() => copyBtn.textContent = originalText, 2000);
            })
            .catch(err => console.error('Error copying text: ', err));
    });

    // Download
    downloadBtn.addEventListener('click', () => {
        const text = finalOutput.value;
        if (!text) return alert("No hay texto para descargar.");

        const keyword = keywordInput.value.trim() || "landing_page";
        const filename = keyword.replace(/\s+/g, '_').toLowerCase() + ".txt";

        const blob = new Blob([text], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    });
});
