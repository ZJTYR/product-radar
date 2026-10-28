import type { RadarDatabase } from './database.ts';
import type { InterestAction, ItemFeedback, SavedItem } from './types.ts';
import { favoriteNoteInserts } from './favorite-notes.ts';

type Statement = ReturnType<RadarDatabase['prepare']>;
interface FeedbackRow extends ItemFeedback { version: string }
interface UndoRow { itemId: string; beforePayload: string | null; afterVersion: string; autoFavoriteVersion: string | null }
export class ReadingConflict extends Error {}
export class ReadingItemMissing extends Error {}
const feedbackSelect = 'SELECT item_id as "itemId",action,updated_at as "updatedAt",version FROM reading_feedback WHERE user_id=?';
const favoriteSelect = 'SELECT item_id as "itemId",collection,note,created_at as "createdAt",updated_at as "updatedAt" FROM favorites WHERE user_id=?';

// 所有反馈和收藏写入共用乐观事务版本，跨实例冲突令整批回滚再读取新状态。
async function mutate<T>(db: RadarDatabase, userId: string, plan: () => Promise<{ statements: Statement[]; result: T }>): Promise<T> {
 await db.prepare('INSERT INTO reading_state(user_id,revision) VALUES(?,0) ON CONFLICT(user_id) DO NOTHING').bind(userId).run();
 for (let attempt = 0; attempt < 4; attempt++) {
  const state = await db.prepare('SELECT revision FROM reading_state WHERE user_id=?').bind(userId).first<{revision:number}>();
  const { statements, result } = await plan();
  try {
   await db.batch([
    db.prepare('UPDATE reading_state SET revision=CASE WHEN revision=? THEN revision+1 ELSE -1 END WHERE user_id=?').bind(state!.revision,userId),
    ...statements,
   ]);
   return result;
  } catch (error) {
   if (!(error instanceof Error) || !error.message.includes('reading_revision_nonnegative')) throw error;
  }
 }
 throw new ReadingConflict('其他页面正在修改阅读偏好，请刷新后重试');
}

export async function readingState(db: RadarDatabase, userId: string) {
 const [feedback, favorites] = await Promise.all([
  db.prepare(feedbackSelect + ' ORDER BY updated_at DESC,item_id').bind(userId).all<FeedbackRow>(),
  db.prepare(favoriteSelect + ' ORDER BY updated_at DESC,item_id').bind(userId).all<SavedItem>(),
 ]);
 return { feedback: feedback.results.map(({itemId,action,updatedAt}) => ({itemId,action,updatedAt})), favorites: favorites.results };
}
function favoriteVersion(db: RadarDatabase,userId:string,itemId:string,version:string) {
 return db.prepare('INSERT INTO reading_favorite_versions(user_id,item_id,version) VALUES(?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET version=excluded.version').bind(userId,itemId,version);
}
async function ensureItem(db: RadarDatabase,itemId:string) {
 if (!await db.prepare('SELECT id FROM intel_items WHERE id=?').bind(itemId).first()) throw new ReadingItemMissing('找不到该内容');
}

export async function setFeedback(db: RadarDatabase,userId:string,itemId:string,action:InterestAction) {
 const undoToken = await mutate(db,userId,async()=> {
  await ensureItem(db,itemId);
  const previous = await db.prepare(feedbackSelect+' AND item_id=?').bind(userId,itemId).first<FeedbackRow>();
  if (previous?.action === action) {
   const undo = await db.prepare('SELECT token FROM reading_undo WHERE user_id=? AND item_id=? AND after_version=?').bind(userId,itemId,previous.version).first<{token:string}>();
   return {statements:[],result:undo?.token || null};
  }
  const at = new Date().toISOString(); const version=crypto.randomUUID(); const token=crypto.randomUUID();
  const favorite = await db.prepare(favoriteSelect+' AND item_id=?').bind(userId,itemId).first<SavedItem>();
  const autoVersion = action === 'interested' && !favorite ? crypto.randomUUID() : null;
  const statements = [
   db.prepare('INSERT INTO reading_feedback(user_id,item_id,action,updated_at,version) VALUES(?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET action=excluded.action,updated_at=excluded.updated_at,version=excluded.version').bind(userId,itemId,action,at,version),
   db.prepare('INSERT INTO reading_undo(token,user_id,item_id,before_payload,after_version,auto_favorite_version,created_at) VALUES(?,?,?,?,?,?,?)').bind(token,userId,itemId,previous?JSON.stringify(previous):null,version,autoVersion,at),
  ];
  if (autoVersion) statements.push(
   db.prepare('INSERT INTO favorites(user_id,item_id,collection,note,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,item_id) DO NOTHING').bind(userId,itemId,'灵感收藏','',at,at),
   favoriteVersion(db,userId,itemId,autoVersion),
  );
  return {statements,result:token};
 });
 return {...await readingState(db,userId),undoToken};
}

export async function undoFeedback(db: RadarDatabase,userId:string,token:string) {
 await mutate(db,userId,async()=> {
  const entry=await db.prepare('SELECT item_id as "itemId",before_payload as "beforePayload",after_version as "afterVersion",auto_favorite_version as "autoFavoriteVersion" FROM reading_undo WHERE token=? AND user_id=?').bind(token,userId).first<UndoRow>();
  if (!entry) throw new ReadingConflict('这次选择已撤销或不再可撤销，请刷新查看');
  const current=await db.prepare(feedbackSelect+' AND item_id=?').bind(userId,entry.itemId).first<FeedbackRow>();
  if (current?.version !== entry.afterVersion) throw new ReadingConflict('这条内容已在其他操作中修改，不能覆盖新的选择');
  const previous:FeedbackRow|null=entry.beforePayload?JSON.parse(entry.beforePayload):null;
  const statements:Statement[]=[db.prepare('DELETE FROM reading_undo WHERE token=? AND user_id=?').bind(token,userId)];
  if (previous) statements.push(db.prepare('UPDATE reading_feedback SET action=?,updated_at=?,version=? WHERE user_id=? AND item_id=?').bind(previous.action,previous.updatedAt,previous.version,userId,entry.itemId));
  else statements.push(db.prepare('DELETE FROM reading_feedback WHERE user_id=? AND item_id=?').bind(userId,entry.itemId));
  const savedVersion=await db.prepare('SELECT version FROM reading_favorite_versions WHERE user_id=? AND item_id=?').bind(userId,entry.itemId).first<{version:string}>();
  if (entry.autoFavoriteVersion && savedVersion?.version === entry.autoFavoriteVersion) statements.push(
   ...await favoriteNoteInserts(db,userId,entry.itemId),
   db.prepare('DELETE FROM favorites WHERE user_id=? AND item_id=?').bind(userId,entry.itemId),
   favoriteVersion(db,userId,entry.itemId,crypto.randomUUID()),
  );
  return {statements,result:null};
 });
 return readingState(db,userId);
}

export async function restoreFeedback(db:RadarDatabase,userId:string,itemId:string) {
 await mutate(db,userId,async()=>({statements:[
  db.prepare('DELETE FROM reading_feedback WHERE user_id=? AND item_id=?').bind(userId,itemId),
  db.prepare('DELETE FROM reading_undo WHERE user_id=? AND item_id=?').bind(userId,itemId),
 ],result:null}));
 return readingState(db,userId);
}
export async function saveFavorite(db:RadarDatabase,userId:string,value:{itemId:string;collection:string;note:string}) {
 await mutate(db,userId,async()=> {
  await ensureItem(db,value.itemId);const at=new Date().toISOString();
  return {statements:[
   ...await favoriteNoteInserts(db,userId,value.itemId),
   db.prepare('INSERT INTO favorites(user_id,item_id,collection,note,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,item_id) DO UPDATE SET collection=excluded.collection,note=excluded.note,updated_at=excluded.updated_at').bind(userId,value.itemId,value.collection,value.note,at,at),
   favoriteVersion(db,userId,value.itemId,crypto.randomUUID()),
  ],result:null};
 });
 return db.prepare(favoriteSelect+' AND item_id=?').bind(userId,value.itemId).first<SavedItem>();
}
export async function removeFavorite(db:RadarDatabase,userId:string,itemId:string) {
 await mutate(db,userId,async()=>({statements:[
  ...await favoriteNoteInserts(db,userId,itemId),
  db.prepare('DELETE FROM favorites WHERE user_id=? AND item_id=?').bind(userId,itemId),
  favoriteVersion(db,userId,itemId,crypto.randomUUID()),
 ],result:null}));
}

export async function updateFavoriteCollection(db:RadarDatabase,userId:string,value:{itemId:string;collection:string;expectedCollection:string}) {
 await mutate(db,userId,async()=> {
  const favorite=await db.prepare(favoriteSelect+' AND item_id=?').bind(userId,value.itemId).first<SavedItem>();
  if (!favorite) throw new ReadingItemMissing('收藏已取消，请重新收藏后再分类');
  if (favorite.collection!==value.expectedCollection && favorite.collection!==value.collection) throw new ReadingConflict('分类已在其他页面修改，请关闭后重新选择');
  if (favorite.collection===value.collection) return {statements:[],result:null};
  return {statements:[
   ...await favoriteNoteInserts(db,userId,value.itemId),
   db.prepare('UPDATE favorites SET collection=?,updated_at=? WHERE user_id=? AND item_id=?').bind(value.collection,new Date().toISOString(),userId,value.itemId),
   favoriteVersion(db,userId,value.itemId,crypto.randomUUID()),
  ],result:null};
 });
 return db.prepare(favoriteSelect+' AND item_id=?').bind(userId,value.itemId).first<SavedItem>();
}
