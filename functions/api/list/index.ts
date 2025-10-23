// functions/api/list/index.ts - POST /api/list (create new GUT list)

import type { Env, CreateListRequest, CreateListResponse, GutList } from '../../types';
import {
  generateSlug,
  normalizeScale,
  sanitizeTitle,
  jsonResponse,
  errorResponse,
  getListKey,
} from '../../utils';
import {
  checkUserRateLimits,
  checkListSize,
  rateLimitResponse,
} from '../../rateLimit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // Parse request body
    const body = await request.json().catch(() => ({})) as CreateListRequest;

    // Extract userId from request (could be in header or body)
    const userId = request.headers.get('X-User-Id') || 'anonymous';

    // Check rate limits
    const rateLimitCheck = checkUserRateLimits(userId, 'create', env);
    if (!rateLimitCheck.allowed) {
      return rateLimitResponse(rateLimitCheck.error!, rateLimitCheck.retryAfter);
    }

    // Get env limits
    const envMin = Number(env.MIN_SCALE || 1);
    const envMax = Number(env.MAX_SCALE || 5);

    // Process scale
    const scale = normalizeScale(body.scale, envMin, envMax);
    
    // Process title
    const title = sanitizeTitle(body.title);

    // Generate slug
    const slug = generateSlug(title);

    // Create list
    const list: GutList = {
      title,
      items: [],
      scale,
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    const listData = JSON.stringify(list);

    // Check size limit
    const sizeCheck = checkListSize(listData, env);
    if (!sizeCheck.allowed) {
      return errorResponse(sizeCheck.error!, 413);
    }

    // Store in KV with TTL
    const key = getListKey(slug);
    const ttlDays = Number(env.LIST_TTL_DAYS || 30);
    await env.MATRIX_STORE.put(key, listData, {
      expirationTtl: ttlDays * 24 * 60 * 60,
    });

    // Return slug
    const response: CreateListResponse = { slug };
    return jsonResponse(response, 201);

  } catch (error) {
    console.error('Create list error:', error);
    return errorResponse('Failed to create list', 500);
  }
};

// Handle OPTIONS for CORS
export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
