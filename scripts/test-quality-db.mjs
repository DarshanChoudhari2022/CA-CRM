import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { prepareAccessTest, setTestIdentity } from "./test-session.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback quality fixtures");
try {
  await sql.begin(async (tx) => {
    await prepareAccessTest(tx);
    await tx.unsafe("set local time zone 'Asia/Kolkata'");
    // Match the Storage service's request-local metadata deletion flag for generated, rolled-back rows only.
    await tx`select set_config('storage.allow_delete_query','true',true)`;
    if (process.argv.includes("--preview"))
      for (const migration of [
        "20261013120000_document_versions",
        "20261013121000_attendance_register",
        "20261013122000_dated_reminders",
        "20261013123000_reminder_refresh",
        "20261013124000_local_leave_year",
      ]) {
        const [installed] =
          await tx`select version from supabase_migrations.schema_migrations where version=${migration.split("_")[0]}`;
        if (!installed)
          await tx.unsafe(await readFile(new URL(`../supabase/migrations/${migration}.sql`, import.meta.url), "utf8"));
      }
    const admin = randomUUID(),
      member = randomUUID(),
      stranger = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('Quality rollback test') returning id`;
    const [branch] =
      await tx`insert into public.branches(organization_id,name) values(${org.id},'Quality') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${org.id},'Quality',current_date-40) returning id`;
    const employees = [];
    for (const [user, name, role] of [
      [admin, "A", "admin"],
      [member, "M", "employee"],
      [stranger, "S", "employee"],
    ]) {
      await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'fixture')`;
      await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${org.id},${name},${role})`;
      const [employee] =
        await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on,manager_id) values(${org.id},${user},${name},${name},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-40,${name === "M" ? employees[0].id : null}) returning id`;
      employees.push(employee);
      await tx`update public.profiles set employee_id=${employee.id} where user_id=${user}`;
    }
    const [document] =
      await tx`insert into public.crm_documents(organization_id,title,owner_id) values(${org.id},'Private document',${employees[1].id}) returning id`;
    const [annualType] =
      await tx`insert into public.leave_types(organization_id,name,code,default_days) values(${org.id},'Annual default','ANN',12) returning id`;
    await setTestIdentity(tx, member);
    await tx.unsafe("set local role authenticated");
    const [defaults] = await tx`select public.my_leave_snapshot() as value`;
    assert.equal(
      Number(defaults.value.types[0].available),
      12,
      "current-year default shown before first balance provisioning",
    );
    await tx.unsafe("reset role");
    await tx`insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated) values(${org.id},${employees[1].id},${annualType.id},extract(year from current_date),0)`;
    await tx.unsafe("set local role authenticated");
    const [explicit] = await tx`select public.my_leave_snapshot() as value`;
    assert.equal(Number(explicit.value.types[0].available), 0, "explicit allocation cannot be replaced by default");
    const denied = async (query, label) => {
      let failed = false;
      try {
        await tx.savepoint(query);
      } catch {
        failed = true;
      }
      assert.ok(failed, label);
    };
    const [history] = await tx`select public.my_attendance_history(to_char(current_date,'YYYY-MM')) as value`;
    assert.ok(history.value.length > 0, "history derives dates when no reconciliation rows exist");
    await denied((sp) => sp`select public.attendance_register(current_date)`, "employee cannot read team register");
    const firstId = randomUUID(),
      secondId = randomUUID();
    const [first] =
      await tx`select public.crm_reserve_document(${firstId},${document.id},'first.png','image/png',68) as value`;
    const [again] =
      await tx`select public.crm_reserve_document(${firstId},${document.id},'first.png','image/png',68) as value`;
    assert.equal(first.value.path, again.value.path, "reservation idempotency");
    await denied(
      (sp) => sp`select public.crm_reserve_document(${firstId},${document.id},'changed.png','image/png',68)`,
      "changed upload cannot reuse reservation",
    );
    await denied((sp) => sp`select public.crm_finish_document(${firstId})`, "file must exist before finalization");
    await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${first.value.path},${sql.json({ size: 68, mimetype: "image/png" })})`;
    const [second] =
      await tx`select public.crm_reserve_document(${secondId},${document.id},'second.png','image/png',68) as value`;
    await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${second.value.path},${sql.json({ size: 68, mimetype: "image/png" })})`;
    await tx`select public.crm_finish_document(${secondId})`;
    await tx`select public.crm_finish_document(${firstId})`;
    const [latest] = await tx`select storage_path from public.crm_documents where id=${document.id}`;
    assert.equal(latest.storage_path, second.value.path, "late first completion cannot replace second version");
    assert.equal(
      (await tx`select name from storage.objects where name in (${first.value.path},${second.value.path})`).length,
      2,
      "both retained versions remain downloadable",
    );
    await denied(
      (sp) => sp`select public.crm_discard_document(${firstId},false)`,
      "retained version cannot be discarded",
    );
    await tx`delete from storage.objects where name=${first.value.path}`;
    assert.equal(
      (await tx`select name from storage.objects where name=${first.value.path}`).length,
      1,
      "direct delete cannot erase retained evidence",
    );
    const pendingId = randomUUID();
    const [pending] =
      await tx`select public.crm_reserve_document(${pendingId},${document.id},'unfinished.png','image/png',68) as value`;
    await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${pending.value.path},${sql.json({ size: 68, mimetype: "image/png" })})`;
    await tx`select public.crm_discard_document(${pendingId},false)`;
    await denied((sp) => sp`select public.crm_finish_document(${pendingId})`, "discarding upload cannot finalize");
    await tx`delete from storage.objects where name=${pending.value.path}`;
    await tx`select public.crm_discard_document(${pendingId},true)`;
    for (let n = 0; n < 8; n++)
      await tx`select public.crm_reserve_document(${randomUUID()},${document.id},'pending.png','image/png',68)`;
    await denied(
      (sp) => sp`select public.crm_reserve_document(${randomUUID()},${document.id},'eleventh.png','image/png',68)`,
      "ten-version limit",
    );
    await setTestIdentity(tx, stranger);
    assert.equal(
      (await tx`select id from public.crm_document_versions`).length,
      0,
      "unassigned employee cannot read versions",
    );
    assert.equal(
      (await tx`select name from storage.objects where name=${first.value.path}`).length,
      0,
      "unassigned employee cannot download old versions",
    );
    await tx.unsafe("reset role");
    await tx`update public.profiles set role='employee' where user_id=${admin}`;
    await setTestIdentity(tx, admin);
    await tx.unsafe("set local role authenticated");
    await denied(
      (sp) => sp`select public.attendance_register(current_date)`,
      "employees cannot open administrator register",
    );
    await tx.unsafe("reset role");
    await tx`update public.profiles set role='admin' where user_id=${admin}`;
    const [task] =
      await tx`insert into public.crm_tasks(organization_id,title,owner_id,due_date) values(${org.id},'Due fixture',${employees[1].id},current_date) returning id`;
    assert.equal(
      (await tx`select id from public.crm_automation_events where source_id=${task.id} and status='queued'`).length,
      1,
      "task creation immediately queues its reminder",
    );
    await tx`select public.crm_queue_reminders()`;
    await tx`select public.crm_queue_reminders()`;
    const [occurrences] =
      await tx`select count(*)::int count from public.crm_automation_events where source_id=${task.id}`;
    assert.equal(occurrences.count, 1, "daily reminder is idempotent");
    await tx.unsafe("set local role authenticated");
    const [event] = await tx`select id from public.crm_automation_events where source_id=${task.id}`;
    await tx`select public.crm_acknowledge_event(${event.id})`;
    await tx.unsafe("reset role");
    await tx`select public.crm_queue_reminders()`;
    const [ack] = await tx`select status from public.crm_automation_events where id=${event.id}`;
    assert.equal(ack.status, "acknowledged", "repeat scheduler preserves acknowledgement");
    await tx`update public.crm_tasks set due_date=current_date+1 where id=${task.id}`;
    assert.equal(
      (await tx`select id from public.crm_automation_events where source_id=${task.id} and status='queued'`).length,
      1,
      "rescheduled work immediately creates a new occurrence without waiting for cron",
    );
    await tx`update public.crm_tasks set status='done' where id=${task.id}`;
    assert.equal(
      (await tx`select id from public.crm_automation_events where source_id=${task.id} and status='queued'`).length,
      0,
      "completed work immediately cancels pending reminders without waiting for cron",
    );
    console.log(
      "Passed quality database checks: retained/versioned uploads, metadata/reservation/quota/recovery, private historical downloads, derived attendance, team scope/filtering and idempotent dated reminders. All fixtures rolled back.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
