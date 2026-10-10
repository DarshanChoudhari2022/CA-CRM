import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(128),
});

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = credentials.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your work email and password." }, { status: 400 });

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error)
    return NextResponse.json(
      { error: "We could not sign you in. Check your credentials or contact an administrator." },
      { status: 401 },
    );
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
