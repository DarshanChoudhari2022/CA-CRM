import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { PortalIdentity } from "@/modules/identity/session";

const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
  audience: z.enum(["admin", "employee"]).default("employee"),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your work email and password." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error)
    return NextResponse.json(
      { error: "We could not sign you in. Check your credentials or contact an administrator." },
      { status: 401 },
    );
  const { data } = await supabase.rpc("current_portal_identity").single();
  const identity = data as PortalIdentity | null;
  if (!identity || (parsed.data.audience === "admin" && !["admin", "partner"].includes(identity.role))) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This account does not have access to this portal." }, { status: 403 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("password_change_required")
    .eq("user_id", identity.userId)
    .single();
  return NextResponse.json(
    { success: true, redirectTo: profile?.password_change_required ? "/change-password" : "/modules" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
