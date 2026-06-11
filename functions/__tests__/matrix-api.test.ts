// __tests__/matrix-api.test.ts - Tests for /api/matrix handlers (legacy/simple endpoints)

import { describe, test, expect, beforeEach } from '@jest/globals';
import { onRequestPost, onRequestOptions } from '../api/matrix/index.js';
import {
  onRequestGet,
  onRequestPut,
  onRequestDelete,
  onRequestOptions as onOptionsSlug,
} from '../api/matrix/[slug].js';
import type { GutList } from '../types.js';
import { MockKV, makeEnv, ctx, jsonRequest, makeList } from './helpers.js';

// ─── POST /api/matrix ─────────────────────────────────────────────────────────

describe('POST /api/matrix', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 201 with a slug', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/matrix', { title: 'My Matrix' });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    expect(res.status).toBe(201);
    const body = await res.json() as { slug: string };
    expect(typeof body.slug).toBe('string');
    expect(body.slug.length).toBeGreaterThan(0);
  });

  test('creates list with defaults when body is empty', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/matrix', {});
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    expect(res.status).toBe(201);
  });

  test('creates list with custom scale', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/matrix', {
      title: 'Big Scale', scale: { min: 1, max: 10 },
    });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv, { MAX_SCALE: '10' })));
    const body = await res.json() as { slug: string };
    const stored = JSON.parse(kv.raw(`list:${body.slug}`)!) as GutList;
    expect(stored.scale.max).toBe(10);
    expect(stored.version).toBe(1);
  });

  test('slug is derived from title', async () => {
    const req = jsonRequest('POST', 'http://localhost/api/matrix', { title: 'Team Review' });
    const res = await onRequestPost(ctx(req, {}, makeEnv(kv)));
    const body = await res.json() as { slug: string };
    expect(body.slug).toMatch(/^team-review-/);
  });

  test('OPTIONS returns 204 with CORS headers', async () => {
    const res = await onRequestOptions(ctx(new Request('http://localhost'), {}, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});

// ─── GET /api/matrix/:slug ────────────────────────────────────────────────────

describe('GET /api/matrix/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 200 with stored list', async () => {
    kv.seed('list:m1', JSON.stringify(makeList({ title: 'Matrix List' })));
    const req = new Request('http://localhost/api/matrix/m1');
    const res = await onRequestGet(ctx(req, { slug: 'm1' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.title).toBe('Matrix List');
  });

  test('returns 404 when list not found', async () => {
    const req = new Request('http://localhost/api/matrix/ghost');
    const res = await onRequestGet(ctx(req, { slug: 'ghost' }, makeEnv(kv)));
    expect(res.status).toBe(404);
  });
});

// ─── PUT /api/matrix/:slug ────────────────────────────────────────────────────

describe('PUT /api/matrix/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  function seed(slug: string, list: GutList) {
    kv.seed(`list:${slug}`, JSON.stringify(list));
  }

  test('updates title and increments version', async () => {
    seed('m2', makeList({ title: 'Before', version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m2', { title: 'After', version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'm2' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.title).toBe('After');
    expect(body.version).toBe(2);
  });

  test('updates items', async () => {
    seed('m3', makeList({ items: [], version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m3', {
      items: [{ id: 'i1', label: 'New Item', scores: {} }],
      version: 1,
    });
    const res = await onRequestPut(ctx(req, { slug: 'm3' }, makeEnv(kv)));
    expect(res.status).toBe(200);
    const body = await res.json() as GutList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe('New Item');
  });

  test('preserves existing items when no items in request', async () => {
    seed('m4', makeList({
      items: [{ id: 'i1', label: 'Existing', scores: {} }],
      version: 1,
    }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m4', { title: 'Updated', version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'm4' }, makeEnv(kv)));
    const body = await res.json() as GutList;
    expect(body.items).toHaveLength(1);
    expect(body.items[0].label).toBe('Existing');
  });

  test('returns 409 on version conflict', async () => {
    seed('m5', makeList({ version: 5 }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m5', { title: 'T', version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'm5' }, makeEnv(kv)));
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.conflict).toBe(true);
  });

  test('returns 404 when list does not exist', async () => {
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/missing', { title: 'T' });
    const res = await onRequestPut(ctx(req, { slug: 'missing' }, makeEnv(kv)));
    expect(res.status).toBe(404);
  });

  test('returns 400 for invalid scale', async () => {
    seed('m6', makeList({ version: 1 }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m6',
      { scale: { min: 10, max: 1 }, version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'm6' }, makeEnv(kv)));
    expect(res.status).toBe(400);
  });

  test('respects MAX_ITEMS env limit', async () => {
    seed('m7', makeList({ version: 1 }));
    const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` }));
    const req = jsonRequest('PUT', 'http://localhost/api/matrix/m7', { items, version: 1 });
    const res = await onRequestPut(ctx(req, { slug: 'm7' }, makeEnv(kv, { MAX_ITEMS: '3' })));
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/matrix/:slug ─────────────────────────────────────────────────

describe('DELETE /api/matrix/:slug', () => {
  let kv: MockKV;
  beforeEach(() => { kv = new MockKV(); });

  test('returns 204 and removes list', async () => {
    kv.seed('list:del-m', JSON.stringify(makeList()));
    const req = new Request('http://localhost/api/matrix/del-m', { method: 'DELETE' });
    const res = await onRequestDelete(ctx(req, { slug: 'del-m' }, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(kv.has('list:del-m')).toBe(false);
  });
});

// ─── OPTIONS /api/matrix/:slug ────────────────────────────────────────────────

describe('OPTIONS /api/matrix/:slug', () => {
  test('returns 204 with CORS headers', async () => {
    const kv = new MockKV();
    const res = await onOptionsSlug(ctx(new Request('http://localhost'), {}, makeEnv(kv)));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });
});
