// __tests__/rateLimit.test.ts - Tests for rate limiting

import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  checkRateLimit,
  checkUserRateLimits,
  checkListRateLimits,
  checkListSize,
} from '../rateLimit.js';
import type { Env } from '../types.js';

// Mock environment
const mockEnv: Env = {
  MATRIX_STORE: {} as any,
  MAX_ITEMS: '500',
  MIN_SCALE: '1',
  MAX_SCALE: '5',
  ENABLE_RATE_LIMITING: 'true',
  MAX_SAVES_PER_USER_PER_MINUTE: '2',
  MAX_SAVES_PER_USER_PER_HOUR: '30',
  MAX_LISTS_PER_USER_PER_DAY: '10',
  MAX_USERS_PER_LIST: '10',
  MAX_SAVES_PER_LIST_PER_MINUTE: '10',
  LIST_MAX_SIZE_KB: '100',
  LIST_TTL_DAYS: '30',
};

describe('checkRateLimit', () => {
  test('allows first request', () => {
    const result = checkRateLimit('test-key-1', 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(1);
  });

  test('tracks multiple requests', () => {
    const key = 'test-key-2';
    
    const r1 = checkRateLimit(key, 3, 60000);
    expect(r1.allowed).toBe(true);
    expect(r1.current).toBe(1);

    const r2 = checkRateLimit(key, 3, 60000);
    expect(r2.allowed).toBe(true);
    expect(r2.current).toBe(2);

    const r3 = checkRateLimit(key, 3, 60000);
    expect(r3.allowed).toBe(true);
    expect(r3.current).toBe(3);
  });

  test('blocks when limit exceeded', () => {
    const key = 'test-key-3';
    
    checkRateLimit(key, 2, 60000);
    checkRateLimit(key, 2, 60000);
    
    const blocked = checkRateLimit(key, 2, 60000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.current).toBe(2);
  });

  test('resets after window expires', async () => {
    const key = 'test-key-4';
    const windowMs = 100; // 100ms window for testing
    
    checkRateLimit(key, 2, windowMs);
    checkRateLimit(key, 2, windowMs);
    
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const afterReset = checkRateLimit(key, 2, windowMs);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.current).toBe(1);
  });

  test('handles different keys independently', () => {
    checkRateLimit('key-a', 1, 60000);
    
    const blocked = checkRateLimit('key-a', 1, 60000);
    expect(blocked.allowed).toBe(false);
    
    const allowed = checkRateLimit('key-b', 1, 60000);
    expect(allowed.allowed).toBe(true);
  });

  test('returns retry time in seconds', () => {
    const key = 'test-key-5';
    checkRateLimit(key, 1, 5000); // 5 second window
    
    const blocked = checkRateLimit(key, 1, 5000);
    expect(blocked.retryAfter).toBeLessThanOrEqual(5);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});

describe('checkUserRateLimits', () => {
  test('allows save when under limits', () => {
    const result = checkUserRateLimits('user-test-1', 'save', mockEnv);
    expect(result.allowed).toBe(true);
  });

  test('blocks save when minute limit exceeded', () => {
    const userId = 'user-test-2';
    
    checkUserRateLimits(userId, 'save', mockEnv); // 1st
    checkUserRateLimits(userId, 'save', mockEnv); // 2nd
    
    const blocked = checkUserRateLimits(userId, 'save', mockEnv); // 3rd - should block
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toContain('minute');
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  test('allows create when under limits', () => {
    const result = checkUserRateLimits('user-test-3', 'create', mockEnv);
    expect(result.allowed).toBe(true);
  });

  test('blocks create when day limit exceeded', () => {
    const userId = 'user-test-4';
    
    // Create 10 lists (the limit)
    for (let i = 0; i < 10; i++) {
      const result = checkUserRateLimits(userId, 'create', mockEnv);
      expect(result.allowed).toBe(true);
    }
    
    // 11th should be blocked
    const blocked = checkUserRateLimits(userId, 'create', mockEnv);
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toContain('day');
  });

  test('bypasses when rate limiting disabled', () => {
    const disabledEnv = { ...mockEnv, ENABLE_RATE_LIMITING: 'false' };
    const userId = 'user-test-5';
    
    // Exhaust limits
    for (let i = 0; i < 5; i++) {
      checkUserRateLimits(userId, 'save', mockEnv);
    }
    
    // Should still be allowed with disabled env
    const result = checkUserRateLimits(userId, 'save', disabledEnv);
    expect(result.allowed).toBe(true);
  });

  test('provides helpful error messages', () => {
    const userId = 'user-test-6';
    
    checkUserRateLimits(userId, 'save', mockEnv);
    checkUserRateLimits(userId, 'save', mockEnv);
    
    const blocked = checkUserRateLimits(userId, 'save', mockEnv);
    expect(blocked.error).toBeTruthy();
    expect(blocked.error).toContain('2/2'); // Shows current/limit
    expect(blocked.error).toMatch(/\d+s/); // Shows retry time
  });
});

describe('checkListRateLimits', () => {
  test('allows update when under limit', () => {
    const result = checkListRateLimits('list-test-1', mockEnv);
    expect(result.allowed).toBe(true);
  });

  test('blocks update when limit exceeded', () => {
    const slug = 'list-test-2';
    
    // Make 10 requests (the limit)
    for (let i = 0; i < 10; i++) {
      const result = checkListRateLimits(slug, mockEnv);
      expect(result.allowed).toBe(true);
    }
    
    // 11th should be blocked
    const blocked = checkListRateLimits(slug, mockEnv);
    expect(blocked.allowed).toBe(false);
    expect(blocked.error).toContain('frequently');
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  test('tracks lists independently', () => {
    // Exhaust one list
    for (let i = 0; i < 10; i++) {
      checkListRateLimits('list-a', mockEnv);
    }
    
    const blockedA = checkListRateLimits('list-a', mockEnv);
    expect(blockedA.allowed).toBe(false);
    
    // Different list should still be allowed
    const allowedB = checkListRateLimits('list-b', mockEnv);
    expect(allowedB.allowed).toBe(true);
  });

  test('bypasses when rate limiting disabled', () => {
    const disabledEnv = { ...mockEnv, ENABLE_RATE_LIMITING: 'false' };
    const result = checkListRateLimits('list-test-3', disabledEnv);
    expect(result.allowed).toBe(true);
  });
});

describe('checkListSize', () => {
  test('allows small lists', () => {
    const smallData = JSON.stringify({ test: 'data' });
    const result = checkListSize(smallData, mockEnv);
    expect(result.allowed).toBe(true);
  });

  test('blocks large lists', () => {
    // Create 150KB of data (limit is 100KB)
    const largeData = 'a'.repeat(150 * 1024);
    const result = checkListSize(largeData, mockEnv);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain('100KB');
    expect(result.error).toContain('150.0KB');
  });

  test('allows exactly at limit', () => {
    // Create exactly 100KB of data
    const data = 'a'.repeat(100 * 1024);
    const result = checkListSize(data, mockEnv);
    expect(result.allowed).toBe(true);
  });

  test('uses UTF-8 byte size', () => {
    // Emoji and special chars take more bytes in UTF-8
    const data = '🎉'.repeat(50 * 1024); // Each emoji is ~4 bytes
    const result = checkListSize(data, mockEnv);
    expect(result.allowed).toBe(false);
  });

  test('provides size in error message', () => {
    const largeData = 'a'.repeat(120 * 1024);
    const result = checkListSize(largeData, mockEnv);
    expect(result.error).toMatch(/\d+\.\d+KB/);
  });
});
