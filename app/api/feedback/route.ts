import { body, checkMutation, currentUser, database, HttpError, initialize, json, route } from '@/lib/server';
import { feedbackItemIdSchema, feedbackSchema, undoSchema } from '@/lib/validation';
import { ReadingConflict, ReadingItemMissing, readingState, restoreFeedback, setFeedback, undoFeedback } from '@/lib/feedback';
export const dynamic='force-dynamic';
async function run(action:()=>Promise<unknown>){try{return json(await action());}catch(error){if(error instanceof ReadingConflict)throw new HttpError(409,error.message);if(error instanceof ReadingItemMissing)throw new HttpError(404,error.message);throw error;}}
export function GET(){return route(async()=>{const user=await currentUser();await initialize();return run(()=>readingState(database(),user.userId));});}
export function PUT(request:Request){return route(async()=>{checkMutation(request);const value=feedbackSchema.parse(await body(request));const user=await currentUser();await initialize();return run(()=>setFeedback(database(),user.userId,value.itemId,value.action));});}
export function POST(request:Request){return route(async()=>{checkMutation(request);const value=undoSchema.parse(await body(request));const user=await currentUser();return run(()=>undoFeedback(database(),user.userId,value.undoToken));});}
export function DELETE(request:Request){return route(async()=>{checkMutation(request);const itemId=feedbackItemIdSchema.parse(new URL(request.url).searchParams.get('itemId'));const user=await currentUser();return run(()=>restoreFeedback(database(),user.userId,itemId));});}
