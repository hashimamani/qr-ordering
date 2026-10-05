import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ValidationError, NotFoundError } from '../../lib/errors';

/**
 * Covers the interlocks rather than the SQL -- the deletion itself is
 * one statement leaning on the schema's cascades, whereas the guards are
 * the part whose failure is unrecoverable. Each test here corresponds to
 * a way a real restaurant could lose its trading history.
 */

const repo = vi.hoisted(() => ({
  findRestaurantMode: vi.fn(),
  setRestaurantMode: vi.fn(),
  resetRestaurantTransactionalData: vi.fn(),
  countRestaurantTransactionalData: vi.fn(),
}));

vi.mock('./restaurantReset.repository', () => repo);

// Static import is safe despite the mock above: vi.mock and vi.hoisted are
// both lifted above the import block, so the repository is already mocked
// by the time the service module is evaluated. A top-level `await import`
// would work under vitest but fails `tsc --noEmit` on this tsconfig.
import { resetRestaurant, changeRestaurantMode } from './restaurantReset.service';

const ACTOR = { id: 'admin-1' };
const TEST_RESTAURANT = { id: 'r1', name: 'Amani Grill', slug: 'amani-grill', mode: 'test' as const };
const LIVE_RESTAURANT = { ...TEST_RESTAURANT, mode: 'live' as const };

beforeEach(() => {
  vi.clearAllMocks();
  repo.resetRestaurantTransactionalData.mockResolvedValue({ orders: 3, table_sessions: 1 });
});

describe('resetting a restaurant', () => {
  it('clears the data when mode is test and the slug matches', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    const counts = await resetRestaurant('r1', 'amani-grill', ACTOR);
    expect(counts).toEqual({ orders: 3, table_sessions: 1 });
    expect(repo.resetRestaurantTransactionalData).toHaveBeenCalledWith('r1');
  });

  // The guard that matters most: right command, wrong tenant.
  it('refuses a live restaurant even with the correct slug', async () => {
    repo.findRestaurantMode.mockResolvedValue(LIVE_RESTAURANT);
    await expect(resetRestaurant('r1', 'amani-grill', ACTOR)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.resetRestaurantTransactionalData).not.toHaveBeenCalled();
  });

  // The other direction: right tenant selected, wrong one intended.
  it('refuses when the typed slug does not match', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    await expect(resetRestaurant('r1', 'amani-gril', ACTOR)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.resetRestaurantTransactionalData).not.toHaveBeenCalled();
  });

  // Exact comparison is deliberate -- a lenient match would let a
  // near-miss through, which is the thing being guarded against.
  it('refuses a slug differing only by case or whitespace', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    for (const attempt of ['Amani-Grill', ' amani-grill', 'amani-grill ', 'AMANI-GRILL']) {
      await expect(resetRestaurant('r1', attempt, ACTOR)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(repo.resetRestaurantTransactionalData).not.toHaveBeenCalled();
  });

  it('refuses an empty confirmation', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    await expect(resetRestaurant('r1', '', ACTOR)).rejects.toBeInstanceOf(ValidationError);
    expect(repo.resetRestaurantTransactionalData).not.toHaveBeenCalled();
  });

  it('404s an unknown restaurant rather than deleting nothing quietly', async () => {
    repo.findRestaurantMode.mockResolvedValue(undefined);
    await expect(resetRestaurant('nope', 'anything', ACTOR)).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.resetRestaurantTransactionalData).not.toHaveBeenCalled();
  });

  // The error has to name the slug, or an operator cannot tell which of
  // several similarly-named test tenants they are actually looking at.
  it('names the expected slug when the confirmation is wrong', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    await expect(resetRestaurant('r1', 'wrong', ACTOR)).rejects.toThrow(/amani-grill/);
  });
});

describe('changing mode', () => {
  it('switches a live restaurant to test', async () => {
    repo.findRestaurantMode.mockResolvedValue(LIVE_RESTAURANT);
    const r = await changeRestaurantMode('r1', 'test', ACTOR);
    expect(r.mode).toBe('test');
    expect(repo.setRestaurantMode).toHaveBeenCalledWith('r1', 'test');
  });

  it('does not write when the mode is already what was asked for', async () => {
    repo.findRestaurantMode.mockResolvedValue(TEST_RESTAURANT);
    await changeRestaurantMode('r1', 'test', ACTOR);
    expect(repo.setRestaurantMode).not.toHaveBeenCalled();
  });

  it('404s an unknown restaurant', async () => {
    repo.findRestaurantMode.mockResolvedValue(undefined);
    await expect(changeRestaurantMode('nope', 'test', ACTOR)).rejects.toBeInstanceOf(NotFoundError);
  });
});
