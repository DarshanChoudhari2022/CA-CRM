import { z } from "zod";
import type { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

const blankDate = z.union([z.literal(""), z.iso.date()]);
export const ledgerFilters = z.object({
  status: z.enum(["all", "draft", "cancelled", "paid", "partial", "unpaid"]).catch("all").default("all"),
  client: z
    .union([z.literal(""), z.uuid()])
    .catch("")
    .default(""),
  q: z.string().trim().max(100).catch("").default(""),
  from: blankDate.catch("").default(""),
  to: blankDate.catch("").default(""),
  page: z.coerce.number().int().min(1).max(100000).catch(1).default(1),
  size: z.coerce
    .number()
    .int()
    .refine((value) => [25, 50, 100].includes(value))
    .catch(25)
    .default(25),
});
const ledgerRow = z.object({
  id: z.uuid(),
  invoice_number: z.string(),
  client_id: z.uuid(),
  client_name: z.string(),
  invoice_date: z.iso.date(),
  due_date: z.iso.date().nullable(),
  created_at: z.string(),
  amount: z.number(),
  received: z.number(),
  balance: z.number(),
  status: z.enum(["draft", "cancelled", "paid", "partial", "unpaid"]),
});
const ledgerData = z.object({ total: z.number().int().nonnegative(), rows: z.array(ledgerRow) });
export const dashboardData = z.object({
  count: z.number(),
  billed: z.number(),
  collected: z.number(),
  outstanding: z.number(),
  average: z.number(),
  trend: z.array(z.object({ month: z.iso.date(), billed: z.number(), collected: z.number() })),
});
export type LedgerFilters = z.infer<typeof ledgerFilters>;
export type LedgerRow = z.infer<typeof ledgerRow>;
export type BillingTrend = z.infer<typeof dashboardData>["trend"];

export async function readLedger(client: Awaited<ReturnType<typeof createClient>>, filters: LedgerFilters) {
  await requireCrmIdentity();
  const { data, error } = await client.rpc("billing_invoice_ledger", {
    p_status: filters.status,
    p_client: filters.client || null,
    p_search: filters.q,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_page: filters.page,
    p_limit: filters.size,
  });
  if (error) throw new Error(error.message);
  return ledgerData.parse(data);
}

export const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
export const ledgerStatus = {
  paid: "Paid",
  partial: "Partially paid",
  unpaid: "Unpaid",
  draft: "Draft",
  cancelled: "Cancelled",
};
export function billingDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}
