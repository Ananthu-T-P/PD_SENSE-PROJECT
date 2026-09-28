# Supabase setup — NeuroLoop Live Monitor

You already created the Supabase project. From zero to live dashboard:

## 1. Create the tables
Dashboard → **SQL Editor** → New query → paste the whole of
`supabase/schema.sql` → **Run**. This creates `readings`,
`alerts`, `readings_rollup`, RLS policies, and enables realtime.

## 2. Get the keys
Project Settings → **API**:
- copy **Project URL** → `SUPABASE_URL` in `js/config.js`
- copy **anon public** key → `SUPABASE_ANON_KEY` in `js/config.js`

Reload the dashboard — the topbar badge flips to
`SUPABASE · <device-id>` and the instrument shows
**WAITING FOR DEVICE DATA** until the first row arrives.

## 3. Point the ESP32 at Supabase
The firmware networking layer POSTs one row per upload interval:

```
POST https://<project-ref>.supabase.co/rest/v1/readings
apikey: <anon-key>
Authorization: Bearer <anon-key>
Content-Type: application/json

{
  "patient_id": "P-001",
  "device_id":  "pd-sense-01",
  "source":     "device",
  "tremor_amplitude":   4.2,
  "dominant_frequency": 4.6,
  "tap_count":          20,
  "freeze_event":       false
}
```

Harmful events additionally go to `/rest/v1/alerts`
(`event_type`, `severity` 'info'|'warning'|'critical`) and are
shown in the banner at the top of the dashboard. Alerts are
**never** deleted by the rollup job.

## 4. Schedule the storage rollup (daily)
Run `supabase/rollup.sql` **once** — it creates the
`rollup_readings(48)` function. Then pick one scheduler:

- **Version A (pg_cron):** Dashboard → Database → Extensions →
  enable `pg_cron`, then run the `cron.schedule(...)` block in
  `rollup.sql`. Daily at 03:17 UTC it buckets >48 h-old readings
  into `readings_rollup` and deletes the originals.
- **Version B (free tier, no pg_cron):**
  `supabase functions deploy rollup --no-verify-jwt` (the
  function is in `edge-function-rollup/`), then call its URL
  daily from cron-job.org or a GitHub Actions cron with the
  service-role key in the Authorization header.

## 5. Behavior notes
- **Live mode:** supabase-js realtime pushes new rows the moment
  they land; a 20 s poll (`POLL_INTERVAL_MS`) runs as a safety net.
- **Manual/demo mode:** the Section 2 form inserts rows tagged
  `source='manual'`; the instrument chip shows
  **DEMO / MANUAL DATA** vs **LIVE DEVICE** accordingly.
- **History:** the console reads fine rows from `readings` for the
  last 48 h and 10-minute aggregates from `readings_rollup` for
  anything older — seamlessly merged (`rollup ·10m` tag in the log).
- Storage growth estimate: at a 20 s cadence ≈ 4,320 rows/day
  (≈15 MB/100 days) before rollup; after rollup ≈ 144 rows/day, and
  old raw data is removed daily.
