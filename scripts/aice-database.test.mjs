import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";
const denied = { code: "42501" };
const invalid = { code: "23514" };

async function withDatabase(run) {
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
      insert into auth.users values ('${alice}'), ('${bob}');`);
    for (const file of ["20260915000000_initial.sql", "20260916010000_aice_runs.sql"])
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const asUser = async (id) => {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    };
    await run(db, asUser);
  } finally { await db.close(); }
}

const payload = {
  schema_version: 2, run_id: "sample", revision: 1, title: "sample", status: "simulated",
  goal: { gloss: "satin", transparency: "opaque" }, recipe: { id: "recipe-1" }, ware: { preset: "bowl" },
  application: {}, thickness: {}, loading: {}, curves: {}, pid: {}, result: {}, sources: [], consent: {}, versions: {},
  created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z",
};

test("AiceRun RLS separates private, consented public, and withdrawn runs", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    const { rows: [run] } = await db.query(
      `insert into public.aice_runs(title,payload,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public)
       values ('Sample',$1,'simulated','satin','opaque','recipe-1','bowl',true) returning *`, [JSON.stringify(payload)],
    );
    await db.query(`insert into public.aice_run_sources(run_id,source_type,reference,limitation,confidence) values ($1,'literature','plan','no quality guarantee','medium')`, [run.id]);
    await asUser(bob);
    assert.equal((await db.query("select * from public.aice_runs")).rows.length, 0);
    await asUser(alice);
    await db.query(`insert into public.aice_consents(run_id,share_allowed,photo_rights_confirmed,pii_reviewed,location_removed,granted_at) values ($1,true,true,true,true,now())`, [run.id]);
    await asUser(bob);
    assert.equal((await db.query("select id from public.aice_runs")).rows.length, 1);
    assert.equal((await db.query("select source_type from public.aice_run_sources")).rows[0].source_type, "literature");
    await asUser(alice);
    await db.query("update public.aice_consents set withdrawn_at=now() where run_id=$1", [run.id]);
    await asUser(bob);
    assert.equal((await db.query("select * from public.aice_runs")).rows.length, 0);
  });
});

test("photo storage and personal calibration remain owner scoped", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    const { rows: [run] } = await db.query(
      `insert into public.aice_runs(title,payload,status,goal_gloss,goal_transparency,recipe_id,ware_preset)
       values ('Sample',$1,'simulated','satin','opaque','recipe-1','bowl') returning *`, [JSON.stringify(payload)],
    );
    await assert.rejects(db.query(`insert into public.aice_photos(run_id,kind,bucket_id,storage_path,source_type,is_public) values ($1,'result','aice-result-photos',$2,'observed',true)`, [run.id, `${alice}/result.jpg`]), invalid);
    await db.query(`insert into public.aice_photos(run_id,kind,bucket_id,storage_path,source_type,rights_confirmed) values ($1,'result','aice-result-photos',$2,'observed',true)`, [run.id, `${alice}/result.jpg`]);
    await db.query(`insert into public.personal_calibrations(kiln_profile_id,clay_body,coefficients,provenance) values ('kiln-a','stoneware','{}','[]')`);
    await db.query(`insert into storage.objects(bucket_id,name) values ('aice-result-photos',$1)`, [`${alice}/result.jpg`]);
    await assert.rejects(db.query(`insert into storage.objects(bucket_id,name) values ('aice-result-photos',$1)`, [`${bob}/forged.jpg`]), denied);
    await asUser(bob);
    assert.equal((await db.query("select * from public.aice_photos")).rows.length, 0);
    assert.equal((await db.query("select * from public.personal_calibrations")).rows.length, 0);
    assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
  });
});

test("AiceRun constraints reject unknown provenance and legacy records stay readable", async () => {
  await withDatabase(async (db, asUser) => {
    await asUser(alice);
    const { rows: [run] } = await db.query(
      `insert into public.aice_runs(title,payload,status,goal_gloss,goal_transparency,recipe_id,ware_preset)
       values ('Sample',$1,'draft','satin','opaque','recipe-1','bowl') returning *`, [JSON.stringify(payload)],
    );
    await assert.rejects(db.query(`insert into public.aice_run_sources(run_id,source_type,reference,limitation,confidence) values ($1,'measured','x','x','low')`, [run.id]), invalid);
    await db.query("insert into public.work_records(title,payload) values ('Legacy','{}')");
    assert.equal((await db.query("select title from public.legacy_work_records_readonly")).rows[0].title, "Legacy");
  });
});

