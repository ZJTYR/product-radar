import { body, checkMutation, currentUser, database, HttpError, initialize, route, json } from '@/lib/server';
import { editionReadSchema } from '@/lib/validation';
import { editionReadingState, ReadingRecordMissing, ReadingVersionConflict, setEditionRead } from '@/lib/reading';
export const dynamic = 'force-dynamic';
export function GET() { return route(async () => { const user=await currentUser();await initialize();return json(await editionReadingState(database(),user.userId)); }); }
export function PUT(request:Request){return route(async()=>{
 checkMutation(request);const value=editionReadSchema.parse(await body(request));const user=await currentUser();await initialize();
 try{return json(await setEditionRead(database(),user.userId,value.date,value.read,value.version));}catch(error){if(error instanceof ReadingRecordMissing)throw new HttpError(404,error.message);if(error instanceof ReadingVersionConflict)throw new HttpError(409,error.message);throw error;}
});}
