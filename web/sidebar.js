import { app } from "../../scripts/app.js";

const API_BASE = "/copynotes/data";

async function loadData() {
    try {
        const res = await fetch(API_BASE);
        if (!res.ok) throw new Error("bad response");
        const data = await res.json();
        return data && Array.isArray(data.groups) ? data : { groups: [] };
    } catch (e) {
        console.error("CopyNotes: failed to load data", e);
        return { groups: [] };
    }
}

let saveTimer = null;
function saveData(data) {
    // Debounced so rapid edits don't spam the backend with writes.
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        try {
            await fetch(API_BASE, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
        } catch (e) {
            console.error("CopyNotes: failed to save data", e);
        }
    }, 400);
}

function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Truncates a snippet to whichever limit (200 chars / 10 lines) is hit first.
function truncateSnippet(text) {
    const lines = text.split("\n");
    let base = text;
    let didTruncate = false;
    if (lines.length > 10) {
        base = lines.slice(0, 10).join("\n");
        didTruncate = true;
    }
    if (base.length > 200) {
        base = base.slice(0, 200);
        didTruncate = true;
    }
    return { truncated: base, didTruncate };
}

// Shows a small "Copied!" pill floating over the row, instead of swapping the
// row's own text — that way the row's size never changes and nothing shifts.
function flashCopiedBadge(rowEl) {
    const badge = document.createElement("span");
    badge.textContent = "Copied!";
    badge.style.cssText = `
        position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
        background:#2d7a3f; color:#fff; padding:3px 10px; border-radius:12px;
        font-size:11px; font-weight:600; white-space:nowrap; pointer-events:none;
        opacity:0; transition:opacity 0.15s ease; box-shadow:0 1px 4px rgba(0,0,0,0.4);
    `;
    rowEl.appendChild(badge);
    requestAnimationFrame(() => (badge.style.opacity = "1"));
    setTimeout(() => {
        badge.style.opacity = "0";
        setTimeout(() => badge.remove(), 200);
    }, 700);
}

async function copyText(text, rowEl) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }
    flashCopiedBadge(rowEl);
}

app.registerExtension({
    name: "CopyNotes.Sidebar",
    async setup() {
        app.extensionManager.registerSidebarTab({
            id: "copyNotesSidebar",
            icon: "pi pi-clipboard",
            title: "Copy Notes",
            tooltip: "Reusable prompt snippets, organized into groups",
            type: "custom",
            render: (el) => {
                el.innerHTML = "";
                el.style.cssText = `
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    padding: 10px;
                    box-sizing: border-box;
                    overflow-y: auto;
                    gap: 10px;
                    font-size: 13px;
                    position: relative;
                `;

                let data = { groups: [] };

                // Search filters snippets only (not group names), case-insensitive.
                let searchQuery = "";

                // Which truncated snippets are currently expanded. Transient UI
                // state, deliberately not persisted.
                const expandedItems = new Set();

                // Recently-copied history (most recent first, capped at 5) and the
                // collapsed state of the History/Pinned sections. Transient — not
                // persisted to disk, resets when the sidebar is reopened.
                let historyEntries = [];
                let historyCollapsed = false;
                let pinnedCollapsed = false;

                function pushHistory(text, groupName, groupColor) {
                    historyEntries = historyEntries.filter((h) => h.text !== text);
                    historyEntries.unshift({ historyId: uid(), text, groupName, groupColor });
                    if (historyEntries.length > 5) historyEntries.length = 5;
                    renderHistory();
                }

                // Drag-and-drop reorder state (transient, not persisted).
                let draggedGroupIdx = null;
                let draggedItem = null; // { groupId, index }

                function moveInArray(arr, from, to) {
                    const [moved] = arr.splice(from, 1);
                    arr.splice(to, 0, moved);
                }

                function makeDragHandle() {
                    const handle = document.createElement("span");
                    handle.textContent = "\u283F"; // ⠿ grip-dots glyph
                    handle.title = "Drag to reorder";
                    handle.draggable = true;
                    handle.style.cssText = "cursor:grab; color:#888; font-size:13px; flex-shrink:0; padding:0 2px;";
                    handle.onclick = (e) => e.stopPropagation();
                    return handle;
                }

                // Shared header for the History/Pinned sections: a collapse arrow
                // plus a title. Returns the header element; toggling calls onToggle.
                function makeSectionHeader(labelText, color, isCollapsed, onToggle) {
                    const sectionHeader = document.createElement("div");
                    sectionHeader.style.cssText = `
                        display:flex; align-items:center; gap:6px; cursor:pointer;
                        font-size:11px; font-weight:700; color:${color}; letter-spacing:0.3px;
                    `;
                    const arrow = document.createElement("span");
                    arrow.textContent = isCollapsed ? "\u25B6" : "\u25BC";
                    arrow.style.cssText = "font-size:9px;";
                    const text = document.createElement("span");
                    text.textContent = labelText;
                    sectionHeader.appendChild(arrow);
                    sectionHeader.appendChild(text);
                    sectionHeader.onclick = onToggle;
                    return sectionHeader;
                }

                // --- History (recently copied) section ---
                const historyContainer = document.createElement("div");
                historyContainer.style.cssText = "display:none; flex-direction:column; gap:6px;";
                el.appendChild(historyContainer);

                function renderHistory() {
                    historyContainer.innerHTML = "";

                    if (historyEntries.length === 0) {
                        historyContainer.style.display = "none";
                        return;
                    }
                    historyContainer.style.display = "flex";

                    historyContainer.appendChild(
                        makeSectionHeader(`\u{1F553} History (${historyEntries.length})`, "#7fa8c9", historyCollapsed, () => {
                            historyCollapsed = !historyCollapsed;
                            renderHistory();
                        })
                    );

                    if (historyCollapsed) return;

                    historyEntries.forEach((entry) => {
                        const row = document.createElement("div");
                        row.style.cssText = `
                            display:flex; align-items:center; gap:6px; cursor:pointer;
                            background:#182430; border:1px solid #2b4457; border-radius:5px;
                            padding:6px 8px;
                        `;

                        const dot = document.createElement("span");
                        dot.title = entry.groupName;
                        dot.style.cssText = `
                            width:8px; height:8px; border-radius:50%; flex-shrink:0;
                            background:${entry.groupColor};
                        `;
                        row.appendChild(dot);

                        const label = document.createElement("span");
                        const { truncated, didTruncate } = truncateSnippet(entry.text);
                        label.textContent = didTruncate ? truncated + "\u2026" : entry.text;
                        label.style.cssText = "flex:1; min-width:0; white-space:pre-wrap; word-break:break-word; color:#ddd; font-size:12px;";
                        row.appendChild(label);

                        row.onmouseenter = () => (row.style.background = "#1f2f3d");
                        row.onmouseleave = () => (row.style.background = "#182430");
                        row.onclick = () => {
                            copyText(entry.text, row);
                            pushHistory(entry.text, entry.groupName, entry.groupColor);
                        };

                        historyContainer.appendChild(row);
                    });
                }

                // --- Pinned (quick access) section ---
                const pinnedContainer = document.createElement("div");
                pinnedContainer.style.cssText = "display:none; flex-direction:column; gap:6px;";
                el.appendChild(pinnedContainer);

                function renderPinned() {
                    pinnedContainer.innerHTML = "";

                    const pinnedEntries = [];
                    data.groups.forEach((group) => {
                        group.items.forEach((item) => {
                            if (item.pinned) pinnedEntries.push({ group, item });
                        });
                    });

                    if (pinnedEntries.length === 0) {
                        pinnedContainer.style.display = "none";
                        return;
                    }
                    pinnedContainer.style.display = "flex";

                    pinnedContainer.appendChild(
                        makeSectionHeader(`\u2605 Pinned (${pinnedEntries.length})`, "#c9a227", pinnedCollapsed, () => {
                            pinnedCollapsed = !pinnedCollapsed;
                            renderPinned();
                        })
                    );

                    if (pinnedCollapsed) return;

                    pinnedEntries.forEach(({ group, item }) => {
                        const row = document.createElement("div");
                        row.style.cssText = `
                            display:flex; align-items:center; gap:6px; cursor:pointer;
                            background:#241f10; border:1px solid #4a3f1a; border-radius:5px;
                            padding:6px 8px;
                        `;

                        const dot = document.createElement("span");
                        dot.title = group.name;
                        dot.style.cssText = `
                            width:8px; height:8px; border-radius:50%; flex-shrink:0;
                            background:${group.color || "#4a4a4a"};
                        `;
                        row.appendChild(dot);

                        const textWrapper = document.createElement("div");
                        textWrapper.style.cssText = "flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;";

                        const label = document.createElement("span");
                        label.style.cssText = "white-space:pre-wrap; word-break:break-word; color:#ddd; font-size:12px;";
                        const { truncated, didTruncate } = truncateSnippet(item.text);
                        const isExpanded = expandedItems.has(item.id);
                        label.textContent = didTruncate && !isExpanded ? truncated + "\u2026" : item.text;
                        textWrapper.appendChild(label);

                        if (didTruncate) {
                            const toggleLink = document.createElement("span");
                            toggleLink.textContent = isExpanded ? "Show less" : "Show more";
                            toggleLink.style.cssText = "align-self:flex-start; color:#4a90e2; cursor:pointer; font-size:11px; font-weight:600;";
                            toggleLink.onclick = (e) => {
                                e.stopPropagation();
                                if (isExpanded) expandedItems.delete(item.id);
                                else expandedItems.add(item.id);
                                renderPinned();
                            };
                            textWrapper.appendChild(toggleLink);
                        }
                        row.appendChild(textWrapper);

                        const unpinBtn = document.createElement("span");
                        unpinBtn.textContent = "\u2605";
                        unpinBtn.title = "Unpin";
                        unpinBtn.style.cssText = "color:#c9a227; font-size:13px; flex-shrink:0;";
                        unpinBtn.onclick = (e) => {
                            e.stopPropagation();
                            item.pinned = false;
                            persist();
                            renderGroups();
                        };
                        row.appendChild(unpinBtn);

                        row.onmouseenter = () => (row.style.background = "#2e2712");
                        row.onmouseleave = () => (row.style.background = "#241f10");
                        row.onclick = () => {
                            copyText(item.text, row);
                            pushHistory(item.text, group.name, group.color || "#4a4a4a");
                        };

                        pinnedContainer.appendChild(row);
                    });
                }

                // --- Search row ---
                const searchRow = document.createElement("div");
                searchRow.style.cssText = "display:flex; gap:6px;";

                const searchInput = document.createElement("input");
                searchInput.type = "search";
                searchInput.placeholder = "Search snippets\u2026";
                searchInput.style.cssText = `
                    flex:1; background:#1e1e1e; color:#eee; border:1px solid #3a3a3a;
                    border-radius:4px; padding:6px 8px; font-size:12px;
                `;
                searchInput.oninput = () => {
                    searchQuery = searchInput.value.trim().toLowerCase();
                    renderGroups();
                };
                searchRow.appendChild(searchInput);
                el.appendChild(searchRow);

                // --- Export / Import row ---
                const toolsRow = document.createElement("div");
                toolsRow.style.cssText = "display:flex; gap:6px;";

                const exportBtn = document.createElement("button");
                exportBtn.textContent = "Export";
                exportBtn.title = "Download all groups and snippets as a JSON file";
                exportBtn.style.cssText = `
                    flex:1; padding:6px 10px; border-radius:4px; border:1px solid #3a3a3a;
                    background:#2a2a2a; color:#ddd; cursor:pointer; font-size:12px;
                `;
                exportBtn.onclick = () => {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
                    a.href = url;
                    a.download = `copynotes-backup-${stamp}.json`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(url);
                };

                const importBtn = document.createElement("button");
                importBtn.textContent = "Import";
                importBtn.title = "Replace all groups and snippets from a JSON file (current data is backed up on disk first)";
                importBtn.style.cssText = exportBtn.style.cssText;

                const importInput = document.createElement("input");
                importInput.type = "file";
                importInput.accept = "application/json";
                importInput.style.display = "none";
                importInput.onchange = async () => {
                    const file = importInput.files[0];
                    importInput.value = "";
                    if (!file) return;

                    let parsed;
                    try {
                        parsed = JSON.parse(await file.text());
                    } catch (e) {
                        alert("CopyNotes: that file isn't valid JSON.");
                        return;
                    }
                    if (!parsed || !Array.isArray(parsed.groups)) {
                        alert("CopyNotes: that file doesn't look like a CopyNotes backup (expected a 'groups' array).");
                        return;
                    }
                    if (!confirm("Import will replace all current groups and snippets. The current data will be backed up on disk first. Continue?")) {
                        return;
                    }

                    try {
                        const res = await fetch("/copynotes/import", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(parsed),
                        });
                        if (!res.ok) throw new Error("bad response");
                        data = await loadData();
                        renderGroups();
                    } catch (e) {
                        console.error("CopyNotes: import failed", e);
                        alert("CopyNotes: import failed, see console for details.");
                    }
                };
                importBtn.onclick = () => importInput.click();

                toolsRow.appendChild(exportBtn);
                toolsRow.appendChild(importBtn);
                toolsRow.appendChild(importInput);
                el.appendChild(toolsRow);

                // --- Add group row ---
                const addGroupRow = document.createElement("div");
                addGroupRow.style.cssText = "display:flex; gap:6px;";

                const groupInput = document.createElement("input");
                groupInput.placeholder = "New group name (e.g. SDXL)";
                groupInput.style.cssText = `
                    flex:1; background:#1e1e1e; color:#eee; border:1px solid #3a3a3a;
                    border-radius:4px; padding:6px 8px; font-size:12px;
                `;

                const addGroupBtn = document.createElement("button");
                addGroupBtn.textContent = "+ Group";
                addGroupBtn.style.cssText = `
                    padding:6px 10px; border-radius:4px; border:none;
                    background:#4a90e2; color:#fff; cursor:pointer; font-size:12px;
                `;

                addGroupRow.appendChild(groupInput);
                addGroupRow.appendChild(addGroupBtn);

                const groupsContainer = document.createElement("div");
                groupsContainer.style.cssText = "display:flex; flex-direction:column; gap:10px;";

                el.appendChild(addGroupRow);
                el.appendChild(groupsContainer);

                // Floating undo toasts for deleted groups/snippets, overlaid at
                // the bottom of the sidebar. Several can stack if deletes happen
                // in quick succession.
                const toastContainer = document.createElement("div");
                toastContainer.style.cssText = `
                    position:absolute; left:10px; right:10px; bottom:10px; z-index:20;
                    display:flex; flex-direction:column; gap:6px; pointer-events:none;
                `;
                el.appendChild(toastContainer);

                function showUndoToast(message, onUndo) {
                    const toast = document.createElement("div");
                    toast.style.cssText = `
                        display:flex; align-items:center; gap:10px;
                        background:#2a2a2a; border:1px solid #4a4a4a; border-radius:6px;
                        padding:8px 10px; font-size:12px; color:#eee;
                        box-shadow:0 2px 8px rgba(0,0,0,0.5); pointer-events:auto;
                    `;
                    const text = document.createElement("span");
                    text.textContent = message;
                    text.style.cssText = "flex:1;";

                    const undoBtn = document.createElement("button");
                    undoBtn.textContent = "Undo";
                    undoBtn.style.cssText = `
                        padding:4px 10px; border-radius:4px; border:none; flex-shrink:0;
                        background:#4a90e2; color:#fff; cursor:pointer; font-size:11px;
                    `;

                    const timer = setTimeout(() => toast.remove(), 5000);
                    undoBtn.onclick = () => {
                        clearTimeout(timer);
                        toast.remove();
                        onUndo();
                    };

                    toast.appendChild(text);
                    toast.appendChild(undoBtn);
                    toastContainer.appendChild(toast);
                }

                function persist() {
                    saveData(data);
                }

                // Transient, per-group UI state (which form is open) — deliberately kept
                // outside `data` so it never gets written to disk.
                const uiState = new Map();
                function getUiState(groupId) {
                    if (!uiState.has(groupId)) uiState.set(groupId, { adding: false, editingId: null });
                    return uiState.get(groupId);
                }

                // Inline add/edit form, built fresh each time and inserted directly into
                // the sidebar's own layout (no popup, no full-screen overlay).
                function buildSnippetForm(initialValue, onSave, onCancel) {
                    const formBox = document.createElement("div");
                    formBox.style.cssText = `
                        display:flex; flex-direction:column; gap:6px;
                        background:#1e1e1e; border:1px solid #4a90e2; border-radius:5px; padding:8px;
                    `;
                    const textarea = document.createElement("textarea");
                    textarea.value = initialValue;
                    textarea.placeholder = "Snippet text\u2026";
                    textarea.style.cssText = `
                        width:100%; min-height:60px; resize:vertical; background:#111; color:#eee;
                        border:1px solid #444; border-radius:4px; padding:6px; font-size:12px; box-sizing:border-box;
                    `;
                    const btnRow = document.createElement("div");
                    btnRow.style.cssText = "display:flex; gap:6px; justify-content:flex-end;";
                    const cancelBtn = document.createElement("button");
                    cancelBtn.textContent = "Cancel";
                    cancelBtn.style.cssText = "padding:4px 10px; border-radius:4px; border:none; background:#555; color:#fff; cursor:pointer; font-size:11px;";
                    cancelBtn.onclick = (e) => {
                        e.stopPropagation();
                        onCancel();
                    };
                    const saveBtn = document.createElement("button");
                    saveBtn.textContent = "Save";
                    saveBtn.style.cssText = "padding:4px 10px; border-radius:4px; border:none; background:#4a90e2; color:#fff; cursor:pointer; font-size:11px;";
                    saveBtn.onclick = (e) => {
                        e.stopPropagation();
                        const val = textarea.value.trim();
                        if (val) onSave(val);
                        else onCancel();
                    };
                    textarea.onkeydown = (e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveBtn.click();
                        if (e.key === "Escape") cancelBtn.click();
                    };
                    btnRow.appendChild(cancelBtn);
                    btnRow.appendChild(saveBtn);
                    formBox.appendChild(textarea);
                    formBox.appendChild(btnRow);
                    formBox.onclick = (e) => e.stopPropagation();
                    setTimeout(() => textarea.focus(), 0);
                    return formBox;
                }

                function renderGroups() {
                    groupsContainer.innerHTML = "";

                    if (data.groups.length === 0) {
                        const empty = document.createElement("div");
                        empty.textContent = "No groups yet — add one above.";
                        empty.style.cssText = "color:#777; font-size:12px; font-style:italic;";
                        groupsContainer.appendChild(empty);
                    }

                    let anyGroupRendered = false;

                    data.groups.forEach((group, groupIdx) => {
                        const matchesSearch = !searchQuery || group.items.some((it) => it.text.toLowerCase().includes(searchQuery));
                        if (!matchesSearch) return;
                        anyGroupRendered = true;

                        const groupEl = document.createElement("div");
                        groupEl.style.cssText = `
                            border:1px solid #3a3a3a; border-left:4px solid ${group.color || "#4a4a4a"};
                            border-radius:6px; overflow:hidden; transition:opacity 0.15s;
                        `;

                        groupEl.ondragover = (e) => {
                            if (draggedGroupIdx === null) return;
                            e.preventDefault();
                        };
                        groupEl.ondrop = (e) => {
                            if (draggedGroupIdx === null) return;
                            e.preventDefault();
                            if (draggedGroupIdx !== groupIdx) {
                                moveInArray(data.groups, draggedGroupIdx, groupIdx);
                                persist();
                            }
                            draggedGroupIdx = null;
                            renderGroups();
                        };

                        // --- Header ---
                        const header = document.createElement("div");
                        header.style.cssText = "display:flex; align-items:center; gap:6px; background:#2a2a2a; padding:6px 8px; cursor:pointer;";
                        header.onmouseenter = () => (header.style.background = "#333");
                        header.onmouseleave = () => (header.style.background = "#2a2a2a");

                        const groupHandle = makeDragHandle();
                        groupHandle.ondragstart = (e) => {
                            e.stopPropagation();
                            draggedGroupIdx = groupIdx;
                            groupEl.style.opacity = "0.4";
                            e.dataTransfer.effectAllowed = "move";
                        };
                        groupHandle.ondragend = (e) => {
                            e.stopPropagation();
                            groupEl.style.opacity = "1";
                            draggedGroupIdx = null;
                        };
                        header.appendChild(groupHandle);

                        const toggleIcon = document.createElement("span");
                        toggleIcon.textContent = group.collapsed ? "\u25B6" : "\u25BC";
                        toggleIcon.style.cssText = "font-size:9px; color:#999; width:10px; flex-shrink:0;";
                        header.appendChild(toggleIcon);

                        const colorInput = document.createElement("input");
                        colorInput.type = "color";
                        colorInput.value = group.color || "#4a4a4a";
                        colorInput.style.cssText = "position:absolute; width:0; height:0; opacity:0; pointer-events:none;";
                        colorInput.oninput = (e) => {
                            group.color = e.target.value;
                            colorDot.style.background = group.color;
                            groupEl.style.borderLeftColor = group.color;
                            persist();
                        };

                        const colorDot = document.createElement("span");
                        colorDot.title = "Group color";
                        colorDot.style.cssText = `
                            width:13px; height:13px; border-radius:50%; flex-shrink:0;
                            border:1px solid #666; cursor:pointer; background:${group.color || "#4a4a4a"};
                        `;
                        colorDot.onclick = (e) => {
                            e.stopPropagation();
                            colorInput.click();
                        };
                        header.appendChild(colorDot);
                        header.appendChild(colorInput);

                        const title = document.createElement("span");
                        title.textContent = group.name;
                        title.title = "Double-click to rename";
                        title.style.cssText = "flex:1; font-weight:600; color:#ddd; cursor:text;";
                        title.ondblclick = (e) => {
                            e.stopPropagation();
                            const inputEl = document.createElement("input");
                            inputEl.value = group.name;
                            inputEl.style.cssText = "flex:1; background:#111; color:#eee; border:1px solid #4a90e2; border-radius:3px; padding:2px 4px; font-size:13px; font-weight:600;";
                            const commit = () => {
                                const val = inputEl.value.trim();
                                if (val) group.name = val;
                                persist();
                                renderGroups();
                            };
                            inputEl.onblur = commit;
                            inputEl.onkeydown = (ev) => {
                                if (ev.key === "Enter") inputEl.blur();
                            };
                            inputEl.onclick = (ev) => ev.stopPropagation();
                            header.replaceChild(inputEl, title);
                            inputEl.focus();
                            inputEl.select();
                        };
                        header.appendChild(title);

                        const countBadge = document.createElement("span");
                        countBadge.textContent = `(${group.items.length})`;
                        countBadge.style.cssText = "color:#888; font-size:11px; flex-shrink:0;";
                        header.appendChild(countBadge);
                        function updateCount() {
                            countBadge.textContent = `(${group.items.length})`;
                        }

                        const addItemBtn = document.createElement("button");
                        addItemBtn.textContent = "+";
                        addItemBtn.title = "Add snippet";
                        addItemBtn.style.cssText = "width:22px; height:22px; border-radius:4px; border:none; background:#4a90e2; color:#fff; cursor:pointer; font-size:13px; line-height:1;";
                        addItemBtn.onclick = (e) => e.stopPropagation();
                        header.appendChild(addItemBtn);

                        const delGroupBtn = document.createElement("button");
                        delGroupBtn.textContent = "\u2715";
                        delGroupBtn.title = "Delete group (click twice to confirm)";
                        delGroupBtn.style.cssText = "width:22px; height:22px; border-radius:4px; border:none; background:#553333; color:#fff; cursor:pointer; font-size:11px;";
                        let confirmingDelete = false;
                        delGroupBtn.onclick = (e) => {
                            e.stopPropagation();
                            if (!confirmingDelete) {
                                confirmingDelete = true;
                                delGroupBtn.style.background = "#a33";
                                delGroupBtn.textContent = "!";
                                setTimeout(() => {
                                    confirmingDelete = false;
                                    delGroupBtn.style.background = "#553333";
                                    delGroupBtn.textContent = "\u2715";
                                }, 2000);
                                return;
                            }
                            const removeIdx = data.groups.findIndex((g) => g.id === group.id);
                            if (removeIdx === -1) return;
                            const [removed] = data.groups.splice(removeIdx, 1);
                            persist();
                            renderGroups();
                            showUndoToast(`Deleted group "${removed.name}"`, () => {
                                data.groups.splice(removeIdx, 0, removed);
                                persist();
                                renderGroups();
                            });
                        };
                        header.appendChild(delGroupBtn);

                        groupEl.appendChild(header);

                        header.onclick = () => {
                            group.collapsed = !group.collapsed;
                            persist();
                            renderGroups();
                        };

                        // --- Items ---
                        const itemsList = document.createElement("div");
                        itemsList.style.cssText = `display:${group.collapsed && !searchQuery ? "none" : "flex"}; flex-direction:column; gap:6px; padding:8px;`;
                        groupEl.appendChild(itemsList);

                        function renderItems() {
                            itemsList.innerHTML = "";
                            const state = getUiState(group.id);

                            if (state.adding) {
                                const form = buildSnippetForm(
                                    "",
                                    (val) => {
                                        group.items.push({ id: uid(), text: val, pinned: false });
                                        updateCount();
                                        state.adding = false;
                                        persist();
                                        renderItems();
                                    },
                                    () => {
                                        state.adding = false;
                                        renderItems();
                                    }
                                );
                                itemsList.appendChild(form);
                            }

                            if (group.items.length === 0 && !state.adding) {
                                const empty = document.createElement("div");
                                empty.textContent = "No snippets yet.";
                                empty.style.cssText = "color:#777; font-size:11px; font-style:italic;";
                                itemsList.appendChild(empty);
                            }

                            const itemsToRender = group.items
                                .map((item, idx) => ({ item, idx }))
                                .filter(({ item }) => !searchQuery || item.text.toLowerCase().includes(searchQuery));

                            itemsToRender.forEach(({ item, idx }) => {
                                if (state.editingId === item.id) {
                                    const form = buildSnippetForm(
                                        item.text,
                                        (val) => {
                                            item.text = val;
                                            state.editingId = null;
                                            persist();
                                            renderItems();
                                        },
                                        () => {
                                            state.editingId = null;
                                            renderItems();
                                        }
                                    );
                                    itemsList.appendChild(form);
                                    return;
                                }

                                const row = document.createElement("div");
                                row.style.cssText = `
                                    position:relative; display:flex; align-items:center; gap:6px;
                                    background:#1e1e1e; border:1px solid #333; border-radius:5px;
                                    padding:6px 8px; cursor:pointer; transition:opacity 0.15s;
                                `;

                                row.ondragover = (e) => {
                                    if (!draggedItem || draggedItem.groupId !== group.id) return;
                                    e.preventDefault();
                                };
                                row.ondrop = (e) => {
                                    if (!draggedItem || draggedItem.groupId !== group.id) return;
                                    e.preventDefault();
                                    if (draggedItem.index !== idx) {
                                        moveInArray(group.items, draggedItem.index, idx);
                                        persist();
                                    }
                                    draggedItem = null;
                                    renderItems();
                                };

                                const itemHandle = makeDragHandle();
                                itemHandle.ondragstart = (e) => {
                                    e.stopPropagation();
                                    draggedItem = { groupId: group.id, index: idx };
                                    row.style.opacity = "0.4";
                                    e.dataTransfer.effectAllowed = "move";
                                };
                                itemHandle.ondragend = (e) => {
                                    e.stopPropagation();
                                    row.style.opacity = "1";
                                    draggedItem = null;
                                };
                                row.appendChild(itemHandle);

                                const textWrapper = document.createElement("div");
                                textWrapper.style.cssText = "flex:1; min-width:0; display:flex; flex-direction:column; gap:2px;";

                                const label = document.createElement("span");
                                label.style.cssText = "white-space:pre-wrap; word-break:break-word; color:#ddd;";
                                const { truncated, didTruncate } = truncateSnippet(item.text);
                                const isExpanded = expandedItems.has(item.id);
                                label.textContent = didTruncate && !isExpanded ? truncated + "\u2026" : item.text;
                                textWrapper.appendChild(label);

                                if (didTruncate) {
                                    const toggleLink = document.createElement("span");
                                    toggleLink.textContent = isExpanded ? "Show less" : "Show more";
                                    toggleLink.style.cssText = "align-self:flex-start; color:#4a90e2; cursor:pointer; font-size:11px; font-weight:600;";
                                    toggleLink.onclick = (e) => {
                                        e.stopPropagation();
                                        if (isExpanded) expandedItems.delete(item.id);
                                        else expandedItems.add(item.id);
                                        renderItems();
                                    };
                                    textWrapper.appendChild(toggleLink);
                                }

                                row.appendChild(textWrapper);

                                const pinBtn = document.createElement("span");
                                pinBtn.textContent = item.pinned ? "\u2605" : "\u2606";
                                pinBtn.title = item.pinned ? "Unpin" : "Pin to quick access";
                                pinBtn.style.cssText = `font-size:12px; flex-shrink:0; color:${item.pinned ? "#c9a227" : "inherit"}; opacity:${item.pinned ? "1" : "0.5"};`;
                                pinBtn.onmouseenter = () => (pinBtn.style.opacity = "1");
                                pinBtn.onmouseleave = () => (pinBtn.style.opacity = item.pinned ? "1" : "0.5");
                                pinBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    item.pinned = !item.pinned;
                                    persist();
                                    renderItems();
                                };
                                row.appendChild(pinBtn);

                                const editBtn = document.createElement("span");
                                editBtn.textContent = "\u270E";
                                editBtn.title = "Edit";
                                editBtn.style.cssText = "opacity:0.5; font-size:12px;";
                                editBtn.onmouseenter = () => (editBtn.style.opacity = "1");
                                editBtn.onmouseleave = () => (editBtn.style.opacity = "0.5");
                                editBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    state.editingId = item.id;
                                    renderItems();
                                };
                                row.appendChild(editBtn);

                                const delBtn = document.createElement("span");
                                delBtn.textContent = "\u2715";
                                delBtn.title = "Delete";
                                delBtn.style.cssText = "opacity:0.5; font-size:12px;";
                                delBtn.onmouseenter = () => (delBtn.style.opacity = "1");
                                delBtn.onmouseleave = () => (delBtn.style.opacity = "0.5");
                                delBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    const [removed] = group.items.splice(idx, 1);
                                    updateCount();
                                    persist();
                                    renderItems();
                                    showUndoToast("Deleted snippet", () => {
                                        group.items.splice(idx, 0, removed);
                                        updateCount();
                                        persist();
                                        renderItems();
                                    });
                                };
                                row.appendChild(delBtn);

                                row.onmouseenter = () => (row.style.background = "#292929");
                                row.onmouseleave = () => (row.style.background = "#1e1e1e");
                                row.onclick = () => {
                                    copyText(item.text, row);
                                    pushHistory(item.text, group.name, group.color || "#4a4a4a");
                                };

                                itemsList.appendChild(row);
                            });

                            renderPinned();
                        }

                        addItemBtn.onclick = (e) => {
                            e.stopPropagation();
                            const state = getUiState(group.id);
                            state.adding = true;
                            if (group.collapsed) {
                                group.collapsed = false;
                                persist();
                                renderGroups();
                                return;
                            }
                            renderItems();
                        };

                        renderItems();
                        groupsContainer.appendChild(groupEl);
                    });

                    if (searchQuery && !anyGroupRendered) {
                        const noMatches = document.createElement("div");
                        noMatches.textContent = "No matching snippets.";
                        noMatches.style.cssText = "color:#777; font-size:12px; font-style:italic;";
                        groupsContainer.appendChild(noMatches);
                    }
                }

                addGroupBtn.onclick = () => {
                    const name = groupInput.value.trim();
                    if (!name) return;
                    data.groups.push({ id: uid(), name, items: [], collapsed: false });
                    groupInput.value = "";
                    persist();
                    renderGroups();
                };
                groupInput.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") addGroupBtn.click();
                });

                loadData().then((loaded) => {
                    data = loaded;
                    renderGroups();
                });
            },
        });
    },
});
