import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback integrity fixtures");
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local time zone 'Asia/Kolkata'");
    const admin = randomUUID(),
      member = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('Integrity rollback test') returning id`;
    const [branch] = await tx`insert into public.branches(organization_id,name) values(${org.id},'Test') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from,correction_window_days) values(${org.id},'Test',current_date-60,60) returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture'),(${member},${`${member}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin'),(${member},${org.id},'Member','employee')`;
    const employees = [];
    for (const [user, name] of [
      [admin, "A"],
      [member, "M"],
    ]) {
      const [e] =
        await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${user},${name},${name},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-30) returning id`;
      employees.push(e);
      await tx`update public.profiles set employee_id=${e.id} where user_id=${user}`;
    }
    const memberEmployee = employees[1].id;
    const [leave] =
      await tx`insert into public.leave_types(organization_id,name,code,default_days) values(${org.id},'Test','T',20) returning id`;
    const expectDenied = async (query, label, pattern) => {
      let failure;
      try {
        await tx.savepoint(query);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, label);
      if (pattern) assert.match(failure.message, pattern, label);
    };
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    await tx.unsafe("set local role authenticated");
    await expectDenied(
      (sp) =>
        sp`select public.request_attendance_correction(current_date,'00:00'::time,'23:59:59'::time,'Future correction test',${randomUUID()})`,
      "future correction is rejected",
      /future times/,
    );
    await expectDenied(
      (sp) =>
        sp`select public.request_attendance_correction(current_date-31,'01:00'::time,'02:00'::time,'Outside employment test',${randomUUID()})`,
      "outside employment correction rejected",
      /within employment/,
    );
    await expectDenied(
      (sp) =>
        sp`select public.submit_leave_request(${leave.id},(extract(year from current_date)||'-12-31')::date,((extract(year from current_date)+1)||'-01-01')::date,'full_day','Cross year request test',${randomUUID()})`,
      "cross-year requests require separate balances",
      /each calendar year/,
    );
    await tx.unsafe("reset role");
    await tx`insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,requested_days,reason,state,requested_by,request_id) values(${org.id},${memberEmployee},${leave.id},current_date,current_date,1,'Approved leave fixture','approved',${member},${randomUUID()})`;
    await tx.unsafe("set local role authenticated");
    await expectDenied(
      (sp) => sp`select public.record_attendance_punch('check_in',${randomUUID()})`,
      "full-day leave blocks punches",
      /full-day leave/,
    );
    await tx.unsafe("reset role");
    const [request] =
      await tx`insert into public.attendance_corrections(organization_id,employee_id,work_date,base_revision,proposed_check_in,proposed_check_out,reason,requested_by,request_id) values(${org.id},${memberEmployee},current_date-1,999,now()-interval '2 days',now()-interval '1 day','Stale correction fixture',${member},${randomUUID()}) returning id`;
    await tx`select set_config('request.jwt.claim.sub',${admin},true)`;
    await tx.unsafe("set local role authenticated");
    await tx`select public.decide_attendance_correction(${request.id},'rejected','Stale correction rejected by reviewer',${randomUUID()})`;
    const [resolved] = await tx`select state from public.attendance_corrections where id=${request.id}`;
    assert.equal(resolved.state, "rejected", "stale correction can be rejected without requiring old revision");
    await tx.unsafe("reset role");
    const [prior] = await tx`select (date_trunc('month',current_date)-interval '1 month')::date as day`;
    await tx`insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,requested_days,reason,requested_by,request_id) values(${org.id},${memberEmployee},${leave.id},${prior.day},${prior.day},1,'Pending leave fixture',${member},${randomUUID()})`;
    await tx.unsafe("set local role authenticated");
    await expectDenied(
      (sp) => sp`select public.close_attendance_month(to_char(${prior.day}::date,'YYYY-MM'),${randomUUID()})`,
      "pending leave blocks closure",
      /pending leave/,
    );
    await tx.unsafe("reset role");
    await tx`insert into public.attendance_months(organization_id,month_start,state) values(${org.id},date_trunc('month',current_date)::date,'closed') on conflict(organization_id,month_start) do update set state='closed'`;
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    await tx.unsafe("set local role authenticated");
    await expectDenied(
      (sp) =>
        sp`select public.request_attendance_correction(current_date-1,'01:00'::time,'02:00'::time,'Closed correction test',${randomUUID()})`,
      "closed month rejects corrections",
      /MONTH_LOCKED/,
    );
    console.log(
      "Passed attendance integrity: future/employment correction rules, cross-year validation, leave/punch conflict, stale rejection, pending-leave closure and month locking. Fixtures rolled back.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
