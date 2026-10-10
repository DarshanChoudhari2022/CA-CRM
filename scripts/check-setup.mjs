import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
try {
  const [auth] = await sql`select count(*)::int as count from auth.users`;
  const [profiles] = await sql`select count(*)::int as count from public.profiles`;
  const [migrations] =
    await sql`select count(*)::int as count from supabase_migrations.schema_migrations where version like '20261010%'`;
  console.log(
    JSON.stringify({ authUsers: auth.count, portalProfiles: profiles.count, attendanceMigrations: migrations.count }),
  );
} finally {
  await sql.end();
}
