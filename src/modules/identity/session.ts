import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type PortalIdentity = {
  userId: string;
  fullName: string;
  role: "employee" | "manager" | "admin" | "partner";
  employeeId: string | null;
  organizationId: string;
};

// React cache is scoped to this server render, never shared between users/requests.
export const requireIdentity = cache(async (): Promise<PortalIdentity> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("user_id,full_name,role,employee_id,organization_id,password_change_required")
    .eq("user_id", claims.claims.sub)
    .eq("active", true)
    .single();
  if (error || !profile) redirect("/login?error=inactive");
  if (profile.password_change_required) redirect("/change-password");
  return {
    userId: profile.user_id,
    fullName: profile.full_name,
    role: profile.role,
    employeeId: profile.employee_id,
    organizationId: profile.organization_id,
  };
});
