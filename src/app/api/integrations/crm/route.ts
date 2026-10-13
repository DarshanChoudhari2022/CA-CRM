import { z } from "zod";
import { boundedBody, verifySignature } from "@/modules/crm/automation/security";
import { automationOrganization, automationStore, ingest } from "@/modules/crm/automation/store";

const eventSchema = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal("website"),
    data: z
      .object({
        name: z.string().min(1).max(200),
        email: z.email().max(320).optional(),
        phone: z
          .string()
          .regex(/^\+[1-9]\d{6,14}$/)
          .optional(),
        message: z.string().min(1).max(10000),
      })
      .refine((value) => !!(value.email || value.phone), "Email or phone required"),
  }),
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal("documents"),
    data: z.object({
      client_id: z.uuid(),
      documents: z
        .array(
          z.object({
            title: z.string().min(1).max(200),
            due_date: z.iso.date().optional(),
            notes: z.string().max(2000).optional(),
          }),
        )
        .min(1)
        .max(30),
    }),
  }),
  z.object({
    id: z.string().min(1).max(100),
    kind: z.literal("payment"),
    data: z.object({ invoice_id: z.uuid(), amount: z.number().positive().max(9999999999.99) }),
  }),
]);
// Server-to-server bridge for website forms, trusted payment adapters and n8n.
// Sign `${timestamp}.${rawBody}`; never expose the signing secret in a web page.
export async function POST(request: Request) {
  try {
    const raw = await boundedBody(request);
    const stamp = request.headers.get("x-crm-timestamp") ?? "";
    if (
      !/^\d{10}$/.test(stamp) ||
      Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
      !verifySignature(`${stamp}.${raw}`, request.headers.get("x-crm-signature"), process.env.CRM_WEBHOOK_SECRET)
    )
      return Response.json({ error: "Invalid signature or expired timestamp" }, { status: 401 });
    const event = eventSchema.safeParse(JSON.parse(raw));
    if (!event.success) return Response.json({ error: "Invalid event payload" }, { status: 400 });
    const e = event.data;
    if (e.kind === "website")
      return Response.json({
        id: await ingest(
          "website",
          e.id,
          e.data.email?.toLowerCase() ?? e.data.phone ?? "",
          e.data.name,
          e.data.message,
          e.data.phone,
        ),
      });
    const { data, error } = await automationStore().rpc("crm_external_update", {
      p_org: automationOrganization(),
      p_id: e.id,
      p_kind: e.kind,
      p_data: e.data,
    });
    if (error)
      return Response.json(
        { error: "Event rejected; check reference, amount and duplicate event data" },
        { status: 409 },
      );
    return Response.json(data);
  } catch {
    return Response.json({ error: "Event could not be processed" }, { status: 503 });
  }
}
