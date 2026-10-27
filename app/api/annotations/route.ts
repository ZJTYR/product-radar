import { body, checkMutation, currentUser, database, HttpError, initialize, json, route } from '@/lib/server';
import { AnnotationError, createAnnotation, listAnnotations, updateAnnotation } from '@/lib/annotation-store';

export const dynamic = 'force-dynamic';

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (error) { if (error instanceof AnnotationError) throw new HttpError(error.status, error.message); throw error; }
}

export function GET(request: Request) {
  return route(async () => {
    const user = await currentUser();
    await initialize();
    const itemId = new URL(request.url).searchParams.get('itemId') ?? undefined;
    return json(await guarded(() => listAnnotations(database(), user.userId, itemId)));
  });
}

export function POST(request: Request) {
  return route(async () => {
    checkMutation(request);
    const user = await currentUser();
    const value = await body(request);
    await initialize();
    return json({ note: await guarded(() => createAnnotation(database(), user.userId, value)) });
  });
}

export function PATCH(request: Request) {
  return route(async () => {
    checkMutation(request);
    const user = await currentUser();
    const value = await body(request);
    await initialize();
    return json({ note: await guarded(() => updateAnnotation(database(), user.userId, value)) });
  });
}
