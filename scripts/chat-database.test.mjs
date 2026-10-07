import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const alice = "00000000-0000-0000-0000-000000000001";
const bob = "00000000-0000-0000-0000-000000000002";
const messageId = "00000000-0000-0000-0000-000000000003";

test("chat messages persist for their owner and remain private to other accounts", async () => {
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
    await db.exec(await readFile(new URL("../supabase/migrations/20261005000000_chat_messages.sql", import.meta.url), "utf8"));
    const asUser = async (id) => {
      await db.exec("reset role; set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    };
    await asUser(alice);
    await db.query("insert into public.chat_threads(owner_id,peer_id,username,display_name) values ($1,'mira','mira.ceramic','미라')", [alice]);
    await db.query("insert into public.chat_messages(id,owner_id,peer_id,body,sender) values ($1,$2,'mira','안녕하세요','me')", [messageId, alice]);
    const saved = await db.query("select body from public.chat_messages where owner_id = $1", [alice]);
    assert.equal(saved.rows[0].body, "안녕하세요");
    await assert.rejects(
      db.query("insert into public.chat_messages(id,owner_id,peer_id,body,sender) values (gen_random_uuid(),$1,'mira','위조','me')", [bob]),
      { code: "42501" },
    );
    await asUser(bob);
    assert.equal((await db.query("select * from public.chat_threads")).rows.length, 0);
    assert.equal((await db.query("select * from public.chat_messages")).rows.length, 0);
    await asUser(alice);
    assert.equal((await db.query("select body from public.chat_messages where id = $1", [messageId])).rows[0].body, "안녕하세요");
  } finally {
    await db.close();
  }
});
