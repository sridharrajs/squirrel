# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

sq is a **personal, single-user** bookmark manager with a web app and a mobile app. Bookmarks are imported once from Pinboard (pinboard.in) and then managed entirely in sq.

**Naming:** the repo directory is still `squirrel`, but the product name is "sq". Use "sq" in code, package names and UI text.

README.md has the stack, data model and the reasons behind each decision. Don't re-argue those choices (Drizzle over Prisma, Turso, pnpm, Turborepo) without a concrete new problem.

The repo is not scaffolded yet: everything below is the agreed plan. Update this file as real code, commands and decisions land, and remove the "planned" wording once something exists.

## Planned layout

```
apps/web       Next.js on Vercel; also the only backend (API routes)
apps/mobile    Expo app; local expo-sqlite DB, syncs with apps/web
packages/core  Shared types, Drizzle schema, Pinboard import client
```

## Tooling

**pnpm:**
- Workspaces with `node-linker=hoisted` in `.npmrc`. Expo's bundler (Metro) has a history of trouble with pnpm's default linked layout, so don't remove this.
- Internal packages depend on each other with `workspace:*`.

**`packages/core` is shared as TypeScript source, with no build step:**
- `apps/web` consumes it through `transpilePackages` in its Next.js config.
- Metro compiles it directly for `apps/mobile`.

**Turborepo:**
- Runs the shared tasks (`dev`, `lint`, `typecheck`, `test`, `build`) across packages.
- The Vercel project for `apps/web` uses `turbo-ignore` so it skips deploys for mobile-only changes.

**Drizzle:** pin `drizzle-orm` and `drizzle-kit` to versions that work together.

## Architecture

**Turso is the source of truth. Pinboard is only a one-time import source.**
- sq never writes back to Pinboard, and nothing should depend on Pinboard after the import.
- Don't design features around keeping sq in sync with Pinboard.

**Pinboard import (v1 API, `https://api.pinboard.in/v1/`, `format=json`):**
- Fetch everything with one `posts/all` call. That endpoint is rate-limited to once every 5 minutes, and other endpoints to about one call every 3 seconds; exceeding these returns HTTP 429.
- Field mapping: `href`→url, `description`→title, `extended`→notes, `tags` (space-separated)→tags, `toread`→read-later, `shared=no`→private, `time`→created_at.
- Store Pinboard's `hash` on the bookmark so importing again (e.g. after a failed run) updates existing rows instead of duplicating them.
- Record each run in the `imports` table.
- Imports run on the server only. I believe the Pinboard API doesn't allow cross-origin browser requests; confirm this when building the client.

**Schema shared between server and phone:**
- The Drizzle schema in `packages/core` is used by both libSQL (Turso) and expo-sqlite. Avoid features that only one of them supports.
- Split the schema files:
  - Synced tables: `bookmarks`, `tags`, `bookmark_tags`
  - Server-only tables: `users`, `imports`, and anything else that holds secrets or server state
- The mobile app imports only the synced tables. The sync feed must never send server-only tables.
- New tables are expected as features grow. Decide for each new table whether it is synced or server-only.

**Two-way mobile sync (the phone can create and edit offline):**
- Primary keys are UUIDs generated on the client, so rows created offline can't collide.
- Every synced row has `updated_at` and a soft-delete column (`deleted_at`). Never hard-delete synced rows.
- The phone pushes local changes, then pulls rows changed since its last sync cursor.
- Conflicts: the most recent `updated_at` wins for each row.
- The mobile app applies bundled Drizzle migrations when it starts.

**Auth (single owner, no signup):**
- The `users` table holds one row with an argon2/bcrypt password hash, created by a seed script (`db:seed`) that prompts for the password. Re-running it changes the password. Never put a plain-text password in code, git or seed files.
- `POST /api/login` checks the password and issues a JWT signed with `SESSION_SECRET`: as an HttpOnly cookie for web, or as a token for mobile.
  - The mobile app stores the token in expo-secure-store and sends it as `Authorization: Bearer`.
- `middleware.ts` protects every page and API route except `/login`, `/api/login` and cron endpoints.
- Password hashing must run in the Node runtime (login route only). `middleware.ts` runs on Edge, so it only verifies the JWT with `jose`.
- Signing tokens without a sessions table means rotating `SESSION_SECRET` signs out every device. Add a `sessions` table if you need to sign out a single device.
- Cron endpoints are protected by `CRON_SECRET`, not by the user login.

**Secrets:** `SESSION_SECRET`, `TURSO_*`, `PINBOARD_AUTH_TOKEN` and `CRON_SECRET` live in Vercel env vars and must never end up in the mobile bundle.
