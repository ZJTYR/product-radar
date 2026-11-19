import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RadarDatabase } from '../lib/database.ts';
import { seedItems } from '../lib/seed.ts';
import { readingState } from '../lib/feedback.ts';
import { itemReadingState, recordItemRead, editionReadingState, setEditionRead, ReadingRecordMissing, ReadingVersionConflict } from '../lib/reading.ts';
import { recommendItems } from '../lib/recommendations.ts';
import { persistEdition } from '../lib/editions.ts';
import { editionReadSchema, itemReadSchema, itemSchema, recommendationExcludeSchema, recommendationScopeSchema } from '../lib/validation.ts';

const at=Date.parse('2026-10-26T08:30:00Z');
const version='2026-10-26T00:30:00.000Z';
const makeItem=(id,overrides={})=>({...seedItems[0],id,name:id,kind:'product',website:`https://example.com/${id}`,github:undefined,repo:undefined,category:'知识协作',tags:['文档'],discoveredAt:'2026-10-25T00:30:00Z',publishedAt:null,...overrides});
const items=[
 makeItem('tool-one',{github:'https://github.com/example/one',stars:100}),
 makeItem('tool-two',{github:'https://github.com/example/two',stars:200}),
 makeItem('consumer-tool',{github:undefined,stars:undefined}),
 makeItem('design',{kind:'design'}),
 makeItem('ai-new',{kind:'ai',aiApplication:'agents',publishedAt:'2026-10-26T00:00:00Z'}),
 makeItem('ai-old',{kind:'ai',aiApplication:'knowledge',publishedAt:'2026-10-24T00:00:00Z'}),
 makeItem('ai-unknown-date',{kind:'ai',aiApplication:'integration',publishedAt:null,discoveredAt:'2026-10-25T12:00:00Z'}),
 makeItem('ai-unclassified',{kind:'ai'}),
 makeItem('ai-stale',{kind:'ai',aiApplication:'agents',publishedAt:'2026-10-01T00:00:00Z'}),
 makeItem('ai-future',{kind:'ai',aiApplication:'multimodal',publishedAt:'2026-10-27T00:00:00Z'}),
];
async function fixture(run){
 const dir=mkdtempSync(join(tmpdir(),'radar-reading-'));const path=join(dir,'test.sqlite');const db=new RadarDatabase(undefined,path);
 try{
  await db.batch([
   ...items.map(item=>db.prepare('INSERT INTO intel_items(id,payload,updated_at) VALUES(?,?,?)').bind(item.id,JSON.stringify(item),version)),
   db.prepare('INSERT INTO editions(date,payload,updated_at,status) VALUES(?,?,?,?)').bind('2026-10-26',JSON.stringify(items.slice(0,2)),version,'complete'),
  ]);
  await run(db,path);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
}

test('opening a product persists a neutral read across sessions without changing feedback, favorites or edition state',async()=>fixture(async(db,path)=>{
 const first=await recordItemRead(db,'owner','tool-one');
 const replay=await recordItemRead(db,'owner','tool-one');
 assert.deepEqual(first,replay);
 assert.deepEqual(await readingState(db,'owner'),{feedback:[],favorites:[]});
 assert.equal((await editionReadingState(db,'owner')).days[0].readAt,null);
 const reopened=new RadarDatabase(undefined,path);
 try{
  const state=await itemReadingState(reopened,'owner');assert.equal(state.items.length,1);assert.equal(state.items[0].itemId,'tool-one');
  assert.deepEqual(await itemReadingState(reopened,'other'),{items:[]});
  const baseline=recommendItems(items,[],[],30,at);
  const next=recommendItems(items,[],[],30,at,{readItems:state.items});
  assert.ok(!next.items.some(item=>item.id==='tool-one'));
  assert.deepEqual(next.profile,baseline.profile);assert.equal(next.feedbackCount,0);
  await assert.rejects(recordItemRead(reopened,'owner','missing'),ReadingRecordMissing);
  assert.equal((await itemReadingState(reopened,'owner')).items.length,1);
 }finally{reopened.close();}
}));

test('confirming read is durable and idempotent, including for old opened records and after an ordinary read', async()=>fixture(async(db,path)=>{
 const [opened] = (await recordItemRead(db,'owner','ai-new')).items;
 assert.equal(opened.confirmedAt,null);
 const [confirmed] = (await recordItemRead(db,'owner','ai-new',true)).items;
 assert.equal(confirmed.readAt,opened.readAt);
 assert.ok(confirmed.confirmedAt);
 const checkpoint = await recordItemRead(db,'owner','design',true);
 assert.ok(checkpoint.items.find(item=>item.itemId==='design')?.confirmedAt);
 const reopened = new RadarDatabase(undefined,path);
 try {
  await Promise.all([recordItemRead(reopened,'owner','ai-new',true),recordItemRead(db,'owner','ai-new')]);
  assert.deepEqual(await itemReadingState(reopened,'owner'),checkpoint);
  assert.deepEqual(await itemReadingState(reopened,'other'),{items:[]});
  assert.deepEqual(await readingState(reopened,'owner'),{feedback:[],favorites:[]});
 } finally { reopened.close(); }
}));

test('edition reading tracks the version actually opened, remains separate from product reads, and supports unread',async()=>fixture(async db=>{
 const read=await setEditionRead(db,'owner','2026-10-26',true,version);
 assert.ok(read.days[0].readAt);assert.equal(read.days[0].hasUpdates,false);assert.equal(read.days[0].count,2);
 assert.deepEqual(await itemReadingState(db,'owner'),{items:[]});
 assert.equal((await editionReadingState(db,'other')).days[0].readAt,null);
 const updated='2026-10-26T01:30:00.000Z';
 await db.prepare('UPDATE editions SET updated_at=?,payload=? WHERE date=?').bind(updated,JSON.stringify(items.slice(0,3)),'2026-10-26').run();
 assert.equal((await editionReadingState(db,'owner')).days[0].hasUpdates,true);
 // A delayed request for the older opened snapshot must never mark the new edition read.
 assert.equal((await setEditionRead(db,'owner','2026-10-26',true,version)).days[0].hasUpdates,true);
 assert.equal((await setEditionRead(db,'owner','2026-10-26',true,updated)).days[0].hasUpdates,false);
 assert.equal((await setEditionRead(db,'owner','2026-10-26',true,version)).days[0].hasUpdates,false);
 await assert.rejects(setEditionRead(db,'owner','2026-10-26',true,'2026-10-27T00:00:00Z'),ReadingVersionConflict);
 await assert.rejects(setEditionRead(db,'owner','2026-10-26',true),ReadingVersionConflict);
 await assert.rejects(setEditionRead(db,'owner','2026-10-25',true,version),ReadingRecordMissing);
 const unread=await setEditionRead(db,'owner','2026-10-26',false);
 assert.equal(unread.days[0].readAt,null);assert.equal(unread.days[0].hasUpdates,false);
}));

test('grid scopes and exclusions reserve unseen candidates without adding negative preference signals',()=>{
 const options={scope:'products',excludeIds:['tool-one'],readItems:[{itemId:'tool-two',readAt:version}]};
 const next=recommendItems(items,[],[],24,at,options);
 assert.deepEqual(next.items.map(item=>item.id),['consumer-tool']);assert.equal(next.remaining,1);
 assert.deepEqual(next.profile,{positiveTopics:[],negativeTopics:[]});
 const github=recommendItems(items,[],[],24,at,{scope:'github'});
 assert.deepEqual(new Set(github.items.map(item=>item.id)),new Set(['tool-one','tool-two']));
 const excluded=recommendItems(items,[{itemId:'tool-one',action:'not_interested',updatedAt:version}],[{itemId:'tool-two'}],24,at,{scope:'github'});
 assert.equal(excluded.remaining,0);
});

test('product reads and reserved slots exclude the same product across scopes and preserve its news', () => {
 const original=makeItem('home-assistant',{website:'https://www.home-assistant.io/',repo:'Home-Assistant/Core',github:'https://github.com/home-assistant/core',stars:100});
 const rewritten=makeItem('home-assistant-revised',{website:'https://home-assistant.io/new-intro',github:'https://github.com/home-assistant/core/releases',stars:100});
 const withoutRepo=makeItem('home-assistant-short',{website:'https://home-assistant.io/?utm_source=brief'});
 const event=makeItem('community-market',{kind:'news',website:original.website,repo:original.repo,newsTopic:'product',publishedAt:'2026-10-26T01:00:00Z'});
 const other=makeItem('another-product',{website:'https://home-assistant.io/another-product',repo:'sample/other',github:'https://github.com/sample/other',stars:50});
 const catalog=[original,rewritten,withoutRepo,event,other];
 const readItems=[{itemId:original.id,readAt:version}];
 const baseline=recommendItems(catalog,[],[],24,at,{scope:'products'});
 assert.equal(baseline.remaining,2);
 for(const scope of ['products','github','all']){
  const result=recommendItems(catalog,[],[],24,at,{scope,readItems});
  assert.deepEqual(new Set(result.items.map(item=>item.id)),new Set(scope==='all'?[other.id,event.id]:[other.id]));
  assert.equal(result.feedbackCount,0);
 }
 assert.deepEqual(recommendItems(catalog,[],[],24,at,{scope:'products',excludeIds:[withoutRepo.id]}).items.map(item=>item.id),[other.id]);
 assert.deepEqual(recommendItems(catalog,[],[],6,at,{scope:'frontier',readItems}).items.map(item=>item.id),[event.id]);
});

test('AI frontier requires an explicit application layer tag and retains dated historical events after recent ones',()=>{
 const next=recommendItems(items,[],[],5,at,{scope:'ai'});
 assert.deepEqual(next.items.map(item=>item.id),['ai-new','ai-unknown-date','ai-old','ai-stale']);assert.equal(next.remaining,4);
 const filtered=recommendItems(items,[],[{itemId:'ai-new'}],5,at,{scope:'ai',excludeIds:['ai-old'],readItems:[{itemId:'ai-unknown-date',readAt:version}]});
 assert.deepEqual(filtered.items.map(item=>item.id),['ai-stale']);assert.equal(filtered.remaining,1);
});

test('reading and candidate input reject forged owners, malformed versions, unknown scopes and excessive exclusions',()=>{
 assert.equal(itemReadSchema.safeParse({itemId:'tool-one',userId:'other'}).success,false);
 assert.equal(itemReadSchema.safeParse({itemId:'../bad'}).success,false);
 assert.equal(itemReadSchema.safeParse({itemId:'tool-one',confirm:'true'}).success,false);
 assert.equal(itemReadSchema.safeParse({itemId:'tool-one',confirm:true}).success,true);
 assert.equal(editionReadSchema.safeParse({date:'2026-10-26',read:true}).success,false);
 assert.equal(editionReadSchema.safeParse({date:'2026-02-30',read:false}).success,false);
 assert.equal(editionReadSchema.safeParse({date:'2026-10-26',read:true,version:'not-a-date'}).success,false);
 assert.equal(editionReadSchema.safeParse({date:'2026-10-26',read:false,userId:'other'}).success,false);
 assert.equal(editionReadSchema.safeParse({date:'2026-10-26',read:false}).success,true);
 assert.equal(recommendationScopeSchema.parse(undefined),'all');
 assert.equal(recommendationScopeSchema.safeParse('everything').success,false);
 assert.deepEqual(recommendationExcludeSchema.parse(undefined),[]);
 assert.deepEqual(recommendationExcludeSchema.parse('tool-one,tool-one'),['tool-one']);
 assert.equal(recommendationExcludeSchema.safeParse('tool-one,,tool-two').success,false);
 assert.equal(recommendationExcludeSchema.safeParse(Array.from({length:51},(_,i)=>`tool-${i}`).join(',')).success,false);
 assert.equal(itemSchema.safeParse({...seedItems[0],aiApplication:'model-benchmark'}).success,false);
 assert.equal(itemSchema.safeParse({...seedItems[0],aiApplication:'agents'}).success,true);
});

test('replaying identical edition content preserves its read version even for legacy key order and a changed run status',async()=>fixture(async db=>{
 const original=items.slice(0,2);
 const reordered=value=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,nested])=>[key,reordered(nested)])):value;
 // Existing imports used ordinary JSON.stringify, so their object key order is not canonical.
 await db.prepare('UPDATE editions SET payload=? WHERE date=?').bind(JSON.stringify(reordered(original),null,2),'2026-10-26').run();
 await setEditionRead(db,'owner','2026-10-26',true,version);
 const replayVersion=await persistEdition(db,'2026-10-26',original,'partial','ingest','2026-10-26T02:00:00.000Z');
 assert.equal(replayVersion,version);
 const history=(await editionReadingState(db,'owner')).days[0];
 assert.equal(history.hasUpdates,false);assert.equal(history.status,'partial');
 assert.ok(history.readAt);assert.equal(history.updatedAt,version);
 assert.equal((await db.prepare('SELECT count(*) as count FROM runs').first()).count,1);
}));

test('real content changes advance the edition version, while replays do not; delayed timestamps cannot regress it',async()=>fixture(async db=>{
 await setEditionRead(db,'owner','2026-10-26',true,version);
 const changed=items.slice(0,2).map((item,index)=>index?item:{...item,title:'A material product change'});
 const changedVersion=await persistEdition(db,'2026-10-26',changed,'complete','ingest','2026-10-26T02:00:00.000Z');
 assert.equal(changedVersion,'2026-10-26T02:00:00.000Z');
 assert.equal((await editionReadingState(db,'owner')).days[0].hasUpdates,true);
 await setEditionRead(db,'owner','2026-10-26',true,changedVersion);
 assert.equal(await persistEdition(db,'2026-10-26',changed,'complete','ingest','2026-10-26T03:00:00.000Z'),changedVersion);
 assert.equal((await editionReadingState(db,'owner')).days[0].hasUpdates,false);
 const newer=changed.map((item,index)=>index?item:{...item,title:'Another real change'});
 const delayedVersion=await persistEdition(db,'2026-10-26',newer,'complete','ingest','2026-10-26T01:00:00.000Z');
 assert.ok(Date.parse(delayedVersion)>Date.parse(changedVersion));
 assert.equal((await editionReadingState(db,'owner')).days[0].hasUpdates,true);
 const stored=await db.prepare('SELECT payload FROM editions WHERE date=?').bind('2026-10-26').first();
 assert.equal(JSON.parse(stored.payload)[0].title,'Another real change');
}));
