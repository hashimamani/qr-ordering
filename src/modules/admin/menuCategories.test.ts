import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError, ValidationError } from '../../lib/errors';

/**
 * The depth cap is not cosmetic: the ordering page renders main
 * categories as a tab row and sub-categories as collapsible sections
 * beneath, so a third level has nowhere to go. Letting one be created
 * would build a menu the customer page silently cannot show, which is
 * why these are service invariants rather than form validation.
 */

const repo = vi.hoisted(() => ({
  insertMenuCategory: vi.fn(),
  updateMenuCategoryById: vi.fn(),
  findMenuCategory: vi.fn(),
  countChildCategories: vi.fn(),
}));
vi.mock('./admin.repository', () => repo);

import { createMenuCategory, updateMenuCategory } from './menuCategories.service';

const R = 'restaurant-1';
const MAIN = { id: 'main-1', restaurant_id: R, name: 'Drinks', sort_order: 0, parent_id: null };
const SUB = { id: 'sub-1', restaurant_id: R, name: 'Beer Bottles', sort_order: 0, parent_id: 'main-1' };

beforeEach(() => {
  vi.clearAllMocks();
  repo.countChildCategories.mockResolvedValue(0);
  repo.insertMenuCategory.mockImplementation(async (_r, input) => ({ id: 'new', ...input }));
  repo.updateMenuCategoryById.mockImplementation(async (_r, id, patch) => ({ id, ...patch }));
});

describe('creating a category', () => {
  it('creates a main category when no parent is given', async () => {
    await createMenuCategory(R, { name: 'Food', sortOrder: 0 });
    expect(repo.findMenuCategory).not.toHaveBeenCalled();
    expect(repo.insertMenuCategory).toHaveBeenCalled();
  });

  it('creates a sub-category under a main one', async () => {
    repo.findMenuCategory.mockResolvedValue(MAIN);
    await createMenuCategory(R, { name: 'Beers', sortOrder: 0, parentId: MAIN.id });
    expect(repo.insertMenuCategory).toHaveBeenCalledWith(R, expect.objectContaining({ parentId: MAIN.id }));
  });

  // The cap. Nesting under a sub-category would be depth three.
  it('refuses to nest under a sub-category', async () => {
    repo.findMenuCategory.mockResolvedValue(SUB);
    await expect(
      createMenuCategory(R, { name: 'Lagers', sortOrder: 0, parentId: SUB.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(repo.insertMenuCategory).not.toHaveBeenCalled();
  });

  // findMenuCategory is restaurant-scoped, so another tenant's id simply
  // is not found -- the menus can never be linked across restaurants.
  it('refuses a parent belonging to another restaurant', async () => {
    repo.findMenuCategory.mockResolvedValue(undefined);
    await expect(
      createMenuCategory(R, { name: 'X', sortOrder: 0, parentId: 'someone-elses' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('re-parenting a category', () => {
  it('moves a sub-category to a different main category', async () => {
    repo.findMenuCategory.mockResolvedValue(MAIN);
    await updateMenuCategory(R, SUB.id, { parentId: MAIN.id });
    expect(repo.updateMenuCategoryById).toHaveBeenCalledWith(R, SUB.id, { parentId: MAIN.id });
  });

  // An explicit null is how a sub-category is promoted, and it must not
  // be mistaken for "no change".
  it('promotes a sub-category to a main one with an explicit null', async () => {
    await updateMenuCategory(R, SUB.id, { parentId: null });
    expect(repo.findMenuCategory).not.toHaveBeenCalled();
    expect(repo.updateMenuCategoryById).toHaveBeenCalledWith(R, SUB.id, { parentId: null });
  });

  it('leaves the parent alone when the patch does not mention it', async () => {
    await updateMenuCategory(R, SUB.id, { name: 'Bottled Beer' });
    const patch = repo.updateMenuCategoryById.mock.calls[0][2];
    expect('parentId' in patch).toBe(false);
  });

  it('refuses to make a category its own parent', async () => {
    repo.findMenuCategory.mockResolvedValue({ ...MAIN, id: 'main-1' });
    await expect(updateMenuCategory(R, 'main-1', { parentId: 'main-1' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  // Demoting a main category that still has children would drag them to
  // depth three.
  it('refuses to demote a main category that still has sub-categories', async () => {
    repo.findMenuCategory.mockResolvedValue(MAIN);
    repo.countChildCategories.mockResolvedValue(8);
    await expect(updateMenuCategory(R, 'other-main', { parentId: MAIN.id })).rejects.toThrow(
      /8 sub-categories/,
    );
    expect(repo.updateMenuCategoryById).not.toHaveBeenCalled();
  });

  it('pluralises the refusal correctly for a single child', async () => {
    repo.findMenuCategory.mockResolvedValue(MAIN);
    repo.countChildCategories.mockResolvedValue(1);
    await expect(updateMenuCategory(R, 'other-main', { parentId: MAIN.id })).rejects.toThrow(
      /1 sub-category\b/,
    );
  });
});
