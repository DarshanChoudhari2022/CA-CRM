// Default: test installed hardening. --preview-migration: install the candidate
// only inside the same always-rolled-back transaction as the generated fixtures.
// Add --preview-integrity to layer the next attendance migration in that preview.
// Never records a migration version, contacts providers, or modifies real users.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { prepareAccessTest, setTestIdentity, testLocation } from "./test-session.mjs";

if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is required.");
const preview = process.argv.includes("--preview-migration");
const sql = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), connect_timeout: 10 });
const rollback = new Error("rollback security migration and fixtures");
const orgIds = [randomUUID(), randomUUID()];
let passed = false;

async function catalog(tx) {
  return {
    functions: await tx`select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
      md5(pg_get_functiondef(p.oid)) as definition, p.proacl::text as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind in ('f','p') order by p.proname, arguments`,
    policies: await tx`select policyname,qual,with_check from pg_policies
      where schemaname='public' and tablename='attendance_report_snapshots' order by policyname`,
    triggers: await tx`select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('attendance_days','attendance_corrections','leave_requests')
      and not t.tgisinternal order by c.relname,t.tgname`,
  };
}

try {
  const before = await sql.begin("read only", catalog);
  try {
    await sql.begin(async (tx) => {
      await prepareAccessTest(tx);
      if (process.argv.includes("--preview-admin-only"))
        await tx.unsafe(
          await readFile(new URL("../supabase/migrations/20261029090000_admin_only_crm.sql", import.meta.url), "utf8"),
        );
      // Avoid non-transactional nextval changes during rollback-only verification.
      await tx.unsafe(
        "alter table public.crm_invoices alter column invoice_number set default ('TEST-'||gen_random_uuid()::text)",
      );
      await tx.unsafe("set local time zone 'Asia/Kolkata'");
      await tx.unsafe("set local lock_timeout = '5s'");
      await tx.unsafe("set local statement_timeout = '30s'");
      if (preview) {
        const source = await readFile(
          new URL("../supabase/migrations/20261013100000_security_hardening.sql", import.meta.url),
          "utf8",
        );
        await tx.unsafe(source);
        if (process.argv.includes("--preview-integrity")) {
          const integrity = await readFile(
            new URL("../supabase/migrations/20261013101000_attendance_integrity.sql", import.meta.url),
            "utf8",
          );
          await tx.unsafe(integrity);
        }
      }

      const denied = async (query, label, code = "P0001", message) => {
        await assert.rejects(
          () => tx.savepoint(query),
          (error) => error.code === code && (!message || [message].flat().some((text) => error.message.includes(text))),
          label,
        );
      };
      const asUser = async (user, role = "authenticated") => {
        await tx.unsafe("reset role");
        await setTestIdentity(tx, user);
        // Fixed allowlist only; never interpolate a user-controlled role name.
        assert.ok(["anon", "authenticated", "service_role"].includes(role));
        await tx.unsafe(`set local role ${role}`);
      };

      const internal = [
        "portal_access_allowed()",
        "attendance_require_portal_access()",
        "assert_admin()",
        "month_is_closed(uuid,date)",
        "day_context(public.employees,date)",
        "leave_working_days(public.employees,date,date,public.leave_portion)",
        "on_employee_password_changed()",
        "crm_invoice_guard()",
        "crm_require_onboarded()",
        "crm_queue_reminders()",
        "reconcile_attendance_date(date,uuid)",
        "reconcile_attendance_month(uuid,date)",
      ];
      for (const signature of internal) {
        const [acl] = await tx`select
          has_function_privilege('anon',('public.'||${signature})::regprocedure,'EXECUTE') as anon,
          has_function_privilege('authenticated',('public.'||${signature})::regprocedure,'EXECUTE') as member`;
        assert.equal(acl.anon, false, `anon cannot execute ${signature}`);
        assert.equal(acl.member, false, `authenticated cannot execute ${signature}`);
      }
      const [dashboardAcl] =
        await tx`select has_function_privilege('anon','public.dashboard_snapshot()','EXECUTE') as anon,
        has_function_privilege('authenticated','public.dashboard_snapshot()','EXECUTE') as member`;
      assert.equal(dashboardAcl.anon, false, "anonymous legacy dashboard denied");
      assert.equal(dashboardAcl.member, true, "authenticated legacy dashboard remains callable with identity guard");
      const cores = await tx`select p.proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as member from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('record_attendance_punch_core','request_attendance_correction_core',
        'submit_leave_request_core','decide_leave_request_core','close_attendance_month_core')`;
      for (const core of cores) {
        assert.equal(core.anon, false, `anonymous ${core.proname} denied`);
        assert.equal(core.member, false, `authenticated ${core.proname} denied`);
      }
      for (const role of ["anon", "authenticated"]) {
        await asUser(null, role);
        await denied(
          (sp) => sp`select public.reconcile_attendance_date(current_date,${orgIds[0]}::uuid)`,
          `${role} reconciliation date denied by privilege`,
          "42501",
        );
        await denied(
          (sp) => sp`select public.reconcile_attendance_month(${orgIds[0]}::uuid,current_date)`,
          `${role} reconciliation month denied by privilege`,
          "42501",
        );
      }
      await tx.unsafe("reset role");

      for (const id of orgIds)
        await tx`insert into public.organizations(id,name) values(${id},'Security rollback fixture')`;
      const users = {};
      for (const [name, role, organization] of [
        ["admin", "admin", orgIds[0]],
        ["manager", "employee", orgIds[0]],
        ["member", "employee", orgIds[0]],
        ["unrelated", "employee", orgIds[0]],
        ["foreign", "employee", orgIds[1]],
      ]) {
        const user = randomUUID();
        const [branch] =
          await tx`insert into public.branches(organization_id,name) values(${organization},${name}) returning id`;
        const [policy] = await tx`insert into public.attendance_policies(organization_id,name,effective_from)
          values(${organization},${name},current_date-30) returning id`;
        await tx`insert into auth.users(id,email,encrypted_password) values(${user},${`${user}@example.invalid`},'security-fixture')`;
        await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${user},${organization},${name},${role})`;
        const [employee] =
          await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on)
          values(${organization},${user},${name},${name},${`${user}@example.invalid`},${branch.id},${policy.id},current_date-30) returning id`;
        await tx`update public.profiles set employee_id=${employee.id} where user_id=${user}`;
        users[name] = { user, employee: employee.id, branch: branch.id, policy: policy.id };
      }
      await tx`update public.employees set manager_id=${users.manager.employee} where id=${users.member.employee}`;
      for (const id of orgIds)
        await tx`insert into public.attendance_report_snapshots(organization_id,month_start,version,summary,detail)
        values(${id},date_trunc('month',current_date)::date,1,'{}','[{"employeeName":"whole-firm fixture"}]')`;
      const [ticket] = await tx`insert into public.crm_support(organization_id,title,owner_id)
        values(${orgIds[0]},'Security fixture ticket',${users.member.employee}) returning id`;
      await tx`insert into public.crm_outbox(organization_id,source_id,actor_user_id,channel,recipient,subject,body)
        values(${orgIds[0]},${ticket.id},${users.admin.user},'gmail','fixture@example.invalid','Fixture','No message sent')`;
      const [leaveType] = await tx`insert into public.leave_types(organization_id,name,code)
        values(${orgIds[0]},'Security fixture','SECURITY') returning id`;
      const [futureDay] =
        await tx`select d::date as day from generate_series(current_date+1,current_date+7,'1 day'::interval) d
        where extract(isodow from d)<6 order by d limit 1`;
      for (const name of ["admin", "member"]) {
        await tx`insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated)
          values(${orgIds[0]},${users[name].employee},${leaveType.id},extract(year from ${futureDay.day}::date),10)`;
      }
      const [leave] =
        await tx`insert into public.leave_requests(organization_id,employee_id,leave_type_id,start_date,end_date,requested_days,reason,requested_by,request_id)
        values(${orgIds[0]},${users.member.employee},${leaveType.id},current_date,current_date,1,'Security test request',${users.member.user},${randomUUID()}) returning id`;

      await asUser(users.admin.user);
      assert.equal(
        (await tx`select id from public.attendance_report_snapshots`).length,
        1,
        "onboarded admin sees own-firm snapshot only",
      );
      assert.equal((await tx`select id from public.crm_outbox`).length, 1, "onboarded admin sees own-firm outbox");
      const [crossTenant] = await tx`select public.can_view_employee(${users.foreign.employee}) as view,
        public.is_reviewer_for(${users.foreign.employee}) as review`;
      assert.equal(crossTenant.view, false, "admin canview cannot cross tenant");
      assert.equal(crossTenant.review, false, "admin reviewer cannot cross tenant");
      await tx`select public.admin_update_employee(${users.unrelated.employee},null,'Verified','employee',true,null)`;

      await asUser(users.manager.user);
      assert.equal(
        (await tx`select id from public.attendance_report_snapshots`).length,
        0,
        "manager cannot read whole-firm snapshots",
      );
      const [team] = await tx`select public.can_view_employee(${users.member.employee}) as own_team,
        public.can_view_employee(${users.unrelated.employee}) as other_team,public.is_reviewer_for(${users.member.employee}) as reviewer`;
      assert.equal(team.own_team, false, "reporting relationship does not grant employee visibility");
      assert.equal(team.other_team, false, "manager cannot view unrelated employee");
      assert.equal(team.reviewer, false, "only administrators can approve requests");
      await asUser(users.member.user);
      assert.equal(
        (await tx`select id from public.attendance_report_snapshots`).length,
        0,
        "employee cannot read whole-firm snapshots",
      );
      assert.ok(
        (await tx`select public.dashboard_snapshot() as value`)[0].value.today,
        "onboarded dashboard remains usable",
      );
      await tx`select public.record_attendance_punch('check_in',${randomUUID()},${sql.json(testLocation())})`;
      // Prove the same leave inputs are valid before negative authorization tests;
      // rollback the positive request so later denial cannot be caused by overlap.
      const undoPositive = new Error("rollback positive leave probe");
      for (const name of ["admin", "member"]) {
        await asUser(users[name].user);
        await assert.rejects(
          () =>
            tx.savepoint(async (sp) => {
              const [created] =
                await sp`select public.submit_leave_request(${leaveType.id},${futureDay.day}::date,${futureDay.day}::date,
            'full_day','Security test leave',${randomUUID()}) as id`;
              assert.ok(created.id, "onboarded caller can submit valid leave inputs");
              throw undoPositive;
            }),
          (error) => error === undoPositive,
        );
      }

      for (const condition of ["inactive", "password_required", "employee_inactive"]) {
        await tx.unsafe("reset role");
        await setTestIdentity(tx, null);
        await tx`update public.profiles set active=${condition !== "inactive"},password_change_required=${condition === "password_required"}
          where user_id in (${users.admin.user},${users.member.user})`;
        await tx`update public.employees set active=${condition !== "employee_inactive"}
          where id in (${users.admin.employee},${users.member.employee})`;
        for (const name of ["admin", "member"]) {
          const actor = users[name];
          await asUser(actor.user);
          const [helpers] =
            await tx`select public.current_organization_id() as org,public.current_employee_id() as employee,
            public.has_portal_role(array['admin','employee']::public.portal_role[]) as role,
            public.can_view_employee(${users.member.employee}) as view,public.is_reviewer_for(${users.member.employee}) as review`;
          assert.deepEqual(
            helpers,
            { org: null, employee: null, role: false, view: false, review: false },
            `${condition} protected helpers fail closed`,
          );
          for (const table of [
            "employees",
            "attendance_days",
            "leave_requests",
            "crm_support",
            "crm_outbox",
            "attendance_report_snapshots",
          ]) {
            assert.equal(
              (await tx.unsafe(`select id from public.${table}`)).length,
              0,
              `${condition} cannot read ${table}`,
            );
          }
          assert.equal(
            (await tx`select public.crm_financial_summary() as value`)[0].value,
            null,
            `${condition} financial summary blocked`,
          );
          await denied((sp) => sp`select public.dashboard_snapshot()`, `${condition} legacy dashboard blocked`);
          const writeGuard =
            condition === "password_required"
              ? ["Active workspace access and password change required", "Active employee access required"]
              : undefined;
          await denied(
            (sp) => sp`select public.record_attendance_punch('check_out',${randomUUID()},${sql.json(testLocation())})`,
            `${condition} direct-profile punch blocked`,
            "P0001",
            writeGuard,
          );
          await denied(
            (sp) =>
              sp`select public.request_attendance_correction(current_date,'10:30','19:30','Security test correction',${randomUUID()})`,
            `${condition} direct-profile correction blocked`,
            "P0001",
            writeGuard,
          );
          await denied(
            (sp) =>
              sp`select public.submit_leave_request(${leaveType.id},${futureDay.day}::date,${futureDay.day}::date,'full_day','Security test leave',${randomUUID()})`,
            `${condition} direct-profile leave blocked`,
            "P0001",
            writeGuard,
          );
          await denied(
            (sp) => sp`select public.crm_save('tasks',null,'{"title":"Forbidden","status":"todo"}'::jsonb)`,
            `${condition} CRM write blocked`,
          );
          if (name === "admin") {
            await denied(
              (sp) =>
                sp`select public.admin_update_employee(${users.unrelated.employee},null,'Forbidden','admin',true,null)`,
              `${condition} role modification blocked`,
            );
            await denied(
              (sp) =>
                sp`select public.decide_leave_request(${leave.id},'rejected','Security test rejection',${randomUUID()})`,
              `${condition} approval blocked`,
            );
          }
          if (condition === "password_required") {
            const [identity] = await tx`select * from public.current_portal_identity()`;
            assert.equal(
              identity.userId,
              actor.user,
              "onboarding identity remains available for login/account-reset checks",
            );
            assert.equal(identity.role, name === "admin" ? "admin" : "employee", "onboarding identity retains role");
            const [self] = await tx`select password_change_required from public.profiles where user_id=${actor.user}`;
            assert.equal(self.password_change_required, true, "self-profile onboarding check remains available");
          }
        }
      }

      await tx.unsafe("reset role");
      await setTestIdentity(tx, null);
      await tx`update public.employees set active=true where id in (${users.admin.employee},${users.member.employee})`;
      await tx`update public.profiles set active=true,password_change_required=true where user_id in (${users.admin.user},${users.member.user})`;
      await tx`update auth.users set encrypted_password='security-fixture-changed' where id in (${users.admin.user},${users.member.user})`;
      await asUser(users.admin.user);
      assert.equal(
        (await tx`select public.has_portal_role(array['admin']::public.portal_role[]) as allowed`)[0].allowed,
        true,
        "password-change trigger restores administrator role helper; no onboarding loop",
      );
      assert.equal(
        (await tx`select id from public.attendance_report_snapshots`).length,
        1,
        "password change restores protected reads",
      );
      await tx`select public.admin_update_employee(${users.unrelated.employee},null,'Restored','employee',true,null)`;

      await asUser(null, "service_role");
      await denied(
        (sp) => sp`select public.reconcile_attendance_date(current_date+2,${orgIds[0]})`,
        "service cannot reconcile future dates",
      );
      await denied(
        (sp) =>
          sp`select public.reconcile_attendance_month(${orgIds[0]},(date_trunc('month',current_date)+interval '2 months')::date)`,
        "service cannot reconcile future months",
      );
      const [reconciled] = await tx`select public.reconcile_attendance_date(current_date-1,${orgIds[0]}) as count`;
      assert.equal(reconciled.count, 4, "trusted service reconciliation still works without user subject");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
    passed = true;
  } finally {
    const after = await sql.begin("read only", catalog);
    assert.deepEqual(after, before, "rollback restores function bodies, privileges, policies and triggers");
    const [remaining] =
      await sql`select count(*)::int as count from public.organizations where id=any(${orgIds}::uuid[])`;
    assert.equal(remaining.count, 0, "all generated fixtures rolled back");
  }
  assert.ok(passed);
  console.log(
    "Passed security checks: reconciliation/internal ACLs, future-date guards, admin-only snapshots, tenant/team scoping, inactive/onboarding read/write denial, password-change recovery. Migration and fixtures rolled back; hosted schema unchanged.",
  );
} catch (error) {
  // PostgreSQL errors can contain connection details or SQL values; never print them.
  console.error(
    error instanceof assert.AssertionError
      ? `Security assertion failed: ${error.message.split("\n")[0]}`
      : `Security test failed (${error.code ?? "unexpected error"}).`,
  );
  if (error instanceof TypeError || error instanceof ReferenceError) console.error(error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
