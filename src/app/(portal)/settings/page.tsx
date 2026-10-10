import { redirect } from "next/navigation";
import { PageHead } from "@/components/page-head";
import { requireIdentity } from "@/modules/identity/session";
import { rpc } from "@/modules/portal/queries";
import { SettingsForms } from "./settings-forms";

type Settings = {
  organization: string;
  timezone: string;
  branch: string;
  workDays: string;
  shift: string;
  grace: number;
  fullDay: number;
  halfDay: number;
  correctionWindow: number;
  leaveTypes: string[];
};

export default async function SettingsPage() {
  const identity = await requireIdentity();
  if (!["admin", "partner"].includes(identity.role)) redirect("/dashboard");
  const settings = await rpc<Settings>("attendance_settings_snapshot");
  const rows = [
    ["Organization", settings.organization],
    ["Timezone", settings.timezone],
    ["Default branch", settings.branch],
    ["Working days", settings.workDays],
    ["Shift", settings.shift],
    ["Grace period", `${settings.grace} minutes`],
    ["Full day", `${settings.fullDay} minutes`],
    ["Half day", `${settings.halfDay} minutes`],
    ["Correction window", `${settings.correctionWindow} days`],
  ];
  return (
    <>
      <PageHead
        eyebrow="Configuration"
        title="Attendance and leave settings"
        description="Versioned rules used for new attendance days and leave requests."
      />
      <section className="grid grid-2">
        <div className="card">
          <div className="section-title">
            <h2>Attendance policy</h2>
          </div>
          {rows.map(([label, value]) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 0",
                borderBottom: "1px solid #edf1f3",
              }}
            >
              <span className="stat-note">{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="section-title">
            <h2>Leave types</h2>
          </div>
          {settings.leaveTypes.map((type) => (
            <div key={type} style={{ padding: "14px 0", borderBottom: "1px solid #edf1f3" }}>
              <strong>{type}</strong>
            </div>
          ))}
        </div>
      </section>
      <SettingsForms />
    </>
  );
}
