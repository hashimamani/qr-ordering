/**
 * The two enums that describe how work is routed and who may do it.
 *
 * Declared once because they were previously spelled out inline in
 * sixteen separate files, so adding 'services' meant editing all
 * sixteen -- and missing one would have compiled fine while silently
 * refusing a valid value at runtime. These mirror the Postgres enums
 * order_item_destination and staff_role; a migration that adds a member
 * there should add it here and nowhere else.
 */

/** Where an order item is fulfilled. Mirrors order_item_destination. */
export type FulfilmentDestination = 'kitchen' | 'bar' | 'services';

/** Mirrors staff_role. 'admin' sees every station. */
export type StaffRole = 'admin' | 'waiter' | 'kitchen' | 'bar' | 'services';

/** Every station a member of staff can be given, admin excluded. */
export const FULFILMENT_DESTINATIONS: readonly FulfilmentDestination[] = [
  'kitchen',
  'bar',
  'services',
] as const;

/** Every role a staff account can hold. Mirrors staff_role. */
export const STAFF_ROLES: readonly StaffRole[] = ['admin', 'waiter', 'kitchen', 'bar', 'services'] as const;

/**
 * Roles allowed to move an item through its preparation states. The
 * station roles plus admin -- waiter is excluded here because serving is
 * a separate transition with its own rule (see staffRoutes).
 */
export const PREPARING_ROLES: readonly StaffRole[] = ['admin', ...FULFILMENT_DESTINATIONS] as const;
