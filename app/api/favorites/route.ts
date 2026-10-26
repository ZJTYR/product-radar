import { database, initialize, currentUser, route, json, checkMutation, body, HttpError } from '@/lib/server';
import { favoriteSchema, feedbackItemIdSchema } from '@/lib/validation';
import { ReadingConflict, ReadingItemMissing, removeFavorite, saveFavorite } from '@/lib/feedback';
export const dynamic = 'force-dynamic';
export function GET() { return route(async()=> { const user = await currentUser(); const rows = await database().prepare('SELECT item_id as "itemId",collection,note,created_at as "createdAt",updated_at as "updatedAt" FROM favorites WHERE user_id=? ORDER BY updated_at DESC').bind(user.userId).all(); return json({favorites:rows.results}); }); }
async function guarded<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn();}catch(error){if(error instanceof ReadingConflict)throw new HttpError(409,error.message);if(error instanceof ReadingItemMissing)throw new HttpError(404,error.message);throw error;}}
export function PUT(request: Request) { return route(async()=> { checkMutation(request); const user=await currentUser(); const value=favoriteSchema.parse(await body(request)); await initialize(); const favorite=await guarded(()=>saveFavorite(database(),user.userId,value)); return json({favorite}); }); }
export function DELETE(request: Request) { return route(async()=> { checkMutation(request); const user=await currentUser(); const itemId=feedbackItemIdSchema.parse(new URL(request.url).searchParams.get('itemId')); await guarded(()=>removeFavorite(database(),user.userId,itemId)); return json({ok:true}); }); }
