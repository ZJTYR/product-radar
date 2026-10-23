import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase, postgresQuery } from '../lib/database.ts';

test('parameterized queries, durable writes and atomic batches preserve existing data', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'radar-db-'));
 const path = join(dir, 'test.sqlite');
 let db = new RadarDatabase(undefined, path);
 try {
  assert.equal(postgresQuery('SELECT * FROM favorites WHERE user_id=? AND item_id=?'), 'SELECT * FROM favorites WHERE user_id=$1 AND item_id=$2');
  await db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('original', "A 'quoted' value", 'now').run();
  await assert.rejects(db.batch([
   db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('new', 'must roll back', 'now'),
   db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').bind('original', 'duplicate key', 'now'),
  ]));
  assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('new').first(), null);
  db.close(); db = new RadarDatabase(undefined, path);
  assert.equal((await db.prepare('SELECT value FROM settings WHERE key=?').bind('original').first()).value, "A 'quoted' value");
 } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
