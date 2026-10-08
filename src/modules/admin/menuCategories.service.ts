import { NotFoundError, ValidationError } from '../../lib/errors';
import {
  insertMenuCategory,
  updateMenuCategoryById,
  findMenuCategory,
  countChildCategories,
  type MenuCategoryRow,
} from './admin.repository';

/**
 * The rules a two-level menu needs, kept out of the route handlers
 * because all three are invariants rather than request validation: no
 * payload shape can express "your parent must not itself have a parent",
 * and getting any of them wrong corrupts the tree rather than rejecting
 * a request.
 *
 * Why two levels and not arbitrary depth: the customer UI is a tab row
 * of main categories with collapsible sub-categories beneath. A third
 * level has nowhere to render, so allowing one would let an admin build
 * a menu the ordering page silently cannot show.
 */

async function assertUsableParent(
  restaurantId: string,
  parentId: string,
  childId?: string,
): Promise<void> {
  const parent = await findMenuCategory(restaurantId, parentId);
  // Scoped to the restaurant, so a parent id from another tenant reads as
  // "not found" rather than quietly linking two restaurants' menus.
  if (!parent) throw new NotFoundError('Parent category not found');

  if (childId && parent.id === childId) {
    throw new ValidationError('A category cannot be its own parent');
  }
  if (parent.parent_id) {
    throw new ValidationError(
      `"${parent.name}" is already a sub-category. Menus are two levels deep: main categories, then sub-categories.`,
    );
  }
}

export async function createMenuCategory(
  restaurantId: string,
  input: { name: string; sortOrder: number; parentId?: string | null },
): Promise<MenuCategoryRow> {
  if (input.parentId) await assertUsableParent(restaurantId, input.parentId);
  return insertMenuCategory(restaurantId, input);
}

export async function updateMenuCategory(
  restaurantId: string,
  categoryId: string,
  patch: { name?: string; sortOrder?: number; parentId?: string | null },
): Promise<MenuCategoryRow> {
  const setsParent = Object.prototype.hasOwnProperty.call(patch, 'parentId');

  if (setsParent && patch.parentId) {
    await assertUsableParent(restaurantId, patch.parentId, categoryId);

    // Demoting a main category that has children would push its children
    // to depth three. The admin has to move them out first, which is
    // visible, rather than having the tree silently rearranged.
    const children = await countChildCategories(categoryId);
    if (children > 0) {
      throw new ValidationError(
        `This category has ${children} sub-categor${children === 1 ? 'y' : 'ies'}. Move them out before making it a sub-category itself.`,
      );
    }
  }

  return updateMenuCategoryById(restaurantId, categoryId, patch);
}
