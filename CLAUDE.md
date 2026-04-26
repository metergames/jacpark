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
- `app/components/ParkingMap.tsx` — main map UI, session handling, reports, distance units state
- `app/components/UserDashboard.tsx` — profile sheet; loads from localStorage cache on mount, fetches live data and updates cache
- `app/components/SettingsModal.tsx` — settings UI; dispatches storage events for cross-component sync
- `app/components/LeaderboardModal.tsx` — leaderboard with week/month/all-time tabs; refetches on tab change
- `app/lib/leaderboard.ts` — `fetchLeaderboard(limit, period)` and `getUserRank(userId, period)`; week/month aggregate from `parking_reports`, all-time from `profiles.points`
- `app/lib/supabaseBrowser.ts` — singleton browser Supabase client
- `app/lib/supabaseServer.ts` — server Supabase client (service role)
- `app/lib/supabase.ts` — re-exports browser client
- `app/lib/geo.ts` — geolocation / campus proximity helpers
- `app/lib/gamification.ts` — points, levels, streaks, achievements
- `app/api/reports/` — parking reports CRUD; DB trigger awards points on insert (parked=2, leaving=2, observing=1)
- `app/api/notifications/` — push subscription
- `app/api/premium/` — premium status check + purchase via `purchase_premium_months` RPC
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

- `profiles` — user profile info (`points`, `premium_expires_at`); points updated by DB trigger on report insert
- `parking_reports` — crowdsourced lot availability reports (`user_id`, `action_type`, `fullness_level`, `lot_name`, `created_at`)
- `push_subscriptions` — web push notification subscriptions
- `user_parking_state` — per-user saved car location (upserted on "parked", deleted on "leaving")
- `user_reports` — premium: user's own report history

## localStorage Keys

| Key | Values | Default | Purpose |
|-----|--------|---------|---------|
| `units` | `metric` \| `imperial` | `metric` | Distance display; storage event dispatched on change for live map sync |
| `haptics` | `true` \| `false` | `false` | Vibrate on report submit (`navigator.vibrate`) |
| `quiet_start` | `HH:MM` | `22:00` | Notification quiet hours start |
| `quiet_end` | `HH:MM` | `07:00` | Notification quiet hours end |
| `profile_cache_{userId}` | JSON | — | Cached profile data (points, rank, reports, lots, premium) for instant profile load |

## Points System

Points are awarded by a Postgres trigger (`increment_profile_points_on_report`) on every `parking_reports` insert:
- `parked` → +2 pts
- `leaving` → +2 pts
- `observing` → +1 pt

Premium costs 60 pts/month, deducted via the `purchase_premium_months` RPC.

## Leaderboard Periods

- **All-time**: sorted by `profiles.points`
- **Week / Month**: aggregates `parking_reports` for the period client-side, computes per-user points, joins `profiles` for display names
