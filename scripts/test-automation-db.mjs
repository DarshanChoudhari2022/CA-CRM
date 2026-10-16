import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { prepareAccessTest, setTestIdentity } from "./test-session.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback automation fixtures");
try {
  await sql.begin(async (tx) => {
    await prepareAccessTest(tx);
    const version = "20261013150000";
    const [installed] = await tx`select version from supabase_migrations.schema_migrations where version=${version}`;
    if (!installed)
      await tx.unsafe(
        await readFile(new URL("../supabase/migrations/20261013150000_automation_engine.sql", import.meta.url), "utf8"),
      );
    const [org] = await tx`insert into public.organizations(name) values('Automation rollback fixture') returning id`;
    const admin = randomUUID(),
      employee = randomUUID();
    for (const [id, role] of [
      [admin, "admin"],
      [employee, "employee"],
    ]) {
      await tx`insert into auth.users(id,email,encrypted_password) values(${id},${`${id}@example.invalid`},'fixture')`;
      await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${id},${org.id},'Fixture',${role})`;
    }
    await setTestIdentity(tx, admin);
    await tx.unsafe("set local role authenticated");
    await tx`select public.crm_automation_config(true,false,'Approved office contact information')`;
    await tx`select public.crm_channel_permission('gmail','client@example.invalid',true,'Test fixture consent')`;
    await tx.unsafe("reset role");
    const [client] =
      await tx`insert into public.crm_clients(organization_id,title,email) values(${org.id},'Fixture client','client@example.invalid') returning id`;
    const [invoice] =
      await tx`insert into public.crm_invoices(organization_id,client_id,title,status,amount,due_date) values(${org.id},${client.id},'Fixture invoice','issued',100,current_date) returning id`;
    const [early] =
      await tx`select public.crm_schedule_dispatch(${org.id},(current_date+time '08:00') at time zone 'Asia/Kolkata') as n`;
    assert.equal(early.n, 0, "No reminders before configured morning windows");
    const [queued] =
      await tx`select public.crm_schedule_dispatch(${org.id},(current_date+time '12:00') at time zone 'Asia/Kolkata') as n`;
    assert.equal(queued.n, 1);
    const [repeat] =
      await tx`select public.crm_schedule_dispatch(${org.id},(current_date+time '12:00') at time zone 'Asia/Kolkata') as n`;
    assert.equal(repeat.n, 0, "Repeated schedules do not duplicate messages");
    const [msg] = await tx`select * from public.crm_dispatch where organization_id=${org.id}`;
    assert.equal(msg.status, "review", "New org never starts sending automatically");
    await setTestIdentity(tx, employee);
    await tx.unsafe("set local role authenticated");
    assert.equal(
      (await tx`select * from public.crm_dispatch where organization_id=${org.id}`).length,
      0,
      "Employee cannot read private outbound queue",
    );
    let denied = false;
    try {
      await tx.savepoint((sp) => sp`select public.crm_dispatch_review(${msg.id},true,'Unsafe approval')`);
    } catch {
      denied = true;
    }
    assert.ok(denied, "Employee cannot approve dispatch");
    await tx.unsafe("reset role");
    await setTestIdentity(tx, admin);
    await tx`select public.crm_dispatch_review(${msg.id},true,'Reviewed message')`;
    const payment = { invoice_id: invoice.id, amount: 40 };
    const [partial] =
      await tx`select public.crm_external_update(${org.id},'fixture-partial','payment',${sql.json(payment)}) as result`;
    assert.equal(Number(partial.result.outstanding), 60, "Partial payment stays outstanding");
    const [duplicate] =
      await tx`select public.crm_external_update(${org.id},'fixture-partial','payment',${sql.json(payment)}) as result`;
    assert.deepEqual(duplicate.result, partial.result, "Payment webhook is idempotent");
    denied = false;
    try {
      await tx.savepoint(
        (sp) =>
          sp`select public.crm_external_update(${org.id},'fixture-overpay','payment',${sql.json({ invoice_id: invoice.id, amount: 61 })})`,
      );
    } catch {
      denied = true;
    }
    assert.ok(denied, "Overpayment rejected");
    await tx`select public.crm_external_update(${org.id},'fixture-final','payment',${sql.json({ invoice_id: invoice.id, amount: 60 })})`;
    await tx`select * from public.crm_claim_dispatch(${org.id},array['gmail'])`;
    const [cancelled] = await tx`select status from public.crm_dispatch where id=${msg.id}`;
    assert.equal(cancelled.status, "cancelled", "Paid invoice cancels unsent reminder");
    const [incoming] =
      await tx`select public.crm_ingest(${org.id},'gmail','mail-id','client@example.invalid','Client','Please help') as id`;
    const [incomingAgain] =
      await tx`select public.crm_ingest(${org.id},'gmail','mail-id','client@example.invalid','Client','Please help') as id`;
    assert.equal(incoming.id, incomingAgain.id);
    const [claim] = await tx`select * from public.crm_claim_inbound(${org.id})`;
    assert.equal(claim.id, incoming.id);
    assert.equal(
      (await tx`select * from public.crm_claim_inbound(${org.id})`).length,
      0,
      "Leased enquiry cannot be claimed twice",
    );
    await tx`select public.crm_finish_inbound(${claim.id},${claim.lease},'A CA will review your question.','needs_review')`;
    const docsPayload = { client_id: client.id, documents: [{ title: "Bank statement" }] };
    const [docRequest] =
      await tx`select public.crm_external_update(${org.id},'doc-request','documents',${sql.json(docsPayload)}) as result`;
    const docId = docRequest.result.documents[0];
    await tx`insert into public.crm_collection_links(token_hash,organization_id,document_id,expires_at) values('fixture-token',${org.id},${docId},now()+interval '1 day')`;
    const [upload] =
      await tx`select public.crm_collection_reserve('fixture-token','statement.pdf','application/pdf',20) as result`;
    denied = false;
    try {
      await tx.savepoint((sp) => sp`select public.crm_collection_finish('fixture-token')`);
    } catch {
      denied = true;
    }
    assert.ok(denied, "Missing Storage file cannot be marked received");
    await tx`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${upload.result.path},${sql.json({ size: 20, mimetype: "application/pdf" })})`;
    await tx`select public.crm_collection_finish('fixture-token')`;
    const [received] = await tx`select status from public.crm_documents where id=${docId}`;
    assert.equal(received.status, "received", "Collection never automatically verifies a document");
    denied = false;
    try {
      await tx.savepoint(
        (sp) => sp`select public.crm_collection_reserve('fixture-token','statement.pdf','application/pdf',20)`,
      );
    } catch {
      denied = true;
    }
    assert.ok(denied, "Completed collection link cannot be reused");
    await tx`select public.crm_channel_permission('whatsapp','+919999999999',true,'Fixture permission')`;
    await tx`select public.crm_ingest(${org.id},'whatsapp','stop-id','+919999999999','Fixture','STOP')`;
    const [stopped] =
      await tx`select allowed from public.crm_channel_permissions where organization_id=${org.id} and recipient='+919999999999'`;
    assert.equal(stopped.allowed, false, "Inbound opt-out revokes recipient permission");
    await tx`select public.crm_automation_config(false,false,'')`;
    assert.equal(
      (await tx`select * from public.crm_claim_dispatch(${org.id},array['gmail'])`).length,
      0,
      "Pause blocks dispatch",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log("Automation database checks passed; fixtures rolled back.");
} finally {
  await sql.end();
}
