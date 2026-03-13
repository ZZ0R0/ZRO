(function () {
    'use strict';

    const SLUG = ZroClient.slugFromUrl() || 'tasks';
    const STATUSES = ['todo', 'in_progress', 'done'];
    const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };

    let allTasks = [];
    let categories = [];
    let conn = null;
    let draggedId = null;

    // ── DOM refs ────────────────────────────────────────────

    const connBadge      = document.getElementById('conn-badge');
    const btnAdd         = document.getElementById('btn-add');
    const btnFilter      = document.getElementById('btn-filter');
    const filterBar      = document.getElementById('filter-bar');
    const filterCategory = document.getElementById('filter-category');
    const filterPriority = document.getElementById('filter-priority');
    const filterSearch   = document.getElementById('filter-search');

    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle   = document.getElementById('modal-title');
    const modalClose   = document.getElementById('modal-close');
    const taskForm     = document.getElementById('task-form');
    const fieldId       = document.getElementById('task-id');
    const fieldTitle    = document.getElementById('task-title-input');
    const fieldDesc     = document.getElementById('task-desc');
    const fieldStatus   = document.getElementById('task-status');
    const fieldPriority = document.getElementById('task-priority');
    const fieldCategory = document.getElementById('task-category');
    const fieldDue      = document.getElementById('task-due');
    const btnDelete     = document.getElementById('btn-delete-task');
    const btnCancel     = document.getElementById('btn-cancel');

    // ── Utility ─────────────────────────────────────────────

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function categoryById(id) {
        return categories.find(c => c.id === id);
    }

    function formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    }

    function dueDateClass(iso) {
        if (!iso) return '';
        const due = new Date(iso);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const diff = (due - now) / (1000 * 60 * 60 * 24);
        if (diff < 0) return 'overdue';
        if (diff <= 2) return 'soon';
        return '';
    }

    // ── Filter logic ────────────────────────────────────────

    function getFilteredTasks() {
        let tasks = allTasks;
        const cat = filterCategory.value;
        const pri = filterPriority.value;
        const q   = filterSearch.value.toLowerCase().trim();

        if (cat) tasks = tasks.filter(t => t.category === cat);
        if (pri) tasks = tasks.filter(t => t.priority === pri);
        if (q)   tasks = tasks.filter(t =>
            t.title.toLowerCase().includes(q) ||
            t.description.toLowerCase().includes(q)
        );

        return tasks;
    }

    // ── Rendering ───────────────────────────────────────────

    function renderBoard() {
        const tasks = getFilteredTasks();

        for (const status of STATUSES) {
            const col = document.getElementById('col-' + status);
            const countEl = document.getElementById('count-' + status);
            const colTasks = tasks
                .filter(t => t.status === status)
                .sort((a, b) => {
                    if (a.position !== b.position) return a.position - b.position;
                    return (PRIORITY_ORDER[a.priority] || 2) - (PRIORITY_ORDER[b.priority] || 2);
                });

            countEl.textContent = colTasks.length;

            col.innerHTML = colTasks.map(t => renderCard(t)).join('');

            // Attach card events
            col.querySelectorAll('.task-card').forEach(card => {
                card.addEventListener('click', () => openEditModal(card.dataset.id));
                card.setAttribute('draggable', 'true');
                card.addEventListener('dragstart', onDragStart);
                card.addEventListener('dragend', onDragEnd);
            });
        }
    }

    function renderCard(task) {
        const cat = categoryById(task.category);
        const catBadge = cat
            ? `<span class="card-category" style="background:${escapeHtml(cat.color)}">${escapeHtml(cat.name)}</span>`
            : '';
        const dueCls = dueDateClass(task.due_date);
        const dueStr = task.due_date ? `<span class="card-due ${dueCls}">📅 ${formatDate(task.due_date)}</span>` : '';
        const desc = task.description
            ? `<div class="card-desc">${escapeHtml(task.description)}</div>`
            : '';

        return `<div class="task-card" data-id="${task.id}" draggable="true">
            <div class="card-top">
                <span class="priority-dot ${task.priority}"></span>
                <span class="card-title">${escapeHtml(task.title)}</span>
            </div>
            ${desc}
            <div class="card-meta">
                ${catBadge}
                ${dueStr}
                <span class="card-author">${escapeHtml(task.created_by || '')}</span>
            </div>
        </div>`;
    }

    function populateCategorySelects() {
        const options = categories.map(c =>
            `<option value="${c.id}">${escapeHtml(c.name)}</option>`
        ).join('');

        // Filter dropdown
        filterCategory.innerHTML = '<option value="">Toutes</option>' + options;

        // Modal dropdown
        fieldCategory.innerHTML = options || '<option value="">—</option>';
    }

    // ── Drag and drop ───────────────────────────────────────

    function onDragStart(e) {
        draggedId = e.currentTarget.dataset.id;
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedId);
    }

    function onDragEnd(e) {
        e.currentTarget.classList.remove('dragging');
        draggedId = null;
        // Clear all drag-over highlights
        document.querySelectorAll('.column-body.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    function setupDropZones() {
        for (const status of STATUSES) {
            const col = document.getElementById('col-' + status);
            col.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                col.classList.add('drag-over');
            });
            col.addEventListener('dragleave', () => {
                col.classList.remove('drag-over');
            });
            col.addEventListener('drop', async (e) => {
                e.preventDefault();
                col.classList.remove('drag-over');
                const taskId = e.dataTransfer.getData('text/plain');
                if (!taskId) return;

                // Calculate drop position
                const cards = col.querySelectorAll('.task-card');
                let position = cards.length;
                for (let i = 0; i < cards.length; i++) {
                    const rect = cards[i].getBoundingClientRect();
                    if (e.clientY < rect.top + rect.height / 2) {
                        position = i;
                        break;
                    }
                }

                await moveTask(taskId, status, position);
            });
        }
    }

    async function moveTask(taskId, newStatus, position) {
        try {
            await conn.invoke('move_task', {
                id: taskId,
                status: newStatus,
                position: position,
            });
            // Optimistic update
            const task = allTasks.find(t => t.id === taskId);
            if (task) {
                task.status = newStatus;
                task.position = position;
            }
            renderBoard();
        } catch (err) {
            console.error('Failed to move task:', err);
        }
    }

    // ── Modal ───────────────────────────────────────────────

    function openNewModal() {
        fieldId.value = '';
        fieldTitle.value = '';
        fieldDesc.value = '';
        fieldStatus.value = 'todo';
        fieldPriority.value = 'medium';
        fieldCategory.value = categories.length ? categories[0].id : '';
        fieldDue.value = '';
        modalTitle.textContent = 'Nouvelle tâche';
        btnDelete.classList.add('hidden');
        modalOverlay.classList.remove('hidden');
        fieldTitle.focus();
    }

    function openEditModal(taskId) {
        const task = allTasks.find(t => t.id === taskId);
        if (!task) return;

        fieldId.value = task.id;
        fieldTitle.value = task.title;
        fieldDesc.value = task.description || '';
        fieldStatus.value = task.status;
        fieldPriority.value = task.priority;
        fieldCategory.value = task.category || '';
        fieldDue.value = task.due_date || '';
        modalTitle.textContent = 'Modifier la tâche';
        btnDelete.classList.remove('hidden');
        modalOverlay.classList.remove('hidden');
        fieldTitle.focus();
    }

    function closeModal() {
        modalOverlay.classList.add('hidden');
    }

    async function saveTask() {
        const title = fieldTitle.value.trim();
        if (!title) { fieldTitle.focus(); return; }

        const payload = {
            title,
            description: fieldDesc.value,
            status: fieldStatus.value,
            priority: fieldPriority.value,
            category: fieldCategory.value,
            due_date: fieldDue.value || null,
        };

        try {
            if (fieldId.value) {
                // Update
                payload.id = fieldId.value;
                const updated = await conn.invoke('update_task', payload);
                const idx = allTasks.findIndex(t => t.id === updated.id);
                if (idx >= 0) allTasks[idx] = updated;
            } else {
                // Create
                const created = await conn.invoke('create_task', payload);
                allTasks.push(created);
            }
            closeModal();
            renderBoard();
        } catch (err) {
            console.error('Failed to save task:', err);
            alert('Erreur lors de la sauvegarde : ' + err.message);
        }
    }

    async function deleteTask() {
        const id = fieldId.value;
        if (!id) return;
        if (!confirm('Supprimer cette tâche ?')) return;

        try {
            await conn.invoke('delete_task', { id });
            allTasks = allTasks.filter(t => t.id !== id);
            closeModal();
            renderBoard();
        } catch (err) {
            console.error('Failed to delete task:', err);
            alert('Erreur lors de la suppression : ' + err.message);
        }
    }

    // ── Data loading ────────────────────────────────────────

    async function loadData() {
        try {
            const data = await conn.invoke('list_tasks');
            allTasks = data.tasks || [];
            categories = data.categories || [];
            populateCategorySelects();
            renderBoard();
        } catch (err) {
            console.error('Failed to load tasks:', err);
        }
    }

    // ── WebSocket real-time ─────────────────────────────────

    function setupWebSocket() {
        conn = ZroClient.connect({
            slug: SLUG,
            onConnect() {
                connBadge.textContent = 'Connecté';
                connBadge.className = 'connection-badge connected';
                loadData();
            },
            onDisconnect() {
                connBadge.textContent = 'Déconnecté';
                connBadge.className = 'connection-badge disconnected';
            },
        });

        conn.on('tasks:changed', (payload) => {
            const action = payload.action;
            if (action === 'created') {
                if (payload.task && !allTasks.find(t => t.id === payload.task.id)) {
                    allTasks.push(payload.task);
                }
            } else if (action === 'updated' || action === 'moved') {
                if (payload.task) {
                    const idx = allTasks.findIndex(t => t.id === payload.task.id);
                    if (idx >= 0) allTasks[idx] = payload.task;
                    else allTasks.push(payload.task);
                }
            } else if (action === 'deleted') {
                allTasks = allTasks.filter(t => t.id !== payload.task_id);
            }
            renderBoard();
        });

        conn.on('tasks:data', (payload) => {
            allTasks = payload.tasks || [];
            categories = payload.categories || [];
            populateCategorySelects();
            renderBoard();
        });
    }

    // ── Event bindings ──────────────────────────────────────

    btnAdd.addEventListener('click', openNewModal);
    btnFilter.addEventListener('click', () => {
        filterBar.classList.toggle('hidden');
    });
    modalClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);
    btnDelete.addEventListener('click', deleteTask);
    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
    });

    // Filters trigger re-render
    filterCategory.addEventListener('change', renderBoard);
    filterPriority.addEventListener('change', renderBoard);
    filterSearch.addEventListener('input', renderBoard);

    // Form submit via Enter
    taskForm.addEventListener('submit', (e) => {
        e.preventDefault();
        saveTask();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
            closeModal();
        }
        if (e.key === 'n' && !e.ctrlKey && !e.metaKey && e.target === document.body) {
            e.preventDefault();
            openNewModal();
        }
    });

    // ── Init ────────────────────────────────────────────────

    setupDropZones();
    setupWebSocket();

})();
