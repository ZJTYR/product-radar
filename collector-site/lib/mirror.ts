import { env } from 'cloudflare:workers';
import { deliverMirrorQueue, type MirrorPath } from './mirror-delivery';

export function mirrorStatement(path: MirrorPath, payload: unknown) {
 if (!env.RADAR_MIRROR_ORIGIN || !env.RADAR_MIRROR_TOKEN || !env.DB) return null;
 const at = new Date().toISOString();
 return env.DB.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').bind(
  `mirror:${at}:${crypto.randomUUID()}`, JSON.stringify({ path, payload }), at,
 );
}
export function deliverMirror() { return deliverMirrorQueue(env); }
