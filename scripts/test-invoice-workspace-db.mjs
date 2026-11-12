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
    await assert.rejects(
      tx.savepoint((q) => q`select public.billing_cancel_invoice(${invoice.id},'Fixture cancellation')`),
      /Paid invoice/,
    );
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
