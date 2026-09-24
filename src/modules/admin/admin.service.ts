import QRCode from 'qrcode';
import { hashPassword } from '../../lib/password';
import { generateToken } from '../../lib/token';
import { ConflictError, ValidationError } from '../../lib/errors';
import {
  insertRestaurantWithAdmin,
  categoryBelongsToRestaurant,
  insertMenuItem,
  insertTable,
  regenerateQrToken,
  type MenuItemRow,
  type TableRow,
} from './admin.repository';
import { insertStaffUser, updateStaffUser, type StaffUser } from '../staff/staff.repository';
import type { createStaffUserSchema, updateStaffUserSchema } from '../staff/staff.validation';
import type { z } from 'zod';

type CreateStaffUserInput = z.infer<typeof createStaffUserSchema>;
type UpdateStaffUserInput = z.infer<typeof updateStaffUserSchema>;

const PUBLIC_ORDERING_BASE_URL =
  process.env.PUBLIC_ORDERING_BASE_URL ?? process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000';

export async function signUpRestaurant(input: {
  restaurant_name: string;
  restaurant_slug: string;
  admin_name: string;
  admin_phone_or_email: string;
  admin_password: string;
}): Promise<{ restaurant_id: string }> {
  const adminPasswordHash = await hashPassword(input.admin_password);
  try {
    const result = await insertRestaurantWithAdmin({
      restaurantName: input.restaurant_name,
      restaurantSlug: input.restaurant_slug,
      adminName: input.admin_name,
      adminPhoneOrEmail: input.admin_phone_or_email,
      adminPasswordHash,
    });
    return { restaurant_id: result.restaurantId };
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new ConflictError('That restaurant slug is already taken');
    }
    throw err;
  }
}

export async function createMenuItemForRestaurant(
  restaurantId: string,
  input: {
    category_id: string;
    name: string;
    description?: string;
    price: number;
    destination: 'kitchen' | 'bar';
    is_available: boolean;
  },
): Promise<MenuItemRow> {
  const ownsCategory = await categoryBelongsToRestaurant(restaurantId, input.category_id);
  if (!ownsCategory) {
    throw new ValidationError('category_id does not belong to this restaurant');
  }
  return insertMenuItem(restaurantId, {
    categoryId: input.category_id,
    name: input.name,
    description: input.description,
    price: input.price,
    destination: input.destination,
    isAvailable: input.is_available,
  });
}

export interface CreatedTableWithQr {
  table: TableRow;
  ordering_url: string;
  qr_code_png_base64: string;
}

// /order (the React frontend's route), not /r/.../t/... (the raw JSON
// API path) -- PUBLIC_ORDERING_BASE_URL is the frontend's own origin
// now that it's a separate S3/CloudFront deployment, not bundled into
// this API's Lambda.
async function buildQrResponse(table: TableRow, restaurantSlug: string): Promise<CreatedTableWithQr> {
  const orderingUrl = `${PUBLIC_ORDERING_BASE_URL}/order?slug=${restaurantSlug}&t=${table.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(orderingUrl, { errorCorrectionLevel: 'M', margin: 2 });
  return {
    table,
    ordering_url: orderingUrl,
    qr_code_png_base64: qrDataUrl.replace(/^data:image\/png;base64,/, ''),
  };
}

export async function createTableWithQrCode(
  restaurantId: string,
  restaurantSlug: string,
  tableNumber: string,
): Promise<CreatedTableWithQr> {
  const qrToken = generateToken();
  const table = await insertTable(restaurantId, { tableNumber, qrToken });
  return buildQrResponse(table, restaurantSlug);
}

/**
 * Rotates a table's qr_token -- for a lost/damaged printed QR sign, or a
 * code that leaked somewhere it shouldn't have. The old code stops
 * resolving immediately (findTableByQrToken looks up by the current
 * token only); regenerateQrToken enforces "no active session" so this
 * can never orphan a customer mid-order.
 */
export async function regenerateQrCodeForTable(
  restaurantId: string,
  restaurantSlug: string,
  tableId: string,
): Promise<CreatedTableWithQr> {
  const qrToken = generateToken();
  const table = await regenerateQrToken(restaurantId, tableId, qrToken);
  return buildQrResponse(table, restaurantSlug);
}

export async function createStaffUserForRestaurant(
  restaurantId: string,
  input: CreateStaffUserInput,
): Promise<{ id: string; name: string; role: string; phone_or_email: string }> {
  const passwordHash = await hashPassword(input.password);
  try {
    return await insertStaffUser({
      restaurantId,
      name: input.name,
      role: input.role,
      phoneOrEmail: input.phone_or_email,
      passwordHash,
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new ConflictError('A staff user with that contact already exists for this restaurant');
    }
    throw err;
  }
}

export async function updateStaffUserForRestaurant(
  restaurantId: string,
  staffId: string,
  input: UpdateStaffUserInput,
): Promise<Omit<StaffUser, 'password_hash'>> {
  const passwordHash = input.password ? await hashPassword(input.password) : undefined;
  try {
    return await updateStaffUser(restaurantId, staffId, {
      name: input.name,
      role: input.role,
      phoneOrEmail: input.phone_or_email,
      passwordHash,
    });
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code?: string }).code === '23505') {
      throw new ConflictError('A staff user with that contact already exists for this restaurant');
    }
    throw err;
  }
}
