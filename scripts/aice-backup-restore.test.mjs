import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const owner = "00000000-0000-0000-0000-000000000011";

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
    insert into auth.users values ('${owner}');`);
  for (const file of ["20260915000000_initial.sql", "20260916010000_aice_runs.sql"])
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  return db;
}

test("AiceRun logical data survives a clean migration backup and restore", async () => {
  const source = await migratedDatabase();
  const target = await migratedDatabase();
  try {
    const payload = { schema_version: 3, run_id: "backup-sample", revision: 4, title: "backup sample", status: "evaluated", goal: { gloss: "satin", transparency: "opaque" }, recipe: { id: "recipe-1" }, ware: { preset: "bowl" }, application: {}, thickness: {}, loading: {}, curves: {}, pid: {}, result: {}, sources: [{ source_type: "synthetic" }], consent: { share_allowed: true }, versions: { data: "data-3", rule_model: "aice-rule-rag-1", simulator: "aice-kiln-explanatory-1", predictor: null }, created_at: "2026-09-17T00:00:00Z", updated_at: "2026-09-17T00:00:00Z" };
    const { rows: [run] } = await source.query(`insert into public.aice_runs(title,payload,schema_version,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public) values ('Backup sample',$1,3,'evaluated','satin','opaque','recipe-1','bowl',true) returning *`, [JSON.stringify(payload)]);
    await source.query(`insert into public.aice_run_sources(run_id,source_type,reference,limitation,confidence) values ($1,'synthetic','backup fixture','not observed','low')`, [run.id]);
    await source.query(`insert into public.aice_consents(run_id,share_allowed,photo_rights_confirmed,pii_reviewed,location_removed,granted_at) values ($1,true,true,true,true,now())`, [run.id]);

    const backup = {
      runs: (await source.query("select id,user_id,title,payload,schema_version,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public,created_at,updated_at from public.aice_runs")).rows,
      sources: (await source.query("select run_id,user_id,source_type,reference,locator,limitation,confidence,created_at from public.aice_run_sources")).rows,
      consents: (await source.query("select run_id,user_id,share_allowed,photo_rights_confirmed,pii_reviewed,location_removed,granted_at,withdrawn_at,updated_at from public.aice_consents")).rows,
    };

    for (const item of backup.runs) await target.query(`insert into public.aice_runs(id,user_id,title,payload,schema_version,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [item.id, item.user_id, item.title, JSON.stringify(item.payload), item.schema_version, item.status, item.goal_gloss, item.goal_transparency, item.recipe_id, item.ware_preset, item.is_public, item.created_at, item.updated_at]);
    for (const item of backup.sources) await target.query(`insert into public.aice_run_sources(run_id,user_id,source_type,reference,locator,limitation,confidence,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [item.run_id, item.user_id, item.source_type, item.reference, item.locator, item.limitation, item.confidence, item.created_at]);
    for (const item of backup.consents) await target.query(`insert into public.aice_consents(run_id,user_id,share_allowed,photo_rights_confirmed,pii_reviewed,location_removed,granted_at,withdrawn_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [item.run_id, item.user_id, item.share_allowed, item.photo_rights_confirmed, item.pii_reviewed, item.location_removed, item.granted_at, item.withdrawn_at, item.updated_at]);

    const { rows: [restored] } = await target.query("select payload,is_public from public.aice_runs where id=$1", [run.id]);
    assert.equal(restored.payload.run_id, "backup-sample");
    assert.equal(restored.payload.versions.rule_model, "aice-rule-rag-1");
    assert.equal(restored.payload.sources[0].source_type, "synthetic");
    assert.equal(restored.is_public, true);
    assert.equal((await target.query("select source_type from public.aice_run_sources where run_id=$1", [run.id])).rows[0].source_type, "synthetic");
    assert.equal((await target.query("select share_allowed from public.aice_consents where run_id=$1", [run.id])).rows[0].share_allowed, true);
  } finally {
    await source.close(); await target.close();
  }
});
