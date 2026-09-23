import webpush from 'web-push';
import { query } from '../db/pool';
import { logger } from '../lib/logger';

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidConfigured = false;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidConfigured = true;
  return true;
}

/**
 * Best-effort nudge, same contract as broadcastEvent -- never throws, logs
 * and moves on. Sent to every subscription on file for this staff member
 * (multiple devices/browsers are all valid). A 404/410 from the push
 * service means the subscription is gone (uninstalled, permission
 * revoked, browser data cleared) and gets pruned here, mirroring
 * dynamoBroadcaster.ts's identical handling of stale WebSocket
 * connections.
 */
export async function sendPushToStaff(staffId: string, payload: { title: string; body: string }): Promise<void> {
  try {
    if (!ensureVapidConfigured()) return;

    const result = await query<PushSubscriptionRow>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE staff_user_id = $1',
      [staffId],
    );

    await Promise.all(
      result.rows.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          );
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await query('DELETE FROM push_subscription WHERE id = $1', [sub.id]);
            return;
          }
          logger.warn({ err, staffId }, 'push send failed (non-fatal)');
        }
      }),
    );
  } catch (err) {
    logger.warn({ err, staffId }, 'sendPushToStaff failed (non-fatal)');
  }
}
