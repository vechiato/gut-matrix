# GUT Matrix

[![Deploy to Cloudflare Pages](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml/badge.svg)](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange)](https://pages.cloudflare.com/)

A collaborative prioritization tool implementing the GUT Method (Gravity × Urgency × Tendency). Built on Cloudflare Pages with KV storage, enabling serverless multi-user collaboration without authentication.

## Features

- GUT Method scoring: Objective prioritization using G × U × T formula (range 1-125)
- Multi-user collaboration with independent scoring and automatic averaging
- URL-based sharing without authentication requirements
- Data persistence in Cloudflare KV (30-day retention)
- CSV and JSON export/import functionality
- Responsive design with mobile support
- Edge network deployment with sub-100ms response times
- Automatic synchronization every 10 seconds with version control
- Configurable save behavior (manual/automatic)
- Rate limiting to protect free tier usage
- Serverless architecture with zero backend management

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Visit http://localhost:8788
```

For production deployment, see [Deployment](#deployment) section.

## GUT Method

The GUT Method is a prioritization framework that scores items across three dimensions (1-5 scale):

| Factor | Definition | Scale |
|--------|-----------|-------|
| **Gravity** | Severity or impact of the issue | 1 = Minimal, 5 = Critical |
| **Urgency** | Time sensitivity | 1 = Can wait, 5 = Immediate |
| **Tendency** | Progression if unaddressed | 1 = Stable, 5 = Rapidly worsening |

**Priority Score = G × U × T** (range: 1-125)

Team members score items independently. The system calculates individual and average scores automatically.

## Architecture

### Stack
- **Frontend**: Vanilla JavaScript, CSS custom properties
- **Backend**: Cloudflare Pages Functions (TypeScript)
- **Storage**: Cloudflare KV
- **CI/CD**: GitHub Actions
- **Testing**: Jest (103+ tests)

### Design Principles
- Zero frontend dependencies for minimal bundle size
- Mobile-first responsive design (breakpoint: 768px)
- Semantic HTML with ARIA labels
- Manual save default to optimize KV write operations

### Data Flow
```
Client → Rate Limiter → Pages Function → KV Storage → CDN
   ↑                                                     ↓
   └──────────── Sync (10s interval) ───────────────────┘
```

### Rate Limits
- 2 saves/min per user
- 30 saves/hour per user
- 10 new lists/day per user
- 10 saves/min per list
- 100KB max list size

## Project Structure

```
gut-matrix/
├── public/
│   ├── index.html       # Landing page
│   ├── matrix.html      # Matrix editor
│   ├── styles.css       # Stylesheets
│   ├── app.js           # Home page logic
│   └── editor.js        # Editor with sync
├── functions/
│   ├── api/
│   │   ├── list/
│   │   │   ├── index.ts      # POST /api/list
│   │   │   └── [slug].ts     # GET/PUT/DELETE /api/list/:slug
│   │   └── matrix/
│   │       ├── index.ts      # GET /api/matrix
│   │       └── [slug].ts     # GET /api/matrix/:slug
│   ├── rateLimit.ts
│   ├── utils.ts
│   └── __tests__/
├── .github/workflows/deploy.yml
└── wrangler.toml        # Not in git
```

## Getting Started

### Prerequisites
- Node.js 20.x+
- Cloudflare account

### Local Development

1. **Installation**
   ```bash
   git clone https://github.com/vechiato/gut-matrix.git
   cd gut-matrix
   npm install
   ```

2. **Configure Cloudflare KV**
   ```bash
   # Copy example config
   cp wrangler.toml.example wrangler.toml
   
   # Create KV namespace
   npx wrangler kv:namespace create GUT_LISTS
   
   # Update wrangler.toml with the returned ID
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   # Visit http://localhost:8788
   ```

4. **Run Tests**
   ```bash
   npm test              # Run all tests
   npm run test:watch    # Watch mode
   npm run test:coverage # Generate coverage report
   ```

### Environment Setup

The `wrangler.toml` file contains sensitive configuration and is **not committed to git**. Use `wrangler.toml.example` as a template:

```toml
name = "gut-matrix"
compatibility_date = "2024-01-01"
pages_build_output_dir = "public"

[[kv_namespaces]]
binding = "GUT_LISTS"
id = "YOUR_KV_NAMESPACE_ID"  # Get from: npx wrangler kv:namespace create GUT_LISTS
```

## Deployment

### GitHub Actions (Recommended)

1. **Configure Secrets**
   
   In repository settings, add:
   - `CLOUDFLARE_API_TOKEN`: Generate at dash.cloudflare.com/profile/api-tokens
   - `CLOUDFLARE_ACCOUNT_ID`: Found in Cloudflare Dashboard

2. **Push to Deploy**
   ```bash
   git push origin main
   ```
   
   Workflow runs tests and deploys automatically.

See [GITHUB_SETUP.md](./GITHUB_SETUP.md) for details.

### Manual Deploy

```bash
# Login to Cloudflare
npx wrangler login

# Deploy
npx wrangler pages deploy public --project-name=gut-vibe
```

### Cloudflare Dashboard

1. Navigate to Workers & Pages → Create Application → Pages
2. Connect GitHub repository
3. Configure:
   - Build output directory: `public`
   - KV namespace binding: `GUT_LISTS`
4. Deploy

## API Reference

### Create New List
```http
POST /api/list
Content-Type: application/json

{
  "title": "Sprint Planning",
  "items": [
    {
      "id": "1",
      "description": "Fix login bug",
      "gravity": 5,
      "urgency": 5,
      "tendency": 4
    }
  ]
}
```

**Response (201):**
```json
{
  "slug": "abc123xyz",
  "url": "/matrix.html?slug=abc123xyz"
}
```

### Get List
```http
GET /api/list/:slug
```

**Response (200):**
```json
{
  "title": "Sprint Planning",
  "items": [
    {
      "id": "1",
      "description": "Fix login bug",
      "scores": {
        "user-uuid-1": {
          "gravity": 5,
          "urgency": 5,
          "tendency": 4,
          "score": 100
        }
      },
      "avgScore": {
        "gravity": 5,
        "urgency": 5,
        "tendency": 4,
        "score": 100,
        "count": 1
      }
    }
  ],
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T10:30:00Z",
  "version": 5
}
```

### Update List
```http
PUT /api/list/:slug
Content-Type: application/json
If-Match: 5  # Required for version control

{
  "title": "Updated Title",
  "items": [...],
  "version": 5
}
```

**Response (200):**
```json
{
  "success": true,
  "version": 6
}
```

**Error (409 Conflict):**
```json
{
  "error": "Version conflict",
  "currentVersion": 7,
  "yourVersion": 5
}
```

### Delete List
```http
DELETE /api/list/:slug
```

**Response (200):**
```json
{
  "success": true
}
```

### Export List (CSV)
```http
GET /api/list/:slug?format=csv
```

**Response:**
```csv
Description,Gravity,Urgency,Tendency,Score,Rank
Fix login bug,5,5,4,100,1
Update docs,3,2,2,12,2
```

### Export List (JSON)
```http
GET /api/list/:slug?format=json
```

**Response:**
```json
{
  "title": "Sprint Planning",
  "items": [...],
  "exportedAt": "2024-01-15T10:30:00Z"
}
```

### Import List
```http
POST /api/list/import
Content-Type: application/json

{
  "format": "json",
  "data": {
    "title": "Imported List",
    "items": [...]
  }
}
```

**Response (201):**
```json
{
  "slug": "abc123xyz",
  "url": "/matrix.html?slug=abc123xyz"
}
```

## Implementation Details

### Data Flow

1. **Create**: POST `/api/list` → Returns slug → Navigate to editor
2. **Score**: Adjust G/U/T → Store locally → Save → PUT `/api/list/:slug`
3. **Sync**: Poll every 10s → Fetch updates → Merge scores
4. **Collaborate**: Server calculates averages from all user scores
5. **Share**: Distribute URL for access

### User Identification

- Browser localStorage stores anonymous UUID (`gut_user_id`)
- No authentication required
- User's own scores are editable
- Other users' scores visible as aggregated averages
- Averages displayed when ≥2 users have scored

### Version Control

- Monotonically increasing `version` number per list
- Client sends `If-Match` header with expected version
- Server validates version before update
- Returns `409 Conflict` on mismatch
- Prevents concurrent update conflicts

### Save Behavior

**Manual (Default)**:
- No automatic persistence
- Explicit save action required
- Visual indicator for unsaved state
- Optimizes KV write operations

**Auto-save (Optional)**:
- Configurable via toggle
- 5-second debounce after last edit
- Preference stored in localStorage

### Rate Limits

| Limit | Value | Purpose |
|-------|-------|---------|
| Saves per minute (user) | 2 | Prevents rapid clicking |
| Saves per hour (user) | 30 | Daily usage spread |
| New lists per day (user) | 10 | Prevents spam |
| Saves per minute (list) | 10 | Prevents edit conflicts |
| Max list size | 100KB | Storage optimization |

Data retention: 30 days of inactivity.

## Security & Privacy

### Model

Anonymous collaborative system:

- URL-based access without authentication
- 8-character random slugs (4.3B possible combinations)
- No global list enumeration endpoint
- Browser-generated anonymous UUIDs for scoring
- Not suitable for confidential data

### Recommendations

- Share URLs only with intended users
- Delete lists after use via editor interface
- Avoid sensitive information in descriptions
- Use generic/temporary list names

## Troubleshooting

### Cannot find module errors
```bash
npm install  # Reinstall dependencies
```

### Local KV not working
```bash
# Use correct dev command
npx wrangler pages dev public --kv GUT_LISTS=your-namespace-id
```

### TypeScript errors during build
```bash
npm install @cloudflare/workers-types  # Install type definitions
```

### 404 on API endpoints
Check:
- Functions exist in `functions/api/list/` directory
- Filenames: `index.ts` and `[slug].ts`
- Running `npm run dev` or deployed correctly

### KV data not persisting in production
Verify:
- KV binding configured in Cloudflare Dashboard (Settings → Functions)
- Binding name is `GUT_LISTS` (matches wrangler.toml)
- KV namespace exists with correct ID

### Rate limit errors
If you see "Rate limit exceeded":
- Wait 1 minute before saving again
- Disable auto-save to reduce writes
- Delete old lists to free up quota

### Version conflicts (409 errors)
When collaborative editing:
- Auto-sync resolves most conflicts automatically
- Reload to fetch latest version if conflicts persist
- Reapply changes and save

## Performance & Limits

| Metric | Value | Notes |
|--------|-------|-------|
| Max items per list | 500 | Configurable in code |
| Scale range | 1-5 | Fixed in GUT methodology |
| Description length | 200 chars | Per item |
| Max list size | 100KB | Rate limiter enforced |
| Auto-sync interval | 10 seconds | Configurable in editor |
| Response time | <100ms | Global edge network |

### Cloudflare Free Tier Capacity
- KV Reads: 100,000/day
- KV Writes: 1,000/day
- Functions: 100,000 requests/day
- Data transfer: 100GB/month

Example usage: 50 lists × 20 items × 5 users ≈ 250 writes/day

## License

MIT License - see [LICENSE](./LICENSE)

## Contributing

1. Fork repository
2. Create feature branch
3. Implement changes with tests
4. Submit pull request

Run `npm test` before submitting.

## Support

- Issues: [GitHub Issues](https://github.com/vechiato/gut-matrix/issues)

---

Built on Cloudflare's edge network
