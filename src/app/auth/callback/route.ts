import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const client = await createClient();
  const code = request.nextUrl.searchParams.get("code");
  const token = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const result = code
    ? await client.auth.exchangeCodeForSession(code)
    : token && type === "recovery"
      ? await client.auth.verifyOtp({ token_hash: token, type: "recovery" })
      : null;
  return NextResponse.redirect(
    new URL(result && !result.error ? "/change-password" : "/forgot-password?error=expired", request.nextUrl.origin),
  );
}
