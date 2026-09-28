-- =========================================================
-- NeuroLoop / PD-SENSE — Supabase schema
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor).
-- =========================================================

-- ---------- readings: fine-grained device + manual rows ----------
-- Kept at full resolution for 48 h only; the rollup job
-- (rollup.sql) compresses anything older into readings_rollup.
create table if not exists public.readings (
  id                  bigint generated always as identity primary key,
  ts                  timestamptz not null default now(),
  patient_id          text        not null,
  device_id           text        not null,
  source              text        not null default 'device'
                      check (source in ('device', 'manual')),
  tremor_amplitude    real,                    -- 0–10 severity scale
  dominant_frequency  real,                    -- Hz (PD band 3–7)
  tap_count           integer,
  bradykinesia_grade  smallint,                -- 0–4, optional
  freeze_event        boolean     not null default false,
  created_at          timestamptz not null default now()
);
create index if not exists readings_patient_ts on public.readings (patient_id, ts desc);

-- ---------- alerts: harmful events, full resolution forever ----------
-- NEVER deleted or aggregated by the rollup job.
create table if not exists public.alerts (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  patient_id  text        not null,
  device_id   text,
  event_type  text        not null,   -- e.g. 'freeze', 'fall_suspect', 'tremor_spike'
  severity    text        not null default 'info'
              check (severity in ('info', 'warning', 'critical')),
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists alerts_patient_ts on public.alerts (patient_id, ts desc);

-- ---------- readings_rollup: 10-minute buckets, >48 h old ----------
create table if not exists public.readings_rollup (
  id                    bigint generated always as identity primary key,
  patient_id            text        not null,
  device_id             text,
  bucket_start          timestamptz not null,   -- 10-minute-aligned
  reading_count         integer     not null,
  avg_tremor_amplitude  real,
  max_tremor_amplitude  real,
  avg_dominant_frequency real,
  total_tap_count       bigint,
  freeze_events         integer     not null default 0,
  manual_readings       integer     not null default 0,
  unique (patient_id, bucket_start)
);
create index if not exists rollup_patient_ts on public.readings_rollup (patient_id, bucket_start);

-- ---------- Row Level Security ----------
-- Demo/education project: anon key used from the dashboard.
-- This policy lets the anon role read everything and insert
-- manual rows. Tighten before any real patient data.
alter table public.readings        enable row level security;
alter table public.alerts          enable row level security;
alter table public.readings_rollup enable row level security;

create policy "anon read readings"   on public.readings        for select to anon using (true);
create policy "anon insert readings" on public.readings        for insert to anon with check (true);
create policy "anon read alerts"     on public.alerts          for select to anon using (true);
create policy "anon insert alerts"   on public.alerts          for insert to anon with check (true);
create policy "anon read rollup"     on public.readings_rollup for select to anon using (true);

-- ---------- Realtime (dashboard live updates) ----------
-- Database → Replication → supabase_realtime, or:
alter publication supabase_realtime add table public.readings;
alter publication supabase_realtime add table public.alerts;
