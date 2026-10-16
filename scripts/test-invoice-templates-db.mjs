import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { prepareAccessTest, setTestIdentity } from "./test-session.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), connect_timeout: 10 });
const rollback = new Error("rollback invoice template fixtures");
try {
  await sql.begin(async (tx) => {
    // Candidate migrations and all fixture data are rolled back on hosted checks.
    process.env.TEST_ACCESS_PREVIEW = "1";
    await prepareAccessTest(tx);
    const admin = randomUUID(),
      employee = randomUUID();
    const [org] =
      await tx`insert into public.organizations(name) values('Invoice templates rollback fixture') returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture'),(${employee},${`${employee}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin'),(${employee},${org.id},'Employee','employee')`;
    const [client] =
      await tx`insert into public.crm_clients(organization_id,title) values(${org.id},'Test customer') returning id`;
    const [otherOrg] =
      await tx`insert into public.organizations(name) values('Invoice foreign rollback fixture') returning id`;
    const [foreign] =
      await tx`insert into public.crm_clients(organization_id,title) values(${otherOrg.id},'Other customer') returning id`;
    const details = {
      template: "modern",
      documentType: "invoice",
      reference: "PSB/TEST/1",
      invoiceDate: "2026-10-16",
      address: "Test address",
      attention: "",
      gstin: "",
      placeOfSupply: "27 - Maharashtra",
      discountPercent: 10,
      items: [{ description: "Bookkeeping", details: "Monthly", hsnSac: "9982", quantity: 24, rate: 500 }],
    };
    const values = {
      title: "Services",
      status: "draft",
      notes: "",
      owner_id: "",
      client_id: client.id,
      amount: 10800,
      invoice_details: details,
    };
    await setTestIdentity(tx, admin);
    await tx.unsafe("set local role authenticated");
    const save = async (data = values, id = null) =>
      (await tx`select public.crm_save('invoices',${id},${sql.json(data)}) as id`)[0].id;
    const denied = async (data, label, id = null) => {
      await assert.rejects(
        () => tx.savepoint((sp) => sp`select public.crm_save('invoices',${id},${sql.json(data)})`),
        undefined,
        label,
      );
    };
    const id = await save();
    const [saved] = await tx`select amount,invoice_details from public.crm_invoices where id=${id}`;
    assert.equal(Number(saved.amount), 10800);
    assert.deepEqual(saved.invoice_details, details, "persist all customer and line-item details");
    const fractional = {
      ...details,
      reference: "ROUNDING",
      discountPercent: 0,
      items: [{ ...details.items[0], quantity: 0.1, rate: 0.05 }],
    };
    await save({ ...values, amount: 0.01, invoice_details: fractional });
    await denied({ ...values, amount: 10799 }, "database rejects manipulated total");
    await denied(
      { ...values, invoice_details: { ...details, template: "other" } },
      "database rejects unknown template",
    );
    await denied({ ...values, invoice_details: { ...details, items: [] } }, "database rejects empty item list");
    await denied(
      { ...values, invoice_details: { ...details, discountPercent: 100 } },
      "database rejects invalid discount",
    );
    await denied(
      { ...values, invoice_details: { ...details, items: [{ ...details.items[0], quantity: 0.001 }] } },
      "database rejects precision mismatch",
    );
    await denied(values, "human-readable references are unique within an organization");
    await denied(
      { ...values, client_id: foreign.id, invoice_details: { ...details, reference: "FOREIGN" } },
      "tenant scope is preserved",
    );
    await save({ ...values, status: "issued" }, id);
    await denied(
      { ...values, status: "issued", title: "Changed service after issue" },
      "issued printed service cannot change",
      id,
    );
    await denied(
      { ...values, status: "issued", invoice_details: { ...details, address: "Changed after issue" } },
      "issued billing details are immutable",
      id,
    );
    await save({ ...values, status: "issued", notes: "Internal note updated" }, id);
    const legacy = await save({
      title: "Legacy",
      status: "issued",
      owner_id: "",
      client_id: client.id,
      amount: 100,
      notes: "",
    });
    await save(
      { title: "Legacy", status: "issued", owner_id: "", client_id: client.id, amount: 100, notes: "Still supported" },
      legacy,
    );
    await setTestIdentity(tx, employee);
    await denied(
      { ...values, invoice_details: { ...details, reference: "EMPLOYEE" } },
      "employees cannot create invoices",
    );
    assert.equal((await tx`select id from public.crm_invoices`).length, 0, "employees cannot read PDF details");
    console.log(
      "PASS: invoice details persistence, exact totals, reference uniqueness, issued locks, legacy compatibility and administrator-only access.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log("Invoice migrations and fixtures rolled back; no live invoices changed.");
} finally {
  await sql.end();
}
