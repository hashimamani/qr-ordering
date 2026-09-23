import { query } from '../../db/pool';

export async function upsertPushSubscription(
  staffUserId: string,
  input: { endpoint: string; p256dh: string; auth: string },
): Promise<void> {
  await query(
    `INSERT INTO push_subscription (staff_user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET staff_user_id = $1, p256dh = $3, auth = $4`,
    [staffUserId, input.endpoint, input.p256dh, input.auth],
  );
}
