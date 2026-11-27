# Contributing to Creatofolio

Thanks for wanting to help. This is a small, volunteer-maintained project;
small, focused pull requests are the easiest to review and merge.

## Getting set up

Follow **Quick start** in the [README](README.md). You can work on most of the
public game and landing page with no database at all: without Supabase
credentials the app boots from the static seed in `app/src/data/`. The admin
editors need a Supabase project (a free hosted one is fine).

## Before you open a pull request

From `app/`:

```bash
npm run lint
npx tsc --noEmit
```

There is **no automated test suite**. Say in the pull request what you ran
and what you looked at in the browser. For anything in the editors, check it
with a mouse *and* in touch mode (`?touch=1` on any `/admin` page in
development simulates a touch device).

## Ground rules

These come from how the project is built; a change that breaks one usually
breaks something else.

- **Two languages, always.** Every visitor-facing string has English and
  Arabic (`name`/`nameAr`, `{ en, ar }`). Layouts must work right-to-left.
- **Slugs and iids.** Rooms, objects and entry points have a human slug
  (`id`, editable) and a stable UUID (`iid`, never edited). Links between
  things use the `iid`.
- **Data shape changes go through migrations on read**
  (`src/data/migrations.ts`, `contentMigrations.ts`, `landingMigrations.ts`),
  not by editing old rows.
- **Database changes are new files** in `supabase/migrations/`
  (timestamp-prefixed). Don't edit a migration that has shipped, and make new
  ones safe to run on a database that already holds data.
- **Every write API route calls `getOwnerUser()`** and returns 403 otherwise.
  The proxy does not cover `/api/*`.
- **URLs from content go through `src/lib/safeUrl.ts`**, iframes through the
  allowlist in `EmbedBlock.tsx`.
- **A new table or column that stores a file reference** must be added to
  `REFERENCE_TABLES` in `src/lib/storageScan.ts`, or the unused-files scan
  will offer to delete files that are in use.
- **Phaser can't render on the server.** Anything importing it is loaded with
  `dynamic(..., { ssr: false })`.
- **One drawing tool.** The studio is Klecks; don't add a second canvas
  library. Changes to Klecks itself live only as patches in
  `app/scripts/klecks-patches/`.
- **Desktop with a mouse must not change** when you add touch behaviour: gate
  touch-only UI on `useTouchMode()`.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains each subsystem in
detail and is the best place to start reading.

## Reporting bugs and ideas

Use the issue templates. For security problems, see [SECURITY.md](SECURITY.md)
instead of opening a public issue.

## Licence

By contributing you agree that your contribution is licensed under the
project's [MIT licence](LICENSE).
