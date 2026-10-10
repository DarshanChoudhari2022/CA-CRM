import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const connection = process.env.SUPABASE_DB_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || "office@psbassociates.in";
const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "PSB Administrator";
if (!connection || !email || !name)
  throw new Error("Set SUPABASE_DB_URL, BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_NAME in .env.local.");

const sql = postgres(connection, { max: 1, ssl: "require" });
let temporaryPassword;
try {
  const [existingAuth] = await sql`select id from auth.users where lower(email)=lower(${email}) limit 1`;
  if (!existingAuth) {
    const [existingAdmin] =
      await sql`select user_id from public.profiles where role in ('admin','partner') and active limit 1`;
    if (existingAdmin)
      throw new Error("A main administrator already exists. Bootstrap does not create additional administrators.");
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Add SUPABASE_SERVICE_ROLE_KEY to .env.local to create the main administrator account.");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    temporaryPassword = `${randomBytes(18).toString("base64url")}!aA7`;
    const { error } = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true });
    if (error) throw new Error("Could not create administrator Auth account. Check Supabase configuration.");
  }
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
      await tx`select id from public.branches where organization_id=${org.id} order by id limit 1`;
    const [policy] =
      await tx`select id from public.attendance_policies where organization_id=${org.id} order by effective_from desc limit 1`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role,password_change_required) values(${authUser.id},${org.id},${name},'admin',${!!temporaryPassword})`;
    const [employee] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,department,branch_id,policy_id,joined_on) values(${org.id},${authUser.id},'PSB-001',${name},${email},'Partners',${branch.id},${policy.id},current_date) returning id`;
    await tx`update public.profiles set employee_id=${employee.id} where user_id=${authUser.id}`;
    await tx`insert into public.leave_balances(organization_id,employee_id,leave_type_id,year,allocated) select ${org.id},${employee.id},id,extract(year from current_date),default_days from public.leave_types where organization_id=${org.id} and active on conflict do nothing`;
    return { created: true };
  });
  console.log(result.created ? "Administrator profile created." : "Administrator profile already exists.");
  if (temporaryPassword)
    console.log(
      `Login: ${email}\nTemporary password (shown once): ${temporaryPassword}\nChange the password at first login.`,
    );
} finally {
  await sql.end();
}
