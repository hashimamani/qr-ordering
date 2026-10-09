import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import { ValidationError } from '../lib/errors';
import { requirePlatformAdminAuth } from '../middleware/platformAdminAuth';
import {
  platformAdminLoginSchema,
  resetAdminPasswordSchema,
  restaurantModeSchema,
  resetRestaurantSchema,
} from '../modules/platformAdmin/platformAdmin.validation';
import { loginPlatformAdmin, resetRestaurantAdminPassword } from '../modules/platformAdmin/platformAdmin.service';
import {
  changeRestaurantMode,
  previewRestaurantReset,
  resetRestaurant,
} from '../modules/platformAdmin/restaurantReset.service';
import { restaurantSignupSchema } from '../modules/admin/admin.validation';
import { signUpRestaurant } from '../modules/admin/admin.service';
import { listAllRestaurants } from '../modules/admin/admin.repository';
import { listAdminsForRestaurant } from '../modules/staff/staff.repository';
import { mintRestaurantViewToken } from '../modules/platformAdmin/restaurantView.service';

export const platformAdminRoutes = Router();

platformAdminRoutes.post(
  '/platform-admin/login',
  asyncHandler(async (req, res) => {
    const parsed = platformAdminLoginSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid login payload', parsed.error.flatten());
    const result = await loginPlatformAdmin(parsed.data.email, parsed.data.password);
    res.json(result);
  }),
);

// Scoped to '/platform-admin' explicitly, same reasoning as adminRoutes'
// scoped .use() -- an unscoped one would 401 every request reaching this
// router, not just its own routes.
platformAdminRoutes.use('/platform-admin', requirePlatformAdminAuth);

platformAdminRoutes.get(
  '/platform-admin/restaurants',
  asyncHandler(async (_req, res) => {
    const restaurants = await listAllRestaurants();
    res.json({ restaurants });
  }),
);

platformAdminRoutes.post(
  '/platform-admin/restaurants',
  asyncHandler(async (req, res) => {
    const parsed = restaurantSignupSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid signup payload', parsed.error.flatten());
    const result = await signUpRestaurant(parsed.data);
    res.status(201).json(result);
  }),
);

platformAdminRoutes.get(
  '/platform-admin/restaurants/:id/admins',
  asyncHandler(async (req, res) => {
    const admins = await listAdminsForRestaurant(req.params.id);
    res.json({ admins });
  }),
);

// Deliberately scoped to the admin role only -- see
// resetRestaurantAdminPassword's comment for why.
platformAdminRoutes.patch(
  '/platform-admin/staff/:staffId/password',
  asyncHandler(async (req, res) => {
    const parsed = resetAdminPasswordSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid password payload', parsed.error.flatten());
    await resetRestaurantAdminPassword(req.params.staffId, parsed.data.password);
    res.status(204).send();
  }),
);

platformAdminRoutes.patch(
  '/platform-admin/restaurants/:id/mode',
  asyncHandler(async (req, res) => {
    const parsed = restaurantModeSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid mode payload', parsed.error.flatten());
    const restaurant = await changeRestaurantMode(req.params.id, parsed.data.mode, {
      id: req.platformAdmin!.sub,
    });
    res.json({ restaurant });
  }),
);

// A GET so the UI can show what would actually be destroyed before
// anyone commits to it -- "this will delete 46 orders" is a far better
// prompt than "are you sure?".
platformAdminRoutes.get(
  '/platform-admin/restaurants/:id/reset',
  asyncHandler(async (req, res) => {
    res.json(await previewRestaurantReset(req.params.id));
  }),
);

platformAdminRoutes.post(
  '/platform-admin/restaurants/:id/reset',
  asyncHandler(async (req, res) => {
    const parsed = resetRestaurantSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError('Invalid reset payload', parsed.error.flatten());
    const counts = await resetRestaurant(req.params.id, parsed.data.confirm_slug, {
      id: req.platformAdmin!.sub,
    });
    res.json({ cleared: counts });
  }),
);

// Read-only, test-mode-only, 30 minutes. The token it returns is an
// ordinary staff token with readOnly set, so the whole admin UI works
// against it unchanged while requireStaffAuth refuses every write.
platformAdminRoutes.post(
  '/platform-admin/restaurants/:id/view-token',
  asyncHandler(async (req, res) => {
    const view = await mintRestaurantViewToken(req.params.id, req.platformAdmin!.sub);
    res.json(view);
  }),
);
