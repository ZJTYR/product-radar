import { body, checkMutation, currentUser, database, HttpError, initialize, json, route } from '@/lib/server';
import { itemReadSchema } from '@/lib/validation';
import { itemReadingState, recordItemRead, ReadingRecordMissing } from '@/lib/reading';
export const dynamic='force-dynamic';
export function GET(){return route(async()=>{const user=await currentUser();await initialize();return json(await itemReadingState(database(),user.userId));});}
export function PUT(request:Request){return route(async()=>{
 checkMutation(request);const value=itemReadSchema.parse(await body(request));const user=await currentUser();await initialize();
 try{return json(await recordItemRead(database(),user.userId,value.itemId,value.confirm));}catch(error){if(error instanceof ReadingRecordMissing)throw new HttpError(404,error.message);throw error;}
});}
