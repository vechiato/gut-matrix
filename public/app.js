// app.js - Home page logic for GUT Matrix
const RECENT_KEY = 'gut_matrix_recent';
const USER_ID_KEY = 'gut_user_id';

// Get or create user ID
function getUserId() {
  let storedId = localStorage.getItem(USER_ID_KEY);
  if (!storedId) {
    storedId = crypto.randomUUID();
    localStorage.setItem(USER_ID_KEY, storedId);
  }
  return storedId;
}

document.addEventListener('DOMContentLoaded', () => {
  // Initialize user ID
  getUserId();
  loadRecentLists();
  document.getElementById('createForm').addEventListener('submit', handleCreate);
});

async function handleCreate(e) {
  e.preventDefault();
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
      alert('Scale min must be less than scale max');
      return;
    }
    
    const response = await fetch('/api/list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': getUserId(),
      },
      body: JSON.stringify({ title, scale: { min: scaleMin, max: scaleMax } })
    });
    
    // Handle rate limiting
    if (response.status === 429) {
      const rateLimitError = await response.json();
      alert(`Rate Limit Exceeded\n\n${rateLimitError.message}\n\nYou've created too many lists recently. Please try again later.`);
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      return;
    }
    
    if (!response.ok) throw new Error('Failed to create list');
    
    const { slug } = await response.json();
    addToRecent({ slug, title: title || 'Untitled List', scaleMin, scaleMax, timestamp: Date.now() });
    window.location.href = `/matrix.html?slug=${slug}`;
  } catch (error) {
    console.error(error);
    alert('Failed to create list');
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
    <a href="/matrix.html?slug=${item.slug}" class="recent-item">
      <div class="recent-item-info">
        <div class="recent-item-title">${escapeHtml(item.title)}</div>
        <div class="recent-item-meta">Scale ${item.scaleMin}-${item.scaleMax} • ${formatTime(item.timestamp)}</div>
      </div>
      <span class="recent-item-arrow">→</span>
    </a>
  `).join('');
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function addToRecent(item) {
  const recent = getRecent();
  const filtered = recent.filter(r => r.slug !== item.slug);
  filtered.unshift(item);
  localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, 10)));
}

function formatTime(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) > 1 ? 's' : ''} ago`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
