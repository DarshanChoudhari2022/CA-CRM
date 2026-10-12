"use server";

import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";

export async function getPendingApprovalCount(): Promise<number | null> {
  const identity = await requireIdentity();
  if (identity.role === "employee") return 0;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pending_approval_count");
  // Keep the last known count if a temporary network error occurs.
  return error ? null : Number(data);
}
