import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const client = await createClient();
  // Another tab may already have signed in again after this tab's timer expired.
  const { data: deadline, error } = await client.rpc("portal_session_deadline");
  if (!error && deadline && Date.parse(deadline) > Date.now())
    return NextResponse.redirect(new URL("/modules", request.url));
  await client.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/login?error=session_expired", request.url));
}
