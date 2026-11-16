import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { setTestIdentity } from "./test-session.mjs";

const db = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback invoice workspace verification");
try {
  await db.begin(async (tx) => {
    await tx.unsafe("set local lock_timeout='5s'; set local statement_timeout='25s'");
    if (process.argv.includes("--preview")) {
      const directory = new URL("../supabase/migrations/", import.meta.url);
      const files = (await readdir(directory)).filter((name) => /^202611121/.test(name)).sort();
      for (const file of files) await tx.unsafe(await readFile(new URL(file, directory), "utf8"));
    }
    if (process.argv.includes("--history-preview")) {
      await tx.unsafe(
        await readFile(
          new URL("../supabase/migrations/20261116100000_invoice_change_history.sql", import.meta.url),
          "utf8",
        ),
      );
    }
    await tx.unsafe(
      "alter table public.crm_invoices alter column invoice_number set default ('TEST-'||gen_random_uuid()::text)",
    );
    const [org] = await tx`insert into public.organizations(name) values('Invoice rollback fixture') returning id`;
    const [other] = await tx`insert into public.organizations(name) values('Other invoice fixture') returning id`;
    const [client] =
      await tx`insert into public.crm_clients(organization_id,title) values(${org.id},'Demo client') returning id`;
    const [foreignClient] =
      await tx`insert into public.crm_clients(organization_id,title) values(${other.id},'Other client') returning id`;
    const roles = [];
    for (const role of ["admin", "employee"]) {
      const id = randomUUID();
      await tx`insert into auth.users(id,email,encrypted_password) values(${id},${`${id}@example.invalid`},'fixture')`;
      await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${id},${org.id},${role},${role})`;
      roles.push(id);
    }
    const [admin, employee] = roles;
    const [{ today }] = await tx`select (now() at time zone 'Asia/Kolkata')::date::text today`;
    const [filing] = await tx`insert into public.crm_compliance(organization_id,title,status,client_id,due_date)
      values(${org.id},'Filed fixture','filed',${client.id},${today}) returning id`;
    const [invoice] = await tx`insert into public.crm_invoices(organization_id,title,status,client_id,amount)
      values(${org.id},'Issued fixture','issued',${client.id},100) returning id`;
    await tx`insert into public.crm_invoices(organization_id,title,status,client_id,amount)
      values(${other.id},'Other invoice','issued',${foreignClient.id},999)`;
    const as = async (person) => {
      await tx.unsafe("reset role");
      await setTestIdentity(tx, person);
      await tx.unsafe("set local role authenticated");
    };
    await as(employee);
    await assert.rejects(
      tx.savepoint((q) => q`select public.billing_invoice_dashboard(${today},${today})`),
      /Administrator/i,
    );
    await as(admin);
    const [service] = await tx`select public.billing_save_service(null,'Fixture service','','',75,0,true) id`;
    const [draft] = await tx`select public.billing_generate_filing_draft(${filing.id},${service.id}) id`;
    const [retry] = await tx`select public.billing_generate_filing_draft(${filing.id},${service.id}) id`;
    assert.equal(draft.id, retry.id);
    const [advance] =
      await tx`select public.billing_record_advance(${client.id},${today},60,'UPI','advance-fixture','') id`;
    const request = randomUUID();
    const [allocation] = await tx`select public.billing_apply_advance(${advance.id},${invoice.id},50,${request}) id`;
    const [allocationRetry] =
      await tx`select public.billing_apply_advance(${advance.id},${invoice.id},50,${request}) id`;
    assert.equal(allocation.id, allocationRetry.id);
    await assert.rejects(
      tx.savepoint((q) => q`select public.billing_apply_advance(${advance.id},${invoice.id},11,${randomUUID()})`),
      /remaining balance/,
    );
    const [ledger] = await tx`select public.billing_invoice_ledger('all',null,'',null,null,1,25) value`;
    assert.equal(ledger.value.total, 2);
    assert.deepEqual(
      ledger.value.rows.filter((r) => r.id === invoice.id).map((r) => [r.status, r.received, r.balance]),
      [["partial", 50, 50]],
    );
    const [{ value }] = await tx`select public.billing_invoice_dashboard(${today},${today}) value`;
    assert.deepEqual([value.count, value.billed, value.collected, value.outstanding], [1, 100, 50, 50]);
    const [feature] =
      await tx`select to_regprocedure('public.billing_confirmed_invoice_change(uuid,uuid,text,text,uuid,timestamptz,jsonb)') is not null as installed`;
    if (feature.installed) {
      const [form] =
        await tx`select updated_at::text as version, to_jsonb(i) as values from public.crm_invoices i where id=${draft.id}`;
      await assert.rejects(
        tx.savepoint(
          (q) => q`select public.billing_confirmed_invoice_change(${admin},${draft.id},'delete','Fixture deletion')`,
        ),
        /permission denied/,
      );
      await assert.rejects(
        tx.savepoint((q) => q`update public.crm_invoices set title='Unconfirmed' where id=${draft.id}`),
      );
      await tx.unsafe("set local role service_role");
      await tx`select public.billing_confirmed_invoice_change(${admin},${draft.id},'edit',null,${randomUUID()},${form.version}::text::timestamptz,${tx.json(
        {
          ...form.values,
          title: "Edited fixture",
          due_date: form.values.due_date ?? "",
        },
      )})`;
      await assert.rejects(
        tx.savepoint(
          (q) =>
            q`select public.billing_confirmed_invoice_change(${admin},${invoice.id},'cancel','Fixture cancellation')`,
        ),
        /recorded payments/,
      );
      await tx`select public.billing_confirmed_invoice_change(${admin},${draft.id},'delete','Fixture deletion')`;
      await as(admin);
      const [history] =
        await tx`select actor_user_id,metadata from public.audit_logs where entity_id=${draft.id}::text and action='invoice_history_delete'`;
      assert.equal(history.actor_user_id, admin);
      assert.equal(history.metadata.before.status, "draft");
      assert.equal(history.metadata.after.status, "void");
      const [edit] =
        await tx`select metadata from public.audit_logs where entity_id=${draft.id}::text and action='invoice_history_edit'`;
      assert.equal(edit.metadata.after.title, "Edited fixture");
      await as(employee);
      assert.equal((await tx`select id from public.audit_logs where entity_id=${draft.id}::text`).length, 0);
    } else {
      await assert.rejects(
        tx.savepoint((q) => q`select public.billing_cancel_invoice(${invoice.id},'Fixture cancellation')`),
        /Paid invoice/,
      );
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log(
    "Verified tenant and role isolation, invoice totals, retry-safe filing drafts, advance allocation, and paid-invoice cancellation.",
  );
} finally {
  await db.end();
}
