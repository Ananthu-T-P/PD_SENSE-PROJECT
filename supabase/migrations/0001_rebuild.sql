-- ============================================================================
-- PD-SENSE / NeuroLoop — rebuild migration 0001
-- ----------------------------------------------------------------------------
-- Converts the old anon-accessible demo schema (readings / alerts /
-- readings_rollup) into the production architecture:
--
--   patients        patient registry (minimal identifiers)
--   devices         device registry + token hash + patient association
--   readings        summarized telemetry windows (event_id UNIQUE)
--   events          discrete events: freeze / possible_fall / medication_event
--                   / tap_test_completed  (event_id UNIQUE, jsonb payload)
--   tap_tests       tap-test detail rows (mirrors events of that type)
--   medication_events  gesture-derived medication event records (no dose/mg)
--   alerts          backend-owned alerts with lifecycle status
--   reading_rollups 10-minute aggregates for history older than 48 h
--
-- SECURITY AUDIT RESPONSE:
--   Old anon read-all/insert-all policies are DROPPED. RLS enabled; the only
--   access is the backend service role (which bypasses RLS). The legacy tables
--   are renamed, never silently destroyed — delete them manually after review.
--
-- RUN: Supabase Dashboard → SQL Editor → paste entire file → Run.
--      Safe to re-run (CREATE ... IF NOT EXISTS, guarded renames).
-- ============================================================================

begin;

-- ---------- 0. park legacy tables (if present) -------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='readings')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='readings' and column_name='event_id')
  then
    execute 'alter table public.readings rename to readings_legacy_v1';
  end if;

  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='alerts')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='alerts' and column_name='status')
  then
    execute 'alter table public.alerts rename to alerts_legacy_v1';
  end if;

  if exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='readings_rollup')
     and not exists (select 1 from information_schema.tables
             where table_schema='public' and table_name='readings_rollup_legacy_v1')
     and not exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='readings_rollup' and column_name='avg_tremor_score')
  then
    execute 'alter table public.readings_rollup rename to readings_rollup_legacy_v1';
  end if;
end $$;

-- ---------- 1. patient registry ----------------------------------------------
create table if not exists public.patients (
  id            text primary key,             -- e.g. 'P-001' (opaque handle)
  display_name  text        not null default '',
  external_ref  text,                         -- optional MRN-style reference
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- 2. device registry (patient association is decided HERE) ---------
create table if not exists public.devices (
  device_id        text primary key,
  patient_id       text        not null references public.patients(id) on delete restrict,
  enabled          boolean     not null default true,
  token_hash       text        not null,        -- sha256 hex of the device token
  firmware_version text,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- 3. readings: one summarized telemetry window per row -------------
create table if not exists public.readings (
  id                    bigint generated always as identity primary key,
  event_id              text        not null unique,   -- dedupe of device retries
  device_id             text        not null references public.devices(device_id),
  patient_id            text        not null references public.patients(id),
  ts                    timestamptz not null default now(),  -- device NTP time
  received_at           timestamptz not null default now(),  -- authoritative ingest clock
  schema_version        smallint    not null,
  sequence              bigint      not null,
  device_ms             bigint,

  tremor_score          real,                 -- null unless quality = VALID
  dominant_frequency_hz real,
  tremor_quality        text        not null default 'INVALID'
                        check (tremor_quality in ('VALID','LOW_SIGNAL','MOTION_CONTAMINATED','INVALID')),

  imu_rms               real,
  jerk_peak             real,
  gait_state            text        check (gait_state in ('REST','WALKING','FREEZE_CANDIDATE','FREEZE','RECOVERY')),
  cadence_hz            real,
  freeze_active         boolean     not null default false,

  uptime_ms             bigint,
  queue_depth           integer,
  queue_dropped         integer,
  rssi                  integer,
  sensor_imu            text,
  sensor_apds           text,
  fw_version            text,
  source                text        not null default 'device',

  created_at            timestamptz not null default now()
);
create index if not exists readings_patient_ts  on public.readings (patient_id, ts desc);
create index if not exists readings_device_seq  on public.readings (device_id, sequence);
create index if not exists readings_received    on public.readings (received_at desc);

-- ---------- 4. discrete events ------------------------------------------------
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  event_id    text        not null unique,
  device_id   text        not null references public.devices(device_id),
  patient_id  text        not null references public.patients(id),
  event_type  text        not null
              check (event_type in ('freeze','possible_fall','medication_event','tap_test_completed')),
  ts          timestamptz not null default now(),
  received_at timestamptz not null default now(),
  device_ms   bigint,
  duration_ms bigint,
  severity    text        not null default 'info'
              check (severity in ('info','warning','critical')),
  payload     jsonb       not null default '{}'::jsonb,
  source      text        not null default 'device',
  created_at  timestamptz not null default now()
);
create index if not exists events_patient_ts on public.events (patient_id, ts desc);
create index if not exists events_type_ts    on public.events (event_type, ts desc);

-- ---------- 5. tap test detail -------------------------------------------------
create table if not exists public.tap_tests (
  id                  bigint generated always as identity primary key,
  event_id            text        not null unique,
  patient_id          text        not null references public.patients(id),
  device_id           text        not null references public.devices(device_id),
  completed_at        timestamptz not null default now(),
  tap_count           integer     not null,
  target_count        integer     not null,
  duration_ms         bigint,
  bradykinesia_grade  smallint    check (bradykinesia_grade between 0 and 4),
  bradykinesia_label  text,
  quality             text        not null default 'COMPLETE'
                      check (quality in ('COMPLETE','INCOMPLETE','TIMEOUT')),
  source              text        not null default 'device',
  created_at          timestamptz not null default now()
);
create index if not exists tap_tests_patient_ts on public.tap_tests (patient_id, completed_at desc);
-- an incomplete test must never carry a grade
alter table public.tap_tests
  drop constraint if exists tap_tests_grade_consistency;
alter table public.tap_tests
  add constraint tap_tests_grade_consistency
  check (quality = 'COMPLETE' or bradykinesia_grade is null);

-- ---------- 6. medication events (gesture records only — no dose metadata) ----
create table if not exists public.medication_events (
  id         bigint generated always as identity primary key,
  event_id   text        not null unique,
  patient_id text        not null references public.patients(id),
  device_id  text        not null references public.devices(device_id),
  ts         timestamptz not null default now(),
  gesture    text        not null
             check (gesture in ('LEFT','RIGHT','UP','DOWN','NEAR','FAR')),
  source     text        not null default 'device',
  created_at timestamptz not null default now()
);
create index if not exists med_events_patient_ts on public.medication_events (patient_id, ts desc);

-- ---------- 7. alerts (backend-owned, lifecycle tracked) -----------------------
create table if not exists public.alerts (
  id          bigint generated always as identity primary key,
  patient_id  text        not null references public.patients(id),
  device_id   text        references public.devices(device_id),
  ts          timestamptz not null default now(),
  event_type  text        not null,   -- prolonged_freeze | possible_fall | high_tremor
  severity    text        not null default 'info'
              check (severity in ('info','warning','critical')),
  detail      text,
  status      text        not null default 'open'
              check (status in ('open','acknowledged','resolved','delivery_failed')),
  detected_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists alerts_patient_ts on public.alerts (patient_id, ts desc);
create index if not exists alerts_type_ts    on public.alerts (patient_id, event_type, ts desc);

-- ---------- 8. rollups for >48 h history ---------------------------------------
-- Field semantics (do NOT average discrete/test values):
--   avg/max_tremor_score     : per-row VALID-window tremor scores
--   avg_dominant_frequency_hz: per-row dominant frequency
--   avg_cadence_hz           : walking cadence mean
--   freeze_events            : count of rows flagged freeze_active (episodes
--                              themselves live in events, never in rollups)
--   valid_share              : share of rows with tremor_quality = VALID
create table if not exists public.reading_rollups (
  id                      bigint generated always as identity primary key,
  patient_id              text        not null references public.patients(id),
  device_id               text,
  bucket_start            timestamptz not null,
  reading_count           integer     not null,
  avg_tremor_score        real,
  max_tremor_score        real,
  avg_dominant_frequency_hz real,
  avg_cadence_hz          real,
  freeze_events           integer     not null default 0,
  valid_share             real,
  unique (patient_id, bucket_start)
);
create index if not exists rollup_patient_ts on public.reading_rollups (patient_id, bucket_start);

create or replace function public.rollup_readings(p_cutoff_hours int default 48)
returns table (buckets int, rolled int, deleted int)
language plpgsql security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(hours => p_cutoff_hours);
  v_buckets int; v_rolled int; v_deleted int;
begin
  with src as (
    select
      patient_id, device_id,
      date_trunc('hour', ts) + floor(extract(minute from ts) / 10) * interval '10 minutes' as bucket,
      tremor_score, dominant_frequency_hz, cadence_hz, freeze_active, tremor_quality
    from readings
    where ts < v_cutoff
  )
  insert into reading_rollups as r (
    patient_id, device_id, bucket_start, reading_count,
    avg_tremor_score, max_tremor_score, avg_dominant_frequency_hz,
    avg_cadence_hz, freeze_events, valid_share
  )
  select
    patient_id, min(device_id), bucket, count(*),
    avg(tremor_score) filter (where tremor_quality = 'VALID'),
    max(tremor_score) filter (where tremor_quality = 'VALID'),
    avg(dominant_frequency_hz) filter (where tremor_quality = 'VALID'),
    avg(cadence_hz),
    count(*) filter (where freeze_active),
    avg(case when tremor_quality = 'VALID' then 1.0 else 0.0 end)
  from src
  group by patient_id, bucket
  on conflict (patient_id, bucket_start) do update set
    device_id                  = excluded.device_id,
    reading_count              = r.reading_count + excluded.reading_count,
    avg_tremor_score           = (coalesce(r.avg_tremor_score,0) * r.reading_count
                                  + coalesce(excluded.avg_tremor_score,0) * excluded.reading_count)
                                  / (r.reading_count + excluded.reading_count),
    max_tremor_score           = greatest(r.max_tremor_score, excluded.max_tremor_score),
    avg_dominant_frequency_hz  = (coalesce(r.avg_dominant_frequency_hz,0) * r.reading_count
                                  + coalesce(excluded.avg_dominant_frequency_hz,0) * excluded.reading_count)
                                  / (r.reading_count + excluded.reading_count),
    avg_cadence_hz             = (coalesce(r.avg_cadence_hz,0) * r.reading_count
                                  + coalesce(excluded.avg_cadence_hz,0) * excluded.reading_count)
                                  / (r.reading_count + excluded.reading_count),
    freeze_events              = r.freeze_events + excluded.freeze_events,
    valid_share                = (coalesce(r.valid_share,0) * r.reading_count
                                  + coalesce(excluded.valid_share,0) * excluded.reading_count)
                                  / (r.reading_count + excluded.reading_count);
  get diagnostics v_buckets = row_count;

  select count(*) into v_rolled from readings where ts < v_cutoff;

  delete from readings rd
  where rd.ts < v_cutoff
    and exists (
      select 1 from reading_rollups rr
      where rr.patient_id = rd.patient_id
        and rr.bucket_start = date_trunc('hour', rd.ts)
          + floor(extract(minute from rd.ts) / 10) * interval '10 minutes'
    );
  get diagnostics v_deleted = row_count;

  return query select v_buckets, v_rolled, v_deleted;
end $$;

-- ---------- 9. SECURITY: no direct database access from browsers --------------
-- Old demo policies are removed; no new anon/authenticated policies are
-- created. Service-role access (the backend) bypasses RLS by design.
alter table public.patients          enable row level security;
alter table public.devices           enable row level security;
alter table public.readings          enable row level security;
alter table public.events            enable row level security;
alter table public.tap_tests         enable row level security;
alter table public.medication_events enable row level security;
alter table public.alerts            enable row level security;
alter table public.reading_rollups   enable row level security;

revoke all on public.patients          from anon, authenticated;
revoke all on public.devices           from anon, authenticated;
revoke all on public.readings          from anon, authenticated;
revoke all on public.events            from anon, authenticated;
revoke all on public.tap_tests         from anon, authenticated;
revoke all on public.medication_events from anon, authenticated;
revoke all on public.alerts            from anon, authenticated;
revoke all on public.reading_rollups   from anon, authenticated;

commit;
