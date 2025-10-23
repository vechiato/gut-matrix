// types.ts - Shared TypeScript types for GUT Method

export interface UserScore {
  g: number;  // Gravity (1-5)
  u: number;  // Urgency (1-5)
  t: number;  // Tendency (1-5)
  score: number;  // Computed: g × u × t
}

export interface AverageScore {
  g: number;
  u: number;
  t: number;
  score: number;
  count: number;  // Number of users who scored
}

export interface GutItem {
  id: string;
  label: string;
  scores: Record<string, UserScore>;  // userId -> UserScore
  avgScore?: AverageScore;  // Calculated from all user scores
  notes?: string;
}

export interface Scale {
  min: number;
  max: number;
}

export interface GutList {
  title: string;
  items: GutItem[];
  scale: Scale;
  updatedAt: string;
  version: number;
}

export interface UserItemUpdate {
  id: string;
  label?: string;
  g?: number;
  u?: number;
  t?: number;
  notes?: string;
}

export interface CreateListRequest {
  title?: string;
  scale?: Partial<Scale>;
}

export interface UpdateListRequest {
  title?: string;
  items?: Partial<GutItem>[] | UserItemUpdate[];  // Can be full items or user updates
  scale?: Partial<Scale>;
  version?: number;
  userId?: string;  // User making the update
}

export interface CreateListResponse {
  slug: string;
}

export interface ConflictResponse {
  conflict: true;
  server: GutList;
}

export interface Env {
  MATRIX_STORE: KVNamespace;
  MAX_ITEMS: string;
  MIN_SCALE: string;
  MAX_SCALE: string;
  
  // Rate Limiting
  ENABLE_RATE_LIMITING: string;
  MAX_SAVES_PER_USER_PER_MINUTE: string;
  MAX_SAVES_PER_USER_PER_HOUR: string;
  MAX_LISTS_PER_USER_PER_DAY: string;
  MAX_USERS_PER_LIST: string;
  MAX_SAVES_PER_LIST_PER_MINUTE: string;
  
  // Resource Limits
  LIST_MAX_SIZE_KB: string;
  LIST_TTL_DAYS: string;
}
