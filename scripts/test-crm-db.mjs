import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
const rollback = new Error("rollback CRM fixtures");
try {
  await sql.begin(async (tx) => {
    const admin = randomUUID(),
      member = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('CRM rollback test') returning id`;
    const [otherOrg] = await tx`insert into public.organizations(name) values('Isolation test') returning id`;
    const [branch] = await tx`insert into public.branches(organization_id,name) values(${org.id},'Test') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${org.id},'Test',current_date) returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture'),(${member},${`${member}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin'),(${member},${org.id},'Member','employee')`;
    const [a] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${admin},'A','Admin',${`${admin}@example.invalid`},${branch.id},${policy.id},current_date) returning id`;
    const [m] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${member},'M','Member',${`${member}@example.invalid`},${branch.id},${policy.id},current_date) returning id`;
    await tx`update public.profiles set employee_id=${a.id} where user_id=${admin}`;
    await tx`update public.profiles set employee_id=${m.id} where user_id=${member}`;
    await tx`insert into public.crm_clients(organization_id,title) values(${otherOrg.id},'Other organization private')`;
    await tx`select set_config('request.jwt.claim.sub',${admin},true)`;
    await tx.unsafe("set local role authenticated");
    const rejected = async (query, label) => {
      let denied = false;
      try {
        await tx.savepoint(query);
      } catch {
        denied = true;
      }
      assert.ok(denied, label);
    };
    const save = async (module, values) => {
      const [row] = await tx`select public.crm_save(${module},null,${sql.json(values)}) as id`;
      return row.id;
    };
    const lead = await save("leads", { title: "Test lead", status: "qualified", owner_id: m.id });
    const [converted] = await tx`select public.crm_convert_lead(${lead}) as id`;
    const [again] = await tx`select public.crm_convert_lead(${lead}) as id`;
    assert.equal(converted.id, again.id, "lead conversion idempotent");
    assert.equal((await tx`select id from public.crm_clients`).length, 1, "cross-organization client isolation");
    const invoice = await save("invoices", {
      title: "Invoice",
      status: "issued",
      client_id: converted.id,
      amount: 1000,
      owner_id: a.id,
    });
    await tx`select public.crm_record_payment(${invoice},400,'TEST-REF')`;
    const [summary] = await tx`select public.crm_financial_summary() as value`;
    assert.equal(Number(summary.value.issued), 1000, "database invoice aggregate");
    assert.equal(Number(summary.value.received), 400, "database receipt aggregate");
    await rejected(
      (sp) => sp`select public.admin_update_employee(${a.id},null,'General','employee',true,null)`,
      "self admin removal denied",
    );
    await tx`select public.admin_update_employee(${m.id},${a.id},'Audit','employee',true,null)`;
    await rejected(
      (sp) => sp`select public.admin_update_employee(${a.id},${m.id},'General','admin',true,null)`,
      "manager cycle denied",
    );
    await tx`select public.admin_add_holiday(${branch.id},current_date+30,'Future holiday')`;
    await rejected(
      (sp) => sp`select public.admin_add_holiday(${branch.id},current_date-1,'Past holiday')`,
      "historical holiday denied",
    );
    await tx.unsafe("reset role");
    await tx`update public.employees set joined_on=current_date-30 where id=${m.id}`;
    const [workday] =
      await tx`select d::date as day from generate_series(current_date-7,current_date-1,'1 day'::interval) d where extract(isodow from d)<6 limit 1`;
    await tx.unsafe("set local role authenticated");
    await tx`select public.admin_excuse_day(${m.id},${workday.day}::date,'Approved personal absence',false)`;
    await tx.unsafe("reset role");
    await tx`select public.reconcile_attendance_date(${workday.day}::date,${org.id})`;
    const [annotation] =
      await tx`select result,excuse_reason from public.attendance_days where employee_id=${m.id} and work_date=${workday.day}::date`;
    assert.equal(annotation.result, "excused", "annotation survives reconciliation");
    assert.equal(annotation.excuse_reason, "Approved personal absence");
    await tx.unsafe("set local role authenticated");
    await rejected(
      (sp) => sp`select public.crm_record_payment(${invoice},400,'TEST-REF')`,
      "duplicate reference denied",
    );
    await rejected((sp) => sp`select public.crm_record_payment(${invoice},700,'OVERPAY')`, "overpayment denied");
    await rejected(
      (sp) =>
        sp`select public.crm_save('invoices',${invoice},${sql.json({ title: "Invoice", status: "draft", client_id: converted.id, amount: 1000, owner_id: a.id })})`,
      "issued invoice cannot return to draft",
    );
    const ownTask = await save("tasks", { title: "Assigned task", status: "todo", owner_id: m.id });
    await save("tasks", { title: "Admin task", status: "todo", owner_id: a.id });
    const ticket = await save("support", { title: "Query", status: "open", owner_id: m.id });
    const request = randomUUID();
    await tx`select public.crm_reserve_send(${request},${ticket},'gmail','test@example.invalid','Test','Reviewed body')`;
    await rejected(
      (sp) =>
        sp`select public.crm_reserve_send(${request},${ticket},'gmail','test@example.invalid','Test','Reviewed body')`,
      "duplicate send denied",
    );
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    assert.equal((await tx`select id from public.crm_tasks`).length, 1, "member sees only assigned tasks");
    await tx`select public.crm_save('tasks',${ownTask},${sql.json({ title: "Assigned task", status: "done", owner_id: m.id })})`;
    await rejected(
      (sp) =>
        sp`select public.crm_save('tasks',null,${sql.json({ title: "Unauthorized creation", status: "todo", owner_id: m.id })})`,
      "employee record creation denied",
    );
    await rejected((sp) => sp`select public.crm_record_payment(${invoice},1,'MEMBER')`, "employee payments denied");
    await rejected(
      (sp) =>
        sp`select public.crm_reserve_send(${randomUUID()},${ticket},'gmail','test@example.invalid','Test','Body')`,
      "employee sends denied",
    );
    await tx.unsafe("reset role");
    await tx`update public.profiles set active=false where user_id=${member}`;
    await tx.unsafe("set local role authenticated");
    assert.equal((await tx`select id from public.crm_tasks`).length, 0, "inactive member cannot read tasks");
    console.log(
      "Passed CRM database checks: organization isolation, assignment RLS, lead conversion idempotency, invoice immutability, duplicate/overpayment rejection, duplicate-send protection, employee restrictions, inactive access.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
