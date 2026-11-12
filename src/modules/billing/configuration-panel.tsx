import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";
import { type SettingsSection, settingsSections } from "./configuration";
import { saveBillingSettings } from "./configuration-actions";
import { ConfigurationForm } from "./configuration-form";

export const configurationInput =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-violet-600";

export async function ConfigurationPanel({ section, saved }: { section: SettingsSection; saved: boolean }) {
  const identity = await requireCrmIdentity();
  const client = await createClient();
  const { data, error } = await client
    .from("billing_practice_settings")
    .select("settings")
    .eq("organization_id", identity.organizationId)
    .eq("section", section)
    .maybeSingle();

  const { label, fields } = settingsSections[section];
  return (
    <section className="billing-card space-y-4 p-4 sm:p-5" aria-labelledby="settings-section">
      <h2 id="settings-section" className="text-base font-semibold">
        {section === "smart-drafts" ? "Draft preferences" : label}
      </h2>
      {section === "sharing" && (
        <p className="billing-muted">
          Use {"{client}"}, {"{number}"} or {"{amount}"} in message drafts.
        </p>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load saved settings. Reload this page to try again.
        </p>
      ) : (
        <>
          {saved && (
            <p role="status" className="text-sm text-emerald-700">
              Settings saved.
            </p>
          )}
          <ConfigurationForm action={saveBillingSettings.bind(null, section)} submit="Save settings">
            {fields.map((field) => {
              const value = data?.settings?.[field.name];
              const input = {
                className: configurationInput,
                id: `settings-${field.name}`,
                name: field.name,
                defaultValue: typeof value === "string" ? value : "",
              };
              return (
                <label
                  key={field.name}
                  htmlFor={input.id}
                  className={
                    field.type === "textarea"
                      ? "grid gap-1.5 text-sm font-medium sm:col-span-2"
                      : "grid gap-1.5 text-sm font-medium"
                  }
                >
                  {field.label}
                  {field.type === "textarea" ? (
                    <textarea {...input} maxLength={field.max} rows={3} />
                  ) : (
                    <input {...input} type={field.type ?? "text"} maxLength={field.max} />
                  )}
                </label>
              );
            })}
          </ConfigurationForm>
        </>
      )}
    </section>
  );
}
