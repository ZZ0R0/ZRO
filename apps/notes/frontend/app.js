(function () {
    'use strict';

    const SLUG = ZroClient.slugFromUrl() || 'notes';
    const AUTOSAVE_DELAY = 1000;

    let notes = [];
    let activeNoteId = null;
    let saveTimer = null;
    let conn = null;

    // DOM refs
    const notesList = document.getElementById('notes-list');
    const noteTitle = document.getElementById('note-title');
    const noteContent = document.getElementById('note-content');
    const btnNew = document.getElementById('btn-new');
    const btnDelete = document.getElementById('btn-delete');
    const statusText = document.getElementById('status-text');

    // --- Render ---
    function renderList() {
        if (notes.length === 0) {
            notesList.innerHTML = '<div class="empty-state">No notes yet</div>';
            return;
        }
        notesList.innerHTML = notes.map(n => {
            const active = n.id === activeNoteId ? ' active' : '';
            const date = new Date(n.updated_at).toLocaleDateString();
            return `<div class="note-item${active}" data-id="${n.id}">
                <div class="note-item-title">${escapeHtml(n.title || 'Untitled')}</div>
                <div class="note-item-date">${date}</div>
            </div>`;
        }).join('');

        // Attach click handlers
        notesList.querySelectorAll('.note-item').forEach(el => {
            el.addEventListener('click', () => selectNote(el.dataset.id));
        });
    }

    function updateEditor(note) {
        if (!note) {
            noteTitle.value = '';
            noteContent.value = '';
            noteTitle.disabled = true;
            noteContent.disabled = true;
            btnDelete.disabled = true;
            statusText.textContent = 'Select or create a note';
            return;
        }
        noteTitle.value = note.title || '';
        noteContent.value = note.content || '';
        noteTitle.disabled = false;
        noteContent.disabled = false;
        btnDelete.disabled = false;
        statusText.textContent = 'Last saved: ' + new Date(note.updated_at || note.created_at).toLocaleString();
    }

    function setStatus(text) {
        statusText.textContent = text;
    }

    // --- Actions ---
    async function loadNotes() {
        try {
            const data = await conn.invoke('list_notes', {});
            notes = data.notes || [];
            renderList();
        } catch (e) {
            console.error('Failed to load notes:', e);
            setStatus('Error loading notes');
        }
    }

    async function selectNote(id) {
        // Save current note first
        if (activeNoteId && saveTimer) {
            clearTimeout(saveTimer);
            await saveCurrentNote();
        }
        activeNoteId = id;
        renderList();
        try {
            const note = await conn.invoke('get_note', { id });
            updateEditor(note);
        } catch (e) {
            console.error('Failed to load note:', e);
            setStatus('Error loading note');
        }
    }

    async function createNote() {
        try {
            const note = await conn.invoke('create_note', {
                title: 'New Note',
                content: ''
            });
            notes.unshift({
                id: note.id,
                title: note.title,
                preview: '',
                updated_at: note.created_at,
            });
            renderList();
            await selectNote(note.id);
            noteTitle.focus();
            noteTitle.select();
        } catch (e) {
            console.error('Failed to create note:', e);
            setStatus('Error creating note');
        }
    }

    async function saveCurrentNote() {
        if (!activeNoteId) return;
        const title = noteTitle.value;
        const content = noteContent.value;
        setStatus('Saving…');
        try {
            const updated = await conn.invoke('update_note', { id: activeNoteId, title, content });
            // Update in list
            const idx = notes.findIndex(n => n.id === activeNoteId);
            if (idx >= 0) {
                notes[idx].title = updated.title;
                notes[idx].preview = updated.content.substring(0, 100);
                notes[idx].updated_at = updated.updated_at;
            }
            renderList();
            setStatus('Saved at ' + new Date().toLocaleTimeString());
        } catch (e) {
            console.error('Failed to save note:', e);
            setStatus('Error saving');
        }
    }

    async function deleteCurrentNote() {
        if (!activeNoteId) return;
        if (!confirm('Delete this note?')) return;
        try {
            await conn.invoke('delete_note', { id: activeNoteId });
            notes = notes.filter(n => n.id !== activeNoteId);
            activeNoteId = null;
            updateEditor(null);
            renderList();
            setStatus('Note deleted');
        } catch (e) {
            console.error('Failed to delete note:', e);
            setStatus('Error deleting note');
        }
    }

    function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            saveCurrentNote();
        }, AUTOSAVE_DELAY);
        setStatus('Editing…');
    }

    // --- Event listeners ---
    btnNew.addEventListener('click', createNote);
    btnDelete.addEventListener('click', deleteCurrentNote);
    noteTitle.addEventListener('input', scheduleSave);
    noteContent.addEventListener('input', scheduleSave);

    // --- WebSocket connection ---
    conn = ZroClient.connect({
        slug: SLUG,
        onConnect: function () {
            console.log('WS connected');
            loadNotes();
        },
        onDisconnect: function () {
            console.log('WS disconnected');
        }
    });

    conn.on('notes:changed', function (data) {
        // Reload the notes list when changes happen (from another client)
        loadNotes();
    });

    // --- Utility ---
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
})();
