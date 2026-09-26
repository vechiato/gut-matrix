// app.js - Home page logic for GUT Matrix (DOM and events; pure logic lives in gut-core.js)
import { escapeHtml, formatRelativeTime, getOrCreateUserId, parseRecent, upsertRecent } from './gut-core.js';

const RECENT_KEY = 'gut_matrix_recent';
const USER_ID_KEY = 'gut_user_id';

// Get or create user ID
function getUserId() {
  return getOrCreateUserId(localStorage, USER_ID_KEY);
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize user ID
  getUserId();
  loadRecentLists();
  document.getElementById('createForm').addEventListener('submit', handleCreate);
});

function showFormError(message) {
  const el = document.getElementById('createError');
  el.textContent = message;
  el.style.display = 'block';
}

function hideFormError() {
  const el = document.getElementById('createError');
  if (el) el.style.display = 'none';
}

async function handleCreate(e) {
  e.preventDefault();
  hideFormError();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';
    const title = form.title.value.trim();
    const scaleMin = parseInt(form.scaleMin.value);
    const scaleMax = parseInt(form.scaleMax.value);

    if (scaleMin >= scaleMax) {
      showFormError('Max must be greater than min.');
      return;
    }

    const response = await fetch('/api/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': getUserId() },
      body: JSON.stringify({ title, scale: { min: scaleMin, max: scaleMax } }),
    });

    if (response.status === 429) {
      const rateLimitError = await response.json();
      showFormError(`Too many lists created recently. ${rateLimitError.message}`);
      return;
    }

    if (!response.ok) throw new Error('Failed to create list');

    const { slug, ownerToken } = await response.json();
    localStorage.setItem(`gut_owner_${slug}`, ownerToken);

    addToRecent({ slug, title: title || 'Untitled List', scaleMin, scaleMax, timestamp: Date.now() });
    window.location.href = `/matrix.html?k=${slug}`;
  } catch (error) {
    console.error(error);
    showFormError('Failed to create list. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
}

function loadRecentLists() {
  const recent = getRecent();
  const listEl = document.getElementById('recentList');
  if (recent.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">No lists yet</p>
        <p class="empty-state-text">Create your first prioritization list above to get started</p>
      </div>
    `;
    return;
  }
  recent.sort((a, b) => b.timestamp - a.timestamp);
  listEl.innerHTML = recent.map(item => `
    <a href="/matrix.html?k=${encodeURIComponent(item.slug)}" class="recent-item">
      <div class="recent-item-info">
        <div class="recent-item-title">${escapeHtml(item.title)}</div>
        <div class="recent-item-meta">Scale ${escapeHtml(item.scaleMin)}-${escapeHtml(item.scaleMax)} • ${formatRelativeTime(item.timestamp)}</div>
      </div>
      <span class="recent-item-arrow">→</span>
    </a>
  `).join('');
}

function getRecent() {
  return parseRecent(localStorage.getItem(RECENT_KEY));
}

function addToRecent(item) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(upsertRecent(getRecent(), item)));
}

// Escapes for both text and attribute contexts (quotes included)
