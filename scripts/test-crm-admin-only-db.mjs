import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { setTestIdentity } from "./test-session.mjs";

// Direct PostgreSQL only: no Storage HTTP requests, AI calls, or message delivery.
const db = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), connect_timeout: 10 });
const rollback = new Error("rollback admin-only CRM verification");
const orgId = randomUUID();
const migration = new URL("../supabase/migrations/20261029090000_admin_only_crm.sql", import.meta.url);
async function catalog(tx) {
  return {
    functions: await tx`select p.oid,p.proacl::text,md5(pg_get_functiondef(p.oid)) as definition
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' order by p.oid`,
    policies:
      await tx`select * from pg_catalog.pg_policies where schemaname in ('public','storage') order by schemaname,tablename,policyname`,
    constraints: await tx`select conname,pg_get_constraintdef(oid) as definition from pg_catalog.pg_constraint
      where conrelid='public.profiles'::regclass order by conname`,
    defaults: await tx`select oid,pg_get_expr(adbin,adrelid) as definition from pg_catalog.pg_attrdef
      where adrelid='public.crm_invoices'::regclass order by oid`,
    sequence: await tx`select last_value,is_called from public.crm_invoice_number_seq`,
  };
}
try {
  const before = await db.begin("read only", catalog);
  try {
    await db.begin(async (tx) => {
      await tx.unsafe("set local lock_timeout='5s'; set local statement_timeout='30s'");
      if (process.argv.includes("--preview")) await tx.unsafe(await readFile(migration, "utf8"));
      // nextval is not transactional. Use a rollback-local UUID default instead.
      await tx.unsafe(
        "alter table public.crm_invoices alter column invoice_number set default ('TEST-'||gen_random_uuid()::text)",
      );
      await tx`select set_config('storage.allow_delete_query','true',true)`;
      await tx`insert into public.organizations(id,name) values(${orgId},'Admin-only rollback fixture')`;
      const [foreignOrg] =
        await tx`insert into public.organizations(name) values('Other tenant rollback fixture') returning id`;
      const [foreignClient] =
        await tx`insert into public.crm_clients(organization_id,title) values(${foreignOrg.id},'Foreign client') returning id`;
      const [branch] =
        await tx`insert into public.branches(organization_id,name) values(${orgId},'Fixture') returning id`;
      const [policy] =
        await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${orgId},'Fixture',current_date-30) returning id`;
      const users = {};
      for (const name of ["admin", "employee", "other"]) {
        const user = randomUUID();
        await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'fixture')`;
        await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${orgId},${name},${name === "admin" ? "admin" : "employee"})`;
        const [employee] =
          await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on)
          values(${orgId},${user},${name},${name},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-30) returning id`;
        await tx`update public.profiles set employee_id=${employee.id} where user_id=${user}`;
        users[name] = { user, employee: employee.id };
      }
      await tx`update public.employees set manager_id=${users.employee.employee} where id=${users.other.employee}`;
      const serverOnly = [
        "ca_finish_job",
        "ca_context_visible_before_invoice_restriction",
        "crm_ingest",
        "crm_external_update",
        "crm_collection_reserve",
        "crm_collection_finish",
        "crm_claim_dispatch",
        "crm_claim_inbound",
        "crm_finish_inbound",
        "crm_schedule_dispatch",
        "crm_queue_reminders",
        "crm_queue_partner_alerts",
      ];
      const entrypoints = await tx`select p.proname,has_function_privilege('anon',p.oid,'execute') as anon,
        has_function_privilege('authenticated',p.oid,'execute') as member
        from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and (starts_with(p.proname,'crm_') or starts_with(p.proname,'ca_'))`;
      for (const entry of entrypoints) {
        assert.equal(entry.anon, false, `anonymous ${entry.proname} denied`);
        if (serverOnly.includes(entry.proname))
          assert.equal(entry.member, false, `${entry.proname} remains private/service-only`);
      }
      const as = async (user, role = "authenticated") => {
        await tx.unsafe("reset role");
        await setTestIdentity(tx, user);
        assert.ok(["authenticated", "anon", "service_role"].includes(role));
        await tx.unsafe(`set local role ${role}`);
      };
      const denied = async (query, label, code = "P0001") => {
        await assert.rejects(
          () => tx.savepoint(query),
          (error) => error.code === code,
          label,
        );
      };
      const [client] =
        await tx`insert into public.crm_clients(organization_id,title,owner_id) values(${orgId},'Assigned client',${users.employee.employee}) returning id`;
      const records = {};
      for (const table of ["leads", "documents", "compliance", "tasks", "support", "invoices"]) {
        const [record] = await tx.unsafe(
          `insert into public.crm_${table}(organization_id,title,client_id,owner_id,due_date${table === "invoices" ? ",amount,status" : ""})
          values($1,'Assigned fixture',$2,$3,current_date${table === "invoices" ? ",1000,'issued'" : ""}) returning id`,
          [orgId, client.id, users.employee.employee],
        );
        records[table] = record.id;
      }
      await tx`insert into public.crm_payments(organization_id,invoice_id,amount,reference,recorded_by) values(${orgId},${records.invoices},100,'FIXTURE',${users.admin.user})`;
      const ready = randomUUID(),
        pending = randomUUID(),
        discarding = randomUUID();
      for (const [id, state, version] of [
        [ready, "ready", 1],
        [pending, "pending", 2],
        [discarding, "discarding", 3],
      ]) {
        const path = `${orgId}/${records.documents}/${id}`;
        await tx`insert into public.crm_document_versions(id,organization_id,document_id,version,filename,content_type,byte_size,storage_path,state,uploaded_by)
          values(${id},${orgId},${records.documents},${version},'fixture.png','image/png',68,${path},${state},${users.employee.user})`;
        if (state !== "pending")
          await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${path},'{"size":68,"mimetype":"image/png"}')`;
      }
      await tx`update public.crm_documents set storage_path=${`${orgId}/${records.documents}/${ready}`} where id=${records.documents}`;
      const [knowledge] =
        await tx`insert into public.ca_knowledge(organization_id,title,content,source_url,jurisdiction,valid_until,state,created_by)
        values(${orgId},'Approved fixture','Approved reference evidence for rollback tests.','https://example.invalid','India',current_date+30,'approved',${users.admin.user}) returning id`;
      const [job] =
        await tx`insert into public.ca_agent_jobs(organization_id,created_by,owner_id,kind,title,brief,jurisdiction,period,request_id)
        values(${orgId},${users.employee.user},${users.employee.employee},'documentation','Legacy own workpaper','Review supplied fixture evidence only.','India','FY 2026',${randomUUID()}) returning id,request_id`;
      const sources = [{ id: `tasks:${records.tasks}`, title: "Fixture", content: "Assigned evidence" }];
      const [event] = await tx`select id from public.crm_automation_events where source_id=${records.tasks} limit 1`;
      assert.ok(event, "assigned task has a reminder fixture");
      const assertDeniedAccess = async (label) => {
        const [helper] = await tx`select public.crm_can_access(${orgId},${users.employee.employee}) as access,
          public.ca_context_visible(${orgId},'[]') as empty_context,
          public.ca_context_visible(${orgId},${db.json(sources)}) as assigned_context,
          public.crm_financial_summary() as summary`;
        assert.deepEqual(
          helper,
          { access: false, empty_context: false, assigned_context: false, summary: null },
          `${label}: export/context helpers deny assigned access`,
        );
        assert.equal(
          (await tx`select * from public.crm_visible_owners()`).length,
          0,
          `${label}: no visible CRM owners`,
        );
        for (const table of [
          "clients",
          ...Object.keys(records),
          "payments",
          "automation_events",
          "document_versions",
          "outbox",
          "automation_settings",
          "channel_permissions",
          "dispatch",
          "inbound",
          "automation_runs",
        ]) {
          assert.equal(
            (await tx.unsafe(`select * from public.crm_${table} where organization_id=$1`, [orgId])).length,
            0,
            `${label}: ${table} export/read denied`,
          );
        }
        for (const table of ["ca_knowledge", "ca_agent_jobs"])
          assert.equal(
            (await tx.unsafe(`select * from public.${table} where organization_id=$1`, [orgId])).length,
            0,
            `${label}: ${table} read denied`,
          );
        assert.equal(
          (await tx`select * from public.crm_invoice_receipts(array[${records.invoices}::uuid])`).length,
          0,
          `${label}: receipts hidden`,
        );
        assert.equal(
          (await tx`select name from storage.objects where bucket_id='crm-documents' and name like ${`${orgId}/%`}`)
            .length,
          0,
          `${label}: storage downloads hidden`,
        );
        await denied(
          (sp) =>
            sp`select public.crm_save('tasks',${records.tasks},${db.json({ title: "Changed", status: "done", client_id: client.id, owner_id: users.employee.employee })})`,
          `${label}: assigned update denied`,
        );
        await denied(
          (sp) => sp`select public.crm_save('tasks',null,'{"title":"New","status":"todo"}')`,
          `${label}: creation denied`,
        );
        await denied(
          (sp) => sp`update public.crm_tasks set status='done' where id=${records.tasks}`,
          `${label}: direct update denied`,
          "42501",
        );
        await denied(
          (sp) => sp`insert into public.crm_tasks(organization_id,title) values(${orgId},'Direct')`,
          `${label}: direct insert denied`,
          "42501",
        );
        await denied(
          (sp) =>
            sp`select public.crm_reserve_document(${randomUUID()},${records.documents},'test.png','image/png',68)`,
          `${label}: reserve denied`,
        );
        await denied((sp) => sp`select public.crm_finish_document(${ready})`, `${label}: finish denied`);
        await denied(
          (sp) =>
            sp`select public.crm_attach_document(${records.documents},${`${orgId}/${records.documents}/${ready}`})`,
          `${label}: legacy attach denied`,
        );
        await denied((sp) => sp`select public.crm_discard_document(${discarding},false)`, `${label}: discard denied`);
        await denied(
          (sp) =>
            sp`insert into storage.objects(bucket_id,name) values('crm-documents',${`${orgId}/${records.documents}/${pending}`})`,
          `${label}: reserved upload denied`,
          "42501",
        );
        assert.equal(
          (
            await tx`delete from storage.objects where bucket_id='crm-documents' and name=${`${orgId}/${records.documents}/${discarding}`} returning name`
          ).length,
          0,
          `${label}: storage delete denied`,
        );
        for (const clientId of [null, client.id])
          await denied(
            (sp) =>
              sp`select public.ca_create_job('documentation','Denied fixture','Review supplied fixture evidence only.','India','FY 2026',${clientId},${randomUUID()})`,
            `${label}: AI creation denied including no-client bypass`,
          );
        await denied(
          (sp) =>
            sp`select public.ca_create_job('documentation','Legacy own workpaper','Review supplied fixture evidence only.','India','FY 2026',null,${job.request_id})`,
          `${label}: idempotent legacy creation denied`,
        );
        await denied(
          (sp) => sp`select public.ca_start_job(${job.id},${randomUUID()},'fixture-model','[]')`,
          `${label}: legacy creator AI start denied`,
        );
        await denied(
          (sp) => sp`select public.ca_review_job(${job.id},'approved','Reviewed all fixture evidence.')`,
          `${label}: AI review denied`,
        );
        await denied(
          (sp) =>
            sp`select public.ca_save_knowledge('Fixture','Reviewed reference evidence for rollback tests.','https://example.invalid','India',current_date+30)`,
          `${label}: knowledge creation denied`,
        );
        await denied(
          (sp) => sp`select public.ca_review_knowledge(${knowledge.id},'retired')`,
          `${label}: knowledge review denied`,
        );
        await denied(
          (sp) => sp`select public.crm_reserve_draft(${records.support})`,
          `${label}: support AI draft denied`,
        );
        await denied((sp) => sp`select public.crm_convert_lead(${records.leads})`, `${label}: conversion denied`);
        await denied(
          (sp) => sp`select public.crm_record_payment(${records.invoices},1,'DENIED')`,
          `${label}: payment denied`,
        );
        await denied(
          (sp) => sp`select public.crm_acknowledge_event(${event.id})`,
          `${label}: assigned reminder acknowledgement denied`,
        );
        await denied(
          (sp) => sp`select public.ca_finish_job(${job.id},${orgId},${randomUUID()},null,'Fixture')`,
          `${label}: AI finish service-only`,
          "42501",
        );
      };
      await as(users.employee.user);
      await assertDeniedAccess("assigned employee");
      // The deployed two-role constraint disallows legacy managers; simulate an
      // upgraded legacy database inside a savepoint, restoring the constraint.
      const legacyRollback = new Error("rollback legacy role probe");
      await assert.rejects(
        () =>
          tx.savepoint(async (sp) => {
            await sp.unsafe("reset role; alter table public.profiles drop constraint portal_two_roles");
            await sp`update public.profiles set role='manager' where user_id=${users.employee.user}`;
            await sp.unsafe("set local role authenticated");
            await assertDeniedAccess("legacy assigned manager");
            throw legacyRollback;
          }),
        (error) => error === legacyRollback,
      );
      await tx.unsafe("reset role");
      // Compatibility probe only: production keeps the employee/admin constraint.
      // This DDL and both legacy labels disappear with the outer rollback.
      await tx.unsafe("alter table public.profiles drop constraint portal_two_roles");
      for (const role of ["admin", "partner"]) {
        await tx`update public.profiles set role=${role}::public.portal_role where user_id=${users.admin.user}`;
        await as(users.admin.user);
        assert.equal(
          (await tx`select id from public.crm_clients where id=${client.id}`).length,
          1,
          `${role}: assigned-to-employee client visible`,
        );
        assert.equal(
          (await tx`select id from public.crm_invoices where id=${records.invoices}`).length,
          1,
          `${role}: invoice visible`,
        );
        assert.equal(
          (await tx`select id from public.crm_clients where id=${foreignClient.id}`).length,
          0,
          `${role}: foreign tenant row hidden`,
        );
        assert.equal(
          (await tx`select * from public.crm_invoice_receipts(array[${records.invoices}::uuid])`).length,
          1,
          `${role}: receipts visible`,
        );
        assert.equal(
          (await tx`select id from public.ca_knowledge where id=${knowledge.id}`).length,
          1,
          `${role}: knowledge visible`,
        );
        assert.equal(
          (await tx`select id from public.ca_agent_jobs where id=${job.id}`).length,
          1,
          `${role}: legacy job visible`,
        );
        assert.equal(
          (await tx`select name from storage.objects where name=${`${orgId}/${records.documents}/${ready}`}`).length,
          1,
          `${role}: retained download allowed`,
        );
        await tx`select public.crm_save('tasks',${records.tasks},${db.json({ title: "Reviewed", status: "todo", client_id: client.id, owner_id: users.employee.employee })})`;
        await tx`select public.crm_save('invoices',${records.invoices},${db.json({ title: "Assigned fixture", status: "issued", client_id: client.id, owner_id: users.employee.employee, amount: 1000 })})`;
        const uploadId = randomUUID();
        const [upload] =
          await tx`select public.crm_reserve_document(${uploadId},${records.documents},'admin.png','image/png',68) as value`;
        await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${upload.value.path},'{"size":68,"mimetype":"image/png"}')`;
        await tx`select public.crm_finish_document(${uploadId})`;
        const [created] =
          await tx`select public.ca_create_job('documentation','Allowed fixture','Review supplied fixture evidence only.','India','FY 2026',null,${randomUUID()}) as id`;
        await tx`select public.ca_start_job(${created.id},${randomUUID()},'fixture-model','[]')`;
        const [crossOrg] =
          await tx`select public.crm_can_access(${randomUUID()},${users.employee.employee}) as allowed`;
        assert.equal(crossOrg.allowed, false, `${role}: cross-tenant helper denied`);
        await tx.unsafe("reset role");
      }
      for (const condition of ["inactive", "onboarding", "employee_inactive", "expired"]) {
        await tx`update public.profiles set active=${condition !== "inactive"},password_change_required=${condition === "onboarding"} where user_id=${users.admin.user}`;
        await tx`update public.employees set active=${condition !== "employee_inactive"} where id=${users.admin.employee}`;
        await as(users.admin.user);
        if (condition === "expired") {
          await tx.unsafe("reset role");
          await tx`update auth.sessions set created_at=now()-interval '2 days' where id=${users.admin.user}`;
          await tx.unsafe("set local role authenticated");
        }
        await assertDeniedAccess(condition);
        await tx.unsafe("reset role");
      }
      await as(null, "anon");
      await denied(
        (sp) => sp`select public.crm_can_access(${orgId},${users.employee.employee})`,
        "anonymous helper denied",
        "42501",
      );
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    assert.deepEqual(
      await db.begin("read only", catalog),
      before,
      "rollback restores functions, ACLs, policies, constraints, defaults and sequence state",
    );
    assert.equal((await db`select id from public.organizations where id=${orgId}`).length, 0, "fixtures rolled back");
  }
  console.log(
    "PASS: admin/partner CRM; assigned employee/legacy manager denial; exports/helpers, documents/storage, AI, onboarding/inactive/session/tenant isolation. Schema, sequence and fixtures rolled back.",
  );
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? `CRM assertion failed: ${error.message.split("\n")[0]}`
      : `CRM test failed (${error.code ?? "unexpected error"}).`,
  );
  process.exitCode = 1;
} finally {
  await db.end();
}
