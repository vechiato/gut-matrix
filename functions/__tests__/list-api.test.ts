// __tests__/list-api.test.ts - Tests for /api/list handlers

import { describe, test, expect, beforeEach } from '@jest/globals';
import { onRequestPost, onRequestOptions } from '../api/list/index.js';
import {
  onRequestGet,
  onRequestPut,
  onRequestDelete,
  onRequestOptions as onOptionsSlug,
} from '../api/list/[slug].js';
import type { GutList } from '../types.js';
import { MockKV, makeEnv, ctx, jsonRequest, makeList, VALID_UUID, freshUserId } from './helpers.js';

// ─── POST /api/list ───────────────────────────────────────────────────────────

describe('POST /api/list', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 201 with slug for valid request', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'My List', scale: { min: 1, max: 5 } },
      { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    expect(res.status).toBe(201);
    const body = await res.json() as { slug: string };
    expect(typeof body.slug).toBe('string');
    expect(body.slug.length).toBeGreaterThan(0);
  });

  test('creates list with title embedded in slug', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'Sprint Goals' },
      { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    const body = await res.json() as { slug: string };
    expect(body.slug).toMatch(/^sprint-goals-/);
  });

  test('creates list with defaults when body is empty', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list', {}, { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    expect(res.status).toBe(201);
  });

  test('stores list in KV with correct scale', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'Scaled', scale: { min: 1, max: 10 } },
      { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv, { MAX_SCALE: '10' })));
    const body = await res.json() as { slug: string };
    const stored = JSON.parse(kv.raw(`list:${body.slug}`)!) as GutList;
    expect(stored.scale.max).toBe(10);
    expect(stored.items).toHaveLength(0);
    expect(stored.version).toBe(1);
  });

  test('returns 413 when list exceeds size limit', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'Big List' },
      { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv, { LIST_MAX_SIZE_KB: '0' })));
    expect(res.status).toBe(413);
  });

  test('returns 429 when user hits create rate limit', async () => {
    const userId = freshUserId();
    const env = makeEnv(kv, { ENABLE_RATE_LIMITING: 'true', MAX_LISTS_PER_USER_PER_DAY: '1' });
    await onRequestPost(ctx(
      jsonRequest('POST', 'http://localhost/api/list', { title: 'A' }, { 'X-User-Id': userId }),
      {}, env));
    const res = await onRequestPost(ctx(
      jsonRequest('POST', 'http://localhost/api/list', { title: 'B' }, { 'X-User-Id': userId }),
      {}, env));
    expect(res.status).toBe(429);
  });

  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await onRequestOptions(ctx(new Request('http://localhost'), {}, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

// ─── GET /api/list/:slug ──────────────────────────────────────────────────────

describe('GET /api/list/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 200 with list data', async () => {
    kv.seed('list:abc', JSON.stringify(makeList({ title: 'Hello' })));
    const req = new Request('http://localhost/api/list/abc');
    const res = await onRequestGet(ctx(req, { slug: 'abc' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.title).toBe('Hello');
  });

  test('returns 404 when list does not exist', async () => {
    const req = new Request('http://localhost/api/list/ghost');
    const res = await onRequestGet(ctx(req, { slug: 'ghost' }, makeEnv(kv)));
    expect(res.status).toBe(404);
  });

  test('returns 304 when X-Current-Version matches stored version', async () => {
    kv.seed('list:v3', JSON.stringify(makeList({ version: 3 })));
    const req = new Request('http://localhost/api/list/v3', {
      headers: { 'X-Current-Version': '3' },
    });
    const res = await onRequestGet(ctx(req, { slug: 'v3' }, makeEnv(kv)));
    expect(res.status).toBe(304);
  });

  test('returns 200 full list when version is stale', async () => {
    kv.seed('list:v5', JSON.stringify(makeList({ version: 5 })));
    const req = new Request('http://localhost/api/list/v5', {
      headers: { 'X-Current-Version': '3' },
    });
    const res = await onRequestGet(ctx(req, { slug: 'v5' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.version).toBe(5);
  });

  test('returns 200 when no X-Current-Version header', async () => {
    kv.seed('list:no-ver', JSON.stringify(makeList({ version: 2 })));
    const req = new Request('http://localhost/api/list/no-ver');
    const res = await onRequestGet(ctx(req, { slug: 'no-ver' }, makeEnv(kv)));
    expect(res.status).toBe(200);
  });
});

// ─── PUT /api/list/:slug ──────────────────────────────────────────────────────

describe('PUT /api/list/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  function seed(slug: string, list: GutList) {
    kv.seed(`list:${slug}`, JSON.stringify(list));
  }

  test('updates title and increments version', async () => {
    seed('p1', makeList({ title: 'Old Title', version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p1',
      { title: 'New Title', version: 1, userId: VALID_UUID });
    const res = await onRequestPut(ctx(req, { slug: 'p1' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.title).toBe('New Title');
    expect(body.version).toBe(2);
  });

  test('merges user G×U×T scores into existing item', async () => {
    seed('p2', makeList({
      items: [{ id: 'i1', label: 'Task A', scores: {} }],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p2', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'i1', label: 'Task A', g: 3, u: 4, t: 5 }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p2' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    const score = body.items[0].scores[VALID_UUID];
    expect(score).toBeDefined();
    expect(score.g).toBe(3);
    expect(score.u).toBe(4);
    expect(score.t).toBe(5);
    expect(score.score).toBe(60);
  });

  test('preserves other users scores when one user updates', async () => {
    const otherId = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
    seed('p3', makeList({
      items: [{
        id: 'i1', label: 'Task', scores: {
          [otherId]: { g: 5, u: 5, t: 5, score: 125 },
        },
      }],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p3', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'i1', label: 'Task', g: 1, u: 1, t: 1 }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p3' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items[0].scores[otherId]).toBeDefined();
    expect(body.items[0].scores[otherId].score).toBe(125);
    expect(body.items[0].scores[VALID_UUID].score).toBe(1);
  });

  test('adds new item (structural change)', async () => {
    seed('p4', makeList({ items: [], version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p4', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'new-1', label: 'New Task', g: 2, u: 2, t: 2 }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p4' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe('New Task');
  });

  test('removes item (structural change)', async () => {
    seed('p5', makeList({
      items: [
        { id: 'keep', label: 'Keep', scores: {} },
        { id: 'drop', label: 'Drop', scores: {} },
      ],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p5', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'keep', label: 'Keep', g: 1, u: 1, t: 1 }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p5' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('keep');
  });

  test('updates item notes and url', async () => {
    seed('p6', makeList({
      items: [{ id: 'i1', label: 'Task', scores: {} }],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p6', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'i1', label: 'Task', g: 2, u: 2, t: 2, notes: 'Important', url: 'https://example.com' }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p6' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items[0].notes).toBe('Important');
    expect(body.items[0].url).toBe('https://example.com');
  });

  test('replaces items entirely when no userId provided', async () => {
    seed('p7', makeList({
      items: [{ id: 'old', label: 'Old', scores: {} }],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p7', {
      items: [{ id: 'new', label: 'Replaced' }],
      version: 1,
    });
    const res = await onRequestPut(ctx(req, { slug: 'p7' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe('new');
  });

  test('returns 409 on version conflict', async () => {
    seed('p8', makeList({ version: 3 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p8', { title: 'T', version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'p8' }, makeEnv(kv)));
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.conflict).toBe(true);
    expect(body.server).toBeDefined();
  });

  test('returns 404 when list does not exist', async () => {
    const req = jsonRequest('PUT', 'http://localhost/api/list/missing', { title: 'T' });
    const res = await onRequestPut(ctx(req, { slug: 'missing' }, makeEnv(kv)));
    expect(res.status).toBe(404);
  });

  test('returns 400 when scale min >= max', async () => {
    seed('p9', makeList({ version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p9',
      { scale: { min: 5, max: 3 }, version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'p9' }, makeEnv(kv)));
    expect(res.status).toBe(400);
  });

  test('returns 400 when too many items', async () => {
    seed('p10', makeList({ version: 1 }));
    const items = Array.from({ length: 3 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p10', { items, version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'p10' }, makeEnv(kv, { MAX_ITEMS: '2' })));
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid userId format', async () => {
    seed('p11', makeList({ version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p11',
      { title: 'T', version: 1, userId: 'not-a-uuid' });
    const res = await onRequestPut(ctx(req, { slug: 'p11' }, makeEnv(kv)));
    expect(res.status).toBe(400);
  });

  test('returns 413 when updated list exceeds size limit', async () => {
    seed('p12', makeList({ version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/list/p12', { title: 'T', version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'p12' }, makeEnv(kv, { LIST_MAX_SIZE_KB: '0' })));
    expect(res.status).toBe(413);
  });

  test('returns 429 when user save rate limit exceeded', async () => {
    const userId = freshUserId();
    const slug = `p-rl-user-${userId.slice(0, 8)}`;
    seed(slug, makeList({ version: 1 }));
    const env = makeEnv(kv, { ENABLE_RATE_LIMITING: 'true', MAX_SAVES_PER_USER_PER_MINUTE: '1' });
    await onRequestPut(ctx(
      jsonRequest('PUT', `http://localhost/api/list/${slug}`, { title: 'T', version: 1, userId }),
      { slug }, env));
    const res = await onRequestPut(ctx(
      jsonRequest('PUT', `http://localhost/api/list/${slug}`, { title: 'T', version: 2, userId }),
      { slug }, env));
    expect(res.status).toBe(429);
  });

  test('returns 429 when list save rate limit exceeded', async () => {
    const slug = `p-rl-list-${Date.now()}`;
    seed(slug, makeList({ version: 1 }));
    const env = makeEnv(kv, { ENABLE_RATE_LIMITING: 'true', MAX_SAVES_PER_LIST_PER_MINUTE: '1' });
    await onRequestPut(ctx(
      jsonRequest('PUT', `http://localhost/api/list/${slug}`, { title: 'T', version: 1 }),
      { slug }, env));
    const res = await onRequestPut(ctx(
      jsonRequest('PUT', `http://localhost/api/list/${slug}`, { title: 'T', version: 2 }),
      { slug }, env));
    expect(res.status).toBe(429);
  });
});

// ─── DELETE /api/list/:slug ───────────────────────────────────────────────────

describe('DELETE /api/list/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 204 and removes list from KV', async () => {
    kv.seed('list:del-me', JSON.stringify(makeList()));
    const req = new Request('http://localhost/api/list/del-me', { method: 'DELETE' });
    const res = await onRequestDelete(ctx(req, { slug: 'del-me' }, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(kv.has('list:del-me')).toBe(false);
  });

  test('returns 204 even when list does not exist', async () => {
    const req = new Request('http://localhost/api/list/nonexistent', { method: 'DELETE' });
    const res = await onRequestDelete(ctx(req, { slug: 'nonexistent' }, makeEnv(kv)));
    expect(res.status).toBe(204);
  });
});

// ─── OPTIONS /api/list/:slug ──────────────────────────────────────────────────

describe('OPTIONS /api/list/:slug', () => {
  test('returns 204 with correct CORS headers', async () => {
    const kv = new MockKV();
    const res = await onOptionsSlug(ctx(new Request('http://localhost'), {}, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});
