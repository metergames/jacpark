# Omnilots — Claude Code Context

Crowdsourced campus parking PWA for John Abbott College.

## Stack

- **Next.js 16** (App Router, `--webpack` flag required)
- **TypeScript** (strict mode, path alias `@/*`)
- **Tailwind CSS 4**
- **Supabase** — auth (Google OAuth) + Postgres DB + RLS
- **Mapbox GL** — interactive map
- **next-pwa** — PWA support (disabled in dev, enabled in prod)

## Commands

```bash
npm run dev      # localhost:3000
npm run build
npm run start
npm run lint
```

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Landing — PWA redirects to `/map`, browser shows login |
| `/login` | Wrapper for LandingPage component |
| `/map` | Main map (protected) |
| `/settings` | User settings / notifications (protected) |

## Key Files

- `app/components/LandingPage.tsx` — Google OAuth sign-in + dev bypass login
- `app/components/ParkingMap.tsx` — main map UI, session handling, reports
- `app/lib/supabaseBrowser.ts` — singleton browser Supabase client
- `app/lib/supabaseServer.ts` — server Supabase client (service role)
- `app/lib/supabase.ts` — re-exports browser client
- `app/lib/geo.ts` — geolocation / campus proximity helpers
- `app/api/reports/` — parking reports CRUD
- `app/api/notifications/` — push subscription
- `app/api/premium/` — premium status check
- `supabase/migrations/` — DB schema (profiles, parking_reports, push_subscriptions, user_parking_state, user_reports)

## Environment Variables (`.env.local`)

```
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Dev-only bypass login (optional)
NEXT_PUBLIC_DEV_EMAIL=
NEXT_PUBLIC_DEV_PASSWORD=
```

## Authentication

- Production: Google OAuth via `supabase.auth.signInWithOAuth`; `redirectTo` is `window.location.origin + /map`
- Dev bypass: if `NEXT_PUBLIC_DEV_EMAIL` + `NEXT_PUBLIC_DEV_PASSWORD` are set, a "Dev Login" button appears in development that calls `signInWithPassword` directly — no OAuth redirect needed

To use dev login: create a user in the Supabase dashboard (Authentication → Users → Add user), then add the credentials to `.env.local`.

## Database Tables

- `profiles` — user profile info, premium flag
- `parking_reports` — crowdsourced lot availability reports
- `push_subscriptions` — web push notification subscriptions
- `user_parking_state` — per-user saved car location
- `user_reports` — premium: user's own report history
