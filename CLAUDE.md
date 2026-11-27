# CLAUDE.md

Guidance for coding agents (Claude Code and similar) working in this
repository. Humans: the same rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## Read first

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes every subsystem (auth,
data model, the Phaser ↔ React boundary, editor state, drawing studio, touch
mode, drafts and publish, pop-ups, uploads, checks, API routes). Read the
relevant section before changing a subsystem; most of the non-obvious
invariants are written down there.

## Layout

- `app/` — the Next.js 16 / React 19 app. **Run all `npm` commands here.**
- `supabase/migrations/` — the database, as ordered SQL migrations.
- `docs/` — architecture, ops runbooks, editor notes.
- `klecks/` — not in the repository; a pinned, patched Klecks checkout created
  by `app/scripts/build-klecks.mjs`. Never edit `app/public/klecks/` except
  `index.html` (everything else is generated).

## Commands (from `app/`)

```bash
npm run dev          # next dev, port 3000
npm run build        # next build (runs the Klecks build first)
npm run lint         # eslint
npx tsc --noEmit     # type-check
npm run klecks:build # rebuild the drawing studio
npm run db:seed      # demo rooms + main world into an empty database
```

There is **no test framework**. Don't claim test coverage you can't run. If a
change touches game or editor behaviour, verify it in a browser.

TypeScript path alias: `@/*` → `app/src/*`.

## Rules that are easy to break

- `src/proxy.ts` is Next.js 16's middleware; the function must be exported as
  `proxy`.
- `src/lib/owner.ts` is server-only. Never import it from a `"use client"`
  file; client code asks `GET /api/admin/whoami`.
- Every write handler under `src/app/api/` calls `getOwnerUser()` and returns
  403 otherwise. Public paths must not use the service-role client.
- The slug check in `api/editor/world-file/route.ts`
  (`/^[a-z0-9][a-z0-9_-]*$/`) is the only path-traversal guard. Never relax it.
- Anything importing Phaser is loaded with `dynamic(..., { ssr: false })`.
- Rooms, objects and entry points have a slug `id` and a stable `iid`; links
  use the `iid`. Rename slugs only through the store/data helpers.
- Shape changes go through migrations on read (`src/data/migrations.ts` and
  friends). Database changes are new files in `supabase/migrations/`; never
  edit one that has shipped.
- Any new writer of `rooms.config` must bump `updated_at` (the optimistic
  concurrency token).
- A new table or column that stores a file reference goes in
  `REFERENCE_TABLES` (`src/lib/storageScan.ts`).
- Every visitor-facing string has English and Arabic.
- Touch-only UI is gated on `useTouchMode()`; desktop with a mouse must not
  change.
- The drawing studio is Klecks. Don't add a second canvas library; Klecks
  changes live only in `app/scripts/klecks-patches/`.
- Browser storage keys start with `creatofolio-` and every change to Klecks
  is marked `// [creatofolio patch]`. Renaming a storage key drops what
  visitors have saved under it, so don't do it casually.
