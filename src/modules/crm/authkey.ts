import { z } from "zod";

export class AuthkeyProviderError extends Error {}

// Return only fixed messages: provider bodies can contain credentials or recipient data.
function providerFailure(raw: unknown, httpStatus: number): string | undefined {
  const text = typeof raw === "string" ? raw.toLowerCase() : JSON.stringify(raw ?? {}).toLowerCase();
  if (/insufficient.*(balance|credit)|low balance|negative balance|balance.*insufficient/.test(text))
    return "Authkey rejected the request: insufficient balance. Resolve the account balance before sending.";
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    /invalid.*(authkey|api.key)|unauthorized|invalid authentication/.test(text)
  )
    return "Authkey authentication failed. Check AUTHKEY_API_KEY in Production and redeploy.";
  if (/invalid.*(wid|template)|template.*(not found|not approved|invalid)/.test(text))
    return "Authkey rejected the template. Confirm WID 52797 belongs to this API key and is approved.";
  return undefined;
}

export async function verifyAuthkeyConnection(): Promise<number> {
  if (whatsappProvider() !== "authkey")
    throw new AuthkeyProviderError("Set WHATSAPP_PROVIDER=authkey in Production and redeploy.");
  if (!authkeyReady())
    throw new AuthkeyProviderError(
      "Authkey configuration is incomplete. Check AUTHKEY_API_KEY, AUTHKEY_TEMPLATE_ID and AUTHKEY_COUNTRY_CODE.",
    );
  const url = new URL("https://console.authkey.io/restapi/getbalance.php");
  url.searchParams.set("authkey", process.env.AUTHKEY_API_KEY?.trim() || "");
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new AuthkeyProviderError("Authkey balance connection failed. No WhatsApp message was sent.");
  }
  const raw = await response.text();
  const failure = providerFailure(raw, response.status);
  if (failure) throw new AuthkeyProviderError(failure);
  if (!response.ok)
    throw new AuthkeyProviderError(
      `Authkey balance check failed (HTTP ${response.status}). No WhatsApp message was sent.`,
    );
  let value: unknown = raw.trim();
  try {
    const data = JSON.parse(raw);
    value = typeof data === "object" && data !== null ? (data.balance ?? data.Balance) : data;
  } catch {
    /* Some accounts return a plain numeric balance. */
  }
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+(?:\.\d+)?$/.test(String(value)))
    throw new AuthkeyProviderError(
      "Authkey returned an unrecognized balance response. Ask Authkey support to verify this API key; no message was sent.",
    );
  const balance = Number(value);
  if (!Number.isFinite(balance)) throw new AuthkeyProviderError("Authkey returned an invalid balance response.");
  if (balance <= 0)
    throw new AuthkeyProviderError(
      `Authkey balance is ${balance}. Fund the account before testing delivery. No WhatsApp message was sent.`,
    );
  return balance;
}

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
  if (!authkeyReady()) throw new AuthkeyProviderError("Authkey is not configured.");
  const v = leaveTemplateSchema.parse(values);
  const mobile = /^(?:\+91|91)?([6-9]\d{9})$/.exec(recipient)?.[1];
  if (!mobile) throw new AuthkeyProviderError("Enter a valid Indian mobile number.");
  let response: Response;
  try {
    response = await fetch("https://console.authkey.io/restapi/requestjson.php", {
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
  } catch {
    throw new AuthkeyProviderError(
      "Authkey send connection failed or timed out. Delivery is uncertain; check Authkey before resending.",
    );
  }
  const raw = await response.text();
  const failure = providerFailure(raw, response.status);
  if (failure) throw new AuthkeyProviderError(failure);
  if (!response.ok)
    throw new AuthkeyProviderError(`Authkey HTTP ${response.status}. Check provider configuration before resending.`);
  let result: { LogID?: unknown; Message?: unknown; error?: unknown; status?: unknown } | null;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new AuthkeyProviderError(
      "Authkey returned a non-JSON send response. Delivery is uncertain; check Authkey support before resending.",
    );
  }
  // Only an explicit submission acknowledgment is acceptance. Never infer delivery.
  if (
    typeof result?.LogID !== "string" ||
    !result.LogID.trim() ||
    result.LogID.length > 300 ||
    result?.Message !== "Submitted Successfully" ||
    result?.error ||
    result?.status === false
  )
    throw new AuthkeyProviderError("Authkey acceptance not confirmed; check the provider before resending.");
  return result.LogID;
}
