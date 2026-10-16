import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";

// Entire migrations + fixture exercise rolls back, including role normalization.
const db = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), connect_timeout: 10 });
const rollback = new Error("rollback access/location verification");
try {
  await db.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout='5s'; set local statement_timeout='20s'");
    for (const name of ["20261016100000_access_location_sessions", "20261016103000_leave_email_notifications"]) {
      const [installed] =
        await tx`select version from supabase_migrations.schema_migrations where version=${name.split("_")[0]}`;
      if (!installed)
        await tx.unsafe(await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8"));
    }
    console.log("Both migrations compile transactionally.");
    const [org] =
      await tx`insert into public.organizations(name) values('Access regression rollback fixture') returning id`;
    const [otherOrg] =
      await tx`insert into public.organizations(name) values('Other tenant rollback fixture') returning id`;
    const [branch] = await tx`insert into public.branches(organization_id,name) values(${org.id},'Test') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${org.id},'Test',current_date-60) returning id`;
    const people = [];
    for (const [code, role] of [
      ["A", "admin"],
      ["B", "employee"],
      ["C", "employee"],
    ]) {
      const user = randomUUID(),
        session = randomUUID();
      await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'fixture')`;
      await tx`insert into auth.sessions(id,user_id,created_at,updated_at) values(${session},${user},now(),now())`;
      await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${org.id},${code},${role})`;
      const [employee] =
        await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on)
        values(${org.id},${user},${code},${code},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-10) returning id`;
      await tx`update public.profiles set employee_id=${employee.id} where user_id=${user}`;
      people.push({ user, session, employee: employee.id });
    }
    const [admin, alice, bob] = people;
    const [client] =
      await tx`insert into public.crm_clients(organization_id,title,owner_id) values(${org.id},'Assigned client',${alice.employee}) returning id`;
    const [foreignClient] =
      await tx`insert into public.crm_clients(organization_id,title) values(${otherOrg.id},'Foreign client') returning id`;
    const [task] =
      await tx`insert into public.crm_tasks(organization_id,title,client_id,owner_id) values(${org.id},'Client task',${client.id},${bob.employee}) returning id,owner_id`;
    assert.equal(task.owner_id, alice.employee, "child records follow client ownership");
    const [invoice] =
      await tx`insert into public.crm_invoices(organization_id,title,client_id,amount) values(${org.id},'Service fee',${client.id},1000) returning id`;
    const [leaveType] =
      await tx`insert into public.leave_types(organization_id,name,code,default_days) values(${org.id},'Test','T',20) returning id`;
    await tx`insert into public.daily_work_items(organization_id,employee_id,work_date,title) values(${org.id},${alice.employee},current_date-11,'Before joining'),(${org.id},${alice.employee},current_date-1,'After joining')`;
    const as = async (person) => {
      await tx.unsafe("reset role");
      await tx`select set_config('request.jwt.claim.sub',${person.user},true)`;
      await tx`select set_config('request.jwt.claims',${JSON.stringify({ sub: person.user, session_id: person.session, role: "authenticated" })},true)`;
      await tx.unsafe("set local role authenticated");
    };
    const denied = async (query, label) => {
      let error;
      try {
        await tx.savepoint(query);
      } catch (failure) {
        error = failure;
      }
      assert.ok(error, label);
    };
    await as(alice);
    // Boundary behavior is fixed to IST, independent of server/connection timezone.
    for (const [created, expected] of [
      ["2026-10-16T02:59:59+05:30", "2026-10-16T03:00:00+05:30"],
      ["2026-10-16T03:00:00+05:30", "2026-10-17T03:00:00+05:30"],
      ["2026-10-16T23:30:00+05:30", "2026-10-17T03:00:00+05:30"],
    ]) {
      await tx.unsafe("reset role");
      await tx`update auth.sessions set created_at=${created}::timestamptz where id=${alice.session}`;
      await tx.unsafe("set local role authenticated");
      const [cutoff] = await tx`select public.portal_session_deadline()=${expected}::timestamptz as correct`;
      assert.equal(cutoff.correct, true, "03:00 IST cutoff is tied to original sign-in");
    }
    await tx.unsafe("reset role");
    await tx`update auth.sessions set created_at=now() where id=${alice.session}`;
    await tx.unsafe("set local role authenticated");
    assert.equal((await tx`select * from public.crm_clients`).length, 1);
    assert.equal((await tx`select * from public.crm_clients where id=${foreignClient.id}`).length, 0);
    assert.equal((await tx`select * from public.crm_tasks where id=${task.id}`).length, 1);
    assert.equal(
      (await tx`select * from public.crm_invoices where id=${invoice.id}`).length,
      0,
      "employees cannot read invoices even for assigned clients",
    );
    assert.equal((await tx`select * from public.crm_invoice_receipts(array[${invoice.id}::uuid])`).length, 0);
    assert.equal(
      (await tx`select * from public.daily_work_items`).length,
      1,
      "joining date applies to raw table reads",
    );
    await denied(
      (sp) => sp`select public.admin_employee_access(${bob.employee},'admin',true)`,
      "employee cannot promote another account",
    );
    await denied(
      (sp) => sp`select public.record_attendance_punch('check_in',${randomUUID()})`,
      "legacy location-free punch revoked",
    );
    await denied(
      (sp) =>
        sp`select public.record_attendance_punch('check_in',${randomUUID()},${tx.json({ latitude: 95, longitude: 70, accuracy: 20, capturedAt: new Date().toISOString() })})`,
      "invalid location denied",
    );
    const location = { latitude: 19.88, longitude: 75.34, accuracy: 20, capturedAt: new Date().toISOString() };
    const punch = randomUUID();
    await tx`select public.record_attendance_punch('check_in',${punch},${tx.json(location)})`;
    await tx`select public.record_attendance_punch('check_in',${punch},${tx.json({ ...location, latitude: 20 })})`;
    const [event] = await tx`select payload from public.attendance_events where request_id=${punch}`;
    assert.equal(event.payload.location.latitude, location.latitude, "retry preserves original location");
    const [hist] =
      await tx`select public.my_attendance_history(to_char(now() at time zone 'Asia/Kolkata','YYYY-MM')) as value`;
    assert.ok(hist.value.some((row) => row.checkInLocation?.latitude === location.latitude));
    const [request] =
      await tx`select public.submit_leave_request(${leaveType.id},((now() at time zone 'Asia/Kolkata')::date+1),((now() at time zone 'Asia/Kolkata')::date+1),'full_day','Medical appointment fixture',${randomUUID()}) as id`;
    await tx.unsafe("reset role");
    assert.equal(
      (await tx`select * from public.leave_email_notifications where leave_request_id=${request.id}`).length,
      1,
    );
    const [claimed] = await tx`select public.claim_leave_email(${org.id},${request.id}) as item`;
    assert.equal(
      (await tx`select public.claim_leave_email(${org.id},${request.id}) as item`)[0].item,
      null,
      "lease prevents duplicate sends",
    );
    await as(bob);
    await denied(
      (sp) => sp`select public.finish_leave_email(${claimed.item.id},${claimed.item.lease},'sent')`,
      "another employee cannot confirm a notification",
    );
    assert.equal((await tx`select * from public.crm_clients where id=${client.id}`).length, 0);
    await as(alice);
    await tx`select public.finish_leave_email(${claimed.item.id},${claimed.item.lease},'failed')`;
    await as(admin);
    await tx`select public.retry_leave_email(${claimed.item.id})`;
    await denied(
      (sp) => sp`select public.admin_employee_access(${admin.employee},'employee',true)`,
      "administrator cannot lock themselves out",
    );
    await tx`select public.admin_employee_access(${bob.employee},'admin',true)`;
    await tx`select public.admin_employee_access(${bob.employee},'employee',true)`;
    await tx`select public.crm_save('clients',${client.id},${tx.json({ title: "Reassigned", status: "active", notes: "", owner_id: bob.employee, email: "", phone: "" })})`;
    const [register] = await tx`select public.attendance_register((now() at time zone 'Asia/Kolkata')::date) as value`;
    assert.equal(
      register.value.items.find((row) => row.employee_id === alice.employee).checkInLocation.latitude,
      location.latitude,
    );
    await as(alice);
    assert.equal(
      (await tx`select * from public.crm_clients where id=${client.id}`).length,
      0,
      "reassignment removes client access immediately",
    );
    assert.equal(
      (await tx`select * from public.crm_tasks where id=${task.id}`).length,
      0,
      "reassignment removes child access immediately",
    );
    await as(bob);
    assert.equal((await tx`select * from public.crm_tasks where id=${task.id}`).length, 1);
    await as(admin);
    await tx`select public.admin_employee_access(${bob.employee},'employee',false)`;
    await as(bob);
    assert.equal((await tx`select * from public.crm_clients`).length, 0, "inactive accounts denied");
    await tx.unsafe("reset role");
    await tx`update auth.sessions set created_at=now()-interval '2 days' where id=${alice.session}`;
    await as(alice);
    assert.equal(
      (await tx`select public.current_organization_id() as value`)[0].value,
      null,
      "old sessions cannot refresh past 3am",
    );
    assert.equal((await tx`select * from public.crm_clients`).length, 0);
    await denied(
      (sp) => sp`select public.record_attendance_punch('check_out',${randomUUID()},${tx.json(location)})`,
      "expired session cannot punch",
    );
    console.log(
      "PASS: location validation/idempotency, joining date, client reassignment, invoice privacy, role/status restrictions, email leases and session expiry.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log("All schema and fixture changes rolled back. No messages were sent.");
} finally {
  await db.end();
}
