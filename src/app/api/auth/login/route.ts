import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
  audience: z.enum(["admin", "employee", "crm"]).default("employee"),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const hostMatches = host ? originHost === host : false;
      const nextHostMatches = originHost === request.nextUrl.host;
      if (!hostMatches && !nextHostMatches && origin !== request.nextUrl.origin) {
        return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your work email and password." }, { status: 400 });

  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error)
    return NextResponse.json(
      { error: "We could not sign you in. Check your credentials or contact an administrator." },
      { status: 401 },
    );
  const { data: profile } = await supabase
    .from("profiles")
    .select("role,active,password_change_required")
    .eq("user_id", auth.user.id)
    .single();
  if (!profile?.active) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "This account does not have access to this portal." }, { status: 403 });
  }
  return NextResponse.json(
    {
      success: true,
      redirectTo: profile.password_change_required
        ? "/change-password"
        : parsed.data.audience === "crm"
          ? "/crm"
          : "/dashboard",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
