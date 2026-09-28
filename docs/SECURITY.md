# PD-SENSE — Security

## Trust model (final architecture)

```
ESP32 device ──HTTP/HTTPS──> PD-SENSE backend API ──service-role──> Supabase
                                     ▲
                                     │ dashboard token (bearer)
                Live Monitor / Doctor Portal / public site
```

- **Supabase service-role key**: exists ONLY in `server/.env` on the
  machine running the backend. Never in the browser bundle, never in
  firmware, never in this repository.
- **Device credentials**: every registered device has `device_id` +
  `DEVICE_TOKEN`. The backend stores only the SHA-256 hash
  (`devices.token_hash`). Firmware sends `X-Device-Id` + `X-Device-Token`
  headers with every POST.
- **Patient association**: derived server-side from the devices registry.
  A device CANNOT claim an arbitrary `patient_id` — the packet's
  `device_id` must match its credential, and the patient mapping comes
  from the registered device row.
- **Dashboard access**: browsers authenticate with one shared
  `DASHBOARD_TOKEN` (Authorization: Bearer …). This is honest
  classroom-demo auth, NOT per-user clinical accounts.
- **RLS**: all patient tables have RLS enabled with **no** anon or
  authenticated policies — direct database access from browsers is
  denied. Only the backend (service role) reads/writes.
- **Public website**: contains no patient data path at all.

## HTTPS / TLS

- ESP32 → backend on a LAN demo is typically **plain HTTP** to the laptop.
  This is a documented limitation: on a trusted LAN only.
- If the backend is fronted by HTTPS, set `API_BASE_URL=https://…` in
  `firmware/NeuroLoop_Core/config.h` and either:
  - `ALLOW_INSECURE_TLS 1` (prototype fallback — connection is encrypted
    but the certificate is NOT validated; do not describe this as secure), or
  - set `API_ROOT_CA_PEM` to the server certificate's root CA (full
    validation — the production posture).
- Browser → backend: serve over HTTPS in any real deployment.

## Where credentials live

| Secret | Location | In repo? |
|---|---|---|
| Supabase service-role key | `server/.env` only | NEVER |
| Device token(s) | firmware `config.h` (local) + backend DB hash | placeholder committed |
| Dashboard token | `server/.env`; typed by operator via `?token=` | NEVER |
| WiFi credentials | firmware `config.h` locally | placeholder committed |

`.env`, and any `config_local.h`, are git-ignored.

## ⚠ Credential rotation (REQUIRED — repository history exposure)

The following were committed in plain text by previous revisions. Even
though current files contain placeholders, **rotate them now**:

1. **WiFi credentials** (`REDMI NOTE 15 Pro 5G` hotspot password was in
   `firmware/NeuroLoop_Core/config.h`) → change the hotspot password.
2. **Supabase anon key** (was in `website/live-monitor/js/config.js` and
   firmware) → in Supabase: Project Settings → API → rotate/reset keys.
   (Under the new architecture the anon key would be useless for reads
   anyway — RLS denies anon — but rotate regardless.)
3. Any service-role key if it ever left the backend machine.
4. Verify: `git log -p` / search the repo history for the old key if the
   project is ever published; history was NOT rewritten by this project.
5. Verify no privileged string remains in the frontend:
   `Select-String -Recurse website -Pattern "service_role|eyJ"` should be empty.

## Demo mode & logging hygiene

- `?mode=demo` shows synthetic data and is labelled DEMO DATA; it never
  touches the network.
- Firmware serial output never prints WiFi passwords, device tokens, or
  the database key. Backend logs never include Authorization headers.
