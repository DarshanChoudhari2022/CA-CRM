import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type PortalIdentity = {
  userId: string;
  fullName: string;
  role: "employee" | "manager" | "admin" | "partner";
  employeeId: string | null;
  organizationId: string;
  sessionExpiresAt?: string;
  joinedOn?: string;
};

// React cache is scoped to this server render, never shared between users/requests.
export const requireIdentity = cache(async (): Promise<PortalIdentity> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");

  const [profileResult, sessionResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("user_id,full_name,role,employee_id,organization_id,password_change_required")
      .eq("user_id", claims.claims.sub)
      .eq("active", true)
      .single(),
    supabase.rpc("portal_session_context"),
  ]);
  const { data: profile, error } = profileResult;
  if (error || !profile) redirect("/login?error=inactive");
  if (profile.password_change_required) redirect("/change-password");
  const deadline = sessionResult.data?.expiresAt;
  if (sessionResult.error || !deadline || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now())
    redirect("/api/auth/session-expired");
  return {
    userId: profile.user_id,
    fullName: profile.full_name,
    role: profile.role,
    employeeId: profile.employee_id,
    organizationId: profile.organization_id,
    sessionExpiresAt: deadline,
    joinedOn: sessionResult.data?.joinedOn ?? undefined,
  };
});
