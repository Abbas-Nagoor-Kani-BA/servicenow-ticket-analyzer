import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";

import { createIdbDatabase } from "../data/idb.ts";
import { CachedTicketRepository } from "../data/repositories/ticket-repository.ts";
import { CachedTimelineRepository } from "../data/repositories/timeline-repository.ts";
import { FakeSnRemote } from "../data/datasource/sn-remote.ts";

/*
 * Exercises the real IndexedDB code path against fake-indexeddb.
 *
 * The in-memory database used elsewhere cannot catch IndexedDB-specific
 * mistakes: it silently hid a bug where the transaction helper overwrote the
 * cursor's own `onsuccess` handler, so `deleteWhere` walked nothing and
 * `purgeExpired` deleted nothing.
 */

let seq = 0;
const freshDb = () => createIdbDatabase(`test-cache-${++seq}`, 1);

test("idb store round-trips values", async () => {
  const store = freshDb().store("queries");
  assert.equal(await store.get("missing"), undefined);
  await store.put("k", { at: 1 });
  assert.deepEqual(await store.get("k"), { at: 1 });
  await store.delete("k");
  assert.equal(await store.get("k"), undefined);
});

test("deleteWhere walks the cursor and reports what it removed", async () => {
  const store = freshDb().store("queries");
  await store.put("a", { at: 1 });
  await store.put("b", { at: 2 });
  await store.put("c", { at: 3 });

  const removed = await store.deleteWhere((v) => v.at < 3);

  assert.equal(removed, 2);
  assert.equal(await store.get("a"), undefined);
  assert.equal(await store.get("b"), undefined);
  assert.deepEqual(await store.get("c"), { at: 3 });
});

test("deleteWhere removes nothing when the predicate never matches", async () => {
  const store = freshDb().store("timelines");
  await store.put("a", { at: Date.now() });
  assert.equal(await store.deleteWhere(() => false), 0);
  assert.ok(await store.get("a"));
});

test("clearAll empties every store", async () => {
  const db = freshDb();
  await db.store("queries").put("a", { at: 1 });
  await db.store("timelines").put("b", { at: 1 });

  await db.clearAll();

  assert.equal(await db.store("queries").get("a"), undefined);
  assert.equal(await db.store("timelines").get("b"), undefined);
});

test("ticket repository caches through real IndexedDB", async () => {
  const remote = new FakeSnRemote();
  remote.records["incident|q"] = [{ sys_id: "1" }];
  const repo = new CachedTicketRepository(remote, freshDb());

  const first = await repo.list({ table: "incident", encodedQuery: "q", fields: [] });
  assert.equal(first.source, "remote");

  const second = await repo.list({ table: "incident", encodedQuery: "q", fields: [] });
  assert.equal(second.source, "cache");
  assert.equal(remote.calls.length, 1);
});

test("a repository reopening the same database name reuses the entry", async () => {
  const dbName = `test-shared-${++seq}`;

  const seeder = new FakeSnRemote();
  seeder.records["incident|q"] = [{ sys_id: "1" }];
  await new CachedTicketRepository(seeder, createIdbDatabase(dbName, 1)).list({
    table: "incident",
    encodedQuery: "q",
    fields: []
  });

  const remote = new FakeSnRemote();
  const reopened = new CachedTicketRepository(remote, createIdbDatabase(dbName, 1));
  const result = await reopened.list({ table: "incident", encodedQuery: "q", fields: [] });

  assert.equal(result.source, "cache");
  assert.equal(remote.calls.length, 0, "survives a service worker restart");
});

test("purgeExpired actually deletes stale rows over IndexedDB", async () => {
  const db = freshDb();
  const store = db.store("queries");
  await store.put("fresh", { at: Date.now(), table: "incident", query: "q", records: [] });
  await store.put("stale", { at: Date.now() - 20 * 60 * 1000, table: "incident", query: "q", records: [] });

  const repo = new CachedTicketRepository(new FakeSnRemote(), db);
  await repo.purgeExpired();

  assert.ok(await store.get("fresh"));
  assert.equal(await store.get("stale"), undefined);
});

test("timeline repository persists through real IndexedDB", async () => {
  const db = freshDb();
  const remote = new FakeSnRemote();
  remote.timelines.a = [{ field: "state" }];
  const repo = new CachedTimelineRepository(remote, db);

  await repo.getMany({ table: "incident", tickets: [{ sysId: "a", updatedOn: "2026-01-01 00:00:00" }] });

  const stored = await db.store("timelines").get<any>("incident:a");
  assert.equal(stored.events.length, 1);

  remote.calls.length = 0;
  const again = await repo.getMany({ table: "incident", tickets: [{ sysId: "a", updatedOn: "2026-01-01 00:00:00" }] });
  assert.equal(remote.calls.length, 0);
  assert.equal(again.reused, 1);
});
