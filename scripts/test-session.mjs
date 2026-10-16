import { readFile } from "node:fs/promises";

export async function prepareAccessTest(tx) {
  if (process.env.TEST_ACCESS_PREVIEW !== "1") return;
  for (const [name, marker] of [
    ["20261016100000_access_location_sessions", "public.portal_session_context()"],
    ["20261016103000_leave_email_notifications", "public.claim_leave_email(uuid,uuid)"],
  ]) {
    const [existing] = await tx`select to_regprocedure(${marker}) as value`;
    if (!existing.value)
      await tx.unsafe(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
  }
}

// Real Supabase JWTs carry session_id; fixtures must model that invariant too.
export async function setTestIdentity(tx, user) {
  const [previous] = await tx`select current_user as role`;
  await tx.unsafe("reset role");
  if (user) {
    const [existing] = await tx`select id from auth.sessions where id=${user} and user_id=${user}`;
    if (!existing)
      await tx`insert into auth.sessions(id,user_id,created_at,updated_at)
      select id,id,now(),now() from auth.users where id=${user} on conflict(id) do nothing`;
  }
  await tx`select set_config('request.jwt.claim.sub',${user ?? ""},true)`;
  await tx`select set_config('request.jwt.claims',${JSON.stringify(user ? { sub: user, session_id: user, role: "authenticated" } : {})},true)`;
  if (["authenticated", "anon", "service_role"].includes(previous.role))
    await tx.unsafe(`set local role ${previous.role}`);
}

export function testLocation() {
  return { latitude: 19.88, longitude: 75.34, accuracy: 20, capturedAt: new Date().toISOString() };
}
