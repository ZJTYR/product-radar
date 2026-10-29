import { HttpError, route } from './server';
import { EmailDeliveryError } from './email-store';

export function emailRoute(operation: () => Promise<Response>) {
  return route(async () => {
    try { return await operation(); }
    catch (error) {
      if (error instanceof EmailDeliveryError) throw new HttpError(error.status, error.message);
      throw error;
    }
  });
}
