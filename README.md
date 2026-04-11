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
- `supabase/migrations/20260411_add_report_action_and_fullness.sql`
- `supabase/migrations/20260411_enforce_report_submission_rules.sql`

This creates:

- `parking_reports`
- `profiles` (name + points)
- `action_type` + required `fullness_level` (1-5) on parking reports
- automatic profile creation for new auth users
- action-based points (`parked` +2, `leaving` +2, `observing` +1)
- server/database rule checks:
    - no duplicate `parked` submissions while already parked
    - `leaving` requires a prior `parked`
    - `observing` is limited to once per hour per user

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

## Deploy to Vultr (VPS + Docker)

This app uses server routes (`app/api/reports/route.ts`), so deploy it as a Node server (not static hosting).

1. Create a Vultr Cloud Compute VPS (Ubuntu 24.04 LTS recommended).
2. Point your domain to the VPS public IP with an `A` record.
3. SSH into the VPS and install Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

4. Clone your repo on the VPS and move into it:

```bash
git clone <your-repo-url>
cd jacpark
```

5. Build the image with build-time public env vars (`NEXT_PUBLIC_*`):

```bash
docker build \
    --build-arg NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="your_mapbox_public_token" \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co" \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="your_supabase_anon_key" \
    -t jacpark:latest .
```

6. Run the container with runtime env vars:

```bash
docker run -d \
    --name jacpark \
    --restart unless-stopped \
    -p 3000:3000 \
    -e NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN="your_mapbox_public_token" \
    -e NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co" \
    -e NEXT_PUBLIC_SUPABASE_ANON_KEY="your_supabase_anon_key" \
    -e SUPABASE_SERVICE_ROLE_KEY="your_supabase_service_role_key" \
    jacpark:latest
```

7. Install Nginx and HTTPS certs:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

8. Create `/etc/nginx/sites-available/jacpark` with:

```nginx
server {
        listen 80;
        server_name your-domain.com www.your-domain.com;

        location / {
                proxy_pass http://127.0.0.1:3000;
                proxy_http_version 1.1;
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
        }
}
```

9. Enable the site and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/jacpark /etc/nginx/sites-enabled/jacpark
sudo nginx -t
sudo systemctl restart nginx
```

10. Issue TLS certificates:

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

11. Update Supabase auth settings:

```text
Site URL: https://your-domain.com
Redirect URLs: https://your-domain.com/map
```

If any credential was exposed publicly, rotate it first (especially `SUPABASE_SERVICE_ROLE_KEY`).
