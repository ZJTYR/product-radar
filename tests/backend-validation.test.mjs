import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSchema, ingestSchema, isSameOriginMutation, dateSchema, preferenceSchema } from '../lib/validation.ts';

test('reject cross-origin browser writes, permit same-origin and private-gated service writes', () => {
 assert.equal(isSameOriginMutation(new Request('https://radar.example/api/ingest', {headers:{origin:'https://evil.example'}})), false);
 assert.equal(isSameOriginMutation(new Request('https://radar.example/api/ingest', {headers:{origin:'https://radar.example'}})), true);
 assert.equal(isSameOriginMutation(new Request('https://radar.example/api/ingest', {headers:{'sec-fetch-site':'cross-site'}})), false);
 assert.equal(isSameOriginMutation(new Request('https://radar.example/api/ingest')), true);
});
test('editorial ingest accepts honest empty editions and validates calendar dates and limits', () => {
 assert.deepEqual(ingestSchema.parse({date:'2026-10-22',items:[]}), {date:'2026-10-22',items:[],status:'complete'});
 assert.equal(dateSchema.safeParse('2026-02-31').success, false);
 assert.equal(ingestSchema.safeParse({date:'2026-10-22',items:Array(21).fill({})}).success,false);
});
test('reject malformed personal preference values before storage', () => {
 assert.equal(preferenceSchema.safeParse({email:'name@example.com',deliveryTime:'08:30',emailEnabled:false}).success,true);
 assert.equal(preferenceSchema.safeParse({email:'bad',deliveryTime:'25:70',emailEnabled:true}).success,false);
});

test('seed source records pass ingestion validation and unsafe presentation fields are rejected', async () => {
 const { seedItems } = await import('../lib/seed.ts');
 assert.equal(ingestSchema.safeParse({date:'2026-10-22',items:seedItems}).success,true);
 const badImage={...seedItems[0],image:'javascript:alert(1)'};
 assert.equal(ingestSchema.safeParse({date:'2026-10-22',items:[badImage]}).success,false);
 const badAccent={...seedItems[0],accent:'red; background:url(https://evil.example)'};
 assert.equal(ingestSchema.safeParse({date:'2026-10-22',items:[badAccent]}).success,false);
 assert.equal(ingestSchema.safeParse({date:'2099-10-22',items:[]}).success,false);
});

test('catalog updates reject duplicate or invalid records and accept optional plain-language context', async () => {
 const { seedItems } = await import('../lib/seed.ts');
 const item = {...seedItems[0], scenario:'使用示例：把重复整理资料的步骤交给工具，自己检查结果。',imageCaption:'官方公开产品界面示意'};
 assert.equal(catalogSchema.safeParse({items:[item]}).success,true);
 assert.equal(catalogSchema.safeParse({items:[item,item]}).success,false);
 assert.equal(catalogSchema.safeParse({items:[]}).success,false);
 assert.equal(catalogSchema.safeParse({items:[{...item,image:'javascript:alert(1)'}]}).success,false);
 assert.equal(catalogSchema.safeParse({items:[item],date:'2026-10-23'}).success,false);
 assert.equal(catalogSchema.safeParse({items:[{...item,scenario:''}]}).success,false);
});
