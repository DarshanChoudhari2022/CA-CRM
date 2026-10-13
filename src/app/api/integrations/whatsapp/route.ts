import { z } from "zod";
import { boundedBody, secretMatches, verifySignature } from "@/modules/crm/automation/security";
import { automationOrganization, automationStore, ingest } from "@/modules/crm/automation/store";

const payloadSchema = z.object({
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          value: z.object({
            metadata: z.object({ phone_number_id: z.string() }),
            contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }) })).optional(),
            messages: z
              .array(
                z.object({
                  id: z.string().max(300),
                  from: z.string().regex(/^\d{6,20}$/),
                  type: z.string(),
                  text: z.object({ body: z.string().max(12000) }).optional(),
                  document: z
                    .object({ id: z.string(), filename: z.string().optional(), caption: z.string().optional() })
                    .optional(),
                  image: z.object({ id: z.string(), caption: z.string().optional() }).optional(),
                }),
              )
              .optional(),
            statuses: z.array(z.object({ id: z.string(), status: z.string() })).optional(),
          }),
        }),
      ),
    }),
  ),
});

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  if (
    query.get("hub.mode") !== "subscribe" ||
    !secretMatches(query.get("hub.verify_token"), process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN)
  )
    return new Response("Forbidden", { status: 403 });
  return new Response(query.get("hub.challenge"), { headers: { "Content-Type": "text/plain" } });
}
export async function POST(request: Request) {
  try {
    const raw = await boundedBody(request);
    if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), process.env.WHATSAPP_APP_SECRET))
      return Response.json({ error: "Invalid signature" }, { status: 401 });
    const payload = payloadSchema.parse(JSON.parse(raw));
    for (const entry of payload.entry)
      for (const change of entry.changes) {
        const v = change.value;
        if (v.metadata.phone_number_id !== process.env.WHATSAPP_PHONE_NUMBER_ID) continue;
        for (const message of v.messages ?? []) {
          const media = message.document ?? message.image;
          const body =
            message.text?.body ??
            `Attachment requires staff matching and review. ${JSON.stringify({ type: message.type, media })}`;
          await ingest(
            "whatsapp",
            message.id,
            `+${message.from}`,
            v.contacts?.find((c) => c.wa_id === message.from)?.profile.name.slice(0, 200) ?? "",
            body.slice(0, 12000),
          );
        }
        for (const status of v.statuses ?? []) {
          const predecessors: Record<string, string[]> = {
            delivered: ["sending", "accepted", "uncertain"],
            read: ["sending", "accepted", "delivered", "uncertain"],
            failed: ["sending", "accepted", "uncertain"],
          };
          if (!predecessors[status.status]) continue;
          const receipt = await automationStore()
            .from("crm_delivery_receipts")
            .upsert(
              { organization_id: automationOrganization(), provider_id: status.id, status: status.status },
              { onConflict: "organization_id,provider_id,status", ignoreDuplicates: true },
            );
          if (receipt.error) throw new Error("Receipt persistence failed");
          const { error } = await automationStore()
            .from("crm_dispatch")
            .update({ status: status.status, updated_at: new Date().toISOString() })
            .eq("organization_id", automationOrganization())
            .eq("channel", "whatsapp")
            .eq("provider_id", status.id)
            .in("status", predecessors[status.status]);
          if (error) throw new Error("Receipt persistence failed");
        }
      }
    return Response.json({ received: true });
  } catch {
    return Response.json({ error: "Webhook not processed; retry required" }, { status: 503 });
  }
}
