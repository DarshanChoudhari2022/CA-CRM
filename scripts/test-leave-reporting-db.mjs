import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback leave reporting fixtures");
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local time zone 'Asia/Kolkata'");
    if (process.argv.includes("--preview"))
      await tx.unsafe(
        await readFile(new URL("../supabase/migrations/20261013130000_leave_reporting.sql", import.meta.url), "utf8"),
      );
    const admin = randomUUID(),
      member = randomUUID();
    const [org] =
      await tx`insert into public.organizations(name) values('Leave reporting rollback fixture') returning id`;
    const [branch] =
      await tx`insert into public.branches(organization_id,name) values(${org.id},'Fixture') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from,working_days) values(${org.id},'Fixture',date_trunc('month',current_date)::date,'{1,2,3,4,5,6,7}') returning id`;
    const employees = [];
    for (const [user, role] of [
      [admin, "admin"],
      [member, "employee"],
    ]) {
      await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'fixture')`;
      await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${org.id},${role},${role})`;
      const [e] =
        await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${user},${role},${role},${`${user}@example.invalid`},${branch.id},${policy.id},date_trunc('month',current_date)::date) returning id`;
      employees.push(e);
      await tx`update public.profiles set employee_id=${e.id} where user_id=${user}`;
    }
    const [type] =
      await tx`insert into public.leave_types(organization_id,name,code,default_days) values(${org.id},'Casual Leave','CL',12) returning id`;
    await tx`insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,requested_days,reason,state,requested_by,reviewed_by,reviewed_at,request_id) values(${org.id},${employees[1].id},${type.id},current_date,current_date+1,2,'Approved leave fixture','approved',${member},${admin},now(),${randomUUID()})`;
    // Saved excused result is precisely the user's screenshot; missing earlier rows model delayed reconciliation.
    await tx`insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context,result) values(${org.id},${employees[1].id},current_date,${branch.id},${policy.id},'working_day','excused')`;
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    await tx.unsafe("set local role authenticated");
    if (!process.argv.includes("--summary")) {
      const [history] = await tx`select public.my_attendance_history(to_char(current_date,'YYYY-MM')) value`;
      assert.equal(history.value[0].result, "leave_approved", "approved leave must not be labelled generic excused");
    }
    await tx.unsafe("reset role");
    await tx`select set_config('request.jwt.claim.sub',${admin},true)`;
    await tx.unsafe("set local role authenticated");
    const [summary] = await tx`select public.attendance_month_summary(to_char(current_date,'YYYY-MM')) value`;
    const [day] = await tx`select extract(day from current_date)::int n`;
    assert.equal(
      summary.value.expectedDays,
      day.n,
      "monthly employee days derive missing dates and exclude admin self-attendance",
    );
    assert.equal(summary.value.leaveDays, 1, "month-to-date counts only leave already elapsed, not tomorrow");
    const [overview] = await tx`select public.admin_attendance_overview() value`;
    assert.equal(overview.value.onLeave, 1, "admin overview counts today's approved employee leave");
    assert.equal(overview.value.expected, 1, "admin is not an expected attendance employee");
    const [register] = await tx`select public.attendance_register(current_date) value`;
    assert.equal(register.value.items[0].result, "leave_approved");
    const [rows] = await tx`select public.attendance_month_employee_totals(to_char(current_date,'YYYY-MM')) value`;
    assert.equal(rows.value.length, 1, "only the employee appears in monthly calculation");
    assert.equal(rows.value[0].leaveDays, 1);
    assert.equal(rows.value[0].absentDays, day.n - 1);
    const [history] =
      await tx`select public.leave_approval_history(to_char(current_date,'YYYY-MM'),'approved',1) value`;
    assert.equal(history.value.total, 1, "approved request remains visible after decision");
    const [exported] = await tx`select public.attendance_export_rows(to_char(current_date,'YYYY-MM')) value`;
    assert.equal(exported.value.length, day.n, "export uses the same derived employee-day calendar");
    assert.equal(exported.value.at(-1).leaveDays, 1, "export retains precise leave day evidence for future snapshots");
    if (day.n > 1) {
      await tx.unsafe("reset role");
      await tx`insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,portion,requested_days,reason,state,requested_by,reviewed_by,reviewed_at,request_id) values(${org.id},${employees[1].id},${type.id},current_date-1,current_date-1,'first_half',0.5,'Approved half-day fixture','approved',${member},${admin},now(),${randomUUID()})`;
      await tx.unsafe("set local role authenticated");
      const [half] = await tx`select public.attendance_month_employee_totals(to_char(current_date,'YYYY-MM')) value`;
      assert.equal(half.value[0].leaveDays, 1.5, "half-day leave contributes exactly half a day");
      assert.equal(
        half.value[0].absentDays,
        day.n - 1.5,
        "unworked remainder of a past half-day is not a full-day absence",
      );
    }
    await tx.unsafe("reset role");
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    await tx.unsafe("set local role authenticated");
    let denied = false;
    try {
      await tx.savepoint(
        (sp) => sp`select public.leave_approval_history(to_char(current_date,'YYYY-MM'),'approved',1)`,
      );
    } catch {
      denied = true;
    }
    assert.ok(denied, "employee cannot read approval administration history");
    console.log(
      "Passed approved-leave label, derived month-to-date employee totals, admin exclusion and permission-scoped approval history. Fixtures rolled back.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
