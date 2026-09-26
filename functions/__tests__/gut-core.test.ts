// __tests__/gut-core.test.ts - Tests for the frontend's pure logic (public/gut-core.js)

import { describe, test, expect } from '@jest/globals';
import {
  escapeHtml, isHttpUrl, getSlugFromSearch, formatTimeAgo, formatRelativeTime,
  getOrCreateUserId, parseRecent, upsertRecent, removeRecent,
  sortByPriority, buildSavePayload, compareListVersions,
  escapeCsv, buildCsv, buildJsonExport, sanitizeFilename, exportFilename,
  parseCsv, mergeCsvImport, mergeJsonImport,
} from '../../public/gut-core.js';

const ME = '550e8400-e29b-41d4-a716-446655440000';
const OTHER = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';

function list(items: any[] = [], extra: any = {}) {
  return { title: 'Backlog', items, scale: { min: 1, max: 5 }, version: 3, ...extra };
}

// ─── Rendering helpers ───────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes every character that can end a text node or an attribute', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  test('turns null/undefined into an empty string and numbers into text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(4.5)).toBe('4.5');
  });
});

describe('isHttpUrl', () => {
  test.each(['https://a.example', 'HTTP://a.example/x'])('accepts %s', url => {
    expect(isHttpUrl(url)).toBe(true);
  });
  test.each(['javascript:alert(1)', 'data:text/html,x', '//a.example', '', undefined])('rejects %s', url => {
    expect(isHttpUrl(url)).toBe(false);
  });
});

describe('getSlugFromSearch', () => {
  test('reads ?k=', () => expect(getSlugFromSearch('?k=abc')).toBe('abc'));
  test('falls back to legacy ?slug=', () => expect(getSlugFromSearch('?slug=old')).toBe('old'));
  test('prefers k when both are present', () => expect(getSlugFromSearch('?slug=old&k=new')).toBe('new'));
  test('returns null when missing', () => expect(getSlugFromSearch('')).toBeNull());
});

describe('formatTimeAgo', () => {
  const now = 10_000_000;
  test.each([
    [now - 30_000, 'just now'],
    [now - 5 * 60_000, '5m ago'],
    [now - 3 * 3_600_000, '3h ago'],
  ])('%s -> %s', (ts, text) => expect(formatTimeAgo(ts, now)).toBe(text));

  test('defaults to the current time', () => expect(formatTimeAgo(Date.now())).toBe('just now'));
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000;
  test.each([
    [now - 10_000, 'Just now'],
    [now - 12 * 60_000, '12 min ago'],
    [now - 3_600_000, '1 hour ago'],
    [now - 5 * 3_600_000, '5 hours ago'],
    [now - 24 * 3_600_000, '1 day ago'],
    [now - 72 * 3_600_000, '3 days ago'],
  ])('%s -> %s', (ts, text) => expect(formatRelativeTime(ts, now)).toBe(text));

  test('defaults to the current time', () => expect(formatRelativeTime(Date.now())).toBe('Just now'));
});

// ─── User ID and recent lists ────────────────────────────────────────────────

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
}

describe('getOrCreateUserId', () => {
  test('returns the stored id', () => {
    expect(getOrCreateUserId(memoryStorage({ gut_user_id: ME }))).toBe(ME);
  });

  test('creates, stores and then reuses a UUID', () => {
    const storage = memoryStorage();
    const id = getOrCreateUserId(storage);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(storage.data.get('gut_user_id')).toBe(id);
    expect(getOrCreateUserId(storage)).toBe(id);
  });

  test('supports a custom key', () => {
    const storage = memoryStorage();
    getOrCreateUserId(storage, 'other_key');
    expect(storage.data.has('other_key')).toBe(true);
  });
});

describe('recent lists', () => {
  test('parseRecent tolerates missing, corrupt and non-array data', () => {
    expect(parseRecent(null)).toEqual([]);
    expect(parseRecent('{not json')).toEqual([]);
    expect(parseRecent('{"slug":"a"}')).toEqual([]);
    expect(parseRecent('[{"slug":"a"}]')).toEqual([{ slug: 'a' }]);
  });

  test('upsertRecent moves an existing entry to the front and caps the list', () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({ slug: `s${i}` }));
    const next = upsertRecent(recent, { slug: 's5', title: 'Updated' });
    expect(next[0]).toEqual({ slug: 's5', title: 'Updated' });
    expect(next.filter((r: any) => r.slug === 's5')).toHaveLength(1);
    expect(next).toHaveLength(10);
    expect(upsertRecent(recent, { slug: 'new' }, 3).map((r: any) => r.slug)).toEqual(['new', 's0', 's1']);
  });

  test('removeRecent drops the slug', () => {
    expect(removeRecent([{ slug: 'a' }, { slug: 'b' }], 'a')).toEqual([{ slug: 'b' }]);
  });
});

// ─── List logic ──────────────────────────────────────────────────────────────

describe('sortByPriority', () => {
  test('uses the group average first, then my score, then 0', () => {
    const items = [
      { id: 'none', scores: {} },
      { id: 'mine', scores: { [ME]: { score: 30 } } },
      { id: 'avg', avgScore: { score: 50 }, scores: { [ME]: { score: 1 } } },
      { id: 'noscores' },
    ];
    expect(sortByPriority(items, ME).map((i: any) => i.id)).toEqual(['avg', 'mine', 'none', 'noscores']);
  });
});

describe('buildSavePayload', () => {
  test('sends only my scores, plus label/notes/url, version and scale', () => {
    const payload = buildSavePayload(list([
      { id: 'a', label: 'A', notes: 'n', url: 'https://a.example/', scores: { [ME]: { g: 2, u: 3, t: 4, score: 24 }, [OTHER]: { g: 5, u: 5, t: 5, score: 125 } } },
    ]), ME, 'New title');
    expect(payload).toEqual({
      title: 'New title',
      items: [{ id: 'a', label: 'A', g: 2, u: 3, t: 4, notes: 'n', url: 'https://a.example/' }],
      scale: { min: 1, max: 5 },
      version: 3,
      userId: ME,
    });
  });

  test('an unscored item keeps its edits and a missing url becomes "" so it clears server-side', () => {
    const payload = buildSavePayload(list([{ id: 'a', label: 'Renamed' }]), ME, 'T');
    const sent = JSON.parse(JSON.stringify(payload)).items[0];
    expect(sent).toEqual({ id: 'a', label: 'Renamed', url: '' });
  });
});

describe('compareListVersions', () => {
  test('reports title, modified, deleted and added items', () => {
    const local = list([
      { id: 'same', label: 'Same' },
      { id: 'mod', label: 'Mine' },
      { id: 'gone', label: 'Gone' },
    ], { title: 'Local' });
    const server = list([
      { id: 'same', label: 'Same' },
      { id: 'mod', label: 'Theirs' },
      { id: 'new', label: 'New' },
    ], { title: 'Server' });
    const changes = compareListVersions(local, server);
    expect(changes.map((c: any) => [c.type, c.id ?? c.server])).toEqual([
      ['title', 'Server'],
      ['modified', 'mod'],
      ['deleted', 'gone'],
      ['added', 'new'],
    ]);
  });

  test('returns nothing for identical lists', () => {
    expect(compareListVersions(list([{ id: 'a' }]), list([{ id: 'a' }]))).toEqual([]);
  });
});

// ─── Export ──────────────────────────────────────────────────────────────────

describe('escapeCsv', () => {
  test.each([
    [null, ''], [undefined, ''], ['plain', 'plain'], [42, '42'],
    ['a,b', '"a,b"'], ['say "hi"', '"say ""hi"""'], ['two\nlines', '"two\nlines"'],
  ])('%j -> %j', (input, output) => expect(escapeCsv(input)).toBe(output));
});

describe('buildCsv', () => {
  test('writes the header, my scores, shared averages and escaped text', () => {
    const csv = buildCsv(list([
      { id: 'a', label: 'Fix, now', notes: 'said "urgent"',
        scores: { [ME]: { g: 5, u: 4, t: 3, score: 60 } },
        avgScore: { g: 4.5, u: 4, t: 3, score: 55, count: 2 } },
      { id: 'b', label: 'Solo', avgScore: { g: 2, u: 2, t: 2, score: 8, count: 1 } },
      { id: 'c', label: 'Empty' },
    ]), ME);
    expect(csv.split('\n')).toEqual([
      'Item,Your G,Your U,Your T,Your Score,Avg G,Avg U,Avg T,Avg Score,Contributors,Notes',
      '"Fix, now",5,4,3,60,4.5,4.0,3.0,55.0,2,"said ""urgent"""',
      'Solo,,,,,,,,,1,',
      'Empty,,,,,,,,,,',
    ]);
  });
});

describe('buildJsonExport / filenames', () => {
  const now = new Date('2026-09-26T10:00:00Z');

  test('wraps the list with export metadata', () => {
    const data = JSON.parse(buildJsonExport(list(), ME, now));
    expect(data).toEqual({ exportedAt: '2026-09-26T10:00:00.000Z', exportedBy: ME, list: list() });
  });

  test('defaults to the current time', () => {
    expect(JSON.parse(buildJsonExport(list(), ME)).exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(exportFilename('x', 'csv')).toMatch(/^x_\d{4}-\d\d-\d\d\.csv$/);
  });

  test.each([
    ['Q4 Backlog: Draft #2!', 'q4_backlog_draft_2_'],
    ['keep-this_one', 'keep-this_one'],
    ['', 'gut-list'],
    [undefined, 'gut-list'],
  ])('sanitizeFilename(%j) -> %j', (name, out) => expect(sanitizeFilename(name)).toBe(out));

  test('exportFilename adds the date and extension', () => {
    expect(exportFilename('My List', 'json', now)).toBe('my_list_2026-09-26.json');
  });
});

// ─── Import ──────────────────────────────────────────────────────────────────

describe('parseCsv', () => {
  test('splits fields, trims them and handles quotes, commas and "" escapes', () => {
    expect(parseCsv(' a , "b, c" ,"say ""hi""",')).toEqual([['a', 'b, c', 'say "hi"', '']]);
  });

  test('ends rows on \\n and \\r\\n but keeps line breaks inside quotes', () => {
    expect(parseCsv('h1,h2\r\nx,"line 1\nline 2"\ny,z')).toEqual([
      ['h1', 'h2'], ['x', 'line 1\nline 2'], ['y', 'z'],
    ]);
  });
});

describe('mergeCsvImport', () => {
  const header = 'Item,Your G,Your U,Your T,Your Score,Avg G,Avg U,Avg T,Avg Score,Contributors,Notes';
  const ids = () => { let n = 0; return () => `new-${++n}`; };

  test('adds new items with my clamped scores and notes', () => {
    const l = list();
    const result = mergeCsvImport(l, `${header}\nFresh,9,0,3,,,,,,,Some note`, ME, ids());
    expect(result).toEqual({ importedCount: 1, updatedCount: 0 });
    expect(l.items).toEqual([{ id: 'new-1', label: 'Fresh', notes: 'Some note', scores: { [ME]: { g: 5, u: 1, t: 3, score: 15 } } }]);
  });

  test('updates my score on an existing item matched by label, case-insensitively', () => {
    const l = list([{ id: 'a', label: 'Fix Bug', notes: 'keep me', scores: { [OTHER]: { g: 1, u: 1, t: 1, score: 1 } } }]);
    const result = mergeCsvImport(l, `${header}\nfix bug,2,2,2,,,,,,,ignored note`, ME);
    expect(result).toEqual({ importedCount: 0, updatedCount: 1 });
    expect(l.items[0].scores).toEqual({ [OTHER]: { g: 1, u: 1, t: 1, score: 1 }, [ME]: { g: 2, u: 2, t: 2, score: 8 } });
    expect(l.items[0].notes).toBe('keep me');
  });

  test('fills empty notes on existing items; unscored rows add items without scores', () => {
    const l: any = list([{ id: 'a', label: 'Known' }]);
    mergeCsvImport(l, `${header}\nKnown,x,,,,,,,,,Filled\nUnscored,,,,`, ME, ids());
    expect(l.items[0]).toEqual({ id: 'a', label: 'Known', scores: {}, notes: 'Filled' });
    expect(l.items[1]).toEqual({ id: 'new-1', label: 'Unscored', scores: {}, notes: undefined });
  });

  test('round-trips its own export, including notes with line breaks', () => {
    const source = list([{ id: 'a', label: 'Multi', notes: 'line 1\nline 2, with comma', scores: { [ME]: { g: 3, u: 3, t: 3, score: 27 } } }]);
    const target = list();
    mergeCsvImport(target, buildCsv(source, ME), ME, ids());
    expect(target.items[0]).toMatchObject({ label: 'Multi', notes: 'line 1\nline 2, with comma', scores: { [ME]: { score: 27 } } });
  });

  test('generates UUIDs for new items by default', () => {
    const l = list();
    mergeCsvImport(l, `${header}\nA,1,1,1,1`, ME);
    expect(l.items[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('skips short rows and empty labels', () => {
    expect(() => mergeCsvImport(list(), `${header}\na,b\n,1,1,1,1`, ME)).toThrow('No valid data found in CSV file');
  });

  test('rejects a file with only a header', () => {
    expect(() => mergeCsvImport(list(), header, ME)).toThrow('CSV file is empty or invalid');
  });
});

describe('mergeJsonImport', () => {
  test('accepts our wrapped export and merges every user\'s scores by id', () => {
    const l: any = list([{ id: 'a', label: 'A', scores: { [ME]: { score: 1 } } }]);
    const json = JSON.stringify({ exportedAt: 'x', list: list([
      { id: 'a', label: 'A', notes: 'from import', scores: { [ME]: { score: 8 }, [OTHER]: { score: 27 } } },
      { id: 'b', label: 'B' },
    ]) });
    expect(mergeJsonImport(l, json)).toEqual({ importedCount: 1, mergedCount: 1, scaleChanged: false });
    expect(l.items[0]).toEqual({ id: 'a', label: 'A', notes: 'from import', scores: { [ME]: { score: 8 }, [OTHER]: { score: 27 } } });
    expect(l.items[1]).toEqual({ id: 'b', label: 'B', scores: {}, notes: undefined });
  });

  test('accepts a bare list, keeps existing notes, and replaces a different scale', () => {
    const l: any = list([{ id: 'a', label: 'A', notes: 'mine' }]);
    const json = JSON.stringify({ items: [{ id: 'a', label: 'A', notes: 'theirs', scores: {} }], scale: { min: 1, max: 10 } });
    expect(mergeJsonImport(l, json)).toEqual({ importedCount: 0, mergedCount: 1, scaleChanged: true });
    expect(l.items[0].notes).toBe('mine');
    expect(l.scale).toEqual({ min: 1, max: 10 });
  });

  test('ignores an identical scale and items without scores to merge', () => {
    const l: any = list([{ id: 'a', label: 'A' }]);
    const json = JSON.stringify({ items: [{ id: 'a', label: 'A' }, { id: 'n', label: 'New' }], scale: { min: 1, max: 5 } });
    expect(mergeJsonImport(l, json)).toEqual({ importedCount: 1, mergedCount: 0, scaleChanged: false });
  });

  test.each([
    ['not json', 'Invalid JSON file'],
    ['null', 'Invalid GUT list format: missing items array'],
    ['{"items":"nope"}', 'Invalid GUT list format: missing items array'],
    ['{"items":[null,{"id":"x"},{"label":"y"}]}', 'No valid items found in JSON file'],
  ])('rejects %j', (json, message) => {
    expect(() => mergeJsonImport(list(), json)).toThrow(message);
  });
});
