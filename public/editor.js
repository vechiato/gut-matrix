// editor.js - GUT List editor logic

const RECENT_KEY = 'gut_matrix_recent';
const USER_ID_KEY = 'gut_user_id';
const AUTO_SAVE_SETTING_KEY = 'gut_auto_save_enabled';
const AUTO_SAVE_DEBOUNCE_MS = 5000; // 5 seconds (increased from 3)
let currentList = null;
let isDirty = false;
let currentNotesItemId = null;
let refreshInterval = null;
let userId = null;
let autoSaveTimeout = null;
let autoSaveEnabled = false;
let lastSaveTime = null;
let conflictModalFocusTrap = null;
let conflictModalPreviousFocus = null;
let undoItem = null;
let undoIndex = null;
let undoTimeout = null;

// ── Security helpers ─────────────────────────────────────────────────────────

function getOwnerToken(slug) {
  return localStorage.getItem(`gut_owner_${slug}`) || null;
}

// ── User ID management ────────────────────────────────────────────────────────

function getUserId() {
  if (userId) return userId;
  
  // Try to get from localStorage
  let storedId = localStorage.getItem(USER_ID_KEY);
  
  if (!storedId) {
    // Generate new UUID
    storedId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, storedId);
  }
  
  userId = storedId;
  return userId;
}

// Auto-save setting management
function getAutoSaveSetting() {
  const setting = localStorage.getItem(AUTO_SAVE_SETTING_KEY);
  return setting === 'true';
}

function setAutoSaveSetting(enabled) {
  autoSaveEnabled = enabled;
  localStorage.setItem(AUTO_SAVE_SETTING_KEY, enabled ? 'true' : 'false');
  updateAutoSaveIndicator();
}

function updateAutoSaveIndicator() {
  const indicator = document.getElementById('autoSaveIndicator');
  const toggle = document.getElementById('autoSaveToggle');
  if (indicator) {
    indicator.textContent = autoSaveEnabled ? 'Auto-save: ON' : 'Auto-save: OFF';
    indicator.className = autoSaveEnabled ? 'auto-save-on' : 'auto-save-off';
  }
  if (toggle) {
    toggle.setAttribute('aria-pressed', autoSaveEnabled ? 'true' : 'false');
  }
}

function updateSaveStatus() {
  const status = document.getElementById('saveStatus');
  const saveBtn = document.getElementById('saveBtn');
  
  if (isDirty) {
    status.textContent = '● Unsaved changes';
    status.className = 'save-status unsaved';
    saveBtn.classList.add('has-changes');
  } else {
    if (lastSaveTime) {
      const elapsed = Date.now() - lastSaveTime;
      if (elapsed < 3000) {
        status.textContent = '✓ Saved';
      } else {
        status.textContent = `✓ Saved ${formatTimeAgo(lastSaveTime)}`;
      }
    } else {
      status.textContent = '✓ Saved';
    }
    status.className = 'save-status saved';
    saveBtn.classList.remove('has-changes');
  }
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Initialize user ID
  getUserId();
  
  // Initialize auto-save setting
  autoSaveEnabled = getAutoSaveSetting();
  updateAutoSaveIndicator();
  
  const slug = getSlugFromUrl();
  if (!slug) {
    window.location.href = '/';
    return;
  }
  
  loadList(slug);
  
  // Event handlers
  document.getElementById('saveBtn').addEventListener('click', handleSave);
  document.getElementById('shareBtn').addEventListener('click', handleShare);
  document.getElementById('deleteBtn').addEventListener('click', handleDelete);
  document.getElementById('addItemBtn').addEventListener('click', handleAddItem);
  document.getElementById('sortBtn').addEventListener('click', handleSort);
  document.getElementById('listTitle').addEventListener('blur', handleTitleChange);
  document.getElementById('listTitle').addEventListener('input', () => {
    isDirty = true;
    updateSaveStatus();
  });
  
  // Auto-save toggle
  document.getElementById('autoSaveToggle').addEventListener('click', () => {
    setAutoSaveSetting(!autoSaveEnabled);
  });
  
  // Avg toggle (mobile)
  document.getElementById('avgToggleBtn').addEventListener('click', handleAvgToggle);

  // Undo toast
  document.getElementById('undoToastBtn').addEventListener('click', handleUndo);

  // Error banner
  document.getElementById('errorBannerClose').addEventListener('click', hideBanner);


  // Export/Import handlers
  document.getElementById('exportCsvBtn').addEventListener('click', handleExportCsv);
  document.getElementById('exportJsonBtn').addEventListener('click', handleExportJson);
  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFileInput').click());
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);
  
  // Notes handlers
  document.getElementById('saveNotesBtn').addEventListener('click', handleSaveNotes);
  document.getElementById('closeNotesBtn').addEventListener('click', hideNotes);
  
  // Conflict modal handlers
  document.getElementById('takeServerBtn').addEventListener('click', handleTakeServer);
  document.getElementById('retryBtn').addEventListener('click', handleRetry);
  document.getElementById('cancelBtn').addEventListener('click', hideConflictModal);
  
  // Auto-save warning on unload
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  
  // Update save status every 30 seconds
  setInterval(updateSaveStatus, 30000);
  
  // Start auto-refresh polling (every 10 seconds)
  startAutoRefresh();
});

function getSlugFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('slug');
}

function startAutoRefresh() {
  // Clear any existing interval
  if (refreshInterval) clearInterval(refreshInterval);
  
  // Poll for updates every 10 seconds
  refreshInterval = setInterval(async () => {
    if (isDirty) {
      // Don't refresh if user has unsaved changes
      return;
    }
    
    try {
      const slug = getSlugFromUrl();
      
      // Smart sync: only fetch if version changed
      // Send current version in header for comparison
      const response = await fetch(`/api/list/${slug}`, {
        headers: {
          'X-Current-Version': String(currentList?.version || 0),
        },
      });
      
      if (response.ok) {
        const latest = await response.json();
        
        // Check if there's a newer version
        if (!currentList || latest.version > currentList.version) {
          currentList = latest;
          renderList();
          setStatus('📡 Updated by collaborator', 'info');
          setTimeout(() => setStatus(''), 3000);
        }
      } else if (response.status === 304) {
        // No changes - server returned 304 Not Modified
        console.log('Auto-sync: No changes detected');
      }
    } catch (error) {
      console.error('Auto-refresh error:', error);
      // Don't show error to user, just log it
    }
  }, 10000); // Every 10 seconds
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

async function loadList(slug) {
  try {
    setStatus('Loading...');
    const response = await fetch(`/api/list/${slug}`);
    if (!response.ok) {
      if (response.status === 404) { window.location.href = '/'; return; }
      throw new Error(`Failed to load list: ${response.statusText}`);
    }
    currentList = await response.json();
    renderList();
    updateDeleteButtonState(slug);
    updateRecent();
    setStatus('');
  } catch (error) {
    console.error('Load error:', error);
    setStatus('Failed to load', 'error');
  }
}

function updateDeleteButtonState(slug) {
  const btn = document.getElementById('deleteBtn');
  const hasToken = !!getOwnerToken(slug);
  btn.disabled = !hasToken;
  btn.title = hasToken ? 'Delete this list permanently' : 'Only the list creator can delete this list';
}

function renderList() {
  if (!currentList) return;
  
  document.getElementById('listTitle').textContent = currentList.title || 'Untitled List';
  document.getElementById('scaleDisplay').textContent = `${currentList.scale.min}-${currentList.scale.max}`;
  
  const tbody = document.getElementById('itemsBody');
  
  if (currentList.items.length === 0) {
    tbody.innerHTML = `<tr class="empty-state-row"><td colspan="11">
      <div class="editor-empty-state">
        <div class="editor-empty-icon">📋</div>
        <p class="editor-empty-title">No items yet</p>
        <p class="editor-empty-text">Click <strong>+ Add Item</strong> above to start scoring</p>
      </div>
    </td></tr>`;
    isDirty = false;
    updateSaveStatus();
    return;
  }
  
  const uid = getUserId();
  
  tbody.innerHTML = currentList.items.map(item => {
    // Get user's scores
    const userScore = item.scores?.[uid];
    const userG = userScore?.g ?? '';
    const userU = userScore?.u ?? '';
    const userT = userScore?.t ?? '';
    const userTotal = userScore?.score ?? '';
    
    // Get average scores
    const avg = item.avgScore;
    const hasAvg = avg && avg.count >= 2;
    const avgG = hasAvg ? avg.g.toFixed(1) : '-';
    const avgU = hasAvg ? avg.u.toFixed(1) : '-';
    const avgT = hasAvg ? avg.t.toFixed(1) : '-';
    const avgTotal = hasAvg ? avg.score.toFixed(1) : '-';
    const count = hasAvg ? avg.count : '-';
    
    const itemLabel = escapeHtml(item.label) || 'this item';
    const notePreview = item.notes
      ? escapeAttr(item.notes.length > 80 ? item.notes.substring(0, 80) + '…' : item.notes)
      : '';
    return `
      <tr data-id="${item.id}">
        <td class="col-label">
          <textarea data-field="label" class="item-input input-label" maxlength="400" placeholder="Item description" rows="1" aria-label="Item description">${escapeHtml(item.label)}</textarea>
          ${item.notes ? `<span class="has-notes" aria-hidden="true" title="${notePreview}">📝</span>` : ''}
          ${item.url ? '<a href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener noreferrer" class="has-url" aria-label="Open reference link"><span aria-hidden="true">🔗</span></a>' : ''}
        </td>
        <td class="col-g">${renderScoreChips('g', userG, currentList.scale.min, currentList.scale.max, itemLabel)}</td>
        <td class="col-u">${renderScoreChips('u', userU, currentList.scale.min, currentList.scale.max, itemLabel)}</td>
        <td class="col-t">${renderScoreChips('t', userT, currentList.scale.min, currentList.scale.max, itemLabel)}</td>
        <td class="col-score"><strong class="score-display" aria-label="Your score">${userTotal}</strong></td>
        <td class="col-g avg-col"><span class="avg-value">${avgG}</span></td>
        <td class="col-u avg-col"><span class="avg-value">${avgU}</span></td>
        <td class="col-t avg-col"><span class="avg-value">${avgT}</span></td>
        <td class="col-score avg-col"><strong class="avg-value">${avgTotal}</strong></td>
        <td class="col-count avg-col"><span class="avg-value">${count}</span></td>
        <td class="col-actions">
          <button class="btn-icon btn-notes" data-id="${item.id}" aria-label="Edit notes for ${itemLabel}"><span aria-hidden="true">📝</span></button>
          <button class="btn-icon btn-delete" data-id="${item.id}" aria-label="Delete ${itemLabel}"><span aria-hidden="true">🗑️</span></button>
        </td>
      </tr>
    `;
  }).join('');
  
  tbody.querySelectorAll('.item-input').forEach(input => {
    input.addEventListener('input', handleItemChange);
    if (input.tagName === 'TEXTAREA') {
      input.addEventListener('input', autoResizeTextarea);
      autoResizeTextarea.call(input);
    }
  });
  tbody.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', handleChipClick));
  tbody.querySelectorAll('.btn-notes').forEach(btn => btn.addEventListener('click', (e) => showNotes(e.currentTarget.dataset.id)));
  tbody.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', (e) => handleDeleteItem(e.currentTarget.dataset.id)));
  
  if (currentList.updatedAt) {
    document.getElementById('lastSaved').textContent = new Date(currentList.updatedAt).toLocaleString();
  }
  
  isDirty = false;
}

function autoResizeTextarea() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 150) + 'px'; // Max 150px height (~6 lines)
}

function handleItemChange(e) {
  const input = e.target;
  const row = input.closest('tr');
  const id = row.dataset.id;
  const field = input.dataset.field;
  const item = currentList.items.find(i => i.id === id);
  
  if (!item) return;
  
  const uid = getUserId();
  
  if (field === 'label') {
    item.label = input.value;
  } else {
    // Initialize scores object if it doesn't exist
    if (!item.scores) {
      item.scores = {};
    }
    
    // Initialize user score if it doesn't exist
    if (!item.scores[uid]) {
      item.scores[uid] = {
        g: currentList.scale.min,
        u: currentList.scale.min,
        t: currentList.scale.min,
        score: currentList.scale.min ** 3
      };
    }
    
    // Update the specific field
    const value = parseInt(input.value) || currentList.scale.min;
    const clamped = Math.max(currentList.scale.min, Math.min(value, currentList.scale.max));
    item.scores[uid][field] = clamped;
    input.value = clamped;
    
    // Recalculate user's score
    const userScore = item.scores[uid];
    userScore.score = userScore.g * userScore.u * userScore.t;
    row.querySelector('.score-display').textContent = userScore.score;
  }
  
  isDirty = true;
  updateSaveStatus();
  
  // Trigger debounced auto-save
  triggerAutoSave();
}

/**
 * Trigger debounced auto-save (only if enabled)
 */
function triggerAutoSave() {
  // Only auto-save if explicitly enabled by user
  if (!autoSaveEnabled) {
    updateSaveStatus();
    return;
  }
  
  // Clear existing timeout
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
  
  // Set new timeout
  autoSaveTimeout = setTimeout(() => {
    if (isDirty && autoSaveEnabled) {
      console.log('Auto-saving after debounce...');
      handleSave();
    }
  }, AUTO_SAVE_DEBOUNCE_MS);
}

function handleAddItem() {
  if (!currentList) return;
  
  const newItem = {
    id: crypto.randomUUID(),
    label: '',
    scores: {},  // Empty scores object - users will add their own
    notes: undefined,
    url: undefined
  };
  
  currentList.items.push(newItem);
  renderList();
  isDirty = true;
  
  // Focus on the new item's label input
  const rows = document.querySelectorAll('#itemsBody tr');
  const lastRow = rows[rows.length - 1];
  const labelInput = lastRow.querySelector('.input-label');
  if (labelInput) labelInput.focus();
}

function handleDeleteItem(id) {
  if (!currentList) return;
  const index = currentList.items.findIndex(item => item.id === id);
  if (index === -1) return;
  const deleted = currentList.items[index];
  currentList.items.splice(index, 1);
  renderList();
  isDirty = true;
  showUndoToast(deleted, index);
}

function showUndoToast(item, index) {
  if (undoTimeout) clearTimeout(undoTimeout);
  undoItem = item;
  undoIndex = index;

  const toast = document.getElementById('undoToast');
  const msg = document.getElementById('undoToastMessage');
  const progress = document.getElementById('undoToastProgress');
  const label = item.label ? `"${item.label.substring(0, 40)}"` : 'Item';
  msg.textContent = `${label} deleted`;

  // Restart progress bar animation
  progress.style.animation = 'none';
  progress.offsetHeight; // force reflow
  progress.style.animation = '';

  toast.style.display = 'flex';

  undoTimeout = setTimeout(() => {
    hideUndoToast();
    undoItem = null;
    undoIndex = null;
  }, 5000);
}

function hideUndoToast() {
  document.getElementById('undoToast').style.display = 'none';
  if (undoTimeout) { clearTimeout(undoTimeout); undoTimeout = null; }
}

function handleUndo() {
  if (undoItem === null || undoIndex === null) return;
  const insertAt = Math.min(undoIndex, currentList.items.length);
  currentList.items.splice(insertAt, 0, undoItem);
  undoItem = null;
  undoIndex = null;
  hideUndoToast();
  renderList();
  isDirty = true;
  updateSaveStatus();
}

function handleAvgToggle() {
  const table = document.getElementById('itemsTable');
  const btn = document.getElementById('avgToggleBtn');
  const showing = table.classList.toggle('show-averages');
  btn.setAttribute('aria-pressed', showing ? 'true' : 'false');
  btn.setAttribute('aria-label', showing ? 'Hide average scores' : 'Show average scores');
  btn.textContent = showing ? 'Avg ▲' : 'Avg ▼';
}

function renderScoreChips(field, currentValue, min, max, itemLabel) {
  const fieldName = field === 'g' ? 'Gravity' : field === 'u' ? 'Urgency' : 'Tendency';
  let chips = '';
  for (let v = min; v <= max; v++) {
    const selected = currentValue !== '' && parseInt(currentValue) === v;
    chips += `<button type="button" class="chip${selected ? ' selected' : ''}" data-field="${field}" data-value="${v}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="${fieldName} ${v} for ${itemLabel}">${v}</button>`;
  }
  return `<div class="score-chips" role="group" aria-label="${fieldName}">${chips}</div>`;
}

function handleChipClick(e) {
  const chip = e.currentTarget;
  const row = chip.closest('tr');
  const id = row.dataset.id;
  const field = chip.dataset.field;
  const value = parseInt(chip.dataset.value);
  const item = currentList.items.find(i => i.id === id);
  if (!item) return;

  const uid = getUserId();
  if (!item.scores) item.scores = {};
  if (!item.scores[uid]) {
    item.scores[uid] = { g: currentList.scale.min, u: currentList.scale.min, t: currentList.scale.min, score: Math.pow(currentList.scale.min, 3) };
  }

  item.scores[uid][field] = value;
  item.scores[uid].score = item.scores[uid].g * item.scores[uid].u * item.scores[uid].t;

  chip.closest('.score-chips').querySelectorAll('.chip').forEach(c => {
    const sel = c === chip;
    c.classList.toggle('selected', sel);
    c.setAttribute('aria-pressed', sel ? 'true' : 'false');
  });

  row.querySelector('.score-display').textContent = item.scores[uid].score;

  isDirty = true;
  updateSaveStatus();
  triggerAutoSave();
}

function handleSort() {
  if (!currentList) return;
  
  // Sort by average score if available, otherwise by user's score
  const uid = getUserId();
  currentList.items.sort((a, b) => {
    const aScore = a.avgScore?.score ?? a.scores?.[uid]?.score ?? 0;
    const bScore = b.avgScore?.score ?? b.scores?.[uid]?.score ?? 0;
    return bScore - aScore;
  });
  
  renderList();
  isDirty = true;
}

function showNotes(itemId) {
  const item = currentList.items.find(i => i.id === itemId);
  if (!item) return;
  currentNotesItemId = itemId;
  document.getElementById('notesItemLabel').textContent = item.label || 'Untitled Item';
  document.getElementById('notesTextarea').value = item.notes || '';
  document.getElementById('urlInput').value = item.url || '';
  document.getElementById('notesSection').style.display = 'block';
}

function hideNotes() {
  document.getElementById('notesSection').style.display = 'none';
  currentNotesItemId = null;
}

function handleSaveNotes() {
  if (!currentNotesItemId) return;
  const item = currentList.items.find(i => i.id === currentNotesItemId);
  if (!item) return;
  const notes = document.getElementById('notesTextarea').value.trim();
  let url = document.getElementById('urlInput').value.trim();
  
  // Add https:// if URL is provided but doesn't have a protocol
  if (url && !url.match(/^https?:\/\//i)) {
    url = 'https://' + url;
  }
  
  item.notes = notes || undefined;
  item.url = url || undefined;
  hideNotes();
  renderList();
  isDirty = true;
}

async function handleSave() {
  const slug = getSlugFromUrl();
  const btn = document.getElementById('saveBtn');
  const originalText = btn.textContent;
  
  try {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    setStatus('Saving...');
    
    // Prepare items with user scores
    const uid = getUserId();
    const itemsToSend = currentList.items.map(item => {
      const userScore = item.scores?.[uid];
      return {
        id: item.id,
        label: item.label,
        g: userScore?.g,
        u: userScore?.u,
        t: userScore?.t,
        notes: item.notes,
        url: item.url
      };
    });
    
    const response = await fetch(`/api/list/${slug}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': uid,
      },
      body: JSON.stringify({
        title: document.getElementById('listTitle').textContent.trim(),
        items: itemsToSend,
        scale: currentList.scale,
        version: currentList.version,
        userId: uid
      })
    });
    
    // Handle rate limiting
    if (response.status === 429) {
      const rateLimitError = await response.json();
      setStatus(`⏱️ Rate limited`, 'error');
      btn.disabled = false;
      btn.textContent = originalText;
      showBanner(`Rate limit: ${rateLimitError.message} Please wait before saving again.`, 'warning');
      return;
    }
    
    if (response.status === 409) {
      const conflict = await response.json();
      showConflictModal(conflict.server);
      return;
    }
    
    // Handle size limit errors
    if (response.status === 413) {
      const sizeError = await response.json();
      setStatus('❌ List too large', 'error');
      showBanner(`List too large: ${sizeError.error}`, 'error');
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }
    
    if (!response.ok) throw new Error(`Failed to save: ${response.statusText}`);
    
    currentList = await response.json();
    renderList();
    document.getElementById('lastSaved').textContent = new Date(currentList.updatedAt).toLocaleString();
    isDirty = false;
    lastSaveTime = Date.now();
    updateSaveStatus();
    setStatus('Saved ✓', 'success');
    setTimeout(() => setStatus(''), 2000);
  } catch (error) {
    console.error('Save error:', error);
    setStatus('Failed to save', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

function handleShare() {
  const url = window.location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => {
      setStatus('Link copied to clipboard! ✓', 'success');
      setTimeout(() => setStatus(''), 2000);
    }).catch(() => promptShareUrl(url));
  } else {
    promptShareUrl(url);
  }
}

function promptShareUrl(url) {
  prompt('Share this URL:', url);
}

async function handleDelete() {
  const slug = getSlugFromUrl();
  const ownerToken = getOwnerToken(slug);
  if (!ownerToken) {
    showBanner('Only the list creator can delete this list.', 'error');
    return;
  }
  if (!confirm('Are you sure you want to delete this list? This cannot be undone.')) return;
  const btn = document.getElementById('deleteBtn');
  try {
    btn.disabled = true;
    setStatus('Deleting...');
    const response = await fetch(`/api/list/${slug}`, {
      method: 'DELETE',
      headers: { 'X-Owner-Token': ownerToken },
    });
    if (response.status === 403) {
      showBanner('Permission denied. Your owner token is invalid.', 'error');
      btn.disabled = false;
      return;
    }
    if (!response.ok) throw new Error(`Failed to delete: ${response.statusText}`);
    removeFromRecent(slug);
    window.location.href = '/';
  } catch (error) {
    console.error('Delete error:', error);
    setStatus('Failed to delete', 'error');
    btn.disabled = false;
  }
}

function handleTitleChange() {
  isDirty = true;
}

function showConflictModal(serverList) {
  const modal = document.getElementById('conflictModal');
  modal.style.display = 'flex';
  window.conflictServerList = serverList;
  conflictModalPreviousFocus = document.activeElement;
  
  // Show what changed
  const changes = compareListVersions(currentList, serverList);
  const detailsEl = document.getElementById('conflictDetails');
  
  // Focus first action button and install keyboard trap
  const firstBtn = document.getElementById('takeServerBtn');
  requestAnimationFrame(() => firstBtn.focus());
  conflictModalFocusTrap = (e) => {
    if (e.key === 'Escape') { hideConflictModal(); return; }
    if (e.key !== 'Tab') return;
    const focusable = Array.from(modal.querySelectorAll('button:not([disabled])'));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };
  document.addEventListener('keydown', conflictModalFocusTrap);

  if (changes.length === 0) {
    detailsEl.innerHTML = '<p class="info-text">No conflicting changes detected.</p>';
  } else {
    detailsEl.innerHTML = '<p><strong>Changes detected:</strong></p>' + changes.map(change => {
      if (change.type === 'title') {
        return `<div class="conflict-item modified">
          <strong>Title changed:</strong><br>
          Your version: "${escapeHtml(change.local)}"<br>
          Their version: "${escapeHtml(change.server)}"
        </div>`;
      } else if (change.type === 'modified') {
        return `<div class="conflict-item modified">
          <strong>Item modified:</strong> ${escapeHtml(change.label)}<br>
          Your scores: G=${change.local.g} U=${change.local.u} T=${change.local.t} (Score: ${change.local.score})<br>
          Their scores: G=${change.server.g} U=${change.server.u} T=${change.server.t} (Score: ${change.server.score})
        </div>`;
      } else if (change.type === 'added') {
        return `<div class="conflict-item added">
          <strong>Item added by them:</strong> ${escapeHtml(change.label)}
        </div>`;
      } else if (change.type === 'deleted') {
        return `<div class="conflict-item deleted">
          <strong>Item deleted by them:</strong> ${escapeHtml(change.label)}
        </div>`;
      }
      return '';
    }).join('');
  }
}

function hideConflictModal() {
  document.getElementById('conflictModal').style.display = 'none';
  window.conflictServerList = null;
  if (conflictModalFocusTrap) {
    document.removeEventListener('keydown', conflictModalFocusTrap);
    conflictModalFocusTrap = null;
  }
  if (conflictModalPreviousFocus) {
    conflictModalPreviousFocus.focus();
    conflictModalPreviousFocus = null;
  }
}

function handleTakeServer() {
  if (window.conflictServerList) {
    currentList = window.conflictServerList;
    renderList();
    hideConflictModal();
    setStatus('Loaded server version', 'success');
  }
}

async function handleRetry() {
  hideConflictModal();
  if (window.conflictServerList) {
    currentList.version = window.conflictServerList.version;
    await handleSave();
  }
}

function showBanner(message, type = 'error') {
  const banner = document.getElementById('errorBanner');
  const msg = document.getElementById('errorBannerMessage');
  banner.className = `error-banner ${type}`;
  msg.textContent = message;
  banner.style.display = 'flex';
}

function hideBanner() {
  document.getElementById('errorBanner').style.display = 'none';
}

function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = `status ${type}`;
}

function updateRecent() {
  if (!currentList) return;
  const slug = getSlugFromUrl();
  const recent = getRecent();
  const filtered = recent.filter(r => r.slug !== slug);
  filtered.unshift({
    slug,
    title: currentList.title || 'Untitled List',
    scaleMin: currentList.scale.min,
    scaleMax: currentList.scale.max,
    timestamp: Date.now()
  });
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
}

function removeFromRecent(slug) {
  const recent = getRecent();
  const filtered = recent.filter(r => r.slug !== slug);
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered));
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function compareListVersions(localList, serverList) {
  const changes = [];
  
  // Compare title
  if (localList.title !== serverList.title) {
    changes.push({
      type: 'title',
      local: localList.title,
      server: serverList.title
    });
  }
  
  // Compare items
  const serverItemsMap = new Map(serverList.items.map(item => [item.id, item]));
  const localItemsMap = new Map(localList.items.map(item => [item.id, item]));
  
  // Check for modified or deleted items
  localList.items.forEach(localItem => {
    const serverItem = serverItemsMap.get(localItem.id);
    if (!serverItem) {
      changes.push({ type: 'deleted', id: localItem.id, label: localItem.label });
    } else if (JSON.stringify(localItem) !== JSON.stringify(serverItem)) {
      changes.push({
        type: 'modified',
        id: localItem.id,
        label: localItem.label,
        local: localItem,
        server: serverItem
      });
    }
  });
  
  // Check for new items
  serverList.items.forEach(serverItem => {
    if (!localItemsMap.has(serverItem.id)) {
      changes.push({
        type: 'added',
        id: serverItem.id,
        label: serverItem.label,
        item: serverItem
      });
    }
  });
  
  return changes;
}

// ============================================================================
// Export/Import Functions
// ============================================================================

/**
 * Export list to CSV format
 * Includes all user scores and average scores
 */
function handleExportCsv() {
  if (!currentList || !currentList.items.length) {
    setStatus('No items to export', 'error');
    return;
  }
  
  const uid = getUserId();
  const rows = [];
  
  // Header row
  rows.push([
    'Item',
    'Your G',
    'Your U',
    'Your T',
    'Your Score',
    'Avg G',
    'Avg U',
    'Avg T',
    'Avg Score',
    'Contributors',
    'Notes'
  ].join(','));
  
  // Data rows
  currentList.items.forEach(item => {
    const userScore = item.scores?.[uid];
    const avg = item.avgScore;
    
    rows.push([
      escapeCsv(item.label),
      userScore?.g ?? '',
      userScore?.u ?? '',
      userScore?.t ?? '',
      userScore?.score ?? '',
      avg && avg.count >= 2 ? avg.g.toFixed(1) : '',
      avg && avg.count >= 2 ? avg.u.toFixed(1) : '',
      avg && avg.count >= 2 ? avg.t.toFixed(1) : '',
      avg && avg.count >= 2 ? avg.score.toFixed(1) : '',
      avg?.count ?? '',
      escapeCsv(item.notes || '')
    ].join(','));
  });
  
  const csv = rows.join('\n');
  const filename = `${sanitizeFilename(currentList.title)}_${new Date().toISOString().split('T')[0]}.csv`;
  downloadFile(csv, filename, 'text/csv');
  setStatus('📥 CSV exported', 'success');
}

/**
 * Export list to JSON format
 * Includes complete list data with all user scores
 */
function handleExportJson() {
  if (!currentList) {
    setStatus('No list to export', 'error');
    return;
  }
  
  // Create export object with metadata
  const exportData = {
    exportedAt: new Date().toISOString(),
    exportedBy: getUserId(),
    list: currentList
  };
  
  const json = JSON.stringify(exportData, null, 2);
  const filename = `${sanitizeFilename(currentList.title)}_${new Date().toISOString().split('T')[0]}.json`;
  downloadFile(json, filename, 'application/json');
  setStatus('📥 JSON exported', 'success');
}

/**
 * Handle file import
 */
async function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Reset input so same file can be imported again
  e.target.value = '';
  
  try {
    const text = await file.text();
    const fileExtension = file.name.split('.').pop().toLowerCase();
    
    if (fileExtension === 'csv') {
      await importFromCsv(text);
    } else if (fileExtension === 'json') {
      await importFromJson(text);
    } else {
      throw new Error('Unsupported file type. Please upload CSV or JSON files.');
    }
  } catch (error) {
    console.error('Import error:', error);
    showBanner(`Import failed: ${error.message}`, 'error');
  }
}

/**
 * Import data from CSV
 * Merges with existing items, adds your scores
 */
async function importFromCsv(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file is empty or invalid');
  }
  
  // Skip header row
  const dataLines = lines.slice(1);
  const uid = getUserId();
  let importedCount = 0;
  let updatedCount = 0;
  
  dataLines.forEach(line => {
    // Simple CSV parsing (handles quoted fields)
    const values = parseCsvLine(line);
    if (values.length < 5) return; // Skip invalid rows
    
    const [label, g, u, t, score, ...rest] = values;
    const notes = rest[5] || ''; // Notes is at index 10 (6th element in rest)
    
    if (!label || !label.trim()) return; // Skip empty labels
    
    // Check if item already exists by label
    const existingItem = currentList.items.find(item => 
      item.label.toLowerCase() === label.trim().toLowerCase()
    );
    
    if (existingItem) {
      // Update existing item with your scores
      if (!existingItem.scores) existingItem.scores = {};
      
      const gVal = parseFloat(g);
      const uVal = parseFloat(u);
      const tVal = parseFloat(t);
      
      if (!isNaN(gVal) && !isNaN(uVal) && !isNaN(tVal)) {
        existingItem.scores[uid] = {
          g: Math.max(currentList.scale.min, Math.min(gVal, currentList.scale.max)),
          u: Math.max(currentList.scale.min, Math.min(uVal, currentList.scale.max)),
          t: Math.max(currentList.scale.min, Math.min(tVal, currentList.scale.max)),
          score: gVal * uVal * tVal
        };
        updatedCount++;
      }
      
      if (notes && !existingItem.notes) {
        existingItem.notes = notes.trim();
      }
    } else {
      // Create new item
      const newItem = {
        id: crypto.randomUUID(),
        label: label.trim(),
        scores: {},
        notes: notes ? notes.trim() : undefined
      };
      
      const gVal = parseFloat(g);
      const uVal = parseFloat(u);
      const tVal = parseFloat(t);
      
      if (!isNaN(gVal) && !isNaN(uVal) && !isNaN(tVal)) {
        newItem.scores[uid] = {
          g: Math.max(currentList.scale.min, Math.min(gVal, currentList.scale.max)),
          u: Math.max(currentList.scale.min, Math.min(uVal, currentList.scale.max)),
          t: Math.max(currentList.scale.min, Math.min(tVal, currentList.scale.max)),
          score: gVal * uVal * tVal
        };
      }
      
      currentList.items.push(newItem);
      importedCount++;
    }
  });
  
  if (importedCount === 0 && updatedCount === 0) {
    throw new Error('No valid data found in CSV file');
  }
  
  renderList();
  isDirty = true;
  
  const message = `📥 Imported: ${importedCount} new items, ${updatedCount} updated`;
  setStatus(message, 'success');
  
  // Auto-save after import
  triggerAutoSave();
}

/**
 * Import data from JSON
 * Merges items from JSON with current list
 */
async function importFromJson(jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (error) {
    throw new Error('Invalid JSON file');
  }
  
  // Handle both direct list export and wrapped export
  const importList = data.list || data;
  
  if (!importList.items || !Array.isArray(importList.items)) {
    throw new Error('Invalid GUT list format: missing items array');
  }
  
  const uid = getUserId();
  let importedCount = 0;
  let mergedCount = 0;
  
  importList.items.forEach(importItem => {
    if (!importItem.id || !importItem.label) return;
    
    // Check if item exists by ID
    const existingItem = currentList.items.find(item => item.id === importItem.id);
    
    if (existingItem) {
      // Merge scores from all users in import
      if (importItem.scores) {
        if (!existingItem.scores) existingItem.scores = {};
        
        Object.entries(importItem.scores).forEach(([userId, score]) => {
          existingItem.scores[userId] = score;
        });
        mergedCount++;
      }
      
      // Update notes if empty
      if (importItem.notes && !existingItem.notes) {
        existingItem.notes = importItem.notes;
      }
    } else {
      // Add new item with all scores from import
      currentList.items.push({
        id: importItem.id,
        label: importItem.label,
        scores: importItem.scores || {},
        notes: importItem.notes
      });
      importedCount++;
    }
  });
  
  // Update scale if provided and different
  if (importList.scale && (
    importList.scale.min !== currentList.scale.min ||
    importList.scale.max !== currentList.scale.max
  )) {
    currentList.scale = importList.scale;
    setStatus(`Scale updated to ${importList.scale.min}–${importList.scale.max}`, 'info');
  }
  
  if (importedCount === 0 && mergedCount === 0) {
    throw new Error('No valid items found in JSON file');
  }
  
  renderList();
  isDirty = true;
  
  const message = `📥 Imported: ${importedCount} new items, ${mergedCount} merged`;
  setStatus(message, 'success');

  // Auto-save after import
  triggerAutoSave();
}

// ============================================================================
// Helper Functions for Export/Import
// ============================================================================

/**
 * Escape CSV field
 */
function escapeCsv(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Parse a CSV line handling quoted fields
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return (name || 'gut-list')
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

/**
 * Download file
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function getTimestamp() {
  return new Date().toISOString();
}
