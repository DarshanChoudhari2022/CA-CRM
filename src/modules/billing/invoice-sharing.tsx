import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { inr } from "./ledger";

export async function InvoiceSharing({
  invoice,
  number,
  amount,
  client,
}: {
  invoice: string;
  number: string;
  amount: number;
  client: { title: string; email: string | null; phone: string | null };
}) {
  const { organizationId } = await requireCrmIdentity();
  const db = await createClient();
  const { data } = await db
    .from("billing_practice_settings")
    .select("settings")
    .eq("organization_id", organizationId)
    .eq("section", "sharing")
    .maybeSingle();
  const preferences = z
    .object({
      email_subject: z.string().optional(),
      email_body: z.string().optional(),
      whatsapp_body: z.string().optional(),
    })
    .safeParse(data?.settings).data;
  const values: Record<string, string> = { client: client.title, number, amount: inr.format(amount) };
  const expand = (value: string) => value.replace(/\{(client|number|amount)\}/g, (_, key: string) => values[key]);
  const subject = expand(preferences?.email_subject || "PSB invoice {number}").replace(/[\r\n]/g, " ");
  const message =
    "Hello {client}, PSB invoice {number} was issued for {amount}. Please contact us if you have a question.";
  const email = z.email().safeParse(client.email).data;
  const digits = client.phone?.replace(/\D/g, "") ?? "";
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return (
    <section className="billing-card section" id="invoice-sharing">
      <h2>Share invoice</h2>
      <p>Open a draft message to review and send. Download the PDF to attach it.</p>
      <div className="billing-toolbar">
        <a className="billing-button" href={`/crm/invoices/${invoice}/pdf`}>
          Download PDF
        </a>
        {email && (
          <a
            className="billing-button"
            href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(expand(preferences?.email_body || message))}`}
          >
            Compose email
          </a>
        )}
        {/^[1-9]\d{9,14}$/.test(phone) && (
          <a
            className="billing-button"
            href={`https://wa.me/${phone}?text=${encodeURIComponent(expand(preferences?.whatsapp_body || message))}`}
            target="_blank"
            rel="noreferrer"
          >
            Compose WhatsApp
          </a>
        )}
      </div>
    </section>
  );
}
