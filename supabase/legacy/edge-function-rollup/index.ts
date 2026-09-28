// =========================================================
// Edge Function "rollup" — free-tier alternative to pg_cron.
// Calls rollup_readings(48) using the service role key.
// Trigger on a schedule from cron-job.org / GitHub Actions:
//   POST https://<project-ref>.functions.supabase.co/rollup
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
// =========================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // only the service-role bearer may trigger a rollup
  if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const { data, error } = await sb.rpc("rollup_readings", { p_cutoff_hours: 48 });
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, result: data }), {
    headers: { "Content-Type": "application/json" },
  });
});
