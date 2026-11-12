import { z } from "zod";
import { documentLayouts } from "@/modules/crm/invoice-details";

export const practiceTabs = ["firm", "bank", "branding", "numbering", "sharing"] as const;

type SettingsField = {
  name: string;
  label: string;
  max: number;
  type?: "text" | "tel" | "email" | "url" | "textarea";
  pattern?: string;
  options?: Record<string, string>;
};

export type SettingsSection = (typeof practiceTabs)[number] | "smart-drafts";

export const settingsSections: Record<SettingsSection, { label: string; fields: SettingsField[] }> = {
  firm: {
    label: "Firm",
    fields: [
      { name: "legal_name", label: "Legal name", max: 160 },
      { name: "trade_name", label: "Trade name", max: 160 },
      { name: "gstin", label: "GSTIN", max: 15, type: "text", pattern: "^[0-9A-Z]{15}$" },
      { name: "pan", label: "PAN", max: 10, type: "text", pattern: "^[A-Z]{5}[0-9]{4}[A-Z]$" },
      { name: "email", label: "Email", max: 160, type: "email", pattern: "^[^ @]+@[^ @]+[.][^ @]+$" },
      { name: "phone", label: "Phone", max: 30, type: "tel" },
      { name: "address", label: "Billing address", max: 500, type: "textarea" },
    ],
  },
  bank: {
    label: "Bank / UPI",
    fields: [
      { name: "beneficiary", label: "Account holder", max: 160 },
      { name: "bank_name", label: "Bank name", max: 120 },
      { name: "branch", label: "Branch", max: 120 },
      { name: "account_number", label: "Account number", max: 34, type: "text", pattern: "^[0-9]{6,34}$" },
      { name: "ifsc", label: "IFSC", max: 11, type: "text", pattern: "^[A-Z]{4}0[A-Z0-9]{6}$" },
      { name: "upi_id", label: "UPI ID", max: 120, type: "text", pattern: "^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$" },
    ],
  },
  branding: {
    label: "Branding",
    fields: [
      { name: "logo_url", label: "Logo URL (HTTPS)", max: 500, type: "url", pattern: "^https://[^ /]+[^ ]*$" },
      { name: "accent_color", label: "Accent colour (hex)", max: 7, type: "text", pattern: "^#[0-9A-Fa-f]{6}$" },
      { name: "footer", label: "Invoice footer", max: 500, type: "textarea" },
      {
        name: "default_layout",
        label: "Default template",
        max: 7,
        pattern: "^(classic|modern|minimal)$",
        options: documentLayouts,
      },
      { name: "terms", label: "Default terms and conditions", max: 3000, type: "textarea" },
    ],
  },
  numbering: {
    label: "Numbering",
    fields: [
      { name: "invoice_prefix", label: "Invoice prefix", max: 16, type: "text", pattern: "^[A-Za-z0-9/_-]+$" },
      { name: "quotation_prefix", label: "Quotation prefix", max: 16, type: "text", pattern: "^[A-Za-z0-9/_-]+$" },
      { name: "starting_number", label: "Starting number", max: 9, type: "text", pattern: "^[1-9][0-9]{0,8}$" },
    ],
  },
  sharing: {
    label: "Sharing",
    fields: [
      { name: "email_subject", label: "Email subject", max: 160 },
      { name: "email_body", label: "Email message", max: 2000, type: "textarea" },
      { name: "whatsapp_body", label: "WhatsApp message", max: 1000, type: "textarea" },
    ],
  },
  "smart-drafts": {
    label: "Smart drafts",
    fields: [
      { name: "title_prefix", label: "Draft title prefix", max: 80 },
      { name: "review_notes", label: "Draft review instructions", max: 1000, type: "textarea" },
      {
        name: "payment_terms_days",
        label: "Payment terms (days)",
        max: 3,
        type: "text",
        pattern: "^(0|[1-9][0-9]{0,2})$",
      },
    ],
  },
};

export function isPracticeTab(value: unknown): value is (typeof practiceTabs)[number] {
  return practiceTabs.some((tab) => tab === value);
}

export function readSettingsForm(section: SettingsSection, form: FormData) {
  const fields = settingsSections[section].fields;
  const schema = z.object(
    Object.fromEntries(
      fields.map(({ name, max, label, pattern }) => [
        name,
        z
          .string()
          .trim()
          .max(max, `${label} is too long.`)
          .refine(
            (value) => !value || !pattern || new RegExp(pattern).test(value),
            `Enter a valid value for ${label.toLowerCase()}.`,
          ),
      ]),
    ),
  );
  return schema.safeParse(Object.fromEntries(fields.map(({ name }) => [name, form.get(name) ?? ""])));
}

const decimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/)
  .transform(Number);
const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300),
  sac_code: z
    .string()
    .trim()
    .regex(/^([0-9A-Za-z/-]{1,12})?$/),
  unit_price: decimal.pipe(z.number().min(0).max(9999999999.99)),
  gst_rate: decimal.pipe(z.number().min(0).max(100)),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export function readServiceForm(form: FormData) {
  return serviceSchema.safeParse({
    name: form.get("name"),
    description: form.get("description") ?? "",
    sac_code: form.get("sac_code") ?? "",
    unit_price: form.get("unit_price"),
    gst_rate: form.get("gst_rate"),
    active: form.get("active"),
  });
}

export type CatalogService = z.output<typeof serviceSchema> & { id: string };
