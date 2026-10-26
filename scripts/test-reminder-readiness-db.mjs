import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { setTestIdentity } from "./test-session.mjs";

// No workers/providers are invoked. DDL and every fixture live in this rollback transaction.
const sql = postgres(process.env.SUPABASE_DB_URL, testDatabaseOptions());
const rollback = new Error("rollback reminder readiness");
const failures = [];
let passed = 0;
const preview = process.env.TEST_READINESS_PREVIEW === "1";
let before;
const persistedState = async () => {
  const [row] = await sql`select jsonb_build_object(
    'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p
      where p.oid in ('public.crm_refresh_source_reminders()'::regprocedure,
        'public.crm_queue_reminders()'::regprocedure,'public.crm_schedule_dispatch(uuid,timestamptz)'::regprocedure)),
    'fixtures',(select count(*) from public.organizations where name='Reminder rollback fixture'),
    'migration',(select count(*) from supabase_migrations.schema_migrations where version='20261026235000')
  ) as value`;
  return row.value;
};
try {
  before = await persistedState();
  await sql.begin(async (tx) => {
    await tx.unsafe("set local time zone 'UTC'");
    await tx.unsafe("set local lock_timeout = '5s'");
    await tx.unsafe("set local statement_timeout = '30s'");
    if (preview) {
      await tx.unsafe(
        await readFile(
          new URL("../supabase/migrations/20261026235000_reminder_reopening.sql", import.meta.url),
          "utf8",
        ),
      );
      await tx.unsafe(
        await readFile(
          new URL("../supabase/migrations/20261026235500_explicit_dispatch_cancellation.sql", import.meta.url),
          "utf8",
        ),
      );
    }

    // A rollback savepoint per case permits a full baseline failure report.
    const check = async (name, run) => {
      const done = new Error("rollback case");
      try {
        await tx.savepoint(async (sp) => {
          await run(sp);
          throw done;
        });
      } catch (error) {
        if (error !== done) {
          failures.push(name);
          console.error(`FAIL ${name}: ${error.message}`);
          return;
        }
      }
      passed++;
      console.log(`PASS ${name}`);
    };
    const organization = async (db, timezone = "Asia/Kolkata") => {
      const [org] = await db`insert into public.organizations(name,timezone)
        values('Reminder rollback fixture',${timezone}) returning id`;
      const [date] = await db`select (now() at time zone ${timezone})::date::text as today`;
      return { ...org, ...date };
    };
    const sources = [
      { table: "crm_tasks", module: "tasks", open: "todo", closed: "done", prefix: "Task due: " },
      { table: "crm_compliance", module: "compliance", open: "pending", closed: "filed", prefix: "Compliance due: " },
    ];
    const source = async (db, kind, org, offset = 0) => {
      const [row] = await db`insert into public.${db(kind.table)}(organization_id,title,due_date)
        values(${org.id},'Original',${org.today}::date+${offset}::int) returning id`;
      return row;
    };
    const events = (db, row) => db`select *,occurrence_date::text as day,source_due_date::text as due
      from public.crm_automation_events where source_id=${row.id} order by occurrence_date,source_due_date`;

    for (const kind of sources) {
      await check(`${kind.module}: same-day close/reopen revives original occurrence`, async (db) => {
        const org = await organization(db),
          row = await source(db, kind, org);
        const [original] = await events(db, row);
        await db`update public.${db(kind.table)} set status=${kind.closed} where id=${row.id}`;
        assert.equal((await events(db, row))[0].status, "cancelled");
        await db`update public.${db(kind.table)} set status=${kind.open},title='Reopened' where id=${row.id}`;
        const restored = await events(db, row);
        assert.equal(restored.length, 1);
        assert.equal(restored[0].id, original.id);
        assert.equal(restored[0].status, "queued");
        assert.equal(restored[0].title, `${kind.prefix}Reopened`);
        await db`select public.crm_queue_reminders()`;
        assert.deepEqual(await events(db, row), restored, "scheduler must be idempotent");
      });
      await check(`${kind.module}: due date away/back revives only matching occurrence`, async (db) => {
        const org = await organization(db),
          row = await source(db, kind, org);
        const [original] = await events(db, row);
        await db`update public.${db(kind.table)} set due_date=${org.today}::date+1 where id=${row.id}`;
        await db`update public.${db(kind.table)} set due_date=${org.today}::date where id=${row.id}`;
        const rows = await events(db, row);
        assert.equal(rows.length, 2);
        assert.equal(rows.find((e) => e.id === original.id).status, "queued");
        assert.equal(rows.find((e) => e.id !== original.id).status, "cancelled");
      });
      await check(`${kind.module}: scheduler independently revives cancelled eligible occurrence`, async (db) => {
        const org = await organization(db),
          row = await source(db, kind, org);
        const [original] = await events(db, row);
        await db`update public.crm_automation_events set status='cancelled',title='Stale',notes='Stale' where id=${original.id}`;
        await db`insert into public.crm_automation_events(organization_id,title,source_module,source_id,occurrence_date,source_due_date,status)
          values(${org.id},'Old cancelled',${kind.module},${row.id},${org.today}::date-1,${org.today},'cancelled')`;
        await db`select public.crm_queue_reminders()`;
        const rows = await events(db, row),
          revived = rows.find((e) => e.id === original.id);
        assert.equal(revived.status, "queued");
        assert.equal(revived.title, `${kind.prefix}Original`);
        assert.equal(revived.notes, `Due ${org.today}`);
        assert.equal(rows[0].status, "cancelled", "older occurrence stays cancelled");
        await db`select public.crm_queue_reminders()`;
        assert.deepEqual(await events(db, row), rows);
      });
      await check(`${kind.module}: acknowledged history survives reopen, reversal and scheduler`, async (db) => {
        const org = await organization(db),
          row = await source(db, kind, org),
          admin = randomUUID();
        await db`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture')`;
        await db`insert into public.profiles(user_id,organization_id,full_name,role)
          values(${admin},${org.id},'Reminder admin','admin')`;
        await setTestIdentity(db, admin);
        const [event] = await events(db, row);
        await db`select public.crm_acknowledge_event(${event.id})`;
        const [ack] = await events(db, row);
        await db`update public.${db(kind.table)} set status=${kind.closed} where id=${row.id}`;
        await db`update public.${db(kind.table)} set status=${kind.open},title='Changed' where id=${row.id}`;
        await db`update public.${db(kind.table)} set due_date=${org.today}::date+1 where id=${row.id}`;
        await db`update public.${db(kind.table)} set due_date=${org.today}::date where id=${row.id}`;
        await db`select public.crm_queue_reminders()`;
        assert.deepEqual(
          (await events(db, row)).find((e) => e.id === ack.id),
          ack,
        );
      });
    }

    // Literal expectations catch widening 7/3/1/0 to ranges and losing overdue days.
    for (const timezone of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
      for (const kind of sources) {
        await check(`${kind.module}: trigger/cron boundaries in ${timezone}`, async (db) => {
          const org = await organization(db, timezone);
          const cases =
            kind.module === "compliance"
              ? [
                  [8, false],
                  [7, true],
                  [6, false],
                  [4, false],
                  [3, true],
                  [2, false],
                  [1, true],
                  [0, true],
                  [-1, true],
                  [-30, true],
                ]
              : [
                  [2, false],
                  [1, true],
                  [0, true],
                  [-1, true],
                  [-30, true],
                  [null, false],
                ];
          const rows = [];
          for (const [offset, eligible] of cases) {
            const row =
              offset === null
                ? (
                    await db`insert into public.crm_tasks(organization_id,title) values(${org.id},'Undated') returning id`
                  )[0]
                : await source(db, kind, org, offset);
            rows.push([row, eligible]);
          }
          const verify = async () => {
            for (const [row, eligible] of rows) {
              const found = await events(db, row);
              assert.equal(found.length, eligible ? 1 : 0, `${kind.module} ${row.id}: eligibility`);
              if (eligible) {
                assert.equal(found[0].status, "queued");
                assert.equal(found[0].day, org.today, "organization day, independent of UTC session");
              }
            }
          };
          await verify();
          await db`delete from public.crm_automation_events where organization_id=${org.id}`;
          await db`select public.crm_queue_reminders()`;
          await verify();
          for (const [row] of rows)
            await db`update public.${db(kind.table)} set status=${kind.closed} where id=${row.id}`;
          await db`select public.crm_queue_reminders()`;
          assert.equal(
            (await db`select id from public.crm_automation_events where organization_id=${org.id} and status='queued'`)
              .length,
            0,
          );
        });
      }
    }

    const dispatchFixture = async (db) => {
      const org = await organization(db);
      await db`insert into public.crm_automation_settings(organization_id,enabled,automatic_sends) values(${org.id},true,true)`;
      await db`insert into public.crm_channel_permissions(organization_id,channel,recipient,allowed,evidence)
        values(${org.id},'gmail','reminder@example.invalid',true,'Rollback consent fixture')`;
      const [client] = await db`insert into public.crm_clients(organization_id,title,email)
        values(${org.id},'Client','reminder@example.invalid') returning id`;
      const row = await source(db, sources[1], org);
      await db`update public.crm_compliance set client_id=${client.id} where id=${row.id}`;
      const schedule = () =>
        db`select public.crm_schedule_dispatch(${org.id},(${org.today}::date+time '12:00') at time zone 'Asia/Kolkata') as n`;
      assert.equal((await schedule())[0].n, 1);
      const [job] = await db`select * from public.crm_dispatch where organization_id=${org.id}`;
      assert.equal(job.status, "queued");
      return { org, row, job, schedule };
    };
    await check("dispatch: explicit administrator cancellation stays cancelled", async (db) => {
      const { org, job, schedule } = await dispatchFixture(db);
      const admin = randomUUID();
      await db`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture')`;
      await db`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin')`;
      await setTestIdentity(db, admin);
      await db`update public.crm_dispatch set status='review' where id=${job.id}`;
      await db`select public.crm_dispatch_review(${job.id},false,'')`;
      const [cancelled] = await db`select * from public.crm_dispatch where id=${job.id}`;
      assert.equal(cancelled.status, "cancelled");
      assert.equal((await schedule())[0].n, 0, "Manual cancellation must not be restored");
      assert.equal((await schedule())[0].n, 0, "Repeated worker schedules respect the cancellation");
      assert.deepEqual((await db`select * from public.crm_dispatch where id=${job.id}`)[0], cancelled);
    });
    for (const reversal of [false, true]) {
      await check(
        `dispatch: ${reversal ? "due reversal" : "file/reopen"} requires fresh approval even in automatic mode`,
        async (db) => {
          const { org, row, job, schedule } = await dispatchFixture(db);
          if (reversal) await db`update public.crm_compliance set due_date=${org.today}::date+8 where id=${row.id}`;
          else await db`update public.crm_compliance set status='filed' where id=${row.id}`;
          // Empty channels exercise real cancellation without claiming any send.
          assert.equal((await db`select * from public.crm_claim_dispatch(${org.id},array[]::text[])`).length, 0);
          assert.equal((await db`select status from public.crm_dispatch where id=${job.id}`)[0].status, "cancelled");
          if (reversal)
            await db`update public.crm_compliance set due_date=${org.today}::date,title='Current title' where id=${row.id}`;
          else await db`update public.crm_compliance set status='pending',title='Current title' where id=${row.id}`;
          assert.equal((await schedule())[0].n, 1, "restoration counted");
          const jobs = await db`select * from public.crm_dispatch where organization_id=${org.id}`;
          assert.equal(jobs.length, 1);
          assert.equal(jobs[0].id, job.id);
          assert.equal(jobs[0].status, "review");
          assert.equal(jobs[0].subject, "Current title");
          assert.ok(jobs[0].body.includes("Current title"));
          assert.equal((await schedule())[0].n, 0);
          assert.equal(
            (await db`select * from public.crm_claim_dispatch(${org.id},array['gmail'])`).length,
            0,
            "restored job cannot be claimed before approval",
          );
          const admin = randomUUID();
          await db`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture')`;
          await db`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Admin','admin')`;
          await setTestIdentity(db, admin);
          await db`select public.crm_dispatch_review(${job.id},true,'Freshly reviewed')`;
          assert.equal((await db`select status from public.crm_dispatch where id=${job.id}`)[0].status, "queued");
        },
      );
    }
    for (const status of ["review", "queued", "sending", "accepted", "delivered", "read", "failed", "uncertain"]) {
      await check(`dispatch: preserve ${status} verbatim`, async (db) => {
        const { job, schedule } = await dispatchFixture(db);
        // Even without provider/lease evidence, these statuses must never be restored.
        await db`update public.crm_dispatch set status=${status},error='Retain evidence' where id=${job.id}`;
        const [before] = await db`select * from public.crm_dispatch where id=${job.id}`;
        assert.equal((await schedule())[0].n, 0);
        assert.deepEqual((await db`select * from public.crm_dispatch where id=${job.id}`)[0], before);
      });
    }
    for (const evidence of ["provider", "lease"]) {
      await check(`dispatch: cancelled with ${evidence} evidence is never restored`, async (db) => {
        const { job, schedule } = await dispatchFixture(db);
        await db`update public.crm_dispatch set status='cancelled',provider_id=${evidence === "provider" ? "accepted-provider-id" : null},
          lease=${evidence === "lease" ? randomUUID() : null} where id=${job.id}`;
        const [before] = await db`select * from public.crm_dispatch where id=${job.id}`;
        assert.equal((await schedule())[0].n, 0);
        assert.deepEqual((await db`select * from public.crm_dispatch where id=${job.id}`)[0], before);
      });
    }
    for (const guard of ["paused", "revoked", "filed", "ineligible date", "early", "other pending occurrence"]) {
      await check(`dispatch: cancelled occurrence respects ${guard}`, async (db) => {
        const { org, row, job, schedule } = await dispatchFixture(db);
        await db`update public.crm_dispatch set status='cancelled' where id=${job.id}`;
        if (guard === "paused")
          await db`update public.crm_automation_settings set enabled=false where organization_id=${org.id}`;
        if (guard === "revoked")
          await db`update public.crm_channel_permissions set allowed=false where organization_id=${org.id}`;
        if (guard === "filed") await db`update public.crm_compliance set status='filed' where id=${row.id}`;
        if (guard === "ineligible date")
          await db`update public.crm_compliance set due_date=${org.today}::date+8 where id=${row.id}`;
        if (guard === "other pending occurrence")
          await db`insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,source_due_date,channel,recipient,subject,body,status)
            values(${org.id},'compliance',${row.id},'other occurrence',${org.today},'gmail',${job.recipient},'Pending','Pending','review')`;
        const [before] = await db`select * from public.crm_dispatch where id=${job.id}`;
        const [result] =
          guard === "early"
            ? await db`select public.crm_schedule_dispatch(${org.id},(${org.today}::date+time '08:59:59') at time zone 'Asia/Kolkata') as n`
            : await schedule();
        assert.equal(result.n, 0);
        assert.deepEqual((await db`select * from public.crm_dispatch where id=${job.id}`)[0], before);
      });
    }
    await check("dispatch: only today's matching occurrence is restored", async (db) => {
      const { org, row, job, schedule } = await dispatchFixture(db);
      await db`update public.crm_dispatch set status='cancelled' where id=${job.id}`;
      const [old] =
        await db`insert into public.crm_dispatch(organization_id,source_module,source_id,occurrence,source_due_date,channel,recipient,subject,body,status)
        values(${org.id},'compliance',${row.id},(${org.today}::date-1)::text||'/'||${org.today},${org.today},
          'gmail',${job.recipient},'Yesterday','Yesterday','cancelled') returning *`;
      assert.equal((await schedule())[0].n, 1);
      assert.deepEqual((await db`select * from public.crm_dispatch where id=${old.id}`)[0], old);
      assert.equal((await db`select status from public.crm_dispatch where id=${job.id}`)[0].status, "review");
    });
    await check("internal: unrelated cancelled events remain untouched", async (db) => {
      const org = await organization(db);
      const [event] =
        await db`insert into public.crm_automation_events(organization_id,title,source_module,source_id,occurrence_date,source_due_date,status)
        values(${org.id},'Unrelated','other',${randomUUID()},${org.today},${org.today},'cancelled') returning *`;
      await db`select public.crm_queue_reminders()`;
      assert.deepEqual((await db`select * from public.crm_automation_events where id=${event.id}`)[0], event);
    });
    await check("dispatch: cancelled non-compliance occurrence stays cancelled", async (db) => {
      const { org, job, schedule } = await dispatchFixture(db);
      await db`update public.crm_compliance set status='filed' where id=${job.source_id}`;
      const [client] = await db`select id from public.crm_clients where organization_id=${org.id}`;
      const [invoice] = await db`insert into public.crm_invoices(organization_id,client_id,title,status,amount,due_date)
        values(${org.id},${client.id},'Invoice','issued',100,${org.today}) returning id`;
      await schedule();
      await db`update public.crm_dispatch set status='cancelled' where source_id=${invoice.id}`;
      assert.equal((await schedule())[0].n, 0);
      assert.equal(
        (await db`select status from public.crm_dispatch where source_id=${invoice.id}`)[0].status,
        "cancelled",
      );
    });
    await check("dispatch: 7/3/1/0, overdue and local 09:00 boundary", async (db) => {
      const org = await organization(db);
      await db`insert into public.crm_automation_settings(organization_id,enabled) values(${org.id},true)`;
      await db`insert into public.crm_channel_permissions(organization_id,channel,recipient,allowed,evidence)
        values(${org.id},'gmail','boundary@example.invalid',true,'Fixture consent')`;
      const [client] = await db`insert into public.crm_clients(organization_id,title,email)
        values(${org.id},'Boundary','boundary@example.invalid') returning id`;
      const rows = [];
      for (const [offset, eligible] of [
        [8, false],
        [7, true],
        [6, false],
        [4, false],
        [3, true],
        [2, false],
        [1, true],
        [0, true],
        [-1, true],
        [-30, true],
      ]) {
        const [row] = await db`insert into public.crm_compliance(organization_id,client_id,title,due_date)
          values(${org.id},${client.id},'Boundary',date '2026-10-27'+${offset}::int) returning id`;
        rows.push([row.id, eligible]);
      }
      // At 23:59:59 local on October 26, offsets 6/2/0/-1/-30 are eligible.
      assert.equal(
        (await db`select public.crm_schedule_dispatch(${org.id},'2026-10-26T18:29:59Z'::timestamptz) as n`)[0].n,
        5,
      );
      const previous = await db`select occurrence from public.crm_dispatch where organization_id=${org.id}`;
      assert.ok(previous.every((job) => job.occurrence.startsWith("2026-10-26/")));
      await db`delete from public.crm_dispatch where organization_id=${org.id}`;
      // UTC is still October 26 at local midnight; neither midnight nor 08:59:59 may schedule.
      for (const instant of ["2026-10-26T18:30:00Z", "2026-10-27T03:29:59Z"])
        assert.equal((await db`select public.crm_schedule_dispatch(${org.id},${instant}::timestamptz) as n`)[0].n, 0);
      assert.equal(
        (await db`select public.crm_schedule_dispatch(${org.id},'2026-10-27T03:30:00Z'::timestamptz) as n`)[0].n,
        6,
      );
      for (const [id, eligible] of rows) {
        const jobs = await db`select * from public.crm_dispatch where source_id=${id}`;
        assert.equal(jobs.length, eligible ? 1 : 0);
        if (eligible) assert.ok(jobs[0].occurrence.startsWith("2026-10-27/"));
      }
    });
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  try {
    if (before) assert.deepEqual(await persistedState(), before, "DDL, migration catalog and fixtures must roll back");
  } finally {
    await sql.end();
  }
}
console.log(
  `${preview ? "Preview" : "Baseline"}: ${passed} passed, ${failures.length} failed; all fixtures and preview DDL rolled back.`,
);
if (failures.length) process.exitCode = 1;
