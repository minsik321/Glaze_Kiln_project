import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";
const carol = "00000000-0000-0000-0000-000000000003";
const runId = "00000000-0000-0000-0000-0000000000a1";
const photoPath = `${alice}/photo-1.png`;
// pgvector is not available in PGlite; the vector migrations are independent of this cleanup.
const SKIP = new Set(["20261005020000_aice_vectors.sql", "20261005030000_aice_vector_corpus.sql"]);

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null);
    alter table storage.objects enable row level security;
    create function storage.foldername(value text) returns text[] language sql immutable as $$ select string_to_array(value, '/') $$;
    grant usage on schema auth, public, storage to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    grant execute on function storage.foldername(text) to authenticated;
    grant select, insert, update, delete on storage.objects to authenticated;
    insert into auth.users values ('${alice}'), ('${bob}');`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  // The state right after the cleanup; later migrations have their own tests.
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql") && f <= "20261005040000_schema_cleanup.sql").sort()) {
    if (!SKIP.has(file)) await db.exec(await readFile(new URL(file, dir), "utf8"));
  }
  return db;
}

async function as(db, id) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}

test("cleanup removes unused tables and redundant columns", async () => {
  const db = await migratedDatabase();
  try {
    const tables = await db.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    assert.deepEqual(tables.rows.map((r) => r.table_name), [
      "aice_consents", "aice_runs", "chat_messages", "chat_threads", "personal_calibrations", "profiles",
    ]);
    const cols = async (t) => (await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [t])).rows.map((r) => r.column_name);
    assert.deepEqual(await cols("personal_calibrations"), ["user_id", "coefficients", "created_at", "updated_at", "recipe_id"]);
    assert.deepEqual(await cols("profiles"), ["id", "display_name", "created_at", "kiln_sensor_plan", "avatar_url", "bio"]);
    const pk = await db.query(`select array_agg(a.attname order by a.attname) cols from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'public.personal_calibrations'::regclass and i.indisprimary`);
    assert.deepEqual(pk.rows[0].cols, ["recipe_id", "user_id"]);
  } finally { await db.close(); }
});

test("every auth user gets a profile row", async () => {
  const db = await migratedDatabase();
  try {
    assert.equal((await db.query("select count(*)::int n from public.profiles")).rows[0].n, 2);
    await db.query("insert into auth.users values ($1)", [carol]);
    assert.equal((await db.query("select count(*)::int n from public.profiles where id = $1", [carol])).rows[0].n, 1);
  } finally { await db.close(); }
});

test("feedback compare-and-swap writes one row per user and recipe", async () => {
  const db = await migratedDatabase();
  try {
    await as(db, alice);
    const first = await db.query("select applied from public.commit_aice_feedback('r1', '{}'::jsonb, '{\"k\":1}'::jsonb)");
    assert.equal(first.rows[0].applied, true);
    const stale = await db.query("select applied from public.commit_aice_feedback('r1', '{}'::jsonb, '{\"k\":2}'::jsonb)");
    assert.equal(stale.rows[0].applied, false);
    const next = await db.query("select applied from public.commit_aice_feedback('r1', '{\"k\":1}'::jsonb, '{\"k\":2}'::jsonb)");
    assert.equal(next.rows[0].applied, true);
    const rows = await db.query("select recipe_id, coefficients from public.personal_calibrations");
    assert.deepEqual(rows.rows, [{ recipe_id: "r1", coefficients: { k: 2 } }]);
  } finally { await db.close(); }
});

test("photos of a published, consented run are readable by other users", async () => {
  const db = await migratedDatabase();
  try {
    await db.query("insert into storage.objects(bucket_id, name) values ('aice-result-photos', $1)", [photoPath]);
    await as(db, alice);
    const payload = { schema_version: "3", result: { photo: { kind: "result", storage_path: photoPath } } };
    await db.query(`insert into public.aice_runs(id, user_id, title, payload, status, goal_gloss, goal_transparency, recipe_id, ware_preset)
      values ($1, $2, 'run', $3, 'evaluated', 'satin', 'opaque', 'r1', 'bowl')`, [runId, alice, JSON.stringify(payload)]);
    const visibleToBob = async () => { await as(db, bob); return (await db.query("select name from storage.objects")).rows.length; };
    assert.equal(await visibleToBob(), 0);
    await as(db, alice);
    await db.query("update public.aice_runs set is_public = true where id = $1", [runId]);
    assert.equal(await visibleToBob(), 0, "public without consent stays hidden");
    await as(db, alice);
    await db.query(`insert into public.aice_consents(run_id, user_id, share_allowed, photo_rights_confirmed, pii_reviewed, location_removed, granted_at)
      values ($1, $2, true, true, true, true, now())`, [runId, alice]);
    assert.equal(await visibleToBob(), 1);
  } finally { await db.close(); }
});
