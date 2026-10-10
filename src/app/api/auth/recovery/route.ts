import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin)
    return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const parsed = z.object({ email: z.email().max(320) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your work email." }, { status: 400 });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl)
    return NextResponse.json({ error: "Recovery is not configured. Contact your administrator." }, { status: 503 });
  const callback = new URL("/auth/callback", appUrl);
  await (await createClient()).auth.resetPasswordForEmail(parsed.data.email, { redirectTo: callback.toString() });
  // Do not disclose whether an account exists, or provider's account-specific errors.
  return NextResponse.json(
    {
      success:
        "If this email is registered, recovery instructions will be sent. Contact your administrator if they do not arrive.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
