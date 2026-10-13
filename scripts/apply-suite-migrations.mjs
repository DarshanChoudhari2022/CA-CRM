import { readFile } from "node:fs/promises";
import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
try {
  for (const name of [
    "20261010180000_crm_suite",
    "20261010190000_workspace_operations",
    "20261010200000_crm_integrations",
    "20261010210000_crm_reporting",
    "20261010220000_excused_annotations",
    "20261012120000_workspace_performance",
    "20261012150000_daily_reports_and_photos",
    "20261012151000_photo_discard_intent",
    "20261012160000_approval_badge",
    "20261012161000_reviewer_tenant_scope",
    "20261013090000_ca_ai_workbench",
    "20261013100000_security_hardening",
    "20261013101000_attendance_integrity",
    "20261013102000_ai_context_validation",
    "20261013103000_ai_workpaper_scope",
  ]) {
    const version = name.split("_")[0];
    const source = await readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
    await sql.begin(async (tx) => {
      const [existing] = await tx`select version from supabase_migrations.schema_migrations where version=${version}`;
      if (existing) return;
      await tx.unsafe(source);
      await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},${name},${[source]})`;
    });
    console.log(`${name} applied.`);
  }
} finally {
  await sql.end();
}
