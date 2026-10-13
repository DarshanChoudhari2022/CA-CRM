import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback CRM fixtures");
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local time zone 'Asia/Kolkata'");
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
    await tx.unsafe("reset role");
    const [unrelated] =
      await tx`insert into public.employees(organization_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},'C','Unrelated',${`${randomUUID()}@example.invalid`},${branch.id},${policy.id},current_date) returning id`;
    await tx.unsafe("set local role authenticated");
    await save("tasks", { title: "Unrelated task", status: "todo", owner_id: unrelated.id });
    await tx.unsafe("reset role");
    await tx`update public.profiles set role='manager' where user_id=${admin}`;
    await tx.unsafe("set local role authenticated");
    assert.equal(
      (await tx`select id from public.crm_tasks`).length,
      2,
      "manager sees own and direct-report tasks, not unrelated employees",
    );
    await tx.unsafe("reset role");
    await tx`update public.profiles set role='admin' where user_id=${admin}`;
    await tx.unsafe("set local role authenticated");
    const ticket = await save("support", { title: "Query", status: "open", owner_id: m.id });
    const [reference] =
      await tx`select public.ca_save_knowledge('Reviewed policy','This is a verified test policy for CA workpapers.','https://example.invalid/policy','India',current_date+30) as id`;
    await tx`select public.ca_review_knowledge(${reference.id},'approved')`;
    const workpaperRequest = randomUUID();
    const [workpaper] =
      await tx`select public.ca_create_job('taxation','Test tax review','Prepare a review of supplied firm information.','India','FY 2026-27',${converted.id},${workpaperRequest}) as id`;
    const [retryWorkpaper] =
      await tx`select public.ca_create_job('taxation','Test tax review','Prepare a review of supplied firm information.','India','FY 2026-27',${converted.id},${workpaperRequest}) as id`;
    assert.equal(workpaper.id, retryWorkpaper.id, "workpaper creation is idempotent");
    await rejected(
      (sp) =>
        sp`select public.ca_create_job('finance','Changed brief','Prepare a review of supplied firm information.','India','FY 2026-27',${converted.id},${workpaperRequest})`,
      "idempotency rejects changed payload",
    );
    const lease = randomUUID();
    await tx`select public.ca_start_job(${workpaper.id},${lease},'fixture-model','[]'::jsonb)`;
    await rejected(
      (sp) => sp`select public.ca_start_job(${workpaper.id},${randomUUID()},'fixture-model','[]'::jsonb)`,
      "concurrent AI run denied",
    );
    await rejected(
      (sp) => sp`select public.ca_finish_job(${workpaper.id},${org.id},${lease},null,'Fake failure')`,
      "users cannot forge AI results",
    );
    await tx.unsafe("reset role");
    const draft = {
      summary: "Review this fixture",
      findings: [],
      missingInformation: ["Source evidence"],
      nextActions: ["Obtain evidence"],
      reviewNotes: "Human review required",
    };
    await tx`select public.ca_finish_job(${workpaper.id},${org.id},${lease},${sql.json(draft)},null)`;
    await tx.unsafe("set local role authenticated");
    await tx`select public.ca_review_job(${workpaper.id},'approved','Reviewed the fixture and identified missing information.')`;
    await rejected(
      (sp) => sp`select public.ca_review_job(${workpaper.id},'rejected','Attempted to change a finished review.')`,
      "reviewed workpaper is immutable",
    );
    const request = randomUUID();
    await tx`select public.crm_reserve_send(${request},${ticket},'gmail','test@example.invalid','Test','Reviewed body')`;
    await rejected(
      (sp) =>
        sp`select public.crm_reserve_send(${request},${ticket},'gmail','test@example.invalid','Test','Reviewed body')`,
      "duplicate send denied",
    );
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    assert.equal((await tx`select id from public.ca_agent_jobs`).length, 0, "employee cannot read admin workpaper");
    await rejected(
      (sp) => sp`select public.ca_review_knowledge(${reference.id},'retired')`,
      "employee cannot approve reference material",
    );
    await rejected(
      (sp) => sp`select public.ca_review_job(${workpaper.id},'approved','Unauthorized reviewer attempt.')`,
      "employee cannot approve workpaper",
    );
    const [memberPaper] =
      await tx`select public.ca_create_job('documentation','Employee evidence review','Review the assigned task using the supplied evidence.','India','Fixture period',${converted.id},${randomUUID()}) as id`;
    await tx`select set_config('request.jwt.claim.sub',${admin},true)`;
    await rejected(
      (sp) => sp`select public.ca_start_job(${memberPaper.id},${randomUUID()},'fixture-model','[]'::jsonb)`,
      "administrator cannot widen employee evidence through generation",
    );
    await tx`select set_config('request.jwt.claim.sub',${member},true)`;
    const memberLease = randomUUID();
    const evidence = [{ id: `tasks:${ownTask}`, title: "Assigned task", content: "Own employee task evidence" }];
    await tx`select public.ca_start_job(${memberPaper.id},${memberLease},'fixture-model',${sql.json(evidence)})`;
    await tx.unsafe("reset role");
    await tx`select public.ca_finish_job(${memberPaper.id},${org.id},${memberLease},${sql.json(draft)},null)`;
    await tx.unsafe("set local role authenticated");
    assert.equal(
      (await tx`select id from public.ca_agent_jobs`).length,
      1,
      "creator sees own currently authorized evidence",
    );
    await tx.unsafe("reset role");
    await tx`update public.crm_tasks set owner_id=${a.id} where id=${ownTask}`;
    await tx.unsafe("set local role authenticated");
    assert.equal(
      (await tx`select id from public.ca_agent_jobs`).length,
      0,
      "reassignment cannot leak through saved evidence",
    );
    await tx.unsafe("reset role");
    await tx`update public.crm_tasks set owner_id=${m.id} where id=${ownTask}`;
    await tx.unsafe("set local role authenticated");
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
    await tx.unsafe("reset role");
    await tx`update public.profiles set active=true,password_change_required=true where user_id=${member}`;
    await tx.unsafe("set local role authenticated");
    assert.equal((await tx`select id from public.crm_tasks`).length, 0, "onboarding cannot bypass role-scoped access");
    await rejected(
      (sp) => sp`insert into public.crm_tasks(organization_id,title) values(${org.id},'Direct write')`,
      "direct table writes denied",
    );
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
