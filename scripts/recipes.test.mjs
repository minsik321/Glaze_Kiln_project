import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-00000000000a";
const bob = "00000000-0000-0000-0000-00000000000b";
const KEY_A = "glaze-v1-aaaa", KEY_B = "glaze-v1-bbbb";
const SKIP = new Set(["20261005020000_aice_vectors.sql", "20261005030000_aice_vector_corpus.sql", "20261007000000_aice_vectors_1536.sql"]);

async function database({ beforeRecipes } = {}) {
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
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort()) {
    if (SKIP.has(file)) continue;
    if (file.endsWith("_recipes.sql") && beforeRecipes) await beforeRecipes(db);
    await db.exec(await readFile(new URL(file, dir), "utf8"));
  }
  return db;
}
const as = async (db, id) => {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
};
const payload = (name, materials) => ({ schema_version: "3", recipe: { name, materials, colorants: {} } });
const save = async (db, key, name, materials, ref = null) => (await db.query(
  "select id, recipe_ref_id from public.save_aice_run(gen_random_uuid(), $1::jsonb)",
  [JSON.stringify({ title: name, payload: payload(name, materials), schema_version: 3, status: "simulated", goal_gloss: "satin",
    goal_transparency: "opaque", recipe_id: key, ware_preset: "bowl", is_public: false, recipe_ref_id: ref })])).rows[0];

test("existing runs are backfilled into one recipe per user and composition", async () => {
  const db = await database({ beforeRecipes: async (d) => {
    for (const day of ["2026-09-01", "2026-09-02"]) await d.query(
      `insert into public.aice_runs(user_id,title,payload,status,goal_gloss,goal_transparency,recipe_id,ware_preset,created_at)
       values ($1,'old',$2::jsonb,'simulated','satin','opaque',$3,'bowl',$4)`,
      [alice, JSON.stringify(payload(`사틴 ${day}`, { 장석: 50, 규석: 50 })), KEY_A, day]);
  } });
  try {
    const recipes = await db.query("select owner_id, name from public.recipes");
    assert.deepEqual(recipes.rows, [{ owner_id: alice, name: "사틴 2026-09-01" }]);
    const linked = await db.query("select count(*)::int n from public.aice_runs where recipe_ref_id is not null");
    assert.equal(linked.rows[0].n, 2);
  } finally { await db.close(); }
});

test("using a public recipe unchanged links to it; editing it forks into my own recipe", async () => {
  const db = await database();
  try {
    await as(db, alice);
    const original = await save(db, KEY_A, "앨리스 사틴", { 장석: 40, 규석: 60 });
    assert.ok(original.recipe_ref_id, "first run creates alice's recipe");
    await db.query("update public.recipes set is_public = true where id = $1", [original.recipe_ref_id]);

    await as(db, bob);
    const reused = await save(db, KEY_A, "그대로 사용", { 장석: 40, 규석: 60 }, original.recipe_ref_id);
    assert.equal(reused.recipe_ref_id, original.recipe_ref_id, "bob's run points at alice's recipe");
    assert.equal((await db.query("select count(*)::int n from public.recipes where owner_id = $1", [bob])).rows[0].n, 0);

    const forked = await save(db, KEY_B, "내 가마용", { 장석: 45, 규석: 55 }, original.recipe_ref_id);
    const row = (await db.query("select owner_id, forked_from_id, name from public.recipes where id = $1", [forked.recipe_ref_id])).rows[0];
    assert.deepEqual(row, { owner_id: bob, forked_from_id: original.recipe_ref_id, name: "내 가마용" });

    const again = await save(db, KEY_B, "내 가마용 2회", { 장석: 45, 규석: 55 }, original.recipe_ref_id);
    assert.equal(again.recipe_ref_id, forked.recipe_ref_id, "same edited composition reuses bob's fork");

    await assert.rejects(db.query("update public.recipes set name = 'x' where id = $1 returning id", [original.recipe_ref_id])
      .then((r) => { if (!r.rows.length) throw new Error("no row"); }), "bob cannot edit alice's recipe");
  } finally { await db.close(); }
});

test("a private recipe cannot be referenced by someone else", async () => {
  const db = await database();
  try {
    await as(db, alice);
    const mine = await save(db, KEY_A, "비공개", { 장석: 40, 규석: 60 });
    await as(db, bob);
    const other = await save(db, KEY_A, "같은 배합", { 장석: 40, 규석: 60 }, mine.recipe_ref_id);
    assert.notEqual(other.recipe_ref_id, mine.recipe_ref_id);
    const row = (await db.query("select owner_id, forked_from_id from public.recipes where id = $1", [other.recipe_ref_id])).rows[0];
    assert.deepEqual(row, { owner_id: bob, forked_from_id: null });
  } finally { await db.close(); }
});

test("deleting an original keeps forks and runs, only the links become null", async () => {
  const db = await database();
  try {
    await as(db, alice);
    const original = await save(db, KEY_A, "원본", { 장석: 40, 규석: 60 });
    await db.query("update public.recipes set is_public = true where id = $1", [original.recipe_ref_id]);
    await as(db, bob);
    const reused = await save(db, KEY_A, "그대로", { 장석: 40, 규석: 60 }, original.recipe_ref_id);
    const forked = await save(db, KEY_B, "변형", { 장석: 45, 규석: 55 }, original.recipe_ref_id);
    await db.exec("reset role");
    await db.query("delete from auth.users where id = $1", [alice]);
    assert.equal((await db.query("select count(*)::int n from public.recipes where owner_id = $1", [alice])).rows[0].n, 0);
    assert.equal((await db.query("select recipe_ref_id from public.aice_runs where id = $1", [reused.id])).rows[0].recipe_ref_id, null);
    const fork = (await db.query("select forked_from_id from public.recipes where id = $1", [forked.recipe_ref_id])).rows[0];
    assert.equal(fork.forked_from_id, null);
    const snapshot = (await db.query("select payload->'recipe'->>'name' n from public.aice_runs where id = $1", [reused.id])).rows[0];
    assert.equal(snapshot.n, "그대로", "the run keeps its recipe snapshot");
  } finally { await db.close(); }
});
