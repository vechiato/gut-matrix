// gut-core.js - Pure logic shared by the editor and home page.
// No DOM access, so it can be tested directly (functions/__tests__/gut-core.test.ts).

// ── Rendering helpers ────────────────────────────────────────────────────────

// Escapes for both text and attribute contexts (quotes included)
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function isHttpUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

// 'slug' = links made before the switch to ?k=
export function getSlugFromSearch(search) {
  const params = new URLSearchParams(search);
  return params.get('k') || params.get('slug');
}

// Short form for the editor's save status ("5m ago")
export function formatTimeAgo(timestamp, now = Date.now()) {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// Long form for the home page's recent lists ("2 hours ago")
export function formatRelativeTime(timestamp, now = Date.now()) {
  const mins = Math.floor((now - timestamp) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

// ── User ID and recent lists (storage is injected: localStorage in the browser) ──

export function getOrCreateUserId(storage, key = 'gut_user_id') {
  let id = storage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    storage.setItem(key, id);
  }
  return id;
}

export function parseRecent(raw) {
  try {
    const recent = JSON.parse(raw || '[]');
    return Array.isArray(recent) ? recent : [];
  } catch {
    return [];
  }
}

export function upsertRecent(recent, entry, max = 10) {
  return [entry, ...recent.filter(r => r.slug !== entry.slug)].slice(0, max);
}

export function removeRecent(recent, slug) {
  return recent.filter(r => r.slug !== slug);
}

// ── List logic ───────────────────────────────────────────────────────────────

// Sort by the group average when there is one, otherwise by this user's score
export function sortByPriority(items, uid) {
  return items.sort((a, b) => {
    const aScore = a.avgScore?.score ?? a.scores?.[uid]?.score ?? 0;
    const bScore = b.avgScore?.score ?? b.scores?.[uid]?.score ?? 0;
    return bScore - aScore;
  });
}

// Each user sends only their own scores; the server merges them.
// url is sent as '' when unset because undefined is dropped from JSON,
// and the server treats a missing url as "unchanged".
export function buildSavePayload(list, uid, title) {
  return {
    title,
    items: list.items.map(item => {
      const userScore = item.scores?.[uid];
      return {
        id: item.id,
        label: item.label,
        g: userScore?.g,
        u: userScore?.u,
        t: userScore?.t,
        notes: item.notes,
        url: item.url ?? '',
      };
    }),
    scale: list.scale,
    version: list.version,
    userId: uid,
  };
}

// Differences shown in the conflict dialog after a 409
export function compareListVersions(localList, serverList) {
  const changes = [];

  if (localList.title !== serverList.title) {
    changes.push({ type: 'title', local: localList.title, server: serverList.title });
  }

  const serverItemsMap = new Map(serverList.items.map(item => [item.id, item]));
  const localIds = new Set(localList.items.map(item => item.id));

  localList.items.forEach(localItem => {
    const serverItem = serverItemsMap.get(localItem.id);
    if (!serverItem) {
      changes.push({ type: 'deleted', id: localItem.id, label: localItem.label });
    } else if (JSON.stringify(localItem) !== JSON.stringify(serverItem)) {
      changes.push({ type: 'modified', id: localItem.id, label: localItem.label, local: localItem, server: serverItem });
    }
  });

  serverList.items.forEach(serverItem => {
    if (!localIds.has(serverItem.id)) {
      changes.push({ type: 'added', id: serverItem.id, label: serverItem.label, item: serverItem });
    }
  });

  return changes;
}

// ── Export ───────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  'Item', 'Your G', 'Your U', 'Your T', 'Your Score',
  'Avg G', 'Avg U', 'Avg T', 'Avg Score', 'Contributors', 'Notes',
];

export function escapeCsv(value) {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function buildCsv(list, uid) {
  const rows = [CSV_HEADER.join(',')];
  list.items.forEach(item => {
    const userScore = item.scores?.[uid];
    const avg = item.avgScore;
    const shared = avg && avg.count >= 2;
    rows.push([
      escapeCsv(item.label),
      userScore?.g ?? '',
      userScore?.u ?? '',
      userScore?.t ?? '',
      userScore?.score ?? '',
      shared ? avg.g.toFixed(1) : '',
      shared ? avg.u.toFixed(1) : '',
      shared ? avg.t.toFixed(1) : '',
      shared ? avg.score.toFixed(1) : '',
      avg?.count ?? '',
      escapeCsv(item.notes || ''),
    ].join(','));
  });
  return rows.join('\n');
}

export function buildJsonExport(list, uid, now = new Date()) {
  return JSON.stringify({ exportedAt: now.toISOString(), exportedBy: uid, list }, null, 2);
}

export function sanitizeFilename(name) {
  return (name || 'gut-list')
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/_+/g, '_')
    .toLowerCase();
}

export function exportFilename(title, extension, now = new Date()) {
  return `${sanitizeFilename(title)}_${now.toISOString().split('T')[0]}.${extension}`;
}

// ── Import ───────────────────────────────────────────────────────────────────

// Splits CSV text into rows of trimmed fields. Quoted fields may contain
// commas, "" escapes and line breaks; \r\n and \n both end a row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  rows.push(row);
  return rows;
}

function parseScore(g, u, t, scale) {
  const values = [g, u, t].map(v => parseFloat(v));
  if (values.some(v => isNaN(v))) return null;
  const [cg, cu, ct] = values.map(v => Math.max(scale.min, Math.min(v, scale.max)));
  return { g: cg, u: cu, t: ct, score: cg * cu * ct };
}

// Adds this user's scores from a CSV export (ours or hand-made). Items are
// matched by label, case-insensitively; unknown labels become new items.
// Mutates list.items.
export function mergeCsvImport(list, csvText, uid, newId = () => crypto.randomUUID()) {
  const rows = parseCsv(csvText.trim());
  if (rows.length < 2) {
    throw new Error('CSV file is empty or invalid');
  }

  let importedCount = 0;
  let updatedCount = 0;

  rows.slice(1).forEach(values => {
    if (values.length < 5) return;
    const [label, g, u, t, , ...rest] = values;
    const notes = rest[5] || ''; // Notes is the 11th column
    if (!label) return;

    const score = parseScore(g, u, t, list.scale);
    const existingItem = list.items.find(item => item.label.toLowerCase() === label.toLowerCase());

    if (existingItem) {
      if (!existingItem.scores) existingItem.scores = {};
      if (score) {
        existingItem.scores[uid] = score;
        updatedCount++;
      }
      if (notes && !existingItem.notes) existingItem.notes = notes;
    } else {
      list.items.push({ id: newId(), label, scores: score ? { [uid]: score } : {}, notes: notes || undefined });
      importedCount++;
    }
  });

  if (importedCount === 0 && updatedCount === 0) {
    throw new Error('No valid data found in CSV file');
  }
  return { importedCount, updatedCount };
}

// Merges a JSON export: items matched by id, every user's scores copied in,
// notes filled only where empty, scale replaced if different. Mutates list.
export function mergeJsonImport(list, jsonText) {
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error('Invalid JSON file');
  }

  // Accept both our wrapped export ({ list }) and a bare list
  const importList = data?.list || data;
  if (!Array.isArray(importList?.items)) {
    throw new Error('Invalid GUT list format: missing items array');
  }

  let importedCount = 0;
  let mergedCount = 0;

  importList.items.forEach(importItem => {
    if (!importItem?.id || !importItem.label) return;

    const existingItem = list.items.find(item => item.id === importItem.id);
    if (existingItem) {
      if (importItem.scores) {
        existingItem.scores = { ...existingItem.scores, ...importItem.scores };
        mergedCount++;
      }
      if (importItem.notes && !existingItem.notes) existingItem.notes = importItem.notes;
    } else {
      list.items.push({
        id: importItem.id,
        label: importItem.label,
        scores: importItem.scores || {},
        notes: importItem.notes,
      });
      importedCount++;
    }
  });

  const scale = importList.scale;
  const scaleChanged = Boolean(scale && (scale.min !== list.scale.min || scale.max !== list.scale.max));
  if (scaleChanged) list.scale = scale;

  if (importedCount === 0 && mergedCount === 0) {
    throw new Error('No valid items found in JSON file');
  }
  return { importedCount, mergedCount, scaleChanged };
}
