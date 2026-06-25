document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
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

    const modelSelect = document.getElementById('model-select');

    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const newHistoryBtn = document.getElementById('new-history-btn');
    const historyList = document.getElementById('history-list');

    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsModal = document.getElementById('close-settings-modal');
    const systemPromptEditor = document.getElementById('system-prompt-editor');
    const saveSystemPromptBtn = document.getElementById('save-system-prompt-btn');
    const resetSystemPromptBtn = document.getElementById('reset-system-prompt-btn');

    const knowledgeDropzone = document.getElementById('knowledge-dropzone');
    const knowledgeFileInput = document.getElementById('knowledge-file-input');
    const currentKnowledgeName = document.getElementById('current-knowledge-name');
    const resetKnowledgeBtn = document.getElementById('reset-knowledge-btn');
    const downloadKnowledgeBtn = document.getElementById('download-knowledge-btn');
    const sidebarResizeHandle = document.getElementById('sidebar-resize-handle');

    const modal = document.getElementById('query-modal');
    const closeModal = document.getElementById('close-modal');
    const queryPreviewContent = document.getElementById('query-preview-content');

    const logsModal = document.getElementById('logs-modal');
    const logsBtn = document.getElementById('logs-btn');
    const closeLogsModal = document.getElementById('close-logs-modal');
    const logsContainer = document.getElementById('logs-container');

    // --- State ---
    let systemPrompt = "";
    let originalSystemPrompt = "";
    let knowledgeBase = "";
    let defaultStructure = "";
    let defaultOutput = "";
    let defaultLimitations = "";
    let historyItems = [];
    let currentHistoryId = null;
    let autoSaveTimeout = null;

    // --- Logger ---
    const logger = {
        send: (level, message, meta = {}) => {
            console[level === 'error' ? 'error' : 'log'](`[${level.toUpperCase()}] ${message}`, meta);
            fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ level, message, meta })
            }).catch(() => {});
        },
        info: (message, meta) => logger.send('info', message, meta),
        error: (message, meta) => logger.send('error', message, meta)
    };

    // --- Initialization ---
    fetchDefaults();
    fetchHistory();

    async function fetchDefaults() {
        try {
            const res = await fetch('/api/defaults');
            const data = await res.json();

            defaultStructure = data.structure || "";
            defaultOutput = data.output || "";
            defaultLimitations = data.limitations || "";

            structureInput.value = defaultStructure;
            outputInput.value = defaultOutput;
            limitationsInput.value = defaultLimitations;

            systemPrompt = data.systemPrompt || "";
            originalSystemPrompt = data.systemPrompt || "";
            knowledgeBase = data.knowledge || "";

            currentKnowledgeName.textContent = data.knowledgeFileName || data.knowledgeSource || 'Original';
        } catch (e) {
            logger.error("Error fetching defaults", { message: e.message });
            showNotification("Error al cargar configuración", "error");
        }
    }

    async function fetchHistory() {
        try {
            const res = await fetch('/api/history');
            historyItems = await res.json();
            renderHistoryList();
        } catch (e) {
            logger.error("Error fetching history", { message: e.message });
        }
    }

    function getWorkspaceData() {
        return {
            keyword: keywordInput.value,
            brief: briefInput.value,
            structure: structureInput.value,
            output: outputInput.value,
            limitations: limitationsInput.value,
            finalOutput: finalOutput.value,
            model: modelSelect.value
        };
    }

    function loadWorkspaceData(data) {
        if (!data) return;
        keywordInput.value = data.keyword || "";
        briefInput.value = data.brief || "";
        structureInput.value = data.structure || defaultStructure;
        outputInput.value = data.output || defaultOutput;
        limitationsInput.value = data.limitations || defaultLimitations;
        finalOutput.value = data.finalOutput || "";
        if (data.model) modelSelect.value = data.model;
    }

    function formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function renderHistoryList() {
        historyList.innerHTML = '';

        if (historyItems.length === 0) {
            historyList.innerHTML = '<li class="history-empty">Aún no hay historial</li>';
            return;
        }

        historyItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'history-item' + (item.id === currentHistoryId ? ' active' : '');
            li.dataset.id = item.id;
            li.innerHTML = `
                <div class="history-item-main">
                    <div class="history-item-title">${escapeHtml(item.name)}</div>
                    <div class="history-item-date">${formatDate(item.updated_at || item.created_at)}</div>
                </div>
                <button class="history-item-menu" title="Opciones">⋮</button>
                <div class="history-item-actions">
                    <button class="action-edit">Editar nombre</button>
                    <button class="action-delete">Eliminar</button>
                </div>
            `;

            li.addEventListener('click', (e) => {
                if (e.target.closest('.history-item-menu') || e.target.closest('.history-item-actions') || e.target.closest('.history-item-edit-input')) return;
                selectHistoryItem(item.id);
            });

            const menuBtn = li.querySelector('.history-item-menu');
            const actions = li.querySelector('.history-item-actions');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.history-item-actions').forEach(el => {
                    if (el !== actions) el.classList.remove('active');
                });
                actions.classList.toggle('active');
            });

            li.querySelector('.action-edit').addEventListener('click', (e) => {
                e.stopPropagation();
                actions.classList.remove('active');
                startInlineEdit(li, item);
            });

            li.querySelector('.action-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                actions.classList.remove('active');
                showConfirm(
                    'Eliminar elemento',
                    `¿Estás seguro de eliminar "${escapeHtml(item.name)}"?`,
                    'Eliminar',
                    () => deleteHistoryItem(item.id)
                );
            });

            historyList.appendChild(li);
        });
    }

    function startInlineEdit(li, item) {
        const titleEl = li.querySelector('.history-item-title');
        const originalName = item.name;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'history-item-edit-input';
        input.value = originalName;

        titleEl.replaceWith(input);
        input.focus();
        input.select();

        const commitEdit = async () => {
            const newName = input.value.trim();
            if (newName && newName !== originalName) {
                await updateHistoryItem(item.id, { name: newName });
            } else {
                renderHistoryList();
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                input.value = originalName;
                input.blur();
            }
        });

        input.addEventListener('blur', commitEdit, { once: true });
    }

    function selectHistoryItem(id) {
        const item = historyItems.find(h => h.id === id);
        if (!item) return;
        currentHistoryId = id;
        loadWorkspaceData(item.data);
        renderHistoryList();
        logger.info('History item loaded', { id });
    }

    async function createHistoryItem() {
        const name = keywordInput.value.trim() || "Nueva sesión";
        try {
            const res = await fetch('/api/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data: getWorkspaceData() })
            });
            const result = await res.json();
            if (result.success) {
                historyItems.unshift(result.item);
                currentHistoryId = result.item.id;
                renderHistoryList();
                logger.info('History item created', { id: result.item.id });
            }
        } catch (e) {
            logger.error('Error creating history item', { message: e.message });
        }
    }

    async function updateHistoryItem(id, changes) {
        const numericId = Number(id);
        try {
            const body = {};
            if (changes.name !== undefined) body.name = changes.name;
            if (changes.data !== undefined) body.data = changes.data;

            const res = await fetch(`/api/history/${numericId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const result = await res.json();
            if (result.success) {
                const idx = historyItems.findIndex(h => h.id === numericId);
                if (idx !== -1) historyItems[idx] = result.item;
                renderHistoryList();
            }
        } catch (e) {
            logger.error('Error updating history item', { message: e.message });
            showNotification("Error al actualizar historial", "error");
        }
    }

    async function deleteHistoryItem(id) {
        const numericId = Number(id);
        try {
            await fetch(`/api/history/${numericId}`, { method: 'DELETE' });
            historyItems = historyItems.filter(h => h.id !== numericId);
            if (currentHistoryId === numericId) {
                currentHistoryId = null;
                clearWorkspace();
            }
            renderHistoryList();
            showNotification("Elemento eliminado", "success");
        } catch (e) {
            logger.error('Error deleting history item', { message: e.message });
            showNotification("Error al eliminar", "error");
        }
    }

    function clearWorkspace() {
        keywordInput.value = "";
        briefInput.value = "";
        structureInput.value = defaultStructure;
        outputInput.value = defaultOutput;
        limitationsInput.value = defaultLimitations;
        finalOutput.value = "";
    }

    function autoSaveCurrentItem() {
        if (!currentHistoryId) return;
        clearTimeout(autoSaveTimeout);
        autoSaveTimeout = setTimeout(() => {
            updateHistoryItem(currentHistoryId, { data: getWorkspaceData() });
        }, 800);
    }

    [keywordInput, briefInput, structureInput, outputInput, limitationsInput, finalOutput, modelSelect].forEach(el => {
        el.addEventListener('input', autoSaveCurrentItem);
        el.addEventListener('change', autoSaveCurrentItem);
    });

    newHistoryBtn.addEventListener('click', async () => {
        currentHistoryId = null;
        clearWorkspace();
        renderHistoryList();
        await createHistoryItem();
        keywordInput.focus();
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.history-item')) {
            document.querySelectorAll('.history-item-actions').forEach(el => el.classList.remove('active'));
        }
    });

    // --- Settings Modal ---
    const openSettingsModal = () => {
        systemPromptEditor.value = systemPrompt;
        settingsModal.classList.add('active');
    };
    const closeSettings = () => settingsModal.classList.remove('active');

    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsModal.addEventListener('click', closeSettings);

    saveSystemPromptBtn.addEventListener('click', async () => {
        const newVal = systemPromptEditor.value;
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
            showNotification("System Prompt guardado", "success");
            logger.info('System prompt updated');
            closeSettings();
        } catch (e) {
            logger.error('Error saving system prompt', { message: e.message });
            showNotification("Error al guardar System Prompt", "error");
        } finally {
            saveSystemPromptBtn.disabled = false;
            saveSystemPromptBtn.textContent = "Guardar Prompt";
        }
    });

    resetSystemPromptBtn.addEventListener('click', async () => {
        if (!originalSystemPrompt) {
            showNotification("No se encontró el prompt original", "error");
            return;
        }
        try {
            const res = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: 'systemPrompt', value: originalSystemPrompt })
            });
            if (!res.ok) throw new Error("Error resetting config");
            systemPrompt = originalSystemPrompt;
            systemPromptEditor.value = originalSystemPrompt;
            showNotification("System Prompt restablecido", "success");
            logger.info('System prompt reset to original');
            closeSettings();
        } catch (e) {
            logger.error('Error resetting system prompt', { message: e.message });
            showNotification("Error al restablecer", "error");
        }
    });

    // --- Knowledge File Upload ---
    function handleFileUpload(file) {
        const allowed = ['.pdf', '.txt', '.docx', '.md'];
        const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
        if (!allowed.includes(ext)) {
            showNotification("Solo se permiten .pdf, .txt, .docx o .md", "error");
            return;
        }

        const formData = new FormData();
        formData.append('knowledgeFile', file);

        showNotification("Procesando archivo...", "info");
        logger.info('Uploading knowledge file', { fileName: file.name });

        fetch('/api/upload-knowledge', {
            method: 'POST',
            body: formData
        })
        .then(async res => {
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Error");
            currentKnowledgeName.textContent = data.fileName;
            showNotification("Conocimiento actualizado", "success");
            logger.info('Knowledge file processed', { fileName: data.fileName });
            await fetchDefaults();
        })
        .catch(e => {
            logger.error('Knowledge upload error', { message: e.message });
            showNotification("Error al subir archivo: " + e.message, "error");
        });
    }

    knowledgeFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
            e.target.value = '';
        }
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        knowledgeDropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        knowledgeDropzone.addEventListener(eventName, () => knowledgeDropzone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        knowledgeDropzone.addEventListener(eventName, () => knowledgeDropzone.classList.remove('dragover'), false);
    });

    knowledgeDropzone.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    });

    knowledgeDropzone.addEventListener('click', () => knowledgeFileInput.click());

    resetKnowledgeBtn.addEventListener('click', () => {
        showConfirm(
            'Restablecer conocimiento',
            '¿Restablecer el archivo de conocimiento al original?',
            'Restablecer',
            async () => {
                try {
                    const res = await fetch('/api/reset-knowledge', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Error");
                    currentKnowledgeName.textContent = data.fileName;
                    showNotification("Conocimiento restablecido", "success");
                    logger.info('Knowledge reset to original', { fileName: data.fileName });
                    await fetchDefaults();
                } catch (e) {
                    logger.error('Knowledge reset error', { message: e.message });
                    showNotification("Error al restablecer: " + e.message, "error");
                }
            }
        );
    });

    downloadKnowledgeBtn.addEventListener('click', async () => {
        try {
            const res = await fetch('/api/defaults');
            const data = await res.json();
            const knowledge = data.knowledge || '';
            if (!knowledge) {
                showNotification('No hay archivo de conocimiento disponible', 'error');
                return;
            }
            const blob = new Blob([knowledge], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'conocimiento.txt';
            document.body.appendChild(a);
            a.click();
            URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showNotification('Archivo descargado', 'success');
        } catch (e) {
            logger.error('Download knowledge error', { message: e.message });
            showNotification('Error al descargar', 'error');
        }
    });

    // --- Sidebar Toggle ---
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        if (sidebar.classList.contains('collapsed')) {
            sidebar.style.width = '';
        }
    });

    // --- Sidebar Resize ---
    let isResizing = false;
    sidebarResizeHandle.addEventListener('mousedown', (e) => {
        if (sidebar.classList.contains('collapsed')) return;
        e.preventDefault();
        isResizing = true;
        sidebarResizeHandle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = Math.max(200, Math.min(600, e.clientX));
        sidebar.style.width = newWidth + 'px';
        sidebar.style.transition = 'none';
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        sidebarResizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        sidebar.style.transition = '';
    });

    // --- Field Editor Modal ---
    const fieldEditorModal = document.getElementById('field-editor-modal');
    const fieldEditorTitle = document.getElementById('field-editor-title');
    const fieldEditorHint = document.getElementById('field-editor-hint');
    const fieldEditorTextarea = document.getElementById('field-editor-textarea');
    const fieldEditorSave = document.getElementById('field-editor-save');
    const fieldEditorReset = document.getElementById('field-editor-reset');
    const fieldEditorCancel = document.getElementById('field-editor-cancel');
    const closeFieldEditor = document.getElementById('close-field-editor');

    const fieldToInput = {
        structure: structureInput,
        output: outputInput,
        limitations: limitationsInput
    };

    let currentEditingField = null;

    document.querySelectorAll('.btn-edit-field').forEach(btn => {
        btn.addEventListener('click', () => {
            const field = btn.dataset.field;
            const label = btn.dataset.label;
            const hint = btn.dataset.hint;
            const targetInput = fieldToInput[field];
            if (!targetInput) return;

            currentEditingField = field;
            fieldEditorTitle.textContent = `Editar: ${label}`;
            fieldEditorHint.textContent = hint;
            fieldEditorTextarea.value = targetInput.value;
            fieldEditorModal.classList.add('active');
            setTimeout(() => fieldEditorTextarea.focus(), 100);
        });
    });

    const closeFieldEditorFn = () => {
        fieldEditorModal.classList.remove('active');
        currentEditingField = null;
    };

    closeFieldEditor.addEventListener('click', closeFieldEditorFn);
    fieldEditorCancel.addEventListener('click', closeFieldEditorFn);
    fieldEditorModal.addEventListener('click', (e) => {
        if (e.target === fieldEditorModal) closeFieldEditorFn();
    });

    fieldEditorSave.addEventListener('click', async () => {
        if (!currentEditingField) return;
        const newValue = fieldEditorTextarea.value;
        const targetInput = fieldToInput[currentEditingField];

        fieldEditorSave.disabled = true;
        fieldEditorSave.textContent = 'Guardando...';

        try {
            const res = await fetch('/api/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key: currentEditingField, value: newValue })
            });
            if (!res.ok) throw new Error('Error al guardar');

            targetInput.value = newValue;
            autoSaveCurrentItem();
            showNotification('Cambios guardados', 'success');
            logger.info('Field saved', { field: currentEditingField });
            closeFieldEditorFn();
        } catch (e) {
            logger.error('Error saving field', { field: currentEditingField, message: e.message });
            showNotification('Error al guardar: ' + e.message, 'error');
        } finally {
            fieldEditorSave.disabled = false;
            fieldEditorSave.textContent = 'Guardar cambios';
        }
    });

    fieldEditorReset.addEventListener('click', () => {
        if (!currentEditingField) return;
        showConfirm(
            'Restablecer campo',
            '¿Restablecer al texto original del archivo RAG? Se perderán los cambios actuales.',
            'Restablecer',
            async () => {
                fieldEditorReset.disabled = true;
                try {
                    const res = await fetch('/api/reset-field', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: currentEditingField })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || 'Error');

                    const targetInput = fieldToInput[currentEditingField];
                    targetInput.value = data.value;
                    fieldEditorTextarea.value = data.value;
                    if (currentEditingField === 'structure') defaultStructure = data.value;
                    if (currentEditingField === 'output') defaultOutput = data.value;
                    if (currentEditingField === 'limitations') defaultLimitations = data.value;
                    autoSaveCurrentItem();
                    showNotification('Campo restablecido al original', 'success');
                    logger.info('Field reset to original', { field: currentEditingField });
                } catch (e) {
                    logger.error('Error resetting field', { message: e.message });
                    showNotification('Error al restablecer: ' + e.message, 'error');
                } finally {
                    fieldEditorReset.disabled = false;
                }
            }
        );
    });

    // --- Query Modal ---
    function constructUserMessage() {
        return `## PDF con explicacion de estructuras
${knowledgeBase}

## Estructura/layout/Sitemap del wireframe
${structureInput.value}

## Brief del servicio
${briefInput.value}

## Output y wireframes
${outputInput.value}

## Limitaciones de caracteres
${limitationsInput.value}`;
    }

    viewQueryBtn.addEventListener('click', () => {
        const userMsg = constructUserMessage();
        const fullQuery = `--- SYSTEM PROMPT ---\n${systemPrompt}\n\n--- USER MESSAGE ---\n${userMsg}`;
        queryPreviewContent.textContent = fullQuery;
        modal.classList.add('active');
    });

    closeModal.addEventListener('click', () => modal.classList.remove('active'));

    // --- Generate ---
    generateBtn.addEventListener('click', async () => {
        if (!briefInput.value.trim()) {
            showNotification("Por favor ingresa el brief del cliente", "error");
            return;
        }

        const userMessage = constructUserMessage();
        const selectedModel = modelSelect.value;

        generateBtn.disabled = true;
        generateBtn.textContent = "Generando...";
        finalOutput.value = "";

        logger.info('Generation started', { model: selectedModel });

        try {
            const response = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemPrompt: systemPrompt,
                    userMessage: userMessage,
                    model: selectedModel
                })
            });

            if (!response.ok) {
                let errorMessage = response.statusText;
                try {
                    const errorData = await response.json();
                    if (errorData.error) errorMessage = errorData.error;
                } catch (e) { }
                throw new Error(errorMessage);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                finalOutput.value += text;
                finalOutput.scrollTop = finalOutput.scrollHeight;
            }

            logger.info('Generation completed', { model: selectedModel });
            showNotification("Texto generado", "success");

            if (!currentHistoryId) {
                await createHistoryItem();
            } else {
                await updateHistoryItem(currentHistoryId, {
                    name: keywordInput.value.trim() || "Sin título",
                    data: getWorkspaceData()
                });
            }

        } catch (e) {
            logger.error('Generation error', { message: e.message, model: selectedModel });
            finalOutput.value += "\n\n[Error: " + e.message + "]";
            showNotification("Error al generar: " + e.message, "error");
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = "Generar texto";
        }
    });

    // --- Copy & Download ---
    copyBtn.addEventListener('click', () => {
        if (!finalOutput.value) return;
        navigator.clipboard.writeText(finalOutput.value)
            .then(() => {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>`;
                setTimeout(() => copyBtn.innerHTML = originalHTML, 2000);
            })
            .catch(err => logger.error('Error copying text', { message: err.message }));
    });

    downloadBtn.addEventListener('click', () => {
        const text = finalOutput.value;
        if (!text) return showNotification("No hay texto para descargar", "error");

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

    // --- Logs Modal ---
    async function renderLogs() {
        try {
            const res = await fetch('/api/logs');
            const logs = await res.json();
            logsContainer.innerHTML = '';

            if (logs.length === 0) {
                logsContainer.innerHTML = '<div class="log-empty">No hay logs registrados</div>';
                return;
            }

            logs.forEach(log => {
                const row = document.createElement('div');
                row.className = `log-row ${log.level}`;
                const time = new Date(log.created_at).toLocaleString('es-ES');
                row.innerHTML = `
                    <span class="log-time">${time}</span>
                    <span class="log-level">${log.level.toUpperCase()}</span>
                    <span class="log-message">${escapeHtml(log.message)}</span>
                `;
                logsContainer.appendChild(row);
            });
        } catch (e) {
            logsContainer.innerHTML = '<div class="log-empty">Error al cargar logs</div>';
        }
    }

    logsBtn.addEventListener('click', () => {
        logsModal.classList.add('active');
        renderLogs();
    });

    closeLogsModal.addEventListener('click', () => logsModal.classList.remove('active'));

    // --- Window clicks for modals ---
    window.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
        if (e.target === settingsModal) settingsModal.classList.remove('active');
        if (e.target === logsModal) logsModal.classList.remove('active');
    });

    // ESC key closes modals
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (fieldEditorModal.classList.contains('active')) closeFieldEditorFn();
            else if (settingsModal.classList.contains('active')) closeSettings();
            else if (modal.classList.contains('active')) modal.classList.remove('active');
            else if (logsModal.classList.contains('active')) logsModal.classList.remove('active');
        }
    });

    // --- Logout ---
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            showConfirm(
                'Cerrar sesión',
                '¿Estás seguro de que deseas cerrar sesión?',
                'Cerrar sesión',
                async () => {
                    try {
                        await fetch('/api/logout', { method: 'POST' });
                        window.location.reload();
                    } catch (e) {
                        logger.error('Logout error', { message: e.message });
                    }
                }
            );
        });
    }

    // --- Helpers ---
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

        setTimeout(() => {
            toast.classList.add('hiding');
            toast.addEventListener('animationend', () => toast.remove());
        }, 4000);
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showConfirm(title, message, confirmLabel, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h4>${escapeHtml(title)}</h4>
                <p>${message}</p>
                <div class="confirm-dialog-actions">
                    <button class="btn-secondary confirm-cancel">Cancelar</button>
                    <button class="btn-danger confirm-ok">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const cleanup = () => overlay.remove();

        overlay.querySelector('.confirm-cancel').addEventListener('click', cleanup);
        overlay.querySelector('.confirm-ok').addEventListener('click', () => {
            cleanup();
            onConfirm();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) cleanup();
        });

        overlay.querySelector('.confirm-cancel').focus();
    }
});
