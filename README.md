# sq

A personal bookmark manager for the web and mobile. sq imports your bookmarks from [Pinboard](https://pinboard.in) once. After that, sq is where you keep and manage them: you save, edit, tag, search and read bookmarks in sq itself.

> **Status:** planning. This repo isn't scaffolded yet. This README describes the intended design.

## Features (planned)

- One-time import of all bookmarks from Pinboard, including titles, notes, tags, read-later and private flags
- Add, edit, tag and delete bookmarks
- Search across titles, URLs, notes and tags
- Use it in a browser (web) or on your phone (iOS/Android)
- Read and edit offline on mobile; changes sync when you're back online
- Single user: one owner account, no public signup

## Tech stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces (`node-linker=hoisted`) + Turborepo |
| Web app + API | Next.js, deployed on Vercel |
| Mobile app | React Native with Expo (built with EAS) |
| Server database | Turso (hosted SQLite, accessed with libSQL) |
| On-device database | expo-sqlite |
| ORM / migrations | Drizzle ORM + drizzle-kit (one schema shared by server and mobile) |
| Auth | One owner account (password hash stored in the DB), signed session cookie (web) or token (mobile) |
| Scheduled jobs | Vercel Cron |

## Architecture

```
            ┌──────────── Pinboard API ────────────┐
            │       (one-time import source)       │
            └───────────────────┬──────────────────┘
                                │ import
                                ▼
┌──────────────┐        ┌──────────────────┐        ┌──────────┐
│ Web browser  │◀──────▶│ apps/web         │◀──────▶│  Turso   │
└──────────────┘        │ Next.js + API    │        │ (SQLite) │
                        │ on Vercel        │        └──────────┘
┌──────────────┐  sync  │                  │
│ apps/mobile  │◀──────▶│                  │
│ Expo +       │        └──────────────────┘
│ expo-sqlite  │
└──────────────┘
```

- **Turso is the source of truth.** Pinboard is only where bookmarks come from on the first import. There's no ongoing link: sq never reads from or writes to Pinboard after that.
- **The web app** reads and writes through the Next.js API routes. That backend is the only thing that talks to the database.
- **The mobile app** reads from and writes to its local SQLite database, then exchanges changes with the API in both directions, so it works fully offline.

## Planned repo layout

```
apps/web       Next.js app and API routes (auth, bookmarks, import, mobile sync)
apps/mobile    Expo app
packages/core  Shared types, Drizzle schema, Pinboard import client
```

## Data model (initial)

| Table | Purpose |
|---|---|
| `users` | The owner account (username, password hash). Server only. |
| `bookmarks` | URL, title, notes, read-later and private flags, timestamps |
| `tags` | Tag names |
| `bookmark_tags` | Links bookmarks to tags (many-to-many) |
| `imports` | History of Pinboard imports: when, how many added or updated, status. Server only. |

More tables will be added as features grow (for example collections or reading progress).

## Accounts and login

There's no signup page. A seed script (`db:seed`) creates the owner account:
- It asks for a username and password in the terminal.
- It hashes the password and stores only the hash in the `users` table.
- Re-running it changes the password; no redeploy needed.

After that:
- **Web:** you log in once and get a signed session cookie.
- **Mobile:** you log in once and the app keeps a signed token in secure storage.

## Design decisions

| Decision | Why |
|---|---|
| **Turso + expo-sqlite** | SQLite on both server and phone keeps one schema and makes offline-first mobile straightforward. Turso is hosted, cheap and works from Vercel serverless functions. |
| **Drizzle over Prisma** | Drizzle has official drivers for both libSQL (Turso) and expo-sqlite, so one TypeScript schema serves both. It's lightweight, runs on Vercel's Edge runtime, and needs no code-generation step. Prisma's Turso support goes through an adapter, and its Expo support is experimental. |
| **Pinboard as a one-time import** | Pinboard's API is heavily rate-limited (`posts/all` once every 5 minutes) and isn't meant to be the backend for an app. A clean break means sq owns its own data. |
| **The server does the import** | I believe Pinboard's API can't be called from browser code (to be confirmed), and keeping the token on the server keeps it out of the web page and the mobile app. |
| **Single owner, password in the DB** | Personal app, so there's no signup or user management. Keeping the hash in the DB (not an env var) makes password changes easy and leaves room for more users later. |
| **pnpm workspaces** | Fast installs and solid `workspace:*` linking. It uses `node-linker=hoisted` to avoid Expo/Metro trouble with pnpm's linked packages. npm workspaces would be an equally valid choice. |
| **Turborepo** | Optional, but cheap: one `turbo dev` runs web and mobile together, it caches tasks, and `turbo-ignore` skips web deploys for mobile-only changes. Easy to drop if it doesn't earn its place. |

## Deployment

- **Web/API:** Vercel
- **Database:** Turso
- **Mobile:** Expo (EAS Build)

Environment variables (Vercel):

```
TURSO_DATABASE_URL     Turso database URL (libsql://...)
TURSO_AUTH_TOKEN       Turso database token
SESSION_SECRET         Secret for signing web sessions and mobile tokens
PINBOARD_AUTH_TOKEN    Pinboard API token (username:TOKEN), only needed for the import
CRON_SECRET            Protects Vercel Cron endpoints
```

Setting up Turso with its command-line tool:

```
turso auth signup
turso db create sq
turso db show sq --url       # → TURSO_DATABASE_URL
turso db tokens create sq    # → TURSO_AUTH_TOKEN
```
