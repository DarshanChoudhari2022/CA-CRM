import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { testDatabaseOptions } from "./test-database-options.mjs";
import { prepareAccessTest, setTestIdentity } from "./test-session.mjs";

// node --env-file=.env.local scripts/test-collection-integrity-db.mjs
// TEST_READINESS_PREVIEW=1 applies ONLY the collection migration, inside the rollback.
const sql = postgres(process.env.SUPABASE_DB_URL, { ...testDatabaseOptions(), connect_timeout: 15 });
const rollback = new Error("rollback collection integrity fixtures");
const failures = [];
let passed = 0;
try {
  await sql.begin(async (tx) => {
    await tx.unsafe("set local statement_timeout = '20s'");
    await tx.unsafe("set local lock_timeout = '5s'");
    // Model Storage's database deletion context without making external API writes.
    await tx`select set_config('storage.allow_delete_query','true',true)`;
    await prepareAccessTest(tx);
    if (process.env.TEST_READINESS_PREVIEW === "1")
      await tx.unsafe(
        await readFile(
          new URL("../supabase/migrations/20261026234000_collection_integrity.sql", import.meta.url),
          "utf8",
        ),
      );
    const [org] =
      await tx`insert into public.organizations(name) values('Collection integrity rollback fixture') returning id`;
    const admin = randomUUID();
    await tx`insert into auth.users(id,email,encrypted_password) values(${admin},${`${admin}@example.invalid`},'fixture')`;
    await tx`insert into public.profiles(user_id,organization_id,full_name,role) values(${admin},${org.id},'Fixture admin','admin')`;
    await setTestIdentity(tx, admin);

    const check = async (name, run) => {
      try {
        await tx.savepoint(run);
        passed++;
        console.log(`PASS ${name}`);
      } catch (error) {
        failures.push(name);
        console.error(`FAIL ${name}: ${error.message}`);
      }
    };
    const denied = async (db, run, pattern) => {
      let failure;
      try {
        await db.savepoint(run);
      } catch (error) {
        failure = error;
      }
      assert.ok(failure, "RPC must reject this operation");
      assert.equal(failure.code, "P0001", "Must reject for a business rule, not an SQL/permission error");
      assert.match(failure.message, pattern);
    };
    const fixture = async (db, status = "requested") => {
      const [doc] =
        await db`insert into public.crm_documents(organization_id,title,status) values(${org.id},'Collection fixture',${status}) returning id`;
      const token = randomUUID();
      await db`insert into public.crm_collection_links(token_hash,organization_id,document_id,expires_at) values(${token},${org.id},${doc.id},now()+interval '1 day')`;
      return { doc: doc.id, token };
    };
    const reserve = async (db, f) => {
      await db.unsafe("set local role service_role");
      const [row] =
        await db`select public.crm_collection_reserve(${f.token},'statement.pdf','application/pdf',20) as value`;
      await db.unsafe("reset role");
      return { ...f, ...row.value };
    };
    const finish = async (db, f) => {
      await db.unsafe("set local role service_role");
      await db`select public.crm_collection_finish(${f.token})`;
      await db.unsafe("reset role");
    };
    const object = (db, f, size = 20, mimetype = "application/pdf") =>
      db`insert into storage.objects(bucket_id,name,metadata) values('crm-documents',${f.path},${sql.json({ size, mimetype })})`;
    const discard = async (db, f, complete = false) => {
      await db.unsafe("set local role authenticated");
      await db`select public.crm_discard_document(${f.id},${complete})`;
      await db.unsafe("reset role");
    };
    const snapshot = async (db, f) => {
      const [row] = await db`select
        (select to_jsonb(d) from public.crm_documents d where id=${f.doc}) as document,
        (select to_jsonb(v) from public.crm_document_versions v where id=${f.id}) as version,
        (select to_jsonb(l) from public.crm_collection_links l where token_hash=${f.token}) as link,
        (select count(*)::int from public.audit_logs where organization_id=${org.id} and request_id=${f.id}::uuid) as audits`;
      return row;
    };

    await check("service-only collection grants", async (db) => {
      for (const signature of [
        "public.crm_collection_reserve(text,text,text,integer)",
        "public.crm_collection_finish(text)",
      ]) {
        const [rights] = await db`select has_function_privilege('anon',${signature},'execute') as anon,
          has_function_privilege('authenticated',${signature},'execute') as staff,
          has_function_privilege('service_role',${signature},'execute') as service`;
        assert.deepEqual({ ...rights }, { anon: false, staff: false, service: true });
      }
    });
    for (const status of ["requested", "rejected"]) {
      await check(`${status}: retry reservation, validate storage, finish and idempotent retry`, async (db) => {
        const f = await reserve(db, await fixture(db, status));
        assert.deepEqual(await reserve(db, f), f, "Retry returns the same reservation");
        assert.equal((await db`select id from public.crm_document_versions where document_id=${f.doc}`).length, 1);
        const before = await snapshot(db, f);
        await denied(db, (sp) => finish(sp, f), /[Uu]pload.*(complete|match)/);
        assert.deepEqual(await snapshot(db, f), before);
        await object(db, f, 19);
        await denied(db, (sp) => finish(sp, f), /[Uu]pload.*(complete|match)/);
        await db`update storage.objects set metadata=${sql.json({ size: 20, mimetype: "image/png" })} where bucket_id='crm-documents' and name=${f.path}`;
        await denied(db, (sp) => finish(sp, f), /[Uu]pload.*(complete|match)/);
        await db`update storage.objects set metadata=${sql.json({ size: 20, mimetype: "application/pdf" })} where bucket_id='crm-documents' and name=${f.path}`;
        await finish(db, f);
        const done = await snapshot(db, f);
        assert.equal(done.document.status, "received");
        assert.equal(done.document.storage_path, f.path);
        assert.equal(done.version.state, "ready");
        assert.ok(done.link.completed_at);
        assert.equal(done.audits, 1);
        await db`update public.crm_documents set status='reviewed' where id=${f.doc}`;
        const reviewed = await snapshot(db, f);
        await finish(db, f);
        assert.deepEqual(
          await snapshot(db, f),
          reviewed,
          "Completed retry preserves review and does not duplicate audit",
        );
        await denied(db, (sp) => reserve(sp, f), /expired|used/);
        await denied(db, (sp) => discard(sp, f), /Retained/);
        await denied(db, (sp) => discard(sp, f, true), /Retained/);
        await denied(db, (sp) => sp`delete from public.crm_document_versions where id=${f.id}`, /Retained/);
        assert.deepEqual(
          await snapshot(db, f),
          reviewed,
          "Retained version and completed link survive deletion attempts",
        );
      });
    }
    await check("discard intent cannot be revived or reused", async (db) => {
      const f = await reserve(db, await fixture(db));
      await object(db, f);
      await discard(db, f);
      const before = await snapshot(db, f);
      await denied(db, (sp) => finish(sp, f), /discard|pending|unavailable/i);
      await denied(db, (sp) => reserve(sp, f), /discard|pending|unavailable/i);
      assert.deepEqual(await snapshot(db, f), before);
    });
    await check("discard deletion releases FK and permanently revokes incomplete link", async (db) => {
      const f = await reserve(db, await fixture(db));
      await object(db, f);
      await discard(db, f);
      await denied(db, (sp) => discard(sp, f, true), /Remove.*file/);
      await db.unsafe("set local role authenticated");
      const removed =
        await db`delete from storage.objects where bucket_id='crm-documents' and name=${f.path} returning id`;
      assert.equal(removed.length, 1, "Staff can remove the discarded object under RLS");
      await db.unsafe("reset role");
      await discard(db, f, true);
      const after = await snapshot(db, f);
      assert.equal(after.version, null);
      assert.equal(after.link.version_id, null);
      assert.equal(after.link.completed_at, null);
      assert.equal(after.document.status, "requested");
      assert.equal(after.document.storage_path, null);
      assert.equal(after.audits, 1);
      const [expired] =
        await db`select expires_at<now() as value from public.crm_collection_links where token_hash=${f.token}`;
      assert.equal(expired.value, true);
      await denied(db, (sp) => reserve(sp, f), /expired|used/);
      await denied(db, (sp) => finish(sp, f), /Invalid link/);
    });
    await check("deleting a pending version also revokes every incomplete link", async (db) => {
      const f = await reserve(db, await fixture(db));
      const alias = randomUUID();
      await db`insert into public.crm_collection_links(token_hash,organization_id,document_id,version_id,expires_at)
        values(${alias},${org.id},${f.doc},${f.id},now()+interval '1 day')`;
      await db`delete from public.crm_document_versions where id=${f.id}`;
      const links = await db`select version_id,completed_at,expires_at<now() as expired
        from public.crm_collection_links where token_hash in (${f.token},${alias})`;
      assert.equal(links.length, 2);
      for (const link of links) {
        assert.equal(link.version_id, null);
        assert.equal(link.completed_at, null);
        assert.equal(link.expired, true);
      }
      for (const token of [f.token, alias]) {
        await denied(db, (sp) => reserve(sp, { ...f, token }), /expired|used/);
        await denied(db, (sp) => finish(sp, { ...f, token }), /Invalid link/);
      }
    });
    await check("reservation retry with different metadata leaves the original intact", async (db) => {
      const f = await reserve(db, await fixture(db));
      const before = await snapshot(db, f);
      await denied(
        db,
        async (sp) => {
          await sp.unsafe("set local role service_role");
          await sp`select public.crm_collection_reserve(${f.token},'other.pdf','application/pdf',20)`;
        },
        /same file/,
      );
      assert.deepEqual(await snapshot(db, f), before);
    });
    await check("a version from another document cannot be reserved or finalized", async (db) => {
      const f = await reserve(db, await fixture(db));
      const other = await reserve(db, await fixture(db));
      await object(db, other);
      await db`update public.crm_collection_links set version_id=${other.id} where token_hash=${f.token}`;
      const before = await snapshot(db, f);
      const otherBefore = await snapshot(db, other);
      await denied(db, (sp) => reserve(sp, f), /pending|unavailable/i);
      await denied(db, (sp) => finish(sp, f), /pending|unavailable/i);
      assert.deepEqual(await snapshot(db, f), before);
      assert.deepEqual(await snapshot(db, other), otherBefore);
    });
    for (const status of ["received", "reviewed"]) {
      await check(`${status} document blocks late finish without side effects`, async (db) => {
        const f = await reserve(db, await fixture(db));
        await object(db, f);
        await db`update public.crm_documents set status=${status},storage_path='fixture/retained/path' where id=${f.doc}`;
        const before = await snapshot(db, f);
        await denied(db, (sp) => finish(sp, f), /no longer awaiting/);
        await denied(db, (sp) => reserve(sp, f), /no longer awaiting/);
        assert.deepEqual(await snapshot(db, f), before);
      });
    }
    await check("uncompleted link cannot finalize an already ready version", async (db) => {
      const f = await reserve(db, await fixture(db));
      await object(db, f);
      await db`update public.crm_document_versions set state='ready' where id=${f.id}`;
      const before = await snapshot(db, f);
      await denied(db, (sp) => finish(sp, f), /pending|unavailable/i);
      await denied(db, (sp) => reserve(sp, f), /pending|unavailable/i);
      assert.deepEqual(await snapshot(db, f), before);
    });
    await check("two links cannot overwrite the first completed upload", async (db) => {
      const first = await reserve(db, await fixture(db));
      const token = randomUUID();
      await db`insert into public.crm_collection_links(token_hash,organization_id,document_id,expires_at) values(${token},${org.id},${first.doc},now()+interval '1 day')`;
      const second = await reserve(db, { doc: first.doc, token });
      await object(db, first);
      await object(db, second);
      await finish(db, first);
      const before = await snapshot(db, second);
      await denied(db, (sp) => finish(sp, second), /no longer awaiting/);
      assert.deepEqual(await snapshot(db, second), before);
      assert.equal(before.document.storage_path, first.path);
    });
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  console.log(`${passed} passed; ${failures.length} failed. All fixtures and preview DDL rolled back.`);
  if (failures.length) process.exitCode = 1;
} finally {
  await sql.end();
}
