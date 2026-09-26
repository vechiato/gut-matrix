// __tests__/list-api.test.ts - Tests for /api/list handlers

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { onRequestPost, onRequestOptions } from '../api/list/index.js';
import {
  onRequestGet,
  onRequestPut,
  onRequestDelete,
  onRequestOptions as onOptionsSlug,
} from '../api/list/[slug].js';
import type { GutList } from '../types.js';
import { MockKV, FailingKV, makeEnv, makeBlankEnv, ctx, jsonRequest, rawRequest, makeList, VALID_UUID, freshUserId } from './helpers.js';

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
    expect(body.items[0].url).toBe('https://example.com/');
  });

  test('saves label/notes/url edits on an item the user has not scored', async () => {
    const otherId = 'aaaaaaaa-bbbb-4000-8000-cccccccccccc';
    seed('p6b', makeList({
      items: [{ id: 'i1', label: 'Original', scores: { [otherId]: { g: 2, u: 2, t: 2, score: 8 } } }],
      version: 1,
    }));
    // The editor sends g/u/t as undefined for unscored items, so JSON drops them
    const req = jsonRequest('PUT', 'http://localhost/api/list/p6b', {
      title: 'T', version: 1, userId: VALID_UUID,
      items: [{ id: 'i1', label: 'Renamed', notes: 'New note', url: 'https://example.com' }],
    });
    const res = await onRequestPut(ctx(req, { slug: 'p6b' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items[0].label).toBe('Renamed');
    expect(body.items[0].notes).toBe('New note');
    expect(body.items[0].url).toBe('https://example.com/');
    expect(body.items[0].scores[VALID_UUID]).toBeUndefined();
    expect(body.items[0].scores[otherId].score).toBe(8);
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

// ─── Security: owner token ────────────────────────────────────────────────────

describe('Owner token', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('POST returns ownerToken in response', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'Secure' }, { 'X-User-Id': VALID_UUID });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(typeof body.ownerToken).toBe('string');
    expect(body.ownerToken).toHaveLength(64);
    // ownerTokenHash stored in KV but NOT returned
    const stored = JSON.parse(kv.raw(`list:${body.slug}`)!) as any;
    expect(stored.ownerTokenHash).toBeDefined();
    expect(body.ownerTokenHash).toBeUndefined();
  });

  test('DELETE without owner token returns 403 when list is protected', async () => {
    const slug = 'sec-del';
    kv.seed(`list:${slug}`, JSON.stringify({ ...makeList(), ownerTokenHash: 'fakehash' }));
    const req = new Request(`http://localhost/api/list/${slug}`, { method: 'DELETE' });
    const res = await onRequestDelete(ctx(req, { slug }, makeEnv(kv)));
    expect(res.status).toBe(403);
  });

  test('DELETE with wrong owner token returns 403', async () => {
    // Create real list via POST to get actual hash
    const postReq = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'T' }, { 'X-User-Id': VALID_UUID });
    const postRes = await onRequestPost(ctx(postReq, {}, makeEnv(kv)));
    const { slug } = await postRes.json() as any;

    const req = new Request(`http://localhost/api/list/${slug}`, {
      method: 'DELETE',
      headers: { 'X-Owner-Token': 'wrongtoken' },
    });
    const res = await onRequestDelete(ctx(req, { slug }, makeEnv(kv)));
    expect(res.status).toBe(403);
  });

  test('DELETE with correct owner token returns 204', async () => {
    const postReq = jsonRequest('POST', 'http://localhost/api/list',
      { title: 'T' }, { 'X-User-Id': VALID_UUID });
    const postRes = await onRequestPost(ctx(postReq, {}, makeEnv(kv)));
    const { slug, ownerToken } = await postRes.json() as any;

    const req = new Request(`http://localhost/api/list/${slug}`, {
      method: 'DELETE',
      headers: { 'X-Owner-Token': ownerToken },
    });
    const res = await onRequestDelete(ctx(req, { slug }, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(kv.has(`list:${slug}`)).toBe(false);
  });

  test('DELETE without ownerTokenHash set allows delete (legacy lists)', async () => {
    kv.seed('list:legacy', JSON.stringify(makeList()));
    const req = new Request('http://localhost/api/list/legacy', { method: 'DELETE' });
    const res = await onRequestDelete(ctx(req, { slug: 'legacy' }, makeEnv(kv)));
    expect(res.status).toBe(204);
  });
});

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

describe('/api/list edge cases', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('POST with malformed JSON, no X-User-Id and unset limits creates a default list', async () => {
    const req = rawRequest('POST', 'http://localhost/api/list', 'not json');
    const res = await onRequestPost(ctx(req, {}, makeBlankEnv(kv)));
    expect(res.status).toBe(201);
    const { slug } = await res.json() as { slug: string };
    const stored = JSON.parse(kv.raw(`list:${slug}`)!) as GutList;
    expect(stored.scale).toEqual({ min: 1, max: 5 });
  });

  test('PUT with malformed JSON and unset limits saves nothing but bumps version', async () => {
    kv.seed('list:e1', JSON.stringify(makeList({ title: 'Keep', version: 4 })));
    const req = rawRequest('PUT', 'http://localhost/api/list/e1', '{oops');
    const res = await onRequestPut(ctx(req, { slug: 'e1' }, makeBlankEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.title).toBe('Keep');
    expect(body.version).toBe(5);
  });

  test('PUT applies a new scale', async () => {
    kv.seed('list:e2', JSON.stringify(makeList()));
    const req = jsonRequest('PUT', 'http://localhost/api/list/e2', { scale: { min: 1, max: 8 } });
    const res = await onRequestPut(ctx(req, { slug: 'e2' }, makeEnv(kv, { MAX_SCALE: '10' })));
    expect((await res.json() as GutList).scale).toEqual({ min: 1, max: 8 });
  });

  test('PUT keeps the label when an item update omits it', async () => {
    kv.seed('list:e3', JSON.stringify(makeList({ items: [{ id: 'i1', label: 'Kept', scores: {} }] })));
    const req = jsonRequest('PUT', 'http://localhost/api/list/e3', {
      userId: VALID_UUID, items: [{ id: 'i1', g: 2, u: 3, t: 4 }],
    });
    const body = await (await onRequestPut(ctx(req, { slug: 'e3' }, makeEnv(kv)))).json() as GutList;
    expect(body.items[0].label).toBe('Kept');
    expect(body.items[0].scores[VALID_UUID].score).toBe(24);
  });

  test('PUT ignores null item entries instead of failing', async () => {
    kv.seed('list:e4', JSON.stringify(makeList({ items: [{ id: 'i1', label: 'Same', scores: {} }] })));
    const req = jsonRequest('PUT', 'http://localhost/api/list/e4', { userId: VALID_UUID, items: [null] });
    const res = await onRequestPut(ctx(req, { slug: 'e4' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    expect((await res.json() as GutList).items[0].label).toBe('Same');
  });

  test('PUT keeps the owner token hash in storage and never returns it', async () => {
    kv.seed('list:e5', JSON.stringify(makeList({ ownerTokenHash: 'abc123' })));
    const req = jsonRequest('PUT', 'http://localhost/api/list/e5', { title: 'Renamed' });
    const body = await (await onRequestPut(ctx(req, { slug: 'e5' }, makeEnv(kv)))).json() as GutList;
    expect(body).not.toHaveProperty('ownerTokenHash');
    expect(JSON.parse(kv.raw('list:e5')!).ownerTokenHash).toBe('abc123');
  });

  test('every handler returns 500 when KV fails', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv(new FailingKV() as any);
    const url = 'http://localhost/api/list/x';
    const results = await Promise.all([
      onRequestPost(ctx(jsonRequest('POST', 'http://localhost/api/list', {}), {}, env)),
      onRequestGet(ctx(new Request(url), { slug: 'x' }, env)),
      onRequestPut(ctx(jsonRequest('PUT', url, {}), { slug: 'x' }, env)),
      onRequestDelete(ctx(new Request(url, { method: 'DELETE' }), { slug: 'x' }, env)),
    ]);
    for (const res of results) expect(res.status).toBe(500);
    expect(logged).toHaveBeenCalledTimes(4);
    logged.mockRestore();
  });
});

describe('PUT /api/list/:slug sanitizes stored items', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  async function put(slug: string, body: unknown) {
    const res = await onRequestPut(ctx(jsonRequest('PUT', `http://localhost/api/list/${slug}`, body), { slug }, makeEnv(kv)));
    expect(res.status).toBe(200);
    return JSON.parse(kv.raw(`list:${slug}`)!) as GutList;
  }

  test('clears javascript: and attribute-breaking URLs', async () => {
    kv.seed('list:s1', JSON.stringify(makeList({ items: [
      { id: 'a', label: 'A', scores: {} },
      { id: 'b', label: 'B', scores: {} },
    ] })));
    const stored = await put('s1', { userId: VALID_UUID, items: [
      { id: 'a', label: 'A', g: 1, u: 1, t: 1, url: 'javascript:alert(1)' },
      { id: 'b', label: 'B', g: 1, u: 1, t: 1, url: 'https://example.com" onmouseover="alert(1)' },
    ] });
    expect(stored.items.map(i => i.url)).toEqual([undefined, undefined]);
  });

  test('an empty url clears an existing link', async () => {
    kv.seed('list:s2', JSON.stringify(makeList({ items: [{ id: 'a', label: 'A', scores: {}, url: 'https://old.example/' }] })));
    const stored = await put('s2', { userId: VALID_UUID, items: [{ id: 'a', label: 'A', g: 1, u: 1, t: 1, url: '' }] });
    expect(stored.items[0].url).toBeUndefined();
  });

  test('keeps an existing link when a structural change omits it', async () => {
    kv.seed('list:s3', JSON.stringify(makeList({ items: [{ id: 'a', label: 'A', scores: {}, url: 'https://keep.example/' }] })));
    const stored = await put('s3', { userId: VALID_UUID, items: [
      { id: 'a', label: 'A' },
      { id: 'new', label: 'New', g: 1, u: 1, t: 1 },
    ] });
    expect(stored.items[0].url).toBe('https://keep.example/');
  });

  test('a new item with an unsafe id gets a fresh id', async () => {
    kv.seed('list:s4', JSON.stringify(makeList()));
    const stored = await put('s4', { userId: VALID_UUID, items: [{ id: '"><svg onload=alert(1)>', label: 'X', g: 1, u: 1, t: 1 }] });
    expect(stored.items[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('caps merged labels and replaces empty ones', async () => {
    kv.seed('list:s5', JSON.stringify(makeList({ items: [
      { id: 'a', label: 'A', scores: {} },
      { id: 'b', label: 'B', scores: {} },
    ] })));
    const stored = await put('s5', { userId: VALID_UUID, items: [
      { id: 'a', label: 'x'.repeat(500), g: 1, u: 1, t: 1 },
      { id: 'b', label: '', g: 1, u: 1, t: 1 },
    ] });
    expect(stored.items[0].label).toHaveLength(200);
    expect(stored.items[1].label).toBe('Untitled Item');
  });

  test('a save without userId cannot plant fake scores or averages', async () => {
    kv.seed('list:s6', JSON.stringify(makeList()));
    const stored = await put('s6', { items: [{
      id: 'a', label: 'A',
      scores: { 'not-a-uuid': { g: 5, u: 5, t: 5, score: 125 }, [VALID_UUID]: { g: '<img>', u: 3, t: 3, score: 1 } },
      avgScore: { g: '<img src=x onerror=alert(1)>', u: 1, t: 1, score: 1, count: 50 },
    }] });
    expect(stored.items[0].scores).toEqual({ [VALID_UUID]: { g: 1, u: 3, t: 3, score: 9 } });
    expect(stored.items[0].avgScore).toEqual({ g: 1, u: 3, t: 3, score: 9, count: 1 });
  });
});
