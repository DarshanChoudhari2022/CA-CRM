import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), client: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/modules/identity/session", () => ({ requireIdentity: mocks.identity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { recordPayment } from "./actions";

const invoiceId = "11111111-1111-4111-8111-111111111111";
function paymentForm(amount: string) {
  const form = new FormData();
  form.set("invoice", invoiceId);
  form.set("amount", amount);
  form.set("reference", " BANK-REF ");
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ role: "admin" });
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("manual invoice payment action", () => {
  it.each(["1.001", "1.005", "0.009", "123.4567", "0", "-1", "NaN", "Infinity"])(
    "rejects invalid amount %s before database access",
    async (amount) => {
      expect(await recordPayment({}, paymentForm(amount))).toEqual({ error: "Check the payment details." });
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    },
  );

  it.each(["1", "1.2", "1.23", "0.01", "0.29", "10.10"])("records exact amount %s", async (amount) => {
    expect(await recordPayment({}, paymentForm(amount))).toEqual({ success: "Payment recorded." });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("crm_record_payment", {
      p_invoice: invoiceId,
      p_amount: Number(amount),
      p_reference: "BANK-REF",
    });
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/crm/invoices");
  });

  it("keeps the administrator boundary", async () => {
    mocks.identity.mockResolvedValue({ role: "employee" });
    expect(await recordPayment({}, paymentForm("1.23"))).toEqual({ error: "Administrator access required." });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("returns RPC errors without revalidating", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "Payment exceeds outstanding amount" } });
    expect(await recordPayment({}, paymentForm("1.23"))).toEqual({ error: "Payment exceeds outstanding amount" });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});

// Opt in with INVOICE_PAYMENT_DB_TEST=1 and SUPABASE_DB_URL. All DDL and fixtures roll back, even on failure.
it.skipIf(process.env.INVOICE_PAYMENT_DB_TEST !== "1")(
  "RPC rejects excess precision without payments or audit writes",
  async () => {
    const url = process.env.SUPABASE_DB_URL;
    if (!url) throw new Error("SUPABASE_DB_URL is required");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
    if (process.env.TEST_DATABASE_LOCAL === "1" && !local) throw new Error("Local test database must use loopback");
    const sql = postgres(url, {
      max: 1,
      ssl: process.env.TEST_DATABASE_LOCAL === "1" && local ? false : "require",
      connect_timeout: 10,
    });
    const rollback = new Error("rollback payment precision regression");
    try {
      await expect(
        sql.begin(async (tx) => {
          const migration = await readFile("supabase/migrations/20261026233000_payment_precision.sql", "utf8");
          await tx.unsafe(migration);
          const admin = randomUUID();
          const [org] =
            await tx`insert into public.organizations(name) values('Payment precision rollback fixture') returning id`;
          await tx`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture')`;
          await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin')`;
          await tx`insert into auth.sessions(id,user_id,created_at,updated_at) values(${admin},${admin},now(),now())`;
          const [client] =
            await tx`insert into public.crm_clients(organization_id,title) values(${org.id},'Test customer') returning id`;
          const [invoice] =
            await tx`insert into public.crm_invoices(organization_id,client_id,title,status,amount) values(${org.id},${client.id},'Precision test','issued',100) returning id`;
          await tx`select set_config('request.jwt.claim.sub',${admin},true),set_config('request.jwt.claims',${JSON.stringify({ sub: admin, session_id: admin, role: "authenticated" })},true)`;
          await tx.unsafe("set local role authenticated");
          for (const amount of ["1.001", "1.005", "0.009", "12.3456"]) {
            await expect(
              tx.savepoint(
                (sp) => sp`select public.crm_record_payment(${invoice.id},${amount}::numeric,${`BAD-${amount}`})`,
              ),
            ).rejects.toThrow(/decimal places/i);
          }
          expect(await tx`select id from public.crm_payments where invoice_id=${invoice.id}`).toHaveLength(0);
          await tx`select public.crm_record_payment(${invoice.id},0.29,'VALID-29')`;
          await tx`select public.crm_record_payment(${invoice.id},1.23,'VALID-123')`;
          const [total] =
            await tx`select sum(amount)::text as amount from public.crm_payments where invoice_id=${invoice.id}`;
          expect(total.amount).toBe("1.52");
          await expect(
            tx.savepoint((sp) => sp`select public.crm_record_payment(${invoice.id},99,'OVERPAY')`),
          ).rejects.toThrow(/outstanding/i);
          await expect(
            tx.savepoint((sp) => sp`select public.crm_record_payment(${invoice.id},1,'VALID-123')`),
          ).rejects.toThrow(/unique|duplicate/i);
          await tx.unsafe("reset role");
          const [audit] =
            await tx`select count(*)::int as count from public.audit_logs where organization_id=${org.id} and action='payment_recorded'`;
          expect(audit.count).toBe(2);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await sql.end();
    }
  },
  30000,
);
