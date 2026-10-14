// Authenticated HTTP timings against a local production build. Fixtures are isolated and removed.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const base = process.env.PERF_BASE_URL ?? "http://localhost:3100";
assert.ok(
  ["localhost", "127.0.0.1", "ca-crm-theta.vercel.app"].includes(new URL(base).hostname),
  "Benchmark target must be this project's local or production site",
);
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const marker = `Performance fixture ${randomUUID()}`;
let userId, organizationId;
try {
  const email = `perf-${randomUUID()}@example.invalid`,
    password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error("Could not create isolated benchmark account");
  userId = created.data.user.id;
  const [org] = await sql`insert into public.organizations(name) values(${marker}) returning id`;
  organizationId = org.id;
  await sql`insert into public.profiles(user_id,organization_id,full_name,role,password_change_required) values(${userId},${organizationId},'Performance fixture','admin',false)`;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, audience: "admin" }),
  });
  assert.equal(login.status, 200, "Benchmark authentication");
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Benchmark session missing");
  const budget = Number(process.env.PERF_MAX_MS ?? 1700);
  let pass = true;
  const pages =
    process.env.PERF_CRM_ONLY === "1"
      ? [
          ["/crm", "Your firm, at a glance."],
          ["/crm/tasks", "Tasks"],
        ]
      : [
          ["/crm/automations", "Automation operations"],
          ["/attendance", "Attendance history"],
        ];
  for (const [path, heading] of pages) {
    const samples = [],
      firstBytes = [];
    for (let run = 0; run < 4; run++) {
      const start = performance.now();
      const response = await fetch(`${base}${path}`, { headers: { Cookie: cookie }, redirect: "manual" });
      const firstByte = Math.round(performance.now() - start);
      const body = await response.text();
      assert.equal(response.status, 200, `Authenticated ${path}`);
      assert.ok(!body.includes("We could not sign you in"), "Unexpected auth failure");
      assert.ok(body.includes(heading), "Expected authenticated page content");
      if (process.env.PERF_ASSERT_ISOLATION === "1")
        assert.ok(
          body.includes(`data-workspace="${path === "/attendance" ? "attendance" : "crm"}"`),
          "Workspace shell separation",
        );
      if (run === 0)
        console.log(
          `${path}: function/edge regions ${
            (response.headers.get("x-vercel-id") ?? "local")
              .split("::")
              .filter((part) => /^[a-z]{3}\d$/.test(part))
              .join(" / ") || "local"
          }`,
        );
      if (run > 0) {
        samples.push(Math.round(performance.now() - start));
        firstBytes.push(firstByte);
      }
    }
    const sorted = [...samples].sort((a, b) => a - b),
      median = sorted[1];
    console.log(
      `${path}: warm full-response samples ${samples.join(", ")} ms; median ${median} ms; budget ${budget} ms`,
    );
    console.log(`${path}: first-byte median ${[...firstBytes].sort((a, b) => a - b)[1]} ms`);
    if (median > budget) pass = false;
  }
  if (!pass) process.exitCode = 1;
} finally {
  if (userId) {
    await sql`delete from public.profiles where user_id=${userId} and full_name='Performance fixture'`;
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      console.error("Benchmark Auth fixture cleanup failed; inspect the isolated fixture account.");
      process.exitCode = 1;
    }
  }
  if (organizationId) await sql`delete from public.organizations where id=${organizationId} and name=${marker}`;
  await sql.end();
  console.log("Isolated benchmark cleanup completed; no real accounts modified.");
}
