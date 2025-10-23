# 🧠 GUT Vibe

[![Deploy to Cloudflare Pages](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml/badge.svg)](https://github.com/vechiato/gut-matrix/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare-Pages-orange)](https://pages.cloudflare.com/)

A lightweight, multi-user collaborative prioritization application using the GUT Method (Gravity, Urgency, Tendency). Built entirely on Cloudflare's edge network. No traditional databases required!

## Features

- ✨ **GUT Prioritization**: Scientifically rank items using Gravity × Urgency × Tendency
- 👥 **Collaborative Scoring**: Multiple people score independently, see averages when 2+ people score
- 🔗 **Share Links**: Anyone with the link can score items
- 💾 **Persistent**: Data stored in Cloudflare KV
- 🔄 **Auto-Sync**: Changes sync automatically every 10 seconds
- � **Free Tier Optimized**: Manual save by default to conserve Cloudflare KV writes
- 📥 **Export/Import**: CSV and JSON support for data portability
- 🛡️ **Rate Limited**: Protects against abuse while staying on free tier
- �📱 **Responsive**: Works on mobile and desktop
- 🚀 **Serverless**: No backend servers to manage
- 🌍 **Global**: Cloudflare's edge network for low latency

## 💰 Free Tier Strategy

To maximize Cloudflare's generous free tier (1000 writes/day KV):

### Manual Save by Default
- **Changes are NOT auto-saved** by default
- Click the **"Save"** button to persist changes
- Visual indicator shows "● Unsaved changes" when you have edits
- Save button pulses when there are unsaved changes

### Optional Auto-Save
- Click the **"Auto-save: OFF"** button to enable auto-saving
- When enabled, changes auto-save after 5 seconds of inactivity
- Setting persists in browser localStorage
- Use sparingly if on free tier

### Rate Limiting
- **2 saves per minute** per user (prevents accidental spam)
- **30 saves per hour** per user
- **10 new lists per day** per user
- **10 saves per minute** per list (prevents collaborative conflicts)
- **100KB max** list size

### Best Practices
1. Make multiple changes before clicking Save
2. Only enable auto-save if you need real-time collaboration
3. Use export/import for bulk operations
4. Delete old lists you don't need anymore

## What is GUT Method?

The GUT Method helps prioritize items objectively by scoring three factors (1-5 scale):

- **G**ravity: How serious is the problem/opportunity?
- **U**rgency: How quickly does it need to be addressed?
- **T**endency: Will it worsen/grow if left alone?
- **Score**: G × U × T (range: 1-125)

Higher scores = higher priority.

## Architecture

- **Frontend**: Static HTML/CSS/JavaScript served by Cloudflare Pages
- **Backend**: Cloudflare Pages Functions (TypeScript)
- **Storage**: Cloudflare KV for persistence
- **No Auth**: URL-based access control (possession = access)

## Project Structure

```
gut-vibe/
├── public/              # Static frontend files
│   ├── index.html       # Home page (create/list)
│   ├── matrix.html      # GUT list editor page
│   ├── styles.css       # Shared styles
│   ├── app.js          # Home page logic
│   └── editor.js       # Editor logic with collaborative scoring
├── functions/           # Cloudflare Pages Functions (API)
│   ├── api/
│   │   └── list/
│   │       ├── index.ts      # POST /api/list (create)
│   │       └── [slug].ts     # GET/PUT/DELETE /api/list/:slug
│   ├── types.ts        # TypeScript types (GutItem, UserScore, etc.)
│   └── utils.ts        # Utility functions (scoring, averaging)
├── package.json
├── wrangler.toml       # Cloudflare config
├── tsconfig.json       # TypeScript config
├── CLAUDE.md           # Full specification
└── README.md           # This file
```

## Getting Started

### Prerequisites

- Node.js 18+ installed
- A Cloudflare account (free tier works!)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) installed

### Installation

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Create a KV namespace**:
   ```bash
   npx wrangler kv:namespace create "MATRIX_STORE"
   ```
   
   This will output an ID like: `{ binding = "MATRIX_STORE", id = "abc123..." }`

3. **Configure local wrangler.toml** (not committed to git):
   ```bash
   # Copy the example file
   cp wrangler.toml.example wrangler.toml
   
   # Edit wrangler.toml and add your KV namespace ID
   # Uncomment the [[kv_namespaces]] section and add your ID
   ```
   
   Your `wrangler.toml` should look like:
   ```toml
   [[kv_namespaces]]
   binding = "MATRIX_STORE"
   id = "abc123..."  # Your actual KV namespace ID from step 2
   
   [vars]
   MAX_ITEMS = "500"
   MIN_SCALE = "1"
   MAX_SCALE = "5"
   # ... other variables
   ```
   
   **Note**: `wrangler.toml` is in `.gitignore` to protect your KV namespace ID

4. **Run locally**:
   ```bash
   npm run dev
   ```
   
   Visit `http://localhost:8788` in your browser

### Development

The development server will:
- Serve static files from `public/`
- Hot-reload function changes
- Use local KV storage (simulated)

**Note**: For local dev with actual KV, you need to bind the KV namespace:
```bash
npx wrangler pages dev public --kv MATRIX_STORE=your-kv-namespace-id
```

## Deployment

### Deploy to Cloudflare Pages

1. **Login to Cloudflare**:
   ```bash
   npx wrangler login
   ```

2. **Deploy**:
   ```bash
   npm run deploy
   ```
   
   Or manually:
   ```bash
   npx wrangler pages deploy public
   ```

3. **Configure KV binding in Cloudflare Dashboard**:
   - Go to your Pages project in the Cloudflare dashboard
   - Navigate to Settings → Functions → KV namespace bindings
   - Add binding: `MATRIX_STORE` → select your KV namespace
   - Add environment variables:
     - `MAX_ITEMS` = `500`
     - `MIN_SCALE` = `1`
     - `MAX_SCALE` = `5`

4. **Access your app**:
   Your app will be available at `https://your-project.pages.dev`

### Alternative: Git Integration

You can also deploy by connecting your Git repository to Cloudflare Pages:

1. Push this code to GitHub/GitLab
2. In Cloudflare Dashboard → Pages → Create project
3. Connect your repository
4. Build settings:
   - **Build command**: (leave empty)
   - **Build output directory**: `public`
5. Add KV binding and environment variables as above

## API Reference

### POST /api/list
Create a new GUT list.

**Request**:
```json
{
  "title": "Q4 Backlog Prioritization",
  "scale": { "min": 1, "max": 5 }
}
```

**Response** (201):
```json
{
  "slug": "q4-backlog-prioritization-a1b2c3d4"
}
```

### GET /api/list/:slug
Get list data with all users' scores.

**Response** (200):
```json
{
  "title": "Q4 Backlog Prioritization",
  "items": [
    {
      "id": "item-1",
      "label": "Reduce checkout latency",
      "scores": {
        "user-abc123": { "g": 5, "u": 4, "t": 4, "score": 80 },
        "user-def456": { "g": 4, "u": 5, "t": 3, "score": 60 }
      },
      "avgScore": {
        "g": 4.5,
        "u": 4.5,
        "t": 3.5,
        "score": 70,
        "count": 2
      },
      "notes": "P95 latency is rising"
    }
  ],
  "scale": { "min": 1, "max": 5 },
  "updatedAt": "2025-01-22T10:30:00Z",
  "version": 3
}
```

### PUT /api/list/:slug
Update list with your scores.

**Request**:
```json
{
  "title": "Q4 Backlog Prioritization",
  "items": [
    {
      "id": "item-1",
      "label": "Reduce checkout latency",
      "g": 5,
      "u": 4,
      "t": 4,
      "notes": "P95 latency is rising"
    }
  ],
  "scale": { "min": 1, "max": 5 },
  "version": 3,
  "userId": "user-abc123"
}
```

**Response** (200):
```json
{
  "title": "Q4 Backlog Prioritization",
  "items": [/* full items with all users' scores and averages */],
  "scale": { "min": 1, "max": 5 },
  "updatedAt": "2025-01-22T10:35:00Z",
  "version": 4
}
```

**Conflict** (409):
```json
{
  "conflict": true,
  "server": { /* latest server version */ }
}
```

### DELETE /api/list/:slug
Delete a list.

**Response**: 204 No Content

## How It Works

### Data Flow

1. **Create**: User fills form → POST to `/api/list` → Returns slug → Redirect to editor
2. **Score**: User scores items (G, U, T) → Stored locally → Click Save → PUT to `/api/list/:slug` with userId
3. **Collaborate**: Other users score independently → Server merges scores → Calculates averages
4. **Auto-sync**: Every 10 seconds, fetch latest data → Show all users' average scores when count ≥ 2
5. **Share**: Copy URL → Anyone with URL can access and add their scores

### User Identification

- Each browser gets a unique UUID (stored in localStorage as `gut_user_id`)
- Users are anonymous - no login required
- Your scores are editable, others' scores shown as read-only averages
- Average scores displayed only when 2+ people have scored

### Slug Generation

Slugs are generated from:
- Sanitized title (lowercase, alphanumeric + dashes)
- 8-character random suffix
- Example: `q4-backlog-a1b2c3d4` or just `a1b2c3d4` if no title

### Optimistic Concurrency

Each matrix has a `version` number that increments on every save. When updating:
1. Client sends current `version` in PUT request
2. Server compares with stored version
3. If they match → save succeeds, version increments
4. If they don't match → return 409 with latest data
5. Client can merge changes or take server version

### Local Storage

"My Lists" is stored in browser's `localStorage`:
- Not synced between devices
- Stores last 10 visited lists
- Used for quick access only
- Also stores your user ID (UUID) for collaborative scoring

## Security Considerations

⚠️ **Important**: This is a **collaborative system** with **anonymous users**.

- **Anyone with the URL can score items** in the list
- Slugs are unguessable (8-char random = 4 billion+ possibilities)
- No server-side listing of all lists
- Each browser gets a unique anonymous ID for scoring
- **Do not use for confidential prioritization**
- Consider this a "collaborative prioritization board" model

### Potential Improvements

For production use, consider:
- Add authentication (Cloudflare Access, OAuth)
- Implement read-only sharing links
- Add rate limiting
- Add audit logs
- Implement soft deletes with recovery
- Add user ownership tracking

## Limits & Performance

- **Max items per list**: 500 (configurable in `wrangler.toml`)
- **Scale range**: 1-5 (configurable)
- **Item label**: 200 characters max
- **Notes per item**: 1024 characters max
- **Auto-sync interval**: 10 seconds
- **KV storage**: 
  - Free tier: 100,000 reads/day, 1,000 writes/day
  - Paid: Unlimited
- **Response time**: ~50-200ms globally (Cloudflare edge network)

### Recommended Limits

For best performance:
- List size: 50 items or fewer for smooth editing
- Collaborators: Works well with 2-10 people scoring simultaneously
- Update frequency: Auto-saves on manual save, auto-syncs every 10s

## Troubleshooting

### "Cannot find module" errors
```bash
npm install
```

### Local dev KV not working
Make sure you're using the correct command:
```bash
npx wrangler pages dev public --kv MATRIX_STORE
```

### TypeScript errors
The TypeScript errors are cosmetic during development. They'll be resolved when:
```bash
npm install  # Installs @cloudflare/workers-types
```

### 404 on API endpoints
Make sure:
- Functions are in `functions/api/list/` directory
- File names match: `index.ts` and `[slug].ts`
- You're running `npm run dev` or deploying properly

### KV not persisting
In production:
- Check KV binding is configured in Cloudflare dashboard
- Verify the binding name is `MATRIX_STORE`
- Check KV namespace exists and has the correct ID

## Future Enhancements

Potential features to add:

- [ ] **Named users**: Optional usernames instead of anonymous IDs
- [ ] **Score history**: Track how scores change over time
- [ ] **Weighted averages**: Give some users' scores more weight
- [ ] **CSV export**: Download prioritization results
- [ ] **Templates**: Pre-built lists for common use cases
- [ ] **Item dependencies**: Link related items
- [ ] **Deadlines**: Add due dates to items
- [ ] **Comments**: Discuss items with collaborators
- [ ] **Real-time updates**: WebSocket for instant sync
- [ ] **Read-only links**: Share without scoring permissions
- [ ] **Team workspaces**: Organized collections of lists

## Tech Stack

- **Frontend**: Vanilla JavaScript (no framework needed!)
- **Backend**: TypeScript + Cloudflare Pages Functions
- **Storage**: Cloudflare KV (key-value store)
- **Hosting**: Cloudflare Pages (global CDN)
- **API**: REST (JSON)

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally
5. Submit a pull request

## License

MIT License - feel free to use for any purpose!

## Support

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers KV Docs](https://developers.cloudflare.com/kv/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)

## Acknowledgments

Built following the specification in `CLAUDE.md`. This project demonstrates:
- Serverless architecture
- Edge computing
- Collaborative editing patterns
- Optimistic concurrency control

---

**Happy matrix-ing! 🧠✨**
