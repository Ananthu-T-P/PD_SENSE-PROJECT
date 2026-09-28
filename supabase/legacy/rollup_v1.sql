-- =========================================================
-- STORAGE ROLLUP JOB — keeps the free-tier database small.
--
-- Daily:
--   a) find readings older than 48 h
--   b) group into 10-minute buckets per patient_id
--   c) insert aggregates into readings_rollup
--   d) delete the original fine-grained rows
-- alerts rows are NEVER touched.
-- =========================================================

-- ---------- the rollup function (idempotent, safe to re-run) ----------
create or replace function public.rollup_readings(p_cutoff_hours int default 48)
returns table (buckets int, rolled int, deleted int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(hours => p_cutoff_hours);
  v_buckets int; v_rolled int; v_deleted int;
begin
  -- aggregate old fine rows into 10-minute buckets
  with src as (
    select
      patient_id,
      device_id,
      -- floor ts to the 10-minute bucket start
      date_trunc('hour', ts)
        + floor(extract(minute from ts) / 10) * interval '10 minutes' as bucket,
      tremor_amplitude, dominant_frequency, tap_count, freeze_event, source
    from readings
    where ts < v_cutoff
  )
  insert into readings_rollup as r (
    patient_id, device_id, bucket_start, reading_count,
    avg_tremor_amplitude, max_tremor_amplitude,
    avg_dominant_frequency, total_tap_count,
    freeze_events, manual_readings
  )
  select
    patient_id,
    min(device_id),
    bucket,
    count(*),
    avg(tremor_amplitude),
    max(tremor_amplitude),
    avg(dominant_frequency),
    coalesce(sum(tap_count), 0),
    count(*) filter (where freeze_event),
    count(*) filter (where source = 'manual')
  from src
  group by patient_id, bucket
  on conflict (patient_id, bucket_start) do update set
    device_id              = excluded.device_id,
    reading_count          = r.reading_count + excluded.reading_count,
    -- weighted re-average when a bucket gets more rows
    avg_tremor_amplitude   = (r.avg_tremor_amplitude * r.reading_count
                              + excluded.avg_tremor_amplitude * excluded.reading_count)
                             / (r.reading_count + excluded.reading_count),
    max_tremor_amplitude   = greatest(r.max_tremor_amplitude, excluded.max_tremor_amplitude),
    avg_dominant_frequency = (r.avg_dominant_frequency * r.reading_count
                              + excluded.avg_dominant_frequency * excluded.reading_count)
                             / (r.reading_count + excluded.reading_count),
    total_tap_count        = r.total_tap_count + excluded.total_tap_count,
    freeze_events          = r.freeze_events + excluded.freeze_events,
    manual_readings        = r.manual_readings + excluded.manual_readings;
  get diagnostics v_buckets = row_count;

  select count(*) into v_rolled from readings where ts < v_cutoff;

  -- only delete what is now safely represented in readings_rollup
  delete from readings rd
  where rd.ts < v_cutoff
    and exists (
      select 1 from readings_rollup rr
      where rr.patient_id = rd.patient_id
        and rr.bucket_start = date_trunc('hour', rd.ts)
          + floor(extract(minute from rd.ts) / 10) * interval '10 minutes'
    );
  get diagnostics v_deleted = row_count;

  return query select v_buckets, v_rolled, v_deleted;
end $$;

-- ---------- VERSION A: pg_cron (if enabled in your project) ----------
-- Enable first: Dashboard → Database → Extensions → pg_cron
select cron.schedule(
  'readings-rollup-daily',   -- job name
  '17 3 * * *',              -- every day at 03:17 UTC
  $$select * from public.rollup_readings(48);$$
);
-- inspect:  select * from cron.job;
-- history:  select * from cron.job_run_details order by start_time desc limit 20;
-- remove:   select cron.unschedule('readings-rollup-daily');

-- ---------- VERSION B: no pg_cron (free tier) ----------
-- Deploy the Edge Function in ./edge-function-rollup/index.ts
-- (Windows Powershell):
--   supabase functions deploy rollup --no-verify-jwt
-- Then schedule it hourly/daily from cron-job.org (free) or
-- GitHub Actions with:
--   POST https://<project-ref>.functions.supabase.co/rollup
--   headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
-- The function simply calls select * from public.rollup_readings(48)
-- through the service role. See edge-function-rollup/index.ts.
