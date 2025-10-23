// functions/api/list/[slug].ts - GET/PUT/DELETE /api/list/:slug

import type { Env, GutList, UpdateListRequest, ConflictResponse, UserItemUpdate } from '../../types';
import {
  normalizeScale,
  normalizeItem,
  sanitizeTitle,
  validateList,
  jsonResponse,
  errorResponse,
  getListKey,
  validateUserId,
  mergeUserScore,
} from '../../utils';
import {
  checkUserRateLimits,
  checkListRateLimits,
  checkListSize,
  rateLimitResponse,
} from '../../rateLimit';

// Type guard to check if an item is a UserItemUpdate
function isUserItemUpdate(item: any): item is UserItemUpdate {
  return 'g' in item || 'u' in item || 't' in item;
}

// GET /api/list/:slug - Read list
export const onRequestGet: PagesFunction<Env> = async ({ request, params, env }) => {
  try {
    const slug = params.slug as string;
    const key = getListKey(slug);
    
    const value = await env.MATRIX_STORE.get(key);
    
    if (!value) {
      return errorResponse('List not found', 404);
    }
    
    const list: GutList = JSON.parse(value);
    
    // Check if client has current version (smart sync)
    const clientVersion = request.headers.get('X-Current-Version');
    if (clientVersion && parseInt(clientVersion) === list.version) {
      // Client is up to date, return 304 Not Modified
      return new Response(null, {
        status: 304,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      });
    }
    
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
    
    // Validate userId if provided
    if (incoming.userId !== undefined && !validateUserId(incoming.userId)) {
      return errorResponse('Invalid user ID format', 400);
    }
    
    // Check rate limits for the user
    if (incoming.userId) {
      const userRateLimit = checkUserRateLimits(incoming.userId, 'save', env);
      if (!userRateLimit.allowed) {
        return rateLimitResponse(userRateLimit.error!, userRateLimit.retryAfter);
      }
    }
    
    // Check rate limits for the list
    const listRateLimit = checkListRateLimits(slug, env);
    if (!listRateLimit.allowed) {
      return rateLimitResponse(listRateLimit.error!, listRateLimit.retryAfter);
    }
    
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
    
    // Start with existing items to preserve all user scores
    let items = existing.items.map(item => normalizeItem(item, scale, maxItems));
    
    // If userId is provided, merge user scores into items
    if (incoming.userId && incoming.items) {
      // Check if this is a structural change (different number of items)
      const isStructuralChange = incoming.items.length !== existing.items.length;
      
      if (isStructuralChange) {
        // Handle add/delete: rebuild items array but preserve existing scores
        items = incoming.items.slice(0, maxItems).map(incomingItem => {
          // Try to find existing item by ID
          const existingItem = existing.items.find(e => e.id === incomingItem.id);
          
          if (existingItem) {
            // Item exists - preserve its scores and update label/notes
            return {
              ...normalizeItem(existingItem, scale, maxItems),
              label: incomingItem.label || existingItem.label,
              notes: incomingItem.notes !== undefined ? incomingItem.notes : existingItem.notes,
            };
          } else {
            // New item - create with empty scores
            return normalizeItem(incomingItem, scale, maxItems);
          }
        });
      }
      
      // Now merge user's scores into items
      items = items.map((item, index) => {
        const incomingItem = incoming.items![index];
        if (incomingItem && isUserItemUpdate(incomingItem)) {
          // Update label if provided
          if (incomingItem.label !== undefined) {
            item = { ...item, label: incomingItem.label };
          }
          
          // Update notes if provided
          if (incomingItem.notes !== undefined) {
            item = { ...item, notes: incomingItem.notes };
          }
          
          // It's a user item update with g, u, t scores
          if (incomingItem.g !== undefined && incomingItem.u !== undefined && incomingItem.t !== undefined) {
            const userScore: import('../../types').UserScore = {
              g: incomingItem.g,
              u: incomingItem.u,
              t: incomingItem.t,
              score: incomingItem.g * incomingItem.u * incomingItem.t,
            };
            return mergeUserScore(item, incoming.userId!, userScore, scale);
          }
        }
        return item;
      });
    }
    
    // Handle case where incoming items are full GutItems (e.g., title-only update)
    if (incoming.items && !incoming.userId) {
      // This is a non-user update, replace items entirely
      items = incoming.items
        .slice(0, maxItems)
        .map(item => normalizeItem(item, scale, maxItems));
    }
    
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
    
    const updatedData = JSON.stringify(updated);
    
    // Check size limit
    const sizeCheck = checkListSize(updatedData, env);
    if (!sizeCheck.allowed) {
      return errorResponse(sizeCheck.error!, 413);
    }
    
    // Store updated list with TTL
    const ttlDays = Number(env.LIST_TTL_DAYS || 30);
    await env.MATRIX_STORE.put(key, updatedData, {
      expirationTtl: ttlDays * 24 * 60 * 60,
    });
    
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
