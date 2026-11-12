import Link from "next/link";
import { isPracticeTab, practiceTabs, settingsSections } from "@/modules/billing/configuration";
import { ConfigurationPanel } from "@/modules/billing/configuration-panel";

export default async function PracticeSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; saved?: string | string[] }>;
}) {
  const { tab, saved } = await searchParams;
  const section = isPracticeTab(tab) ? tab : "firm";

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Practice settings</h1>
        <p className="text-sm text-slate-600">
          Configure billing details and message drafts. PDF branding and document numbering use the existing PSB
          configuration.
        </p>
      </header>
      <nav className="billing-toolbar flex flex-wrap gap-2" aria-label="Practice settings sections">
        {practiceTabs.map((tab) => (
          <Link
            key={tab}
            href={`/invoice/settings?tab=${tab}`}
            aria-current={tab === section ? "page" : undefined}
            className={`billing-button ${tab === section ? "billing-primary" : ""}`}
          >
            {settingsSections[tab].label}
          </Link>
        ))}
      </nav>
      <ConfigurationPanel key={section} section={section} saved={saved === "1"} />
    </div>
  );
}
