// A real private Storage upload/download using only a generated test image and isolated fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const member = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
let userId, orgId, path;
const documentPaths = [];
const marker = `Photo API fixture ${randomUUID()}`;
try {
  const email = `photo-${randomUUID()}@example.invalid`,
    password = randomBytes(24).toString("base64url");
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error, "fixture Auth creation");
  userId = created.data.user.id;
  const [org] = await sql`insert into public.organizations(name) values(${marker}) returning id`;
  orgId = org.id;
  const [branch] = await sql`insert into public.branches(organization_id,name) values(${orgId},'Fixture') returning id`;
  const [policy] =
    await sql`insert into public.attendance_policies(organization_id,name,effective_from) values(${orgId},'Fixture',current_date) returning id`;
  await sql`insert into public.profiles(user_id,organization_id,full_name,password_change_required) values(${userId},${orgId},'Photo fixture',false)`;
  const [employee] =
    await sql`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${orgId},${userId},'FIXTURE','Photo fixture',${email},${branch.id},${policy.id},current_date-1) returning id`;
  await sql`update public.profiles set employee_id=${employee.id} where user_id=${userId}`;
  const signed = await member.auth.signInWithPassword({ email, password });
  assert.ok(!signed.error, "fixture sign-in");
  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l7sAAAAASUVORK5CYII=",
    "base64",
  );
  const id = randomUUID();
  const reserved = await member.rpc("reserve_daily_photo", {
    p_id: id,
    p_content_type: "image/png",
    p_size: image.length,
  });
  assert.ok(!reserved.error, "reserve generated test photo");
  path = reserved.data.path;
  const upload = await member.storage
    .from("attendance-photos")
    .upload(path, new Blob([image], { type: "image/png" }), { contentType: "image/png" });
  assert.ok(!upload.error, "private Storage upload");
  const finished = await member.rpc("finish_daily_photo", { p_id: id });
  assert.ok(!finished.error, "verify real Storage metadata and finalize");
  const download = await member.storage.from("attendance-photos").download(path);
  assert.ok(!download.error, "own ready photo download");
  assert.equal(download.data.size, image.length);
  const url = await member.storage.from("attendance-photos").createSignedUrl(path, 60);
  assert.ok(!url.error, "private signed preview URL");
  const blockedDiscard = await member.rpc("prepare_daily_photo_discard", { p_id: id });
  assert.ok(blockedDiscard.error, "published photo cannot enter discard state");
  await member.storage.from("attendance-photos").remove([path]);
  assert.ok(
    !(await member.storage.from("attendance-photos").download(path)).error,
    "direct delete cannot remove a finalized photo",
  );
  const pendingId = randomUUID();
  const pending = await member.rpc("reserve_daily_photo", {
    p_id: pendingId,
    p_content_type: "image/png",
    p_size: image.length,
  });
  assert.ok(!pending.error, "reserve unfinished test upload");
  assert.ok(!(await member.rpc("prepare_daily_photo_discard", { p_id: pendingId })).error, "discard intent");
  assert.ok((await member.rpc("finish_daily_photo", { p_id: pendingId })).error, "discarding slot cannot finalize");
  assert.ok(!(await member.rpc("cancel_daily_photo", { p_id: pendingId })).error, "unfinished slot released");
  const forged = await member.storage
    .from("attendance-photos")
    .upload(`${orgId}/${employee.id}/unreserved`, new Blob([image], { type: "image/png" }), {
      contentType: "image/png",
    });
  assert.ok(forged.error, "unreserved upload denied");
  if (process.env.PHOTO_VERIFY_QUALITY === "1") {
    const [document] =
      await sql`insert into public.crm_documents(organization_id,title,owner_id) values(${orgId},'Generated version test',${employee.id}) returning id`;
    for (const filename of ["first.png", "second.png"]) {
      const reservation = await member.rpc("crm_reserve_document", {
        p_id: randomUUID(),
        p_document: document.id,
        p_filename: filename,
        p_type: "image/png",
        p_size: image.length,
      });
      assert.ok(!reservation.error, "document upload reservation");
      documentPaths.push(reservation.data.path);
      const uploaded = await member.storage
        .from("crm-documents")
        .upload(reservation.data.path, new Blob([image], { type: "image/png" }), { contentType: "image/png" });
      assert.ok(!uploaded.error, "real document Storage upload");
      assert.ok(
        !(await member.rpc("crm_finish_document", { p_id: reservation.data.id })).error,
        "document metadata finalization",
      );
    }
    assert.ok(
      !(await member.storage.from("crm-documents").download(documentPaths[0])).error,
      "earlier version stays downloadable",
    );
    await member.storage.from("crm-documents").remove([documentPaths[0]]);
    assert.ok(
      !(await member.storage.from("crm-documents").download(documentPaths[0])).error,
      "ready version cannot be directly deleted",
    );
    const unfinishedId = randomUUID();
    const unfinished = await member.rpc("crm_reserve_document", {
      p_id: unfinishedId,
      p_document: document.id,
      p_filename: "unfinished.png",
      p_type: "image/png",
      p_size: image.length,
    });
    assert.ok(!unfinished.error, "unfinished reservation");
    documentPaths.push(unfinished.data.path);
    assert.ok(
      !(
        await member.storage
          .from("crm-documents")
          .upload(unfinished.data.path, new Blob([image], { type: "image/png" }), { contentType: "image/png" })
      ).error,
      "unfinished file upload",
    );
    assert.ok(
      !(await member.rpc("crm_discard_document", { p_id: unfinishedId, p_complete: false })).error,
      "discard intent",
    );
    assert.ok(
      (await member.rpc("crm_finish_document", { p_id: unfinishedId })).error,
      "discarded version cannot finalize",
    );
    assert.ok(
      !(await member.storage.from("crm-documents").remove([unfinished.data.path])).error,
      "discard removes physical upload",
    );
    assert.ok(
      !(await member.rpc("crm_discard_document", { p_id: unfinishedId, p_complete: true })).error,
      "discard releases reservation",
    );
    console.log(
      "Passed real document Storage API: retained versions, metadata finalization, ready-file delete denial and unfinished-file discard.",
    );
  }
  if (process.env.PHOTO_PORTAL_URL) {
    const base = process.env.PHOTO_PORTAL_URL;
    assert.ok(
      ["localhost", "127.0.0.1", "ca-crm-theta.vercel.app"].includes(new URL(base).hostname),
      "Portal target must belong to this project",
    );
    await sql`insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context,check_in_at,check_out_at,duration_minutes,result) values(${orgId},${employee.id},(now() at time zone 'Asia/Kolkata')::date,${branch.id},${policy.id},'working_day',now()-interval '450 minutes',now(),450,'half_day')`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, audience: "employee" }),
    });
    assert.equal(login.status, 200, "fixture portal login");
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const start = performance.now();
    const response = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } });
    const html = await response.text();
    assert.equal(response.status, 200, "authenticated dashboard");
    assert.ok(
      html.includes("Tasks performed today") && html.includes("Add photo (optional)"),
      "dashboard optional task/photo block",
    );
    assert.ok(html.includes("Time worked today") && html.includes("7h 30m"), "dashboard shows saved shift total");
    console.log(
      `Passed authenticated dashboard task/photo/shift rendering; full response ${Math.round(performance.now() - start)} ms.`,
    );
    if (process.env.PHOTO_VERIFY_AI === "1") {
      const brief = await member.rpc("ca_create_job", {
        p_kind: "documentation",
        p_title: "Generated workpaper fixture",
        p_brief: "Prepare a checklist of evidence for this generated test workpaper.",
        p_jurisdiction: "India",
        p_period: "Fixture period",
        p_client: null,
        p_request: randomUUID(),
      });
      assert.ok(!brief.error, "fixture workpaper saved through authenticated RPC");
      const workspace = await fetch(`${base}/crm/ai-team?workpaper=${brief.data}`, { headers: { Cookie: cookie } });
      const workspaceHtml = await workspace.text();
      assert.equal(workspace.status, 200, "authenticated AI workspace");
      assert.ok(
        workspaceHtml.includes("Generated workpaper fixture") &&
          workspaceHtml.includes("Reference library") &&
          workspaceHtml.includes("Tax preparation"),
        "new AI workbench renders actual fixture and specialists",
      );
      const exported = await fetch(`${base}/crm/ai-team/export?id=${brief.data}`, { headers: { Cookie: cookie } });
      assert.equal(exported.status, 200, "own workpaper export");
      assert.ok((await exported.text()).includes("Generated workpaper fixture"), "workpaper export has saved brief");
      assert.ok(exported.headers.get("cache-control")?.includes("no-store"), "private workpaper export is not cached");
      console.log("Passed authenticated AI workbench and scoped workpaper export; no provider call made.");
    }
    if (process.env.PHOTO_VERIFY_QUALITY === "1") {
      const documents = await fetch(`${base}/crm/documents`, { headers: { Cookie: cookie } });
      assert.ok((await documents.text()).includes("Upload a new version"), "versioned document interface rendered");
      await sql`update public.profiles set role='admin' where user_id=${userId}`;
      const register = await fetch(`${base}/team-attendance`, { headers: { Cookie: cookie } });
      const registerHtml = await register.text();
      assert.equal(register.status, 200, "team attendance page");
      assert.ok(
        registerHtml.includes("Photo fixture") && registerHtml.includes("Apply filters"),
        "scoped daily register renders administration controls",
      );
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const exported = await fetch(`${base}/team-attendance/export?date=${today}`, { headers: { Cookie: cookie } });
      assert.equal(exported.status, 200, "filtered register export");
      assert.ok(
        !(await exported.text()).includes("FIXTURE"),
        "administrator is excluded from employee attendance export",
      );
      const adminDashboard = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } });
      const adminHtml = await adminDashboard.text();
      assert.equal(adminDashboard.status, 200);
      assert.ok(
        adminHtml.includes("Attendance management") && !adminHtml.includes("My attendance today"),
        "admin dashboard has no personal attendance block",
      );
      const approvals = await fetch(`${base}/approvals`, { headers: { Cookie: cookie } });
      assert.equal(approvals.status, 200);
      assert.ok((await approvals.text()).includes("Leave approval history"));
      const monthly = await fetch(`${base}/reports`, { headers: { Cookie: cookie } });
      const monthlyHtml = await monthly.text();
      assert.equal(monthly.status, 200);
      assert.ok(
        monthlyHtml.replaceAll(/<!--.*?-->/g, "").includes(`${today.slice(0, 7)} · Open`) &&
          monthlyHtml.includes("Employee monthly calculation"),
        "monthly report defaults to current month and exposes employee totals",
      );
      console.log("Passed authenticated document-version and team attendance interfaces and register export.");
    }
  }
  console.log(
    "Passed real private photo API: generated PNG upload, metadata verification, authenticated download, signed preview, unreserved upload denied.",
  );
} finally {
  if (documentPaths.length) {
    const deleted = await admin.storage.from("crm-documents").remove(documentPaths);
    if (deleted.error) {
      console.error("Generated document fixture cleanup failed.");
      process.exitCode = 1;
    }
  }
  if (path) {
    const removed = await admin.storage.from("attendance-photos").remove([path]);
    if (removed.error) {
      console.error("Generated fixture file cleanup failed.");
      process.exitCode = 1;
    }
  }
  if (orgId)
    await sql.begin(async (tx) => {
      await tx`delete from public.audit_logs where organization_id=${orgId}`;
      await tx`delete from public.ca_agent_jobs where organization_id=${orgId}`;
      await tx`delete from public.ca_knowledge where organization_id=${orgId}`;
      await tx`delete from public.crm_document_versions where organization_id=${orgId}`;
      await tx`delete from public.crm_documents where organization_id=${orgId}`;
      await tx`delete from public.daily_report_photos where organization_id=${orgId}`;
      await tx`delete from public.daily_work_reports where organization_id=${orgId}`;
      await tx`delete from public.attendance_days where organization_id=${orgId}`;
      await tx`update public.profiles set employee_id=null where organization_id=${orgId}`;
      await tx`delete from public.employees where organization_id=${orgId}`;
      await tx`delete from public.profiles where organization_id=${orgId}`;
      await tx`delete from public.attendance_policies where organization_id=${orgId}`;
      await tx`delete from public.branches where organization_id=${orgId}`;
      await tx`delete from public.organizations where id=${orgId} and name=${marker}`;
    });
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) {
      console.error("Generated Auth fixture cleanup failed.");
      process.exitCode = 1;
    }
  }
  await sql.end();
  console.log("Generated image and isolated photo fixtures cleaned up. No employee photos or real accounts modified.");
}
