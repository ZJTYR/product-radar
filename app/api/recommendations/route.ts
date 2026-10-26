import { currentUser, database, initialize, json, library, route } from '@/lib/server';
import { readingState } from '@/lib/feedback';
import { recommendItems } from '@/lib/recommendations';
import { recommendationExcludeSchema, recommendationLimitSchema, recommendationScopeSchema } from '@/lib/validation';
import { itemReadingState } from '@/lib/reading';
export const dynamic='force-dynamic';
export function GET(request:Request){return route(async()=>{
 const params=new URL(request.url).searchParams;
 const limit=recommendationLimitSchema.parse(params.get('limit')??undefined);
 const scope=recommendationScopeSchema.parse(params.get('scope')??undefined);
 const excludeIds=recommendationExcludeSchema.parse(params.get('exclude')??undefined);
 const user=await currentUser();await initialize();const [items,state,reading]=await Promise.all([library(),readingState(database(),user.userId),itemReadingState(database(),user.userId)]);
 return json(recommendItems(items,state.feedback,state.favorites,limit,Date.now(),{scope,excludeIds,readItems:reading.items}));
});}
