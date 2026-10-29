export type RadarView = 'today' | 'recommendations' | 'products' | 'design' | 'frontier' | 'saved' | 'history';
export type LibraryRead = 'all' | 'unread' | 'read';
export type LibraryTopic = 'all' | 'ai' | 'technology' | 'product';
export type LibraryRange = 'all' | '7' | '30';
export type LibrarySort = 'recent' | 'published' | 'name' | 'stars';
export interface RadarLocation {
  view: RadarView; query: string; category: string; read: LibraryRead; topic: LibraryTopic;
  range: LibraryRange; sort: LibrarySort; collection: string; date: string; item: string; annotation: string;
}
export const defaultRadarLocation: RadarLocation = { view:'today', query:'', category:'', read:'all', topic:'all', range:'all', sort:'recent', collection:'', date:'', item:'', annotation:'' };
const oneOf = <T extends string>(value: string | null, values: readonly T[], fallback: T): T => values.includes(value as T) ? value as T : fallback;
const short = (value: string | null, length: number) => (value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, length);
function validDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const date = new Date(`${value}T12:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value; }
export function parseRadarLocation(search: string): RadarLocation {
  const q = new URLSearchParams(search);
  const view = oneOf(q.get('view'), ['today','recommendations','products','design','frontier','saved','history'] as const, 'today');
  const date = q.get('date') || '';
  const item = short(q.get('item'), 180);
  return { view, query:short(q.get('q'),200), category:short(q.get('category'),100), read:oneOf(q.get('read'),['all','unread','read'] as const,'all'), topic:oneOf(q.get('topic'),['all','ai','technology','product'] as const,'all'), range:oneOf(q.get('range'),['all','7','30'] as const,'all'), sort:oneOf(q.get('sort'),['recent','published','name','stars'] as const,'recent'), collection:short(q.get('collection'),80), date:view === 'history' && validDate(date) ? date : '', item, annotation:item ? short(q.get('annotation'),80) : '' };
}
export function radarLocationSearch(location: RadarLocation) {
  const q = new URLSearchParams();
  const keys = { view:'view', query:'q', category:'category', read:'read', topic:'topic', range:'range', sort:'sort', collection:'collection', date:'date', item:'item', annotation:'annotation' } as const;
  for (const key of Object.keys(keys) as (keyof RadarLocation)[]) if (location[key] && location[key] !== defaultRadarLocation[key]) q.set(keys[key],location[key]);
  const search=q.toString(); return search ? `?${search}` : '';
}
