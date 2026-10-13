import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// Server adapters only. No browser import or user-supplied tenant selection.
export function automationStore() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server database configuration required");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export function automationOrganization() {
  return z.uuid().parse(process.env.CRM_AUTOMATION_ORGANIZATION_ID);
}
export async function ingest(
  channel: string,
  external: string,
  sender: string,
  name: string,
  body: string,
  phone?: string,
) {
  const { data, error } = await automationStore().rpc("crm_ingest", {
    p_org: automationOrganization(),
    p_channel: channel,
    p_external: external,
    p_sender: sender,
    p_name: name,
    p_body: body,
    p_phone: phone ?? null,
  });
  if (error) throw new Error("Enquiry could not be recorded");
  return data as string;
}
