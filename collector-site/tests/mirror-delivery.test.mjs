import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deliverMirrorQueue, mirrorPayloadBatches } from '../lib/mirror-delivery.ts';
import { catalogSchema, ingestSchema } from '../lib/validation.ts';
import { seedItems } from '../lib/seed.ts';

const origin = 'https://product-radar-gules.vercel.app';
const items = Array.from({length: 64}, (_, index) => ({...seedItems[0], id: `batch-product-${index}`}));
const edition = {date: '2026-10-22', status: 'complete', items: items.slice(0, 9)};

function fixture() {
 const sqlite = new DatabaseSync(':memory:');
 sqlite.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);');
 const put = sqlite.prepare('INSERT INTO settings VALUES(?,?)');
 put.run('mirror:1', JSON.stringify({path:'/api/catalog',payload:{items}}));
 put.run('mirror:2', JSON.stringify({path:'/api/ingest',payload:edition}));
 const db = { prepare(sql) {
  const statement = sqlite.prepare(sql);
  return {
   async all() { return {results: statement.all()}; },
   async first() { return statement.get() ?? null; },
   bind(...values) { return {async run() { return statement.run(...values); }}; },
  };
 } };
 return {sqlite, env:{DB:db,RADAR_MIRROR_ORIGIN:origin,RADAR_MIRROR_TOKEN:'test-only-mirror-token'}};
}

test('legacy catalog over 50 items is split in order and ingestion stays a complete edition', async () => {
 const {sqlite,env} = fixture();
 const calls = [];
 try {
  const result = await deliverMirrorQueue(env, async (url, options) => {
   const payload = JSON.parse(options.body);
   calls.push({path:url.pathname,payload});
   assert.equal(url.origin, origin);
   assert.equal(options.redirect, 'manual');
   assert.equal(options.headers['x-vercel-protection-bypass'], 'test-only-mirror-token');
   if (url.pathname === '/api/catalog') {
    assert.equal(catalogSchema.safeParse(payload).success, true);
    // 原队列行在第一批成功后仍存在，直到所有分批请求成功。
    assert.ok(sqlite.prepare('SELECT key FROM settings WHERE key=?').get('mirror:1'));
   } else assert.equal(ingestSchema.safeParse(payload).success, true);
   return new Response('{}', {status:200});
  });
  assert.deepEqual(calls.map(call=>[call.path,call.payload.items.length]), [['/api/catalog',50],['/api/catalog',14],['/api/ingest',9]]);
  assert.deepEqual(calls.slice(0,2).flatMap(call=>call.payload.items), items);
  assert.deepEqual(calls[2].payload, edition);
  assert.deepEqual(result,{configured:true,delivered:2,pending:0,failure:null});
 } finally { sqlite.close(); }
});

test('partial catalog failure retains the whole original row and retries safely before the queued edition', async () => {
 const {sqlite,env} = fixture();
 const destination = new Map();
 let attempt = 0;
 const send = async (url,options) => {
  const payload = JSON.parse(options.body);
  if (++attempt === 2) return new Response('{}',{status:400});
  for (const item of payload.items) destination.set(item.id,item);
  return new Response('{}',{status:200});
 };
 try {
  const failed = await deliverMirrorQueue(env,send);
  assert.equal(failed.delivered,0);
  assert.equal(failed.pending,2);
  assert.deepEqual(failed.failure,{path:'/api/catalog',status:400,reason:'destination_rejected'});
  assert.equal(destination.size,50);
  assert.deepEqual(JSON.parse(sqlite.prepare('SELECT value FROM settings WHERE key=?').get('mirror:1').value).payload,{items});
  assert.equal(attempt,2); // 后续整期简报尚未发送。
  const retried = await deliverMirrorQueue(env,send);
  assert.deepEqual(retried,{configured:true,delivered:2,pending:0,failure:null});
  assert.equal(destination.size,64); // 重放前50条是按稳定ID覆盖，没有重复记录。
  assert.equal(attempt,5);
 } finally { sqlite.close(); }
});

test('redirect and transport failures retain the row without forwarding credentials or exposing content', async () => {
 const {sqlite,env} = fixture();
 try {
  let calls = 0;
  const redirected = await deliverMirrorQueue(env,async (_url,options)=>{
   calls++; assert.equal(options.redirect,'manual');
   return new Response(null,{status:302,headers:{location:'https://outside.example/'}});
  });
  assert.equal(calls,1);
  assert.equal(redirected.pending,2);
  assert.equal(redirected.failure.status,302);
  const transport = await deliverMirrorQueue(env,async ()=>{throw new TypeError('private test-only-mirror-token and product content');});
  assert.deepEqual(transport.failure,{path:'/api/catalog',reason:'TypeError'});
  assert.doesNotMatch(JSON.stringify(transport), /test-only-mirror-token|product content/);
  await assert.rejects(deliverMirrorQueue({...env,RADAR_MIRROR_ORIGIN:'https://outside.example/'},async()=>{throw new Error('must not send');}),/Unexpected mirror destination/);
 } finally { sqlite.close(); }
});

test('batching never rewrites complete-edition or system payloads', () => {
 const largeEdition = {...edition,items};
 assert.deepEqual(mirrorPayloadBatches('/api/ingest',largeEdition),[largeEdition]);
 const system = {schedule_status:'test'};
 assert.deepEqual(mirrorPayloadBatches('/api/system',system),[system]);
 assert.deepEqual(mirrorPayloadBatches('/api/catalog',{items:[]}),[{items:[]}]);
 assert.deepEqual(mirrorPayloadBatches('/api/catalog',{items:items.slice(0,50)}),[{items:items.slice(0,50)}]);
});
