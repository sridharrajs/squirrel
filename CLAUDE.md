# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

sq is a **personal, single-user** bookmark manager with a web app and a mobile app. Bookmarks are imported once from Pinboard (pinboard.in) and then managed entirely in sq.

**Naming:** the repo directory is still `squirrel`, but the product name is "sq". Use "sq" in code, package names (`@sq/*`) and UI text.

README.md has the stack, data model and the reasons behind each decision. Don't re-argue those choices (Drizzle over Prisma, Turso, pnpm, Turborepo) without a concrete new problem.

**Status:**
- Done: both apps are scaffolded and boot as placeholder screens.
- Not started: database work (migrations, seeding, sync), auth and the Pinboard import. The Drizzle schema and DB client exist, but no migration has been generated or run.

## Toolchain

- **Node 22** (`.nvmrc`). Expo SDK 58 needs Node ≥22.13, so Node 20 fails. Run `nvm use` first.
- **pnpm 12** (`packageManager` in the root `package.json`). If pnpm isn't installed globally, use `npx pnpm@12.18.0`. The repo's pnpm settings live in `pnpm-workspace.yaml`, not `.npmrc`:
  - `nodeLinker: hoisted`: required for Expo/Metro. Don't remove it.
  - `allowBuilds`: install scripts are blocked unless listed here. `esbuild` is allowed because drizzle-kit needs it.
  - `minimumReleaseAgeExclude`: pnpm refuses very new package versions unless they're listed here. pnpm added entries for the current Next.js release on its own.

## Commands

From the repo root:

```bash
pnpm install
pnpm dev          # turbo: web (next dev) + mobile (expo start) together, in turbo's interactive TUI
pnpm build        # turbo: production builds (web only; mobile builds go through EAS)
pnpm lint         # web: eslint; mobile: expo lint. packages/core has no lint config
pnpm typecheck    # all three packages
pnpm --filter @sq/web dev       # run a script in one package
```

Web (`apps/web`):
- `pnpm dev` serves http://localhost:3000.
- `typecheck` runs `next typegen` first, because types like `LayoutProps` are generated.

Mobile (`apps/mobile`):
- `npx expo start`, then press `a` for the Android emulator or `i` for the iOS simulator. Under `pnpm dev`, select the mobile task in turbo's terminal UI before pressing keys.
- Add packages with `npx expo install <pkg>`, not `pnpm add`, so versions match the Expo SDK.
- `npx expo-doctor` diagnoses config and dependency issues.

Database (`apps/web`, not run yet):
- `db:generate`, `db:migrate` and `db:studio` wrap drizzle-kit.
- `drizzle.config.ts` loads `.env.local` itself, because drizzle-kit doesn't read Next.js env files.

There are no tests yet.

## Layout

```
apps/web       Next.js 16 (App Router, src/, Tailwind) on Vercel; also the only backend (API routes)
apps/mobile    Expo SDK 58 with Expo Router (routes in src/app/)
packages/core  Shared TypeScript source, no build step: Drizzle schema in src/schema/
```

**`packages/core` is shared as TypeScript source, with no build step:**
- `apps/web` compiles it through `transpilePackages` in `next.config.ts`.
- Metro compiles it directly for `apps/mobile`.
- It's exposed through the `exports` field in its `package.json` (e.g. `@sq/core/schema/synced`). Add a new entry there for each new entry point.

**Read each app's `AGENTS.md` before writing code in it** (both are pulled in by that app's `CLAUDE.md`). Next.js 16 and Expo SDK 58 both have breaking changes newer than most training data:
- **Next.js:** its docs ship inside the package, at `node_modules/next/dist/docs/`.
- **Expo:** use the versioned docs at docs.expo.dev.

## Architecture

**Turso is the source of truth. Pinboard is only a one-time import source.**
- sq never writes back to Pinboard, and nothing should depend on Pinboard after the import.
- Don't design features around keeping sq in sync with Pinboard.

**All writes go through the server API; mobile writes need a connection.** Web and mobile can both add links, edit titles and change tags, and the import is also a write. Every write goes through `apps/web`'s API and lands in Turso.

**The phone's local SQLite copy is read-only:**
- It's a cache for reading offline.
- The app never writes bookmarks into it directly. After a successful API write, it pulls the change down (or applies the server's response).
- When offline, the app shows writes as unavailable. There is no local queue of pending edits.

**Sync is one-way (server → phone):**
- The phone asks for rows changed since its last `updated_at` cursor.
- Soft deletes (`deleted_at`) are how deletions reach the phone.
- There's no push and no conflict resolution.

**IDs are UUIDv7, generated on the server:**
- UUIDv7 starts with a timestamp, so IDs sort by creation time and new rows go in index order, unlike random v4 IDs. Generate them with the `uuid` package's `v7()`; Node's `crypto.randomUUID()` only makes v4.
- `packages/core/src/schema/columns.ts` still uses `crypto.randomUUID()` (v4), and its comment still says "client-generated". Switch it to `v7()` and fix the comment during the DB work.
- Pinboard import: pass the bookmark's original Pinboard `time` as `v7({ msecs })`, so imported IDs sort by when each bookmark was first saved, not by import time.
- IDs stay UUIDs anyway, so offline edits could be added later without migrating IDs. That would mean client-side v7 IDs (on the phone, the `uuid` package needs a `crypto.getRandomValues` polyfill such as `expo-crypto`), a push step, latest-`updated_at`-wins conflicts, and merging duplicate tag names. Don't build any of that unless asked.

**Pinboard import (v1 API, `https://api.pinboard.in/v1/`, `format=json`):**
- Fetch everything with one `posts/all` call. That endpoint is rate-limited to once every 5 minutes, and other endpoints to about one call every 3 seconds; exceeding these returns HTTP 429.
- Field mapping: `href`→url, `description`→title, `extended`→notes, `tags` (space-separated)→tags, `toread`→read-later, `shared=no`→private, `time`→created_at.
- Store Pinboard's `hash` on the bookmark (`pinboard_hash`) so importing again (e.g. after a failed run) updates existing rows instead of duplicating them.
- Record each run in the `imports` table.
- Imports run on the server only. I believe the Pinboard API doesn't allow cross-origin browser requests; confirm this when building the client.

**Schema shared between server and phone (`packages/core/src/schema/`):**
- The Drizzle schema is used by both libSQL (Turso) and expo-sqlite. Avoid features that only one of them supports.
- Synced tables (`synced.ts`): `bookmarks`, `tags`, `bookmark_tags`.
- Server-only tables (`server.ts`): `users`, `imports`.
- `index.ts` re-exports both and is for the server only. The mobile app must import `@sq/core/schema/synced`, and the sync feed must never send server-only tables.
- Synced rows have `updated_at` (for sync cursors) and `deleted_at`. Deletes are soft deletes, so they can reach the phone.
- When adding a table, decide whether it is synced or server-only.

**DB access in web:**
- `apps/web/src/db/index.ts` exports a Drizzle client.
- It starts with `import 'server-only'`, so importing it from client components fails the build.

**Auth (planned; not built yet):**
- Single owner, no signup. One row in `users` holds a password hash, created by a seed script that prompts for the password.
- Login issues a JWT signed with `SESSION_SECRET`: an HttpOnly cookie for web, a Bearer token for mobile.
- Password hashing runs only in the Node runtime. Middleware/proxy only verifies the JWT.
- Cron endpoints use `CRON_SECRET` instead of the user login.
- Fill in the details here once auth is built.

**Secrets:**
- They live in Vercel env vars, plus `apps/web/.env.local` for local dev; `.env.example` lists them.
- They must never end up in the mobile bundle.
