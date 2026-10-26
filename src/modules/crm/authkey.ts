import { z } from "zod";

export const leaveTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^\r\n{}]+$/),
  dates: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[^\r\n{}]+$/),
  status: z.enum(["approved", "rejected"]),
});
export type LeaveTemplate = z.infer<typeof leaveTemplateSchema>;

export function whatsappProvider() {
  return process.env.WHATSAPP_PROVIDER?.trim() || "meta";
}

export function authkeyReady() {
  return (
    Boolean(process.env.AUTHKEY_API_KEY?.trim()) &&
    /^\d+$/.test(process.env.AUTHKEY_TEMPLATE_ID ?? "") &&
    (process.env.AUTHKEY_COUNTRY_CODE || "91") === "91"
  );
}

export function leaveTemplateText(values: LeaveTemplate) {
  const v = leaveTemplateSchema.parse(values);
  return `Dear ${v.name}, your leave request for ${v.dates} has been ${v.status}. Please contact PSB Associates if you need assistance.`;
}

export async function sendAuthkeyLeave(recipient: string, values: LeaveTemplate): Promise<string> {
  if (!authkeyReady()) throw new Error("Authkey is not configured.");
  const v = leaveTemplateSchema.parse(values);
  const mobile = /^(?:\+91|91)?([6-9]\d{9})$/.exec(recipient)?.[1];
  if (!mobile) throw new Error("Enter a valid Indian mobile number.");
  const response = await fetch("https://console.authkey.io/restapi/requestjson.php", {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Basic ${process.env.AUTHKEY_API_KEY?.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      country_code: "91",
      mobile,
      wid: process.env.AUTHKEY_TEMPLATE_ID,
      type: "text",
      bodyValues: { "1": v.name, "2": v.dates, "3": v.status },
    }),
  });
  if (!response.ok) throw new Error(`Authkey HTTP ${response.status}.`);
  const result = await response.json();
  // Only an explicit submission acknowledgment is acceptance. Never infer delivery.
  if (
    typeof result?.LogID !== "string" ||
    !result.LogID.trim() ||
    result.LogID.length > 300 ||
    result.Message !== "Submitted Successfully" ||
    result.error ||
    result.status === false
  )
    throw new Error("Authkey acceptance not confirmed; check the provider before resending.");
  return result.LogID;
}
