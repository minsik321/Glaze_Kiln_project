import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-000000000001";
const migration = (file) => readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");

async function withDatabase(files, run) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets(id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null);
      alter table storage.objects enable row level security;
      create function storage.foldername(value text) returns text[] language sql immutable as
      $$ select string_to_array(value, '/') $$;
      grant usage on schema auth, public, storage to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      grant execute on function storage.foldername(text) to authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;
      insert into auth.users values ('${alice}');`);
    for (const file of files) await db.exec(await migration(file));
    await run(db);
  } finally { await db.close(); }
}

const base = ["20260915000000_initial.sql", "20260916010000_aice_runs.sql", "20260930000000_add_jar_ware_preset.sql"];
const derive = "20261008000000_aice_runs_derive_from_payload.sql";

const payload = (over = {}) => ({
  schema_version: 3, run_id: "r", revision: 1, title: "payload title", status: "simulated",
  goal: { gloss: "satin", transparency: "opaque" }, recipe: { id: "recipe-1" }, ware: { preset: "bowl" },
  application: {}, thickness: {}, loading: {}, curves: {}, pid: {}, result: {}, sources: [], consent: {}, versions: {},
  created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:00Z", ...over,
});
const insert = (db, title, p, extra = {}) => db.query(
  `insert into public.aice_runs(user_id,title,payload,status,goal_gloss,goal_transparency,recipe_id,ware_preset)
   values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
  [alice, title, JSON.stringify(p), extra.status ?? "simulated", extra.gloss ?? "satin", extra.trans ?? "opaque", extra.recipe ?? "recipe-1", extra.ware ?? "bowl"],
);

test("insert: columns are taken from the payload, not from the values passed in", async () => {
  await withDatabase([...base, derive], async (db) => {
    const { rows: [run] } = await insert(db, "chat prompt text", payload(), {
      status: "draft", gloss: "glossy", trans: "clear", recipe: "other", ware: "plate",
    });
    assert.equal(run.title, "payload title");
    assert.equal(run.status, "simulated");
    assert.equal(run.goal_gloss, "satin");
    assert.equal(run.goal_transparency, "opaque");
    assert.equal(run.recipe_id, "recipe-1");
    assert.equal(run.ware_preset, "bowl");
  });
});

test("update: changing the payload moves the columns with it; other updates leave them alone", async () => {
  await withDatabase([...base, derive], async (db) => {
    const { rows: [run] } = await insert(db, "x", payload());
    const next = payload({ title: "renamed", status: "evaluated", goal: { gloss: "matte", transparency: "clear" }, ware: { preset: "mug" }, recipe: { id: "recipe-2" } });
    const { rows: [updated] } = await db.query("update public.aice_runs set payload=$2 where id=$1 returning *", [run.id, JSON.stringify(next)]);
    assert.deepEqual(
      [updated.title, updated.status, updated.goal_gloss, updated.goal_transparency, updated.ware_preset, updated.recipe_id],
      ["renamed", "evaluated", "matte", "clear", "mug", "recipe-2"],
    );
    // A column-only update does not fire the payload trigger.
    const { rows: [flag] } = await db.query("update public.aice_runs set is_public=true where id=$1 returning *", [run.id]);
    assert.equal(flag.title, "renamed");
  });
});

test("a payload without a key keeps the column value instead of nulling it", async () => {
  await withDatabase([...base, derive], async (db) => {
    const { rows: [run] } = await insert(db, "keep me", payload());
    const sparse = payload();
    delete sparse.ware; delete sparse.recipe; sparse.title = "   ";
    const { rows: [updated] } = await db.query("update public.aice_runs set payload=$2 where id=$1 returning *", [run.id, JSON.stringify(sparse)]);
    assert.equal(updated.title, "payload title");
    assert.equal(updated.ware_preset, "bowl");
    assert.equal(updated.recipe_id, "recipe-1");
  });
});

test("migration re-derives drifted rows but leaves in-step rows (and their updated_at) alone", async () => {
  await withDatabase(base, async (db) => {
    // State of the hosted project before this migration: one row drifted, one in step.
    const { rows: [drifted] } = await insert(db, "chat prompt text", payload({ title: "사틴 청색 사발" }));
    const { rows: [inStep] } = await insert(db, "payload title", payload());
    // aice_runs_updated_at would overwrite the backdated value, so switch it off for the setup only.
    await db.exec("alter table public.aice_runs disable trigger aice_runs_updated_at");
    await db.query("update public.aice_runs set updated_at = '2026-01-01T00:00:00Z' where id in ($1,$2)", [drifted.id, inStep.id]);
    await db.exec("alter table public.aice_runs enable trigger aice_runs_updated_at");
    await db.exec(await migration(derive));
    const { rows: [fixed] } = await db.query("select * from public.aice_runs where id=$1", [drifted.id]);
    const { rows: [same] } = await db.query("select * from public.aice_runs where id=$1", [inStep.id]);
    assert.equal(fixed.title, "사틴 청색 사발");
    assert.ok(fixed.updated_at > new Date("2026-01-02T00:00:00Z"));
    assert.equal(same.updated_at.toISOString(), "2026-01-01T00:00:00.000Z");
  });
});
