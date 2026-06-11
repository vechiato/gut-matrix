// functions/api/list/index.ts - POST /api/list (create new GUT list)

import type { Env, CreateListRequest, CreateListResponse, GutList } from '../../types';
import {
  generateSlug,
  normalizeScale,
  sanitizeTitle,
  jsonResponse,
  errorResponse,
  getListKey,
  generateOwnerToken,
  hashHex,
} from '../../utils';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // Parse request body
    const body = await request.json().catch(() => ({})) as CreateListRequest;

    // Get env limits
    const envMin = Number(env.MIN_SCALE || 1);
    const envMax = Number(env.MAX_SCALE || 10);

    // Process scale
    const scale = normalizeScale(body.scale, envMin, envMax);
    
    // Process title
    const title = sanitizeTitle(body.title);

    // Generate slug
    const slug = generateSlug(title);

    const ownerToken = generateOwnerToken();
    const ownerTokenHash = await hashHex(ownerToken);

    const list: GutList = {
      title,
      items: [],
      scale,
      updatedAt: new Date().toISOString(),
      version: 1,
      ownerTokenHash,
    };

    const key = getListKey(slug);
    await env.MATRIX_STORE.put(key, JSON.stringify(list));

    const response: CreateListResponse = { slug, ownerToken };
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
