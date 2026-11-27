# Account recovery runbook

For when the owner account can't sign in: a lost authenticator (two-factor), a
forgotten password, or both. Everything here is done **on the server**, with the
Supabase **service-role key**. Nothing in the app can recover the account on
its own, by design: the app is the thing being protected.

> **Never paste the service-role key into a chat, a ticket, a commit or a
> screenshot.** It bypasses every row-level-security rule. Type it into your own
> terminal only, and clear the shell history line afterwards if your shell
> records it.

## Where the keys live

- **Self-hosted Supabase:** your hosting panel → the Supabase service →
  *Environment variables* (hosted Supabase: *Project settings → API*):
  `SERVICE_ROLE_KEY` (service-role JWT), `ANON_KEY`, `JWT_SECRET`, and the
  Postgres password. The Next.js app's own copy is `SUPABASE_SERVICE_ROLE_KEY`
  in the app's hosting environment (and in `app/.env.local` on your machine).
- The API is at your `NEXT_PUBLIC_SUPABASE_URL` (the examples below use
  `https://supabase.example.com`). The `/pg/query` endpoint exists on
  self-hosted Supabase; on hosted Supabase run the same SQL in the dashboard's
  SQL editor instead.

## The two tools

**1. SQL through pg-meta** (read/write SQL as the service role):

```bash
URL=https://supabase.example.com
SK='<paste the service-role key here, in your terminal only>'
curl -s "$URL/pg/query" -H "apikey: $SK" -H "Authorization: Bearer $SK" \
  -H "Content-Type: application/json" -d '{"query":"select 1"}'
```

pg-meta returns only the last statement's result when you send several.

**2. The GoTrue admin API** (users):

```bash
curl -s "$URL/auth/v1/admin/users?per_page=5" \
  -H "apikey: $SK" -H "Authorization: Bearer $SK"
```

## Lost authenticator (two-factor)

You still know the password but can't produce a code (and you didn't enrol a
second device, or lost both).

1. Confirm what exists (read-only):

   ```sql
   select f.id, f.friendly_name, f.status, f.created_at
   from auth.mfa_factors f
   join auth.users u on u.id = f.user_id
   where u.email = 'owner@example.com';
   ```

2. Delete the factor(s). This takes the account back to password-only sign-in:

   ```sql
   delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = 'owner@example.com');
   ```

3. Sign in with the password at `/admin/login`, open **/admin/security** and
   enrol again, **two devices this time**.

Notes:

- Existing sessions that are already at aal2 keep working until they expire;
  that is fine. A session at aal1 stops being asked for a code the moment the
  factor is gone.
- If the database-level rule is applied (`owner_mfa_satisfied()` in
  `supabase/migrations/20261005000004_owner_mfa.sql`), deleting the factor also
  satisfies it: the rule only bites while a **verified** factor exists.

## Forgotten password

Either route works. Pick one.

**A. Supabase Studio** (easiest): Authentication → Users → the owner's row →
*Send password recovery*, or *Update user* → set a new password. (If email
delivery isn't set up, use the API route below.)

**B. The admin API** with the service-role key:

```bash
USER_ID=$(curl -s "$URL/auth/v1/admin/users?per_page=5" \
  -H "apikey: $SK" -H "Authorization: Bearer $SK" | node -e \
  "const u=JSON.parse(require('fs').readFileSync(0,'utf8')).users.find(x=>x.email==='owner@example.com');console.log(u.id)")

curl -s -X PUT "$URL/auth/v1/admin/users/$USER_ID" \
  -H "apikey: $SK" -H "Authorization: Bearer $SK" \
  -H "Content-Type: application/json" \
  -d '{"password":"<a new password of 12+ characters>"}'
```

Then sign in at `/admin/login` (you will still be asked for your authenticator
code if two-factor is on) and, if you like, change it again on
**/admin/security**.

## Lost both the password and the authenticator

Do the two sections above, in this order: delete the factors, set the new
password, sign in, re-enrol two devices.

## Things that are never the answer

- **Re-opening sign-ups is never needed.** Sign-ups stay closed
  (`DISABLE_SIGNUP=true`, phone sign-up and auto-confirm off). Do not create a
  second account to "get in": the owner gate is by email address, so a new
  account would not be the owner anyway.
- Don't edit `is_owner()` to let a different account in as a shortcut. If the
  owner address itself must change, update the row in `public.app_owner` and the `OWNER_EMAIL`
  environment variable together; see `docs/ARCHITECTURE.md`.

## If the service-role key itself may have leaked

Rotate it in your hosting panel (Supabase service: regenerate `SERVICE_ROLE_KEY` /
`JWT_SECRET` and the derived keys), update the app's
`SUPABASE_SERVICE_ROLE_KEY` and the `NEXT_PUBLIC_SUPABASE_ANON_KEY`, redeploy
both, and check `auth.users` for accounts you don't recognise. Rotating the JWT
secret signs everyone out, including you: sign in again afterwards.
