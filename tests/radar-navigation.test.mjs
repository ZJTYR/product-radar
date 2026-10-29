import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultRadarLocation, parseRadarLocation, radarLocationSearch } from '../lib/radar-navigation.ts';
import { filterLibrary } from '../lib/library-search.ts';

test('product and archived-note links round-trip without any note text',()=>{
  const expected={...defaultRadarLocation,view:'history',date:'2026-10-23',item:'product-中文/entry',annotation:'note-1',query:'业务 后台',read:'read',collection:'界面参考'};
  const search=radarLocationSearch(expected);
  assert.deepEqual(parseRadarLocation(search),expected);
  assert.match(search,/annotation=note-1/);
  assert.equal(radarLocationSearch(defaultRadarLocation),'');
});

test('untrusted URL values and impossible dates fall back safely',()=>{
  for(const date of ['2026-02-31','2026-99-99','<script>','2026-10-29T00:00:00Z']) assert.equal(parseRadarLocation(`?view=history&date=${encodeURIComponent(date)}`).date,'');
  const invalid=parseRadarLocation('?view=unknown&read=missing&sort=delete&topic=other&range=forever&annotation=orphan&q=%00hello');
  assert.deepEqual(invalid,{...defaultRadarLocation,query:'hello'});
  assert.equal(parseRadarLocation('?view=products&date=2026-10-29').date,'');
  assert.equal(parseRadarLocation('?q='+'a'.repeat(500)).query.length,200);
});

const at=Date.parse('2026-10-29T12:00:00+08:00');
const item=(id,extra={})=>({id,name:id,kind:'news',newsTopic:'technology',category:'硬件',publishedAt:'2026-10-28',discoveredAt:'2026-10-29T00:00:00Z',...extra});
test('full frontier archive includes older news while range uses actual publication date',()=>{
  const items=[item('old',{publishedAt:'2026-09-01'}),item('recent'),item('future',{publishedAt:'2026-10-30'}),item('ai',{kind:'ai',aiApplication:'engineering'})];
  assert.equal(filterLibrary(items,defaultRadarLocation,new Set(),at).length,4);
  const filtered=filterLibrary(items,{...defaultRadarLocation,range:'7',topic:'technology'},new Set(),at);
  assert.deepEqual(filtered.map(x=>x.id),['recent']);
  assert.deepEqual(filterLibrary(items,{...defaultRadarLocation,topic:'ai'},new Set(),at).map(x=>x.id),['ai']);
});

test('read and category filters combine with stable sorting without mutating catalog',()=>{
  const items=[item('B',{stars:20}),item('A',{stars:20}),item('C',{category:'软件',stars:100})];
  const original=[...items];
  assert.deepEqual(filterLibrary(items,{...defaultRadarLocation,category:'硬件',read:'read',sort:'stars'},new Set(['A','B','C']),at).map(x=>x.id),['A','B']);
  assert.deepEqual(filterLibrary(items,{...defaultRadarLocation,read:'unread'},new Set(['A','B']),at).map(x=>x.id),['C']);
  assert.deepEqual(items,original);
});
