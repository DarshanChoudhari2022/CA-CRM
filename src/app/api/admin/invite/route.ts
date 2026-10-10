import { createClient as createAdminClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { PortalIdentity } from "@/modules/identity/session";

const schema = z.object({ employeeId: z.string().uuid(), role: z.enum(["employee", "manager", "admin"]) });

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid invitation request." }, { status: 400 });
  const caller = await createClient();
  const { data: identity } = await caller.rpc("current_portal_identity").single();
  const portalIdentity = identity as unknown as PortalIdentity | null;
  if (!portalIdentity || !["admin", "partner"].includes(String(portalIdentity.role)))
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey)
    return NextResponse.json({ error: "Employee invitations are not configured on this deployment." }, { status: 503 });
  const env = publicEnv();
  const admin = createAdminClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: employee } = await admin
    .from("employees")
    .select("id,organization_id,full_name,work_email,profile_user_id")
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", portalIdentity.organizationId)
    .single();
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (employee.profile_user_id)
    return NextResponse.json({ error: "This employee already has an account." }, { status: 409 });
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin}/login`;
  const { data: invitation, error: inviteError } = await admin.auth.admin.inviteUserByEmail(employee.work_email, {
    redirectTo,
    data: { full_name: employee.full_name },
  });
  if (inviteError || !invitation.user)
    return NextResponse.json({ error: inviteError?.message ?? "Invitation could not be created." }, { status: 400 });
  const { error: profileError } = await admin.from("profiles").insert({
    user_id: invitation.user.id,
    organization_id: employee.organization_id,
    employee_id: employee.id,
    full_name: employee.full_name,
    role: parsed.data.role,
  });
  if (profileError)
    return NextResponse.json(
      { error: "Invitation was sent, but the portal profile could not be linked. Contact support." },
      { status: 500 },
    );
  await admin.from("employees").update({ profile_user_id: invitation.user.id }).eq("id", employee.id);
  return NextResponse.json({ success: true });
}
