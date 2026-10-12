import { randomUUID } from "node:crypto";
import postgres from "postgres";

const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, ssl: "require" });
const rollback = new Error("rollback query fixtures");
try {
  await sql.begin(async (tx) => {
    const uid = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('Query-plan rollback fixture') returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${uid},${`${uid}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${uid},${org.id},'Query fixture','admin')`;
    await tx`insert into public.crm_tasks(organization_id,title) select ${org.id},'Fixture task '||n from generate_series(1,10000) n`;
    await tx.unsafe("analyze public.crm_tasks");
    await tx`select set_config('request.jwt.claim.sub',${uid},true)`;
    await tx.unsafe("set local role authenticated");
    const rows = await tx.unsafe(
      "explain (analyze,format json) select id,title from public.crm_tasks order by created_at desc,id limit 50",
    );
    const report = rows[0]["QUERY PLAN"][0];
    console.log(`10,000-row role-scoped CRM list: database execution ${report["Execution Time"]} ms`);
    if (report["Execution Time"] > 200) process.exitCode = 1;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
  console.log("Query fixtures rolled back.");
}
