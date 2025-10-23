// rateLimit.ts - In-memory rate limiting for Cloudflare Workers

import type { Env } from './types';

/**
 * In-memory rate limit storage
 * Structure: { [key: string]: { count: number, resetAt: number } }
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/**
 * Clean up expired entries periodically
 */
function cleanupExpired() {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Check rate limit and increment counter
 * Returns { allowed: boolean, retryAfter?: number }
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number; current: number } {
  // Periodically cleanup (1% chance on each call)
  if (Math.random() < 0.01) {
    cleanupExpired();
  }

  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    // No entry or expired - create new
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, current: 1 };
  }

  // Entry exists and not expired
  if (entry.count >= limit) {
    // Rate limit exceeded
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { allowed: false, retryAfter, current: entry.count };
  }

  // Increment counter
  entry.count += 1;
  return { allowed: true, current: entry.count };
}

/**
 * Check multiple rate limits for a user action
 */
export function checkUserRateLimits(
  userId: string,
  action: 'save' | 'create',
  env: Env
): { allowed: boolean; error?: string; retryAfter?: number } {
  if (env.ENABLE_RATE_LIMITING !== 'true') {
    return { allowed: true };
  }

  const limits = {
    save: [
      {
        key: `user:${userId}:save:minute`,
        limit: Number(env.MAX_SAVES_PER_USER_PER_MINUTE || 2),
        window: 60 * 1000, // 1 minute
        message: 'Too many saves per minute',
      },
      {
        key: `user:${userId}:save:hour`,
        limit: Number(env.MAX_SAVES_PER_USER_PER_HOUR || 30),
        window: 60 * 60 * 1000, // 1 hour
        message: 'Too many saves per hour',
      },
    ],
    create: [
      {
        key: `user:${userId}:create:day`,
        limit: Number(env.MAX_LISTS_PER_USER_PER_DAY || 10),
        window: 24 * 60 * 60 * 1000, // 1 day
        message: 'Too many lists created today',
      },
    ],
  };

  const checksToRun = limits[action];

  for (const check of checksToRun) {
    const result = checkRateLimit(check.key, check.limit, check.window);
    if (!result.allowed) {
      return {
        allowed: false,
        error: `${check.message}. Try again in ${result.retryAfter}s. (${result.current}/${check.limit})`,
        retryAfter: result.retryAfter,
      };
    }
  }

  return { allowed: true };
}

/**
 * Check rate limits for a list
 */
export function checkListRateLimits(
  slug: string,
  env: Env
): { allowed: boolean; error?: string; retryAfter?: number } {
  if (env.ENABLE_RATE_LIMITING !== 'true') {
    return { allowed: true };
  }

  const limit = Number(env.MAX_SAVES_PER_LIST_PER_MINUTE || 10);
  const window = 60 * 1000; // 1 minute

  const result = checkRateLimit(`list:${slug}:save:minute`, limit, window);

  if (!result.allowed) {
    return {
      allowed: false,
      error: `This list is being updated too frequently. Try again in ${result.retryAfter}s. (${result.current}/${limit})`,
      retryAfter: result.retryAfter,
    };
  }

  return { allowed: true };
}

/**
 * Check list size limit
 */
export function checkListSize(
  data: string,
  env: Env
): { allowed: boolean; error?: string } {
  const maxSizeKB = Number(env.LIST_MAX_SIZE_KB || 100);
  const sizeKB = new TextEncoder().encode(data).length / 1024;

  if (sizeKB > maxSizeKB) {
    return {
      allowed: false,
      error: `List size (${sizeKB.toFixed(1)}KB) exceeds limit of ${maxSizeKB}KB. Remove some items or notes.`,
    };
  }

  return { allowed: true };
}

/**
 * Create a rate limit error response
 */
export function rateLimitResponse(
  error: string,
  retryAfter?: number
): Response {
  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: error,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': String(retryAfter || 60),
      },
    }
  );
}
