import { currentUser, database, initialize, json, library, route } from '@/lib/server';
import { readingState } from '@/lib/feedback';
import { recommendItems } from '@/lib/recommendations';
import { recommendationLimitSchema } from '@/lib/validation';
export const dynamic='force-dynamic';
export function GET(request:Request){return route(async()=>{
 const limit=recommendationLimitSchema.parse(new URL(request.url).searchParams.get('limit')??undefined);
 const user=await currentUser();await initialize();const [items,state]=await Promise.all([library(),readingState(database(),user.userId)]);
 return json(recommendItems(items,state.feedback,state.favorites,limit));
});}
