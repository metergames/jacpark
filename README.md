# JACPark

JACPark is a mobile-first map/reporting app for John Abbott parking status.

## Environment variables

Add these in `.env.local`:

```bash
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_public_token
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Google OAuth setup

In Supabase dashboard:

1. Open Authentication -> Providers -> Google.
2. Enable Google provider.
3. Add your Google OAuth client ID and secret.
4. Add redirect URL:
    - `http://localhost:3000`
    - your production URL when deployed.

## Postgres setup

Run both SQL migrations in your Supabase Postgres database:

- `supabase/migrations/20260411_create_parking_reports.sql`
- `supabase/migrations/20260411_add_profiles_and_user_reports.sql`

This creates:

- `parking_reports`
- `profiles` (name + points)
- automatic profile creation for new auth users
- automatic point increment when a report is submitted

## Hardcoded parking boundary

End users cannot draw or edit boundaries in the app.

The map reads a static boundary file from:

- `public/boundaries/jac-parking-boundaries.geojson`

To upload/replace the hardcoded boundary with your own GeoJSON file:

```bash
npm run boundary:upload -- path/to/your-boundary.geojson
```

## Run the app

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```
