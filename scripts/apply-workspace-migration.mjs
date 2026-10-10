import { readFile } from "node:fs/promises";
import postgres from "postgres";

const version = "20261010160000";
const source = await readFile(
  new URL(`../supabase/migrations/${version}_employee_workspace.sql`, import.meta.url),
  "utf8",
);
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
try {
  await sql.begin(async (tx) => {
    const [existing] = await tx`select version from supabase_migrations.schema_migrations where version=${version}`;
    if (existing) return;
    await tx.unsafe(source);
    await tx`insert into supabase_migrations.schema_migrations(version,name,statements) values(${version},'employee_workspace',${[source]})`;
  });
  console.log("Employee workspace migration applied.");
} finally {
  await sql.end();
}
