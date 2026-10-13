import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";

const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback day report fixtures");
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local time zone 'Asia/Kolkata'");
    const a = randomUUID(),
      b = randomUUID();
    const [org] = await tx`insert into public.organizations(name) values('Day report rollback test') returning id`;
    const [branch] = await tx`insert into public.branches(organization_id,name) values(${org.id},'Test') returning id`;
    const [policy] =
      await tx`insert into public.attendance_policies(organization_id,name,effective_from) values(${org.id},'Test',current_date) returning id`;
    await tx`insert into auth.users(id,email,encrypted_password) values(${a},${`${a}@example.invalid`},'fixture'),(${b},${`${b}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name) values(${a},${org.id},'A'),(${b},${org.id},'B')`;
    const [ea] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${a},'A','A',${`${a}@example.invalid`},${branch.id},${policy.id},current_date-1) returning id`;
    const [eb] =
      await tx`insert into public.employees(organization_id,profile_user_id,employee_code,full_name,work_email,branch_id,policy_id,joined_on) values(${org.id},${b},'B','B',${`${b}@example.invalid`},${branch.id},${policy.id},current_date-1) returning id`;
    await tx`update public.profiles set employee_id=${ea.id} where user_id=${a}`;
    await tx`update public.profiles set employee_id=${eb.id} where user_id=${b}`;
    await tx`select set_config('request.jwt.claim.sub',${a},true)`;
    await tx.unsafe("set local role authenticated");
    const rejected = async (query, label) => {
      let denied = false;
      try {
        await tx.savepoint(query);
      } catch {
        denied = true;
      }
      assert.ok(denied, label);
    };
    const [blank] = await tx`select public.save_daily_report('') as id`;
    const [updated] = await tx`select public.save_daily_report('Prepared audit working papers') as id`;
    assert.equal(blank.id, updated.id, "one report per employee/day");
    const photoId = randomUUID();
    const [slot] = await tx`select public.reserve_daily_photo(${photoId},'image/png',68) as value`;
    const [same] = await tx`select public.reserve_daily_photo(${photoId},'image/png',68) as value`;
    assert.equal(slot.value.path, same.value.path, "photo reservation idempotent");
    await rejected(
      (sp) => sp`select public.reserve_daily_photo(${randomUUID()},'image/svg+xml',68)`,
      "SVG photo denied",
    );
    await rejected(
      (sp) => sp`select public.reserve_daily_photo(${randomUUID()},'image/png',5242881)`,
      "oversize photo denied",
    );
    await rejected((sp) => sp`select public.finish_daily_photo(${photoId})`, "missing upload cannot be finalized");
    await tx`insert into storage.objects(bucket_id,name,metadata) values('attendance-photos',${slot.value.path},${sql.json({ size: 68, mimetype: "image/png" })})`;
    await tx`select public.finish_daily_photo(${photoId})`;
    await tx`select public.finish_daily_photo(${photoId})`;
    assert.equal(
      (await tx`select name from storage.objects where bucket_id='attendance-photos'`).length,
      1,
      "own ready photo readable",
    );
    for (let n = 0; n < 4; n++) await tx`select public.reserve_daily_photo(${randomUUID()},'image/jpeg',100)`;
    await rejected(
      (sp) => sp`select public.reserve_daily_photo(${randomUUID()},'image/jpeg',100)`,
      "five-photo limit enforced",
    );
    await rejected(
      (sp) => sp`select public.cancel_daily_photo(${photoId})`,
      "ready photo cannot be discarded as unfinished",
    );
    await tx`select set_config('request.jwt.claim.sub',${b},true)`;
    assert.equal((await tx`select id from public.daily_work_reports`).length, 0, "colleague report hidden");
    assert.equal((await tx`select id from public.daily_report_photos`).length, 0, "colleague photo hidden");
    assert.equal(
      (await tx`select name from storage.objects where bucket_id='attendance-photos'`).length,
      0,
      "colleague storage file hidden",
    );
    await rejected((sp) => sp`select public.finish_daily_photo(${photoId})`, "colleague cannot attach photo");
    await tx.unsafe("reset role");
    await tx`insert into public.attendance_days(organization_id,employee_id,work_date,branch_id,policy_id,calendar_context,check_in_at) values(${org.id},${eb.id},(now() at time zone 'Asia/Kolkata')::date,${branch.id},${policy.id},'working_day',now()-interval '450 minutes')`;
    await tx.unsafe("set local role authenticated");
    const [punched] = await tx`select public.record_attendance_punch('check_out',${randomUUID()}) as value`;
    assert.equal(
      punched.value.duration_minutes,
      450,
      "checkout works with no summary/photo and saves authoritative minutes",
    );
    assert.equal(
      (await tx`select id from public.daily_work_reports`).length,
      0,
      "checkout did not require or create a report",
    );
    const [dashboard] = await tx`select public.dashboard_snapshot_v2() as value`;
    assert.equal(dashboard.value.today.durationMinutes, 450, "completed shift total in dashboard");
    await tx.unsafe("reset role");
    await tx`update public.profiles set password_change_required=true where user_id=${a}`;
    await tx`select set_config('request.jwt.claim.sub',${a},true)`;
    await tx.unsafe("set local role authenticated");
    assert.equal((await tx`select id from public.daily_work_reports`).length, 0, "onboarding report access blocked");
    await rejected((sp) => sp`select public.save_daily_report('Bypass')`, "onboarding cannot write summary");
    console.log(
      "Passed: optional summary, stable report/reservation, photo type/size/count, upload verification, private photo RLS, onboarding gate, checkout without tasks/photos, 450-minute dashboard total.",
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await sql.end();
}
