# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting instead: on this repository open
**Security → Report a vulnerability**. Include what you found, how to
reproduce it, and what an attacker could do with it.

This is a volunteer-maintained project with no guaranteed response time, but
reports are read and credited.

## What counts

Creatofolio is a single-owner CMS. The things it is meant to guarantee:

- Only the owner account can reach `/admin/*` and the write API routes.
- Only the owner can write to the database or to Storage (Row Level Security
  through `public.is_owner()`), even with the public anon key.
- Visitors never see drafts, trashed items, backups or private buckets.
- Pop-up and page content can't run script or load arbitrary iframes
  (`src/lib/safeUrl.ts`, the embed allowlist in `EmbedBlock.tsx`).

Anything that breaks one of those is in scope. So is a path-traversal or
upload-type bypass in `src/app/api/editor/*`.

## Running it safely

- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never prefix it (or
  `OWNER_EMAIL`) with `NEXT_PUBLIC_`.
- Close sign-ups on your Supabase Auth instance once the owner account exists.
- Enrol two-factor at `/admin/security`, on two devices.
  Recovery is server-side: see `docs/ops/ACCOUNT_RECOVERY.md`.
