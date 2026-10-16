// Only generated fixture data is committed, to exercise separate real database transactions.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { setTestIdentity } from "./test-session.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), max: 3 });
const cleanupId = process.argv.find((arg) => arg.startsWith("--cleanup-fixture="))?.split("=")[1];
if (cleanupId && !/^[0-9a-f-]{36}$/.test(cleanupId)) throw new Error("Invalid fixture ID");
const orgId = cleanupId ?? randomUUID(),
  admin = randomUUID(),
  member = randomUUID();
const marker = `Concurrency fixture ${orgId}`;
let releaseClose = () => {};
try {
  if (!cleanupId) {
    const fixture = await sql.begin(async (tx) => {
      await tx.unsafe("set local time zone 'Asia/Kolkata'");
      await tx`insert into public.organizations(id,name) values(${orgId},${marker})`;
      const [branch] =
        await tx`insert into public.branches(organization_id,name) values(${orgId},'Fixture') returning id`;
      const [policy] =
        await tx`insert into public.attendance_policies(organization_id,name,effective_from,correction_window_days) values(${orgId},'Fixture',current_date-70,70) returning id`;
      const employees = [];
      for (const [user, code, role] of [
        [admin, "A", "admin"],
        [member, "M", "employee"],
      ]) {
        await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'fixture')`;
        await tx`insert into auth.sessions(id,user_id,created_at,updated_at) values(${user},${user},now(),now())`;
        await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${orgId},${code},${role})`;
        const [e] =
          await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${orgId},${user},${code},${code},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-70) returning id`;
        employees.push(e);
        await tx`update public.profiles set employee_id=${e.id} where user_id=${user}`;
      }
      const types =
        await tx`insert into public.leave_types(organization_id,name,code,default_days) values(${orgId},'First','ONE',12),(${orgId},'Second','TWO',12) returning id`;
      const [future] =
        await tx`select d::date as work_date from generate_series(current_date+1,current_date+10,'1 day') d where extract(isodow from d)<7 limit 1`;
      const [previous] = await tx`select (date_trunc('month',current_date)-interval '1 month')::date as month`;
      await tx`insert into public.attendance_months(organization_id,month_start) values(${orgId},${previous.month})`;
      return { types, future: future.work_date, month: previous.month, employees };
    });
    const asUser = async (tx, user) => {
      await tx.unsafe("set local time zone 'Asia/Kolkata'");
      await tx.unsafe("set local statement_timeout='10s'");
      await setTestIdentity(tx, user);
      await tx.unsafe("set local role authenticated");
    };
    const leaves = await Promise.allSettled(
      fixture.types.map((type) =>
        sql.begin(async (tx) => {
          await asUser(tx, member);
          return tx`select public.submit_leave_request(${type.id},${fixture.future}::date,${fixture.future}::date,'full_day','Concurrent leave fixture',${randomUUID()})`;
        }),
      ),
    );
    assert.equal(
      leaves.filter((result) => result.status === "fulfilled").length,
      1,
      "exactly one overlapping leave commits across different leave types",
    );
    assert.equal(
      leaves.filter((result) => result.status === "rejected").length,
      1,
      "overlapping concurrent request is rejected",
    );
    let signalLocked, signalPid;
    const locked = new Promise((resolve) => {
      signalLocked = resolve;
    });
    const identified = new Promise((resolve) => {
      signalPid = resolve;
    });
    const gate = new Promise((resolve) => {
      releaseClose = resolve;
    });
    const closing = sql.begin(async (tx) => {
      // The public month table is intentionally hidden by RLS; acquire the test barrier
      // as the fixture owner, then execute the actual closure as the administrator.
      const held =
        await tx`select id from public.attendance_months where organization_id=${orgId} and month_start=${fixture.month}::date for update`;
      assert.equal(held.length, 1, "fixture month lock acquired");
      await asUser(tx, admin);
      signalLocked();
      await gate;
      await tx`select public.close_attendance_month(to_char(${fixture.month}::date,'YYYY-MM'),${randomUUID()})`;
    });
    await locked;
    const correction = sql.begin(async (tx) => {
      await asUser(tx, member);
      const [backend] = await tx`select pg_backend_pid() as pid`;
      signalPid(backend.pid);
      await tx`select public.request_attendance_correction(${fixture.month}::date+1,'01:00'::time,'02:00'::time,'Concurrent correction fixture',${randomUUID()})`;
    });
    // Attach outcome handlers immediately so an unexpected denial cannot become an unhandled rejection.
    const outcomes = Promise.allSettled([closing, correction]);
    const pid = await identified;
    let waiting = false;
    for (let probe = 0; probe < 40; probe++) {
      const [backend] = await sql`select wait_event_type from pg_stat_activity where pid=${pid}`;
      if (backend?.wait_event_type === "Lock") {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    releaseClose();
    const [closed, blocked] = await outcomes;
    if (!waiting)
      console.log(
        [closed, blocked].map((result) => (result.status === "rejected" ? result.reason.message : result.status)),
      );
    assert.ok(waiting, "correction actually waits on the month lock held by closure");
    assert.equal(closed.status, "fulfilled", "month closure commits");
    assert.equal(blocked.status, "rejected", "correction cannot commit into a closed month");
    assert.match(blocked.reason.message, /MONTH_LOCKED/);
    console.log(
      "Passed actual concurrent transactions: overlapping leave across different types and correction waiting behind month closure.",
    );
  }
} finally {
  releaseClose();
  // Delete only the generated organization; never target any existing account or record.
  await sql.begin(async (tx) => {
    const [fixture] = await tx`select id from public.organizations where id=${orgId} and name=${marker}`;
    if (!fixture) return;
    const users = await tx`select user_id from public.profiles where organization_id=${orgId}`;
    for (const table of [
      "audit_logs",
      "attendance_report_snapshots",
      "attendance_events",
      "attendance_corrections",
      "leave_email_notifications",
      "leave_requests",
      "leave_balances",
      "attendance_days",
      "attendance_months",
      "leave_types",
    ])
      await tx`delete from ${sql(`public.${table}`)} where organization_id=${orgId}`;
    await tx`update public.profiles set employee_id=null where organization_id=${orgId}`;
    await tx`delete from public.employees where organization_id=${orgId}`;
    await tx`delete from public.profiles where organization_id=${orgId}`;
    await tx`delete from public.attendance_policies where organization_id=${orgId}`;
    await tx`delete from public.branches where organization_id=${orgId}`;
    await tx`delete from public.organizations where id=${orgId} and name=${marker}`;
    for (const user of users)
      await tx`delete from auth.users where id=${user.user_id} and email=${`${user.user_id}@example.invalid`}`;
  });
  await sql.end();
  console.log("Generated concurrency fixtures cleaned up; no real employee records changed.");
}
