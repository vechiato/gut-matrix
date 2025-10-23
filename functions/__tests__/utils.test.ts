// __tests__/utils.test.ts - Tests for utility functions

import { describe, test, expect } from '@jest/globals';
import {
  generateSlug,
  sanitizeTitle,
  normalizeScale,
  normalizeItem,
  normalizeUserScore,
  calculateAverageScore,
  mergeUserScore,
  validateUserId,
  validateList,
} from '../utils.js';
import type { GutItem, UserScore, Scale, UpdateListRequest } from '../types.js';

describe('generateSlug', () => {
  test('generates slug from title', () => {
    const slug = generateSlug('My Test List');
    expect(slug).toMatch(/^my-test-list-[a-z0-9]{8}$/);
  });

  test('handles empty title', () => {
    const slug = generateSlug('');
    expect(slug).toMatch(/^[a-z0-9]{8}$/);
  });

  test('removes special characters', () => {
    const slug = generateSlug('Test@#$%^&*()List!!!');
    expect(slug).toMatch(/^test-list-[a-z0-9]{8}$/);
  });

  test('handles very long titles', () => {
    const longTitle = 'a'.repeat(100);
    const slug = generateSlug(longTitle);
    expect(slug.length).toBeLessThan(60);
  });

  test('generates unique slugs', () => {
    const slug1 = generateSlug('Test');
    const slug2 = generateSlug('Test');
    expect(slug1).not.toBe(slug2);
  });
});

describe('sanitizeTitle', () => {
  test('trims whitespace', () => {
    expect(sanitizeTitle('  Test  ')).toBe('Test');
  });

  test('limits length to 200 characters', () => {
    const longTitle = 'a'.repeat(250);
    expect(sanitizeTitle(longTitle).length).toBe(200);
  });

  test('returns empty string for empty input', () => {
    expect(sanitizeTitle('')).toBe('');
  });

  test('returns empty string for whitespace only', () => {
    expect(sanitizeTitle('   ')).toBe('');
  });

  test('returns empty string for undefined', () => {
    expect(sanitizeTitle(undefined)).toBe('');
  });

  test('returns empty string for non-string', () => {
    expect(sanitizeTitle(123 as any)).toBe('');
    expect(sanitizeTitle(null as any)).toBe('');
  });
});

describe('normalizeScale', () => {
  test('uses provided scale', () => {
    const scale = normalizeScale({ min: 1, max: 5 }, 1, 10);
    expect(scale).toEqual({ min: 1, max: 5 });
  });

  test('clamps min to env limits', () => {
    const scale = normalizeScale({ min: 0, max: 5 }, 1, 10);
    expect(scale.min).toBe(1);
  });

  test('clamps max to env limits', () => {
    const scale = normalizeScale({ min: 1, max: 20 }, 1, 10);
    expect(scale.max).toBe(10);
  });

  test('ensures min < max', () => {
    const scale = normalizeScale({ min: 5, max: 3 }, 1, 10);
    expect(scale.min).toBeLessThan(scale.max);
  });

  test('uses defaults for empty object', () => {
    const scale = normalizeScale({}, 1, 5);
    expect(scale).toEqual({ min: 1, max: 5 });
  });

  test('handles partial scale', () => {
    // When min is provided, it's clamped to 1 (envMin)
    const scale1 = normalizeScale({ min: 2 }, 1, 5);
    expect(scale1.min).toBe(1); // Clamped to envMin
    expect(scale1.max).toBe(5); // Uses default 5

    const scale2 = normalizeScale({ max: 10 }, 1, 10);
    expect(scale2.min).toBe(1); // Uses default 1
    expect(scale2.max).toBe(10);
  });
});

describe('normalizeItem', () => {
  const scale: Scale = { min: 1, max: 5 };

  test('preserves existing item properties', () => {
    const item: Partial<GutItem> = {
      id: 'test-123',
      label: 'Test Item',
      scores: {
        'user-1': { g: 5, u: 4, t: 3, score: 60 },
      },
      notes: 'Some notes',
    };

    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.id).toBe('test-123');
    expect(normalized.label).toBe('Test Item');
    expect(normalized.scores).toEqual(item.scores);
    expect(normalized.notes).toBe('Some notes');
  });

  test('generates ID if missing', () => {
    const item: Partial<GutItem> = { label: 'Test' };
    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.id).toBeTruthy();
    expect(typeof normalized.id).toBe('string');
  });

  test('uses default label if empty', () => {
    const item: Partial<GutItem> = { id: '123', label: '' };
    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.label).toBe('Untitled Item');
  });

  test('truncates long labels', () => {
    const longLabel = 'a'.repeat(300);
    const item: Partial<GutItem> = { id: '123', label: longLabel };
    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.label.length).toBeLessThanOrEqual(200);
  });

  test('truncates long notes', () => {
    const longNotes = 'a'.repeat(2000);
    const item: Partial<GutItem> = {
      id: '123',
      label: 'Test',
      notes: longNotes,
    };
    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.notes!.length).toBeLessThanOrEqual(1024);
  });

  test('initializes empty scores object', () => {
    const item: Partial<GutItem> = { id: '123', label: 'Test' };
    const normalized = normalizeItem(item, scale, 500);
    expect(normalized.scores).toEqual({});
  });
});

describe('normalizeUserScore', () => {
  const scale: Scale = { min: 1, max: 5 };

  test('clamps values to scale', () => {
    const score = normalizeUserScore({ g: 10, u: 0, t: 3 }, scale);
    expect(score.g).toBe(5);
    expect(score.u).toBe(1);
    expect(score.t).toBe(3);
  });

  test('calculates score correctly', () => {
    const score = normalizeUserScore({ g: 5, u: 4, t: 3 }, scale);
    expect(score.score).toBe(60);
  });

  test('handles missing values with scale min', () => {
    const score = normalizeUserScore({}, scale);
    expect(score.g).toBe(1);
    expect(score.u).toBe(1);
    expect(score.t).toBe(1);
    expect(score.score).toBe(1);
  });

  test('handles partial values', () => {
    const score = normalizeUserScore({ g: 5 }, scale);
    expect(score.g).toBe(5);
    expect(score.u).toBe(1);
    expect(score.t).toBe(1);
  });
});

describe('calculateAverageScore', () => {
  test('calculates average from multiple users', () => {
    const scores: Record<string, UserScore> = {
      'user-1': { g: 5, u: 4, t: 3, score: 60 },
      'user-2': { g: 3, u: 5, t: 4, score: 60 },
    };

    const avg = calculateAverageScore(scores);
    expect(avg).toBeDefined();
    expect(avg!.g).toBe(4);
    expect(avg!.u).toBe(4.5);
    expect(avg!.t).toBe(3.5);
    expect(avg!.score).toBe(60);
    expect(avg!.count).toBe(2);
  });

  test('returns undefined for empty scores', () => {
    const avg = calculateAverageScore({});
    expect(avg).toBeUndefined();
  });

  test('calculates average even for single user', () => {
    const scores: Record<string, UserScore> = {
      'user-1': { g: 5, u: 4, t: 3, score: 60 },
    };
    const avg = calculateAverageScore(scores);
    expect(avg).toBeDefined();
    expect(avg!.g).toBe(5);
    expect(avg!.u).toBe(4);
    expect(avg!.t).toBe(3);
    expect(avg!.score).toBe(60);
    expect(avg!.count).toBe(1);
  });

  test('handles three users', () => {
    const scores: Record<string, UserScore> = {
      'user-1': { g: 5, u: 5, t: 5, score: 125 },
      'user-2': { g: 3, u: 3, t: 3, score: 27 },
      'user-3': { g: 4, u: 4, t: 4, score: 64 },
    };

    const avg = calculateAverageScore(scores);
    expect(avg).toBeDefined();
    expect(avg!.g).toBe(4);
    expect(avg!.u).toBe(4);
    expect(avg!.t).toBe(4);
    expect(avg!.count).toBe(3);
  });
});

describe('mergeUserScore', () => {
  const scale: Scale = { min: 1, max: 5 };

  test('adds new user score to item', () => {
    const item: GutItem = {
      id: '123',
      label: 'Test',
      scores: {},
    };
    const userScore: UserScore = { g: 5, u: 4, t: 3, score: 60 };

    const merged = mergeUserScore(item, 'user-1', userScore, scale);
    expect(merged.scores['user-1']).toEqual(userScore);
  });

  test('updates existing user score', () => {
    const item: GutItem = {
      id: '123',
      label: 'Test',
      scores: {
        'user-1': { g: 3, u: 3, t: 3, score: 27 },
      },
    };
    const userScore: UserScore = { g: 5, u: 4, t: 3, score: 60 };

    const merged = mergeUserScore(item, 'user-1', userScore, scale);
    expect(merged.scores['user-1']).toEqual(userScore);
  });

  test('preserves other users scores', () => {
    const item: GutItem = {
      id: '123',
      label: 'Test',
      scores: {
        'user-1': { g: 5, u: 5, t: 5, score: 125 },
        'user-2': { g: 3, u: 3, t: 3, score: 27 },
      },
    };
    const userScore: UserScore = { g: 4, u: 4, t: 4, score: 64 };

    const merged = mergeUserScore(item, 'user-3', userScore, scale);
    expect(merged.scores['user-1']).toEqual({ g: 5, u: 5, t: 5, score: 125 });
    expect(merged.scores['user-2']).toEqual({ g: 3, u: 3, t: 3, score: 27 });
    expect(merged.scores['user-3']).toEqual(userScore);
  });

  test('calculates average when 2+ users', () => {
    const item: GutItem = {
      id: '123',
      label: 'Test',
      scores: {
        'user-1': { g: 5, u: 5, t: 5, score: 125 },
      },
    };
    const userScore: UserScore = { g: 3, u: 3, t: 3, score: 27 };

    const merged = mergeUserScore(item, 'user-2', userScore, scale);
    expect(merged.avgScore).toBeDefined();
    expect(merged.avgScore!.count).toBe(2);
  });

  test('normalizes user score before merging', () => {
    const item: GutItem = {
      id: '123',
      label: 'Test',
      scores: {},
    };
    const userScore: UserScore = { g: 10, u: 0, t: 3, score: 999 };

    const merged = mergeUserScore(item, 'user-1', userScore, scale);
    expect(merged.scores['user-1'].g).toBe(5); // Clamped
    expect(merged.scores['user-1'].u).toBe(1); // Clamped
    expect(merged.scores['user-1'].score).toBe(15); // Recalculated: 5*1*3
  });
});

describe('validateUserId', () => {
  test('accepts valid UUID', () => {
    expect(validateUserId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('rejects non-string', () => {
    expect(validateUserId(123 as any)).toBe(false);
    expect(validateUserId(null as any)).toBe(false);
    expect(validateUserId(undefined as any)).toBe(false);
  });

  test('rejects too short', () => {
    expect(validateUserId('abc123')).toBe(false);
  });

  test('rejects invalid format', () => {
    expect(validateUserId('not-a-uuid-at-all')).toBe(false);
  });

  test('rejects empty string', () => {
    expect(validateUserId('')).toBe(false);
  });

  test('rejects UUID without dashes', () => {
    expect(validateUserId('550e8400e29b41d4a716446655440000')).toBe(false);
  });
});

describe('validateList', () => {
  test('accepts valid list request', () => {
    const request: UpdateListRequest = {
      title: 'Test List',
      items: [
        { id: '1', label: 'Item 1' },
        { id: '2', label: 'Item 2' },
      ],
      scale: { min: 1, max: 5 },
      version: 1,
    };

    const result = validateList(request, 500);
    expect(result.valid).toBe(true);
  });

  test('rejects too many items', () => {
    const items = Array(501)
      .fill(null)
      .map((_, i) => ({ id: `${i}`, label: `Item ${i}` }));
    const request: UpdateListRequest = { items };

    const result = validateList(request, 500);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('500');
  });

  test('accepts empty items array', () => {
    const request: UpdateListRequest = { items: [] };

    const result = validateList(request, 500);
    expect(result.valid).toBe(true);
  });

  test('accepts request without items', () => {
    const request: UpdateListRequest = { title: 'Just a title' };

    const result = validateList(request, 500);
    expect(result.valid).toBe(true);
  });
});
