// Shared test helpers for API handler tests

import type { Env, GutList } from '../types.js';

export class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, _options?: unknown): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  seed(key: string, value: string) {
    this.store.set(key, value);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  raw(key: string): string | null {
    return this.store.get(key) ?? null;
  }
}

export function makeEnv(kv: MockKV, overrides: Partial<Env> = {}): Env {
  return {
    MATRIX_STORE: kv as any,
    MAX_ITEMS: '500',
    MIN_SCALE: '1',
    MAX_SCALE: '5',
    ENABLE_RATE_LIMITING: 'false',
    MAX_SAVES_PER_USER_PER_MINUTE: '60',
    MAX_SAVES_PER_USER_PER_HOUR: '1000',
    MAX_LISTS_PER_USER_PER_DAY: '100',
    MAX_USERS_PER_LIST: '100',
    MAX_SAVES_PER_LIST_PER_MINUTE: '100',
    LIST_MAX_SIZE_KB: '100',
    LIST_TTL_DAYS: '30',
    ...overrides,
  };
}

export function ctx(request: Request, params: Record<string, string>, env: Env): any {
  return { request, params, env };
}

export function jsonRequest(method: string, url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function makeList(overrides: Partial<GutList> = {}): GutList {
  return {
    title: 'Test List',
    items: [],
    scale: { min: 1, max: 5 },
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

export const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

let rlCounter = 0;
export function freshUserId(): string {
  const n = String(++rlCounter).padStart(12, '0');
  return `bbbbbbbb-0000-4000-a000-${n}`;
}
