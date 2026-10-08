import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-00000000000a";
const bob = "00000000-0000-0000-0000-00000000000b";
const LEGACY_KEY = "coastal-satin";
const CANONICAL = "glaze-v1-9799c9424d963459c01eb67875feb78dd0cacf6270917ba76f937c93e07d3314";
const MATERIALS = { 규석: 25, 장석: 40, 석회석: 20, 카올린: 15 };
// pgvector is not available in PGlite; the vector migrations are independent of recipes.
const SKIP = new Set(["20261005020000_aice_vectors.sql", "20261005030000_aice_vector_corpus.sql", "20261007000000_aice_vectors_1536.sql"]);
const NEW = new Set(["20261008000000_aice_runs_derive_from_payload.sql", "20261008010000_aice_runs_recipe_key_guard.sql"]);

async function database(beforeNew) {
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
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (SKIP.has(file)) continue;
    if (NEW.has(file) && beforeNew) { await beforeNew(db); beforeNew = null; }
    await db.exec(await readFile(new URL(file, dir), "utf8"));
  }
  return db;
}
const as = async (db, id) => {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
};
const payload = (key, materials = MATERIALS, extra = {}) => ({
  schema_version: 3, title: "t", status: "draft", goal: { gloss: "satin", transparency: "opaque" },
  ware: { preset: "bowl" }, recipe: { id: key, name: "해안 사틴 01", materials }, ...extra,
});
const insertRun = (db, user, key, p, ref = null) => db.query(
  `insert into public.aice_runs(user_id,title,payload,status,goal_gloss,goal_transparency,recipe_id,recipe_ref_id,ware_preset)
   values ($1,'t',$2,'draft','satin','opaque',$3,$4,'bowl') returning id`, [user, JSON.stringify(p), key, ref]);

test("legacy coastal-satin drafts are linked to a recipe under the canonical key", async () => {
  const db = await database(async (d) => {
    await insertRun(d, alice, LEGACY_KEY, payload(LEGACY_KEY));
    await insertRun(d, alice, LEGACY_KEY, payload(LEGACY_KEY));
    await insertRun(d, bob, LEGACY_KEY, payload(LEGACY_KEY, { 장석: 50, 규석: 50 })); // other materials: must stay untouched
  });
  try {
    const runs = (await db.query(
      "select user_id, recipe_id, recipe_ref_id, payload#>>'{recipe,id}' pid, payload#>'{recipe,colorants}' cols from public.aice_runs order by user_id")).rows;
    const mine = runs.filter((r) => r.user_id === alice);
    assert.equal(mine.length, 2);
    for (const r of mine) {
      assert.equal(r.recipe_id, CANONICAL);
      assert.equal(r.pid, CANONICAL);
      assert.deepEqual(r.cols, {});
      assert.ok(r.recipe_ref_id);
    }
    assert.equal(mine[0].recipe_ref_id, mine[1].recipe_ref_id, "both runs share one recipe row");
    const recipes = (await db.query("select owner_id, name, materials, colorants, composition_key from public.recipes")).rows;
    assert.deepEqual(recipes, [{ owner_id: alice, name: "해안 사틴 01", materials: MATERIALS, colorants: {}, composition_key: CANONICAL }]);
    const other = runs.find((r) => r.user_id === bob);
    assert.equal(other.recipe_id, LEGACY_KEY);
    assert.equal(other.recipe_ref_id, null);
  } finally { await db.close(); }
});

test("the migration is a no-op on a database without legacy runs", async () => {
  const db = await database();
  try {
    assert.equal((await db.query("select count(*)::int n from public.recipes")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("guard: a run whose recipe_id disagrees with its recipe_ref_id is refused", async () => {
  const db = await database();
  try {
    await as(db, alice);
    const { rows: [a] } = await db.query(
      `insert into public.recipes(name, materials, composition_key) values ('A','{"장석":1}','glaze-v1-aaaa') returning id`);
    const { rows: [b] } = await db.query(
      `insert into public.recipes(name, materials, composition_key) values ('B','{"규석":1}','glaze-v1-bbbb') returning id`);
    const { rows: [run] } = await insertRun(db, alice, "glaze-v1-aaaa", payload("glaze-v1-aaaa"), a.id);
    await assert.rejects(db.query("update public.aice_runs set recipe_ref_id=$2 where id=$1", [run.id, b.id]), { code: "23514" });
    await assert.rejects(insertRun(db, alice, "glaze-v1-bbbb", payload("glaze-v1-aaaa"), b.id), { code: "23514" }); // payload wins -> aaaa != bbbb
    assert.equal((await insertRun(db, alice, "glaze-v1-bbbb", payload("glaze-v1-bbbb"), b.id)).rows.length, 1);
  } finally { await db.close(); }
});

test("guard: no recipe_ref_id means no check, and a recipe that turned private does not block unrelated updates", async () => {
  const db = await database();
  try {
    await as(db, alice);
    const { rows: [pub] } = await db.query(
      `insert into public.recipes(name, materials, composition_key, is_public) values ('P','{"장석":1}','glaze-v1-pub',true) returning id`);
    await as(db, bob);
    assert.equal((await insertRun(db, bob, "anything", payload("anything"))).rows.length, 1);
    const { rows: [run] } = await insertRun(db, bob, "glaze-v1-pub", payload("glaze-v1-pub"), pub.id);
    await as(db, alice);
    await db.query("update public.recipes set is_public=false where id=$1", [pub.id]);
    await as(db, bob);
    const { rowCount } = await db.query("update public.aice_runs set payload=$2 where id=$1", [run.id, JSON.stringify(payload("glaze-v1-pub", MATERIALS, { title: "renamed" }))]);
    assert.equal(rowCount, 1);
  } finally { await db.close(); }
});
