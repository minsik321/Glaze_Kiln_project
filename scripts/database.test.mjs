import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";

async function withDatabase(run) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${alice}'), ('${bob}');`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260915000000_initial.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const asUser = async (id) => {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
        id,
      ]);
    };
    await run(db, asUser);
  } finally {
    await db.close();
  }
}

// Assert SQLSTATE so unrelated SQL failures cannot masquerade as security checks.
const denied = { code: "42501" };
const invalid = { code: "23514" };

test("profiles allow owner CRUD and reject forged ownership or other users", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    await assert.rejects(
      db.query(
        "insert into public.profiles (id, display_name) values ($1, 'Forged')",
        [bob],
      ),
      denied,
    );
    await db.query(
      "insert into public.profiles (id, display_name) values ($1, 'Alice')",
      [alice],
    );
    const {
      rows: [profile],
    } = await db.query(
      "update public.profiles set display_name = 'Alice updated' returning *",
    );
    assert.equal(profile.id, alice);
    assert.equal(profile.display_name, "Alice updated");
    assert.ok(Number.isFinite(new Date(profile.created_at).getTime()));
    await assert.rejects(
      db.query("update public.profiles set id = $1", [bob]),
      denied,
    );
    await asUser(bob);
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query(
          "update public.profiles set display_name = 'Stolen' returning id",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("delete from public.profiles returning id")).rows.length,
      0,
    );
    await asUser(alice);
    assert.equal(
      (await db.query("select display_name from public.profiles")).rows[0]
        .display_name,
      "Alice updated",
    );
    assert.equal(
      (await db.query("delete from public.profiles returning id")).rows.length,
      1,
    );
  });
});

test("records enforce private ownership, authenticated sharing, and publication revocation", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    const {
      rows: [record],
    } = await db.query(
      "insert into public.work_records(title) values ('Test') returning *",
    );
    assert.equal(record.is_public, false);
    assert.equal(record.user_id, alice);
    assert.deepEqual(record.payload, {});
    assert.equal(record.schema_version, 1);
    await assert.rejects(
      db.query(
        "insert into public.work_records(user_id,title) values ($1, 'Forged')",
        [bob],
      ),
      denied,
    );
    await asUser(bob);
    assert.equal(
      (await db.query("select * from public.work_records")).rows.length,
      0,
    );
    await asUser(alice);
    await db.query(
      "update public.work_records set is_public = true, payload = $1 where id = $2",
      [JSON.stringify({ temperature: 1200 }), record.id],
    );
    await asUser(bob);
    assert.deepEqual(
      (await db.query("select payload from public.work_records")).rows,
      [{ payload: { temperature: 1200 } }],
    );
    assert.equal(
      (
        await db.query(
          "update public.work_records set title = 'Stolen' returning id",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await db.query("delete from public.work_records returning id")).rows
        .length,
      0,
    );
    await db.exec("reset role; set role anon");
    for (const table of ["profiles", "work_records"]) {
      await assert.rejects(db.query(`select * from public.${table}`), denied);
      await assert.rejects(db.query(`delete from public.${table}`), denied);
    }
    await assert.rejects(
      db.query("insert into public.work_records(title) values ('Anonymous')"),
      denied,
    );
    await assert.rejects(
      db.query("update public.work_records set title = 'Anonymous'"),
      denied,
    );
    await asUser(alice);
    await assert.rejects(
      db.query("update public.work_records set user_id = $1 where id = $2", [
        bob,
        record.id,
      ]),
      denied,
    );
    await db.query(
      "update public.work_records set is_public = false where id = $1",
      [record.id],
    );
    await asUser(bob);
    assert.equal(
      (await db.query("select * from public.work_records")).rows.length,
      0,
    );
    await asUser(alice);
    assert.equal(
      (await db.query("delete from public.work_records returning id")).rows
        .length,
      1,
    );
    assert.equal(
      (await db.query("select * from public.work_records")).rows.length,
      0,
    );
  });
});

test("database validates profile and record input and refreshes update timestamps", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    await assert.rejects(
      db.query(
        "insert into public.profiles(id, display_name) values ($1, $2)",
        [alice, "a".repeat(81)],
      ),
      invalid,
    );
    await db.query(
      "insert into public.profiles(id, display_name) values ($1, $2)",
      [alice, "a".repeat(80)],
    );
    for (const title of ["", "   ", "a".repeat(201)]) {
      await assert.rejects(
        db.query("insert into public.work_records(title) values ($1)", [title]),
        invalid,
      );
    }
    for (const payload of ["[]", '"text"', "null", "42"]) {
      await assert.rejects(
        db.query(
          "insert into public.work_records(title, payload) values ('Test', $1)",
          [payload],
        ),
        invalid,
      );
    }
    for (const version of [0, -1]) {
      await assert.rejects(
        db.query(
          "insert into public.work_records(title, schema_version) values ('Test', $1)",
          [version],
        ),
        invalid,
      );
    }
    const {
      rows: [record],
    } = await db.query(
      "insert into public.work_records(title, updated_at) values ($1, '2000-01-01') returning *",
      ["a".repeat(200)],
    );
    const {
      rows: [updated],
    } = await db.query(
      "update public.work_records set title = 'Updated', updated_at = '1999-01-01' where id = $1 returning *",
      [record.id],
    );
    assert.equal(updated.title, "Updated");
    assert.equal(
      new Date(updated.created_at).getTime(),
      new Date(record.created_at).getTime(),
    );
    assert.ok(new Date(updated.updated_at) > new Date(record.updated_at));
    assert.ok(new Date(updated.updated_at) >= new Date(updated.created_at));
  });
});
