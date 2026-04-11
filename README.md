# JACPark

JACPark is a mobile-first map/reporting app for John Abbott parking status.

## Environment variables

Add these in `.env.local`:

```bash
NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN=your_mapbox_public_token
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

## Postgres setup

Run the SQL migration in your Supabase Postgres database:

- `supabase/migrations/20260411_create_parking_reports.sql`

This creates the `parking_reports` table and indexes used by `app/api/reports/route.ts`.

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
