# GUT Matrix

[![Deploy to Cloudflare Pages](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml/badge.svg)](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange)](https://pages.cloudflare.com/)

A collaborative prioritization tool implementing the GUT Method (Gravity × Urgency × Tendency). Built on Cloudflare Pages with KV storage — no authentication required, share a URL to collaborate.

## Features

- **GUT scoring** — objective prioritization using G × U × T (range 1–125)
- **Multi-user collaboration** — independent scoring per user, automatic average calculation
- **URL-based sharing** — no accounts, no login
- **Score chip picker** — click to select G/U/T values (1 to configured max); no keyboard entry required
- **Conflict resolution** — optimistic concurrency with version control and merge UI
- **Undo deletions** — 5-second undo toast after deleting an item
- **Auto-sync** — polls for changes every 10 seconds; skips if you have unsaved work
- **Export/Import** — CSV and JSON, client-side (no server round-trip)
- **Dark mode** — follows system appearance
- **Responsive** — mobile-first; average score columns hidden on small screens with a toggle
- **Accessible** — ARIA live regions, labeled inputs, keyboard-trapped modals, screen-reader-friendly
- **Rate limiting** — protects Cloudflare free tier KV quotas

## Quick Start

```bash
npm install
npm run dev
# Visit http://localhost:8788
```

For production deployment see [Deployment](#deployment).

## GUT Method

Scores each item on three dimensions (default scale 1–5, max configurable up to 10):

| Factor | Question | 1 | 5 |
|--------|----------|---|---|
| **Gravity** | How serious is the impact? | Minimal | Critical |
| **Urgency** | How time-sensitive is it? | Can wait | Immediate |
| **Tendency** | Will it worsen if ignored? | Stable | Rapidly deteriorates |

**Priority Score = G × U × T** (range 1–125 on the default 1–5 scale)

Each team member scores independently. Averages are shown once ≥ 2 users have scored an item.

## Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS + CSS custom properties (zero dependencies) |
| Backend | Cloudflare Pages Functions (TypeScript) |
| Storage | Cloudflare KV |
| CI/CD | GitHub Actions |
| Tests | Jest — 151 tests, ~90% backend coverage |

### Data Flow

```
Client → Rate Limiter → Pages Function → KV Storage
   ↑                                         ↓
   └──────── Auto-sync (10s polling) ────────┘
```

### Project Structure

```
gut-matrix/
├── public/
│   ├── index.html        # Landing page
│   ├── matrix.html       # List editor
│   ├── styles.css        # All styles (CSS variables, dark mode)
│   ├── app.js            # Landing page logic
│   └── editor.js         # Editor: scoring, sync, conflict resolution
├── functions/
│   ├── api/
│   │   ├── list/
│   │   │   ├── index.ts       # POST /api/list (with rate limiting)
│   │   │   └── [slug].ts      # GET/PUT/DELETE /api/list/:slug
│   │   └── matrix/
│   │       ├── index.ts       # POST /api/matrix (legacy, no rate limiting)
│   │       └── [slug].ts      # GET/PUT/DELETE /api/matrix/:slug
│   ├── rateLimit.ts
│   ├── utils.ts
│   ├── types.ts
│   └── __tests__/             # 5 test files, 151 tests
├── wrangler.toml.example
└── jest.config.js
```

## Getting Started

### Prerequisites

- Node.js 20+
- Cloudflare account (free tier is sufficient)

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/vechiato/gut-matrix.git
cd gut-matrix
npm install

# 2. Create KV namespace
npx wrangler kv:namespace create MATRIX_STORE

# 3. Configure wrangler.toml
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml — uncomment the [[kv_namespaces]] block and set your KV ID

# 4. Start dev server
npm run dev
# Visit http://localhost:8788
```

### Running Tests

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report (~90% backend coverage)
```

## Deployment

### GitHub Actions (recommended)

1. Add repository secrets:
   - `CLOUDFLARE_API_TOKEN` — from [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
   - `CLOUDFLARE_ACCOUNT_ID` — from your Cloudflare dashboard

2. Push to `main` — tests run then deploy automatically.

### Manual Deploy

```bash
npx wrangler login
npx wrangler pages deploy public --project-name=gut-matrix
```

### Cloudflare Dashboard

1. Workers & Pages → Create → Pages → Connect to Git
2. Build output directory: `public`
3. Settings → Functions → KV namespace bindings → add `MATRIX_STORE`

## API Reference

All endpoints return JSON. CORS headers are set on every response.

### POST /api/list — Create list

```http
POST /api/list
Content-Type: application/json
X-User-Id: <uuid>

{
  "title": "Sprint Planning",
  "scale": { "min": 1, "max": 5 }
}
```

**201 Created:**
```json
{ "slug": "sprint-planning-a1b2c3d4" }
```

### GET /api/list/:slug — Fetch list

```http
GET /api/list/sprint-planning-a1b2c3d4
X-Current-Version: 3
```

Returns **304 Not Modified** if the client already has the latest version, otherwise **200** with the full list:

```json
{
  "title": "Sprint Planning",
  "scale": { "min": 1, "max": 5 },
  "version": 4,
  "updatedAt": "2025-06-11T10:30:00Z",
  "items": [
    {
      "id": "550e8400-...",
      "label": "Fix login bug",
      "scores": {
        "user-uuid-1": { "g": 5, "u": 5, "t": 4, "score": 100 }
      },
      "avgScore": { "g": 4.5, "u": 4.5, "t": 3.5, "score": 70.9, "count": 2 },
      "notes": "Affects checkout flow",
      "url": "https://github.com/org/repo/issues/42"
    }
  ]
}
```

### PUT /api/list/:slug — Update list

```http
PUT /api/list/sprint-planning-a1b2c3d4
Content-Type: application/json
X-User-Id: <uuid>

{
  "title": "Sprint Planning",
  "version": 4,
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "items": [
    { "id": "...", "label": "Fix login bug", "g": 5, "u": 5, "t": 4 }
  ]
}
```

- `version` is required for conflict detection — omit to skip the check
- `userId` causes the server to merge only your scores, preserving other users' scores
- Without `userId`, the items array replaces the stored items entirely

**200 OK** — returns the updated list object.

**409 Conflict** — someone else saved between your last fetch and this save:
```json
{ "conflict": true, "server": { ...serverList } }
```

**Error codes:**

| Status | Cause |
|--------|-------|
| 400 | Invalid userId format, scale min ≥ max, or too many items |
| 404 | List not found |
| 409 | Version conflict |
| 413 | List exceeds 100 KB size limit |
| 429 | Rate limit exceeded |

### DELETE /api/list/:slug — Delete list

```http
DELETE /api/list/sprint-planning-a1b2c3d4
```

**204 No Content**

### Legacy endpoints

`/api/matrix` and `/api/matrix/:slug` mirror the list endpoints without rate limiting. Kept for backward compatibility.

## Configuration

Environment variables (set in `wrangler.toml` or Cloudflare Dashboard):

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_ITEMS` | `500` | Max items per list |
| `MIN_SCALE` / `MAX_SCALE` | `1` / `10` | Scale min is always 1; max can be 3–10 |
| `LIST_MAX_SIZE_KB` | `100` | Max serialized list size |
| `LIST_TTL_DAYS` | `30` | KV expiry after last write |
| `ENABLE_RATE_LIMITING` | `true` | Toggle rate limiting |
| `MAX_SAVES_PER_USER_PER_MINUTE` | `2` | Per-user save rate |
| `MAX_SAVES_PER_USER_PER_HOUR` | `30` | Per-user hourly cap |
| `MAX_LISTS_PER_USER_PER_DAY` | `10` | Per-user daily creation cap |
| `MAX_SAVES_PER_LIST_PER_MINUTE` | `10` | Per-list write rate |

## Security & Privacy

- URL-based access — share only with intended collaborators
- 8-character random slugs (~4.3 billion combinations)
- No global list enumeration endpoint
- Anonymous UUIDs stored in `localStorage` (never sent to a server without user action)
- Not suitable for confidential data — treat lists as semi-public

## Cloudflare Free Tier Capacity

| Resource | Free limit | Typical usage |
|----------|-----------|---------------|
| KV reads | 100,000/day | ~5 reads per page load |
| KV writes | 1,000/day | 1 write per save |
| Function invocations | 100,000/day | 1 per API call |

Example: 50 active users × 10 saves/day = 500 writes/day — well within the free tier.

## Troubleshooting

**Local KV not persisting**
```bash
# Make sure you're using the --kv flag
npm run dev   # already configured in package.json
```

**TypeScript errors**
```bash
npm run types   # type-check without building
```

**409 conflict errors during collaboration**
- The editor shows a merge dialog — choose "Use Their Version" or "Keep My Changes"
- Auto-sync (10s) resolves most conflicts before you save

**Rate limit 429**
- Wait 1 minute, then save again
- Enable manual save (default) rather than auto-save to reduce writes

## License

MIT — see [LICENSE](./LICENSE)

## Contributing

1. Fork and create a feature branch
2. Add or update tests (`npm test` must pass)
3. Submit a pull request

---

Built on [Cloudflare Pages](https://pages.cloudflare.com/)
