import { documentPresentationSchema } from "@/modules/crm/invoice-details";

export function presentationDefaults(rows: Array<{ section: string; settings: unknown }>) {
  function get(section: string, key: string) {
    const settings = rows.find((row) => row.section === section)?.settings;
    if (!settings || typeof settings !== "object") return "";
    const value = (settings as Record<string, unknown>)[key];
    return typeof value === "string" ? value : "";
  }
  const bank = [
    ["Account holder", "beneficiary"],
    ["Bank", "bank_name"],
    ["Branch", "branch"],
    ["Account number", "account_number"],
    ["IFSC", "ifsc"],
    ["UPI", "upi_id"],
  ].flatMap(([label, key]) => (get("bank", key) ? [`${label}: ${get("bank", key)}`] : []));
  const accent = get("branding", "accent_color");
  const gstin = get("firm", "gstin");
  const pan = get("firm", "pan");
  const layout = documentPresentationSchema.shape.layout.safeParse(get("branding", "default_layout"));
  return documentPresentationSchema.parse({
    layout: layout.success ? layout.data : undefined,
    issuer: get("firm", "legal_name") || "PSB & Associates LLP",
    issuerDetails: [
      get("firm", "address"),
      get("firm", "email"),
      get("firm", "phone"),
      gstin && `GSTIN: ${gstin}`,
      pan && `PAN: ${pan}`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 700),
    payment: bank.join("\n").slice(0, 700),
    terms: get("branding", "terms").slice(0, 3000),
    footer: get("branding", "footer"),
    accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : undefined,
  });
}
