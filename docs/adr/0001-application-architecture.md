# ADR 0001: Application architecture

- **Status:** Accepted (records the architecture as built on `main`, commit `ab27f0e`)
- **Date:** 2026-09-26

## Context

GUT Matrix lets a group prioritize a list of items using the GUT method. Each person rates every item on Gravity, Urgency and Tendency (1 to the list's maximum). An item's score is G × U × T, and the group ranking uses the average of everyone's scores.

Requirements that shaped the design:

- Anyone can create a list and share it by link. No sign-up.
- Several people score the same list at the same time without overwriting each other.
- It runs on Cloudflare's free tier with nothing to operate: no servers, no database.
- It stays small enough for one person to maintain.

## Decisions

### 1. Static frontend plus Cloudflare Pages Functions

The UI is plain HTML, CSS and JavaScript in `public/`, with no framework and no build step. The API is a set of TypeScript Pages Functions in `functions/`. Cloudflare routes requests by file path:

| File | Endpoint |
|---|---|
| `functions/api/list/index.ts` | `POST /api/list`: create a list |
| `functions/api/list/[slug].ts` | `GET` / `PUT` / `DELETE /api/list/:slug` |

`functions/api/matrix/*` is an older copy of these endpoints. The frontend doesn't use it.

**Why:** Pages serves static files from the edge for free, and Functions deploy together with them in one step (`wrangler pages deploy public`). Nothing needs bundling.

### 2. One KV entry per list

Each list is one JSON document in Cloudflare KV, stored under the key `list:<slug>`:

```json
{
  "title": "Q4 backlog",
  "scale": { "min": 1, "max": 5 },
  "version": 7,
  "updatedAt": "2026-09-26T08:00:00.000Z",
  "ownerTokenHash": "<sha-256 hex, never sent to clients>",
  "items": [{
    "id": "…", "label": "Reduce checkout latency", "notes": "…", "url": "…",
    "scores": { "<userId>": { "g": 5, "u": 4, "t": 4, "score": 80 } },
    "avgScore": { "g": 4.5, "u": 4.5, "t": 3.5, "score": 70, "count": 2 }
  }]
}
```

Every write sets a TTL of `LIST_TTL_DAYS` (30). A list nobody saves for 30 days is deleted automatically.

**Why:** a list is always read and written as a whole, so a key-value store is enough. KV is free at this scale and needs no schema. The TTL keeps storage from growing forever without a cleanup job.

**Trade-off:** KV is eventually consistent. Right after a save, a request served by another edge location can briefly return the previous version.

### 3. Anonymous identity per browser

On first visit the browser generates a UUID and keeps it in `localStorage` as `gut_user_id`. It's sent as `userId` in save requests and in the `X-User-Id` header. The server checks that it looks like a UUID but can't verify who sent it.

**Why:** people can score a list without accounts. The ID only exists to keep each person's scores separate.

**Trade-off:** the same person on two browsers counts as two people. Clearing browser storage loses that browser's scores. Anyone can claim any ID.

### 4. Link-based sharing

A list's slug is the title turned into a URL-safe string plus 8 random hex characters, e.g. `q4-backlog-3fa91c0e`. The editor opens at `/matrix.html?k=<slug>`. Anyone with the link can read, add items and score.

**Why:** sharing is just sending a link.

**Trade-off:** 8 hex characters (about 4 billion combinations) is guessable with enough attempts. Anyone who has the link can edit the list.

### 5. Owner token for deletion

`POST /api/list` returns `{ slug, ownerToken }`, where the token is 32 random bytes. The server stores only its SHA-256 hash (`ownerTokenHash`). The creating browser keeps the token in `localStorage` as `gut_owner_<slug>`. `DELETE` requires it in the `X-Owner-Token` header and returns 403 without it.

Rules that keep this working:

- Every response that returns a list passes through `stripSecretFields`, so the hash never leaves the server.
- `PUT` copies `ownerTokenHash` from the stored list, so saving doesn't erase the owner.

**Why:** editing is open to everyone with the link, but a destructive, irreversible action should be limited to the creator.

**Trade-off:** the token lives in one browser, and losing it means nobody can delete the list (it still expires after 30 days). Lists created before this feature have no hash, and anyone can delete them.

### 6. Each person saves only their own scores; the server merges

The editor sends every item but only the current person's scores: `{ id, label, g, u, t, notes, url }` plus `userId`. The server, in `PUT /api/list/:slug`:

1. If the number of items changed (someone added or removed one), rebuilds the item list by `id`, keeping everyone else's scores.
2. Matches incoming items to stored items **by position in the list** and updates label, notes and url.
3. Clamps the person's g/u/t to the list's scale, recomputes `score = g × u × t`, stores it under their `userId` and recomputes `avgScore` (rounded to one decimal).

A request without `userId` replaces the items wholesale.

**Why:** two people scoring at the same time don't overwrite each other's ratings, and the server is the only place that computes scores and averages.

**Trade-offs:**

- Step 2 matches by position, not by `id`. If items were reordered without the count changing, scores and edits would land on the wrong items.
- `normalizeItem` doesn't copy `url`. It survives only because the editor resends it on every save. Any new item field has to be added to both the editor's save payload and the server's merge code.

### 7. Version numbers against lost updates

Every list has a `version` that goes up by one on each successful save. The editor sends the version it last loaded. If the stored version is different, the server rejects the save with 409 and returns the current list, and the editor shows a conflict dialog.

**Why:** KV has no transactions. Checking the version stops a save based on an old copy from silently overwriting newer changes.

**Trade-off:** the check and the write are two separate KV operations, so two saves arriving at almost the same moment can both pass.

### 8. Polling instead of real-time updates

The editor asks for the list every 10 seconds, sending `X-Current-Version`. If nothing changed the server replies 304 with no body. The editor doesn't poll while the user has unsaved edits. Saving is manual by default, with an optional auto-save that waits for a pause in typing.

**Why:** polling needs no WebSockets or Durable Objects, and the 304 reply keeps it cheap. Manual saving keeps KV writes (the scarcest free-tier resource) low.

**Trade-off:** collaborators' changes show up after up to 10 seconds, and not at all while you have unsaved edits.

### 9. Best-effort limits

`functions/rateLimit.ts` limits saves per person (per minute and per hour), new lists per person per day, and saves per list per minute. It returns 429 with `Retry-After`. It's switched on only when `ENABLE_RATE_LIMITING` is `"true"`, and all limits come from `wrangler.toml` variables. Separately, a list larger than `LIST_MAX_SIZE_KB` (100) is rejected with 413, and item counts and text lengths are capped.

**Why:** protects the free tier from accidents and casual abuse without paying for a separate store.

**Trade-off:** the counters live in the memory of each Cloudflare Worker instance. They aren't shared between instances or edge locations and reset whenever an instance restarts, so they don't stop determined abuse. Because the user ID comes from the client, a sender can also get around the per-person limits by changing it.

### 10. Delivery

GitHub Actions (`.github/workflows/deploy.yml`) runs the Jest tests on every pull request and every push to `main`. A push to `main` deploys production (https://gut.vechiato.cc). Pull requests from branches in this repository get a preview at `https://<branch>.gut-matrix.pages.dev`. `wrangler.toml` holds the KV namespace ID and isn't committed; `wrangler.toml.example` is the template.

## Consequences

- Hosting is free and there's nothing to run: no servers, database, migrations or backups.
- Collaboration works without accounts, but identity and access are only as strong as a browser UUID and a link.
- Concurrent scoring is safe because of the per-person merge and version check, apart from the near-simultaneous race in decision 7.
- Data isn't permanent: lists vanish after 30 days without a save, and there's no export on the server side. Users can export to CSV or JSON from the editor.
- Moving to real-time updates or strict consistency would mean replacing KV with a Durable Object per list. That was considered in the original spec and deferred.
