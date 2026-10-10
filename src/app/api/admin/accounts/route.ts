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
    return NextResponse.json({ error: "Change your password before creating accounts." }, { status: 403 });
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return NextResponse.json({ error: "Account creation is awaiting administrator setup." }, { status: 503 });
  const admin = createAdminClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: employee } = await admin
    .from("employees")
    .select("id,work_email,full_name,profile_user_id")
    .eq("id", parsed.data.employeeId)
    .eq("organization_id", identity.organizationId)
    .eq("active", true)
    .single();
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  if (employee.profile_user_id) return NextResponse.json({ error: "Account already exists." }, { status: 409 });
  const password = `${randomBytes(18).toString("base64url")}!aA7`;
  const { data: account, error } = await admin.auth.admin.createUser({
    email: employee.work_email,
    password,
    email_confirm: true,
    user_metadata: { full_name: employee.full_name },
  });
  if (error || !account.user)
    return NextResponse.json(
      { error: "Account could not be created. Check whether this email already has an account." },
      { status: 409 },
    );
  const { error: linkError } = await admin.rpc("link_employee_account", {
    p_employee: employee.id,
    p_user: account.user.id,
    p_actor: identity.userId,
  });
  if (linkError) {
    // Compensate only the new Auth user created by this request.
    const { error: cleanupError } = await admin.auth.admin.deleteUser(account.user.id);
    return NextResponse.json(
      {
        error: cleanupError
          ? "Account linking failed; administrator support is required before retrying."
          : "Account could not be linked. Please retry.",
      },
      { status: 500 },
    );
  }
  return NextResponse.json({ email: employee.work_email, password }, { headers: { "Cache-Control": "no-store" } });
}
