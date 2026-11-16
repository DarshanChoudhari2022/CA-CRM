import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export async function confirmedInvoiceClient(userId: string, password: FormDataEntryValue | null) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || typeof password !== "string" || !password || password.length > 128) return null;
  const session = await createSessionClient();
  const { data } = await session.auth.getUser();
  if (data.user?.id !== userId || !data.user.email) return null;
  const env = publicEnv();
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const verifier = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
  const confirmation = await verifier.auth.signInWithPassword({ email: data.user.email, password });
  if (confirmation.error || confirmation.data.user?.id !== userId) return null;
  await verifier.auth.signOut({ scope: "local" });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, options);
}
