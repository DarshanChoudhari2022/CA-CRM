import { randomBytes } from "node:crypto";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { PortalIdentity } from "@/modules/identity/session";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = z.object({ employeeId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid employee." }, { status: 400 });
  const caller = await createClient();
  const { data } = await caller.rpc("current_portal_identity").single();
  const identity = data as unknown as PortalIdentity | null;
  if (!identity || !["admin", "partner"].includes(identity.role))
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const { data: profile } = await caller
    .from("profiles")
    .select("password_change_required")
    .eq("user_id", identity.userId)
    .single();
  if (!profile || profile.password_change_required)
    return NextResponse.json({ error: "Change your password before resetting accounts." }, { status: 403 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    return NextResponse.json({ error: "Password reset is not configured on this deployment." }, { status: 503 });
  const admin = createAdminClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: employee } = await admin
    .from("employees")
    .select("id,work_email,profile_user_id")
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", identity.organizationId)
    .eq("active", true)
    .single();
  if (!employee?.profile_user_id)
    return NextResponse.json({ error: "Linked employee account not found." }, { status: 404 });
  const password = `${randomBytes(18).toString("base64url")}!aA7`;
  const { error: authError } = await admin.auth.admin.updateUserById(employee.profile_user_id, { password });
  if (authError) return NextResponse.json({ error: "Temporary password could not be generated." }, { status: 500 });
  const { error: profileError } = await admin
    .from("profiles")
    .update({ password_change_required: true })
    .eq("user_id", employee.profile_user_id)
    .eq("organization_id", identity.organizationId);
  if (profileError)
    return NextResponse.json(
      { error: "Password changed, but onboarding status could not be updated." },
      { status: 500 },
    );
  await admin.from("audit_logs").insert({
    organization_id: identity.organizationId,
    actor_user_id: identity.userId,
    action: "account_password_reset",
    entity_type: "employee",
    entity_id: employee.id,
    request_id: crypto.randomUUID(),
  });
  return NextResponse.json({ email: employee.work_email, password }, { headers: { "Cache-Control": "no-store" } });
}
