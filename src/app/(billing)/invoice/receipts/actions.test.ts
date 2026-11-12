import { beforeEach, expect, it, vi } from "vitest";
import { recordReceipt } from "./actions";

const { requireCrmIdentity, rpc } = vi.hoisted(() => ({
  requireCrmIdentity: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/modules/identity/crm", () => ({ requireCrmIdentity }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const invoice = "00000000-0000-4000-8000-000000000001";

function payment(amount: string) {
  const form = new FormData();
  form.set("amount", amount);
  form.set("reference", " NEFT-001 ");
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  requireCrmIdentity.mockResolvedValue({});
  rpc.mockResolvedValue({ error: null });
});

it("authorizes before recording a receipt", async () => {
  requireCrmIdentity.mockRejectedValue(new Error("Denied"));
  await expect(recordReceipt(invoice, {}, payment("1.23"))).rejects.toThrow("Denied");
  expect(rpc).not.toHaveBeenCalled();
});

it.each(["0", "0.001", "1e3", "99999999999.99"])("rejects an invalid amount of %s", async (amount) => {
  expect(await recordReceipt(invoice, {}, payment(amount))).toHaveProperty("error");
  expect(rpc).not.toHaveBeenCalled();
});

it("passes the exact validated payment to the billing receipt RPC", async () => {
  expect(await recordReceipt(invoice, {}, payment("0.29"))).toEqual({ success: "Payment recorded." });
  expect(rpc).toHaveBeenCalledExactlyOnceWith("billing_record_receipt", {
    p_invoice: invoice,
    p_amount: 0.29,
    p_reference: "NEFT-001",
  });
});
