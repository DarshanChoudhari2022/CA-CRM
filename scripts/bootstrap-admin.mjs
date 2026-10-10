import postgres from "postgres";

const connection = process.env.SUPABASE_DB_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
if (!connection || !email || !name)
  throw new Error("Set SUPABASE_DB_URL, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME in .env.local.");

const sql = postgres(connection, { max: 1, ssl: "require" });
try {
  const result = await sql.begin(async (tx) => {
    const [authUser] = await tx`select id from auth.users where lower(email)=lower(${email}) limit 1`;
    if (!authUser)
      throw new Error(
        "Create the administrator in Supabase Authentication > Users first, then run this command again.",
      );
    const [existing] = await tx`select user_id from public.profiles where user_id=${authUser.id}`;
    if (existing) return { created: false };
    const [org] = await tx`select id from public.organizations order by created_at limit 1`;
    const [branch] =
      await tx`select id from public.branches where organization_id=${org.id} order by created_at limit 1`;
    const [policy] =
      await tx`select id from public.attendance_policies where organization_id=${org.id} order by effective_from desc limit 1`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${authUser.id},${org.id},${name},'partner')`;
    const [employee] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,department,branch_id,policy_id,joined_on) values(${org.id},${authUser.id},'PSB-001',${name},${email},'Partners',${branch.id},${policy.id},current_date) returning id`;
    await tx`update public.profiles set employee_id=${employee.id} where user_id=${authUser.id}`;
    await tx`insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated) select ${org.id},${employee.id},id,extract(year from current_date),default_days from public.leave_types where organization_id=${org.id} and active on conflict do nothing`;
    return { created: true };
  });
  console.log(result.created ? "Administrator profile created." : "Administrator profile already exists.");
} finally {
  await sql.end();
}
