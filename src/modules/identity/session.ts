import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PortalIdentity = {
  userId: string;
  fullName: string;
  role: "employee" | "manager" | "admin" | "partner";
  employeeId: string | null;
  organizationId: string;
};

export async function requireIdentity(): Promise<PortalIdentity> {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data, error } = await supabase.rpc("current_portal_identity").single();
  if (error || !data) redirect("/login?error=inactive");
  const row = data as unknown as PortalIdentity;
  return row;
}
