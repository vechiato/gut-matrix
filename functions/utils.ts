// utils.ts - Shared utility functions for GUT Method

import type { GutList, GutItem, Scale, UserScore, AverageScore } from './types';

/**
 * Generate a unique slug from title and random suffix
 */
export function generateSlug(title?: string): string {
  const base = title
    ? title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50)
    : '';
  
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
  
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Calculate GUT score (G × U × T)
 */
export function calculateScore(g: number, u: number, t: number): number {
  return g * u * t;
}

/**
 * Clamp a value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Validate and normalize scale
 */
export function normalizeScale(
  scale: Partial<Scale> | undefined,
  envMin: number,
  envMax: number
): Scale {
  const min = scale?.min !== undefined ? Number(scale.min) : 1;
  const max = scale?.max !== undefined ? Number(scale.max) : 5;
  
  const normalizedMin = clamp(min, 1, envMin);
  const normalizedMax = clamp(max, 2, envMax);
  
  // Ensure min < max
  if (normalizedMin >= normalizedMax) {
    return { min: 1, max: 5 };
  }
  
  return { min: normalizedMin, max: normalizedMax };
}

/**
 * Validate and normalize a GUT item (collaborative version)
 */
export function normalizeItem(
  item: Partial<GutItem>,
  scale: Scale,
  maxItems: number
): GutItem {
  // Initialize scores object if not present
  const scores = item.scores || {};
  
  return {
    id: String(item.id || crypto.randomUUID()),
    label: String(item.label || '').slice(0, 200).trim() || 'Untitled Item',
    scores,
    avgScore: item.avgScore,
    notes: item.notes ? String(item.notes).slice(0, 1024).trim() : undefined,
  };
}

/**
 * Normalize user score with scale clamping
 */
export function normalizeUserScore(
  score: Partial<UserScore>,
  scale: Scale
): UserScore {
  const g = clamp(Number(score.g) || scale.min, scale.min, scale.max);
  const u = clamp(Number(score.u) || scale.min, scale.min, scale.max);
  const t = clamp(Number(score.t) || scale.min, scale.min, scale.max);
  
  return {
    g,
    u,
    t,
    score: calculateScore(g, u, t),
  };
}

/**
 * Calculate average scores from all user scores
 */
export function calculateAverageScore(scores: Record<string, UserScore>): AverageScore | undefined {
  const userScores = Object.values(scores);
  
  if (userScores.length === 0) {
    return undefined;
  }
  
  const sum = userScores.reduce(
    (acc, score) => ({
      g: acc.g + score.g,
      u: acc.u + score.u,
      t: acc.t + score.t,
      score: acc.score + score.score,
    }),
    { g: 0, u: 0, t: 0, score: 0 }
  );
  
  const count = userScores.length;
  
  return {
    g: Math.round((sum.g / count) * 10) / 10,  // Round to 1 decimal
    u: Math.round((sum.u / count) * 10) / 10,
    t: Math.round((sum.t / count) * 10) / 10,
    score: Math.round((sum.score / count) * 10) / 10,
    count,
  };
}

/**
 * Merge user scores into an item
 */
export function mergeUserScore(
  item: GutItem,
  userId: string,
  userScore: UserScore,
  scale: Scale
): GutItem {
  // Normalize the user score
  const normalizedScore = normalizeUserScore(userScore, scale);
  
  // Create new scores object with merged user score
  const updatedScores = {
    ...item.scores,
    [userId]: normalizedScore,
  };
  
  // Recalculate average
  const avgScore = calculateAverageScore(updatedScores);
  
  return {
    ...item,
    scores: updatedScores,
    avgScore,
  };
}

/**
 * Validate user ID format
 */
export function validateUserId(userId: any): boolean {
  if (typeof userId !== 'string') return false;
  // Simple UUID format check
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId);
}

/**
 * Sanitize and truncate title
 */
export function sanitizeTitle(title: any): string {
  if (typeof title !== 'string') return '';
  return title.trim().slice(0, 200);
}

/**
 * Validate list payload
 */
export function validateList(data: any, maxItems: number): {
  valid: boolean;
  error?: string;
} {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }

  if (data.items && Array.isArray(data.items)) {
    if (data.items.length > maxItems) {
      return { valid: false, error: `Too many items (max ${maxItems})` };
    }
  }

  if (data.scale) {
    if (typeof data.scale.min === 'number' && typeof data.scale.max === 'number') {
      if (data.scale.min >= data.scale.max) {
        return { valid: false, error: 'Scale min must be less than max' };
      }
    }
  }

  return { valid: true };
}

/**
 * Create JSON response with CORS headers
 */
export function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

/**
 * Create error response
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Get list key for KV storage
 */
export function getListKey(slug: string): string {
  return `list:${slug}`;
}
