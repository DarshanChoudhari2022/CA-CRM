import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
const rollback = new Error("rollback fixtures");
try {
  await sql.begin(async (tx) => {
    const userA = randomUUID();
    const userB = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('Workspace test') returning id`;
    const [branch] = await tx`insert into public.branches(organization_id,name) values(${org.id},'Test') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${org.id},'Test',current_date) returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${userA},${`${userA}@example.invalid`},'fixture'),(${userB},${`${userB}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name) values(${userA},${org.id},'A'),(${userB},${org.id},'B')`;
    const [employeeA] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${userA},'A','A',${`${userA}@example.invalid`},${branch.id},${policy.id},current_date) returning id`;
    const [employeeB] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${userB},'B','B',${`${userB}@example.invalid`},${branch.id},${policy.id},current_date) returning id`;
    await tx`update public.profiles set employee_id=${employeeA.id} where user_id=${userA}`;
    await tx`update public.profiles set employee_id=${employeeB.id} where user_id=${userB}`;
    const [other] =
      await tx`insert into public.daily_work_items(organization_id,employee_id,work_date,title) values(${org.id},${employeeB.id},current_date,'Private work') returning id`;
    await tx`select set_config('request.jwt.claim.sub',${userA},true)`;
    await tx.unsafe("set local role authenticated");
    const [created] = await tx`select public.save_daily_work(null,'Prepare audit','Started','planned') as id`;
    const rows = await tx`select id from public.daily_work_items`;
    assert.equal(rows.length, 1, "employee reads only own work");
    assert.equal(rows[0].id, created.id);
    let rejected = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`select public.save_daily_work(${other.id},'Tampered','','completed')`;
      });
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "employee cannot change colleague work");
    await tx.unsafe("reset role");
    await tx`update public.daily_work_items set work_date=current_date-2 where id=${created.id}`;
    await tx.unsafe("set local role authenticated");
    rejected = false;
    try {
      await tx.savepoint(async (sp) => {
        await sp`select public.save_daily_work(${created.id},'Old change','','completed')`;
      });
    } catch {
      rejected = true;
    }
    assert.ok(rejected, "historical work cannot be edited");
    await tx.unsafe("reset role");
    await tx`update public.profiles set password_change_required=true where user_id=${userA}`;
    await tx`update auth.users set updated_at=now() where id=${userA}`;
    const [unchanged] = await tx`select password_change_required from public.profiles where user_id=${userA}`;
    assert.equal(unchanged.password_change_required, true, "metadata update cannot bypass password change");
    await tx`update auth.users set encrypted_password='new-fixture' where id=${userA}`;
    const [changed] = await tx`select password_change_required from public.profiles where user_id=${userA}`;
    assert.equal(changed.password_change_required, false, "password hash update clears onboarding");
    console.log(
      "Passed: own-work visibility, colleague edit denied, historical edit denied, password-change enforcement.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
