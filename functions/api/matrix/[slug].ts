// functions/api/list/[slug].ts - GET/PUT/DELETE /api/list/:slug

import type { Env, GutList, UpdateListRequest, ConflictResponse } from '../../types';
import {
  normalizeScale,
  normalizeItem,
  sanitizeTitle,
  validateList,
  jsonResponse,
  errorResponse,
  getListKey,
} from '../../utils';

// GET /api/list/:slug - Read list
export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  try {
    const slug = params.slug as string;
    const key = getListKey(slug);
    
    const value = await env.MATRIX_STORE.get(key);
    
    if (!value) {
      return errorResponse('List not found', 404);
    }
    
    const list: GutList = JSON.parse(value);
    return jsonResponse(list);
    
  } catch (error) {
    console.error('Get list error:', error);
    return errorResponse('Failed to load list', 500);
  }
};

// PUT /api/list/:slug - Update list
export const onRequestPut: PagesFunction<Env> = async ({ request, params, env }) => {
  try {
    const slug = params.slug as string;
    const key = getListKey(slug);
    
    // Parse incoming data
    const incoming = await request.json().catch(() => ({})) as UpdateListRequest;
    
    // Get env limits
    const maxItems = Number(env.MAX_ITEMS || 500);
    const envMin = Number(env.MIN_SCALE || 1);
    const envMax = Number(env.MAX_SCALE || 5);
    
    // Validate
    const validation = validateList(incoming, maxItems);
    if (!validation.valid) {
      return errorResponse(validation.error || 'Invalid request', 400);
    }
    
    // Get existing list
    const existingRaw = await env.MATRIX_STORE.get(key);
    if (!existingRaw) {
      return errorResponse('List not found', 404);
    }
    
    const existing: GutList = JSON.parse(existingRaw);
    
    // Check for version conflict (optimistic concurrency)
    if (incoming.version !== undefined && incoming.version !== existing.version) {
      const conflict: ConflictResponse = {
        conflict: true,
        server: existing,
      };
      return jsonResponse(conflict, 409);
    }
    
    // Process scale
    const scale = incoming.scale !== undefined
      ? normalizeScale(incoming.scale, envMin, envMax)
      : existing.scale;
    
    // Process items
    const rawItems = incoming.items !== undefined ? incoming.items : existing.items;
    const items = rawItems
      .slice(0, maxItems)
      .map(item => normalizeItem(item, scale, maxItems));
    
    // Update list
    const updated: GutList = {
      title: incoming.title !== undefined 
        ? sanitizeTitle(incoming.title) 
        : existing.title,
      items,
      scale,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };
    
    // Store updated list
    await env.MATRIX_STORE.put(key, JSON.stringify(updated));
    
    return jsonResponse(updated);
    
  } catch (error) {
    console.error('Update list error:', error);
    return errorResponse('Failed to update list', 500);
  }
};

// DELETE /api/list/:slug - Delete list
export const onRequestDelete: PagesFunction<Env> = async ({ params, env }) => {
  try {
    const slug = params.slug as string;
    const key = getListKey(slug);
    
    await env.MATRIX_STORE.delete(key);
    
    return new Response(null, { 
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    });
    
  } catch (error) {
    console.error('Delete list error:', error);
    return errorResponse('Failed to delete list', 500);
  }
};

// Handle OPTIONS for CORS
export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
