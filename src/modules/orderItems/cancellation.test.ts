import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Covers the reporting hand-off rather than the SQL, because the unit
 * mismatch there is invisible: report_order_fact.item_count is a sum of
 * quantities, so sending a count of *lines* leaves the figure
 * permanently overstated and nothing errors. An order of 2+1 cancelled
 * in full dropped the count from 3 to 1 instead of 0.
 */

const enqueue = vi.fn();
const repo = vi.hoisted(() => ({ cancelOrderItems: vi.fn() }));
vi.mock('./cancellation.repository', () => repo);
vi.mock('../reports/events/reportingEvents.queue', () => ({
  getReportingQueue: () => ({ enqueue }),
}));
vi.mock('../../realtime/broadcaster', () => ({ broadcastEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../realtime/waiterBroadcast', () => ({
  broadcastToTableWaiter: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../staff/staff.repository', () => ({
  findStaffUserById: vi.fn().mockResolvedValue({ name: 'Amani Admin' }),
}));

import { cancelOrderAsCustomer, cancelOrderAsStaff } from './cancellation.service';

const RESULT = {
  orderId: '42',
  publicToken: 'tok',
  restaurantId: 'r1',
  tableId: 't1',
  items: [
    { id: 'a', quantity: 2, unit_price: '250.00', line_total: '500.00' },
    { id: 'b', quantity: 1, unit_price: '1100.00', line_total: '1100.00' },
  ],
  cancelledTotal: '1600.00',
  orderFullyCancelled: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  repo.cancelOrderItems.mockResolvedValue(RESULT);
});

describe('the reporting correction', () => {
  it('counts quantities, not lines', async () => {
    await cancelOrderAsCustomer('r1', 'tok');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'order_items_cancelled', cancelledItemCount: 3 }),
    );
  });

  it('carries the cancelled value and the item ids', async () => {
    await cancelOrderAsCustomer('r1', 'tok');
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ cancelledTotal: '1600.00', orderItemIds: ['a', 'b'] }),
    );
  });

  // A reporting hiccup must never undo a cancellation the customer has
  // already been told succeeded.
  it('still reports success when the event cannot be enqueued', async () => {
    enqueue.mockRejectedValueOnce(new Error('queue down'));
    await expect(cancelOrderAsCustomer('r1', 'tok')).resolves.toMatchObject({ orderId: '42' });
  });
});

describe('who is allowed what', () => {
  it('holds a customer to an order nothing has started on', async () => {
    await cancelOrderAsCustomer('r1', 'tok');
    expect(repo.cancelOrderItems).toHaveBeenCalledWith(
      'r1',
      'tok',
      expect.objectContaining({ kind: 'customer', role: null, staffId: null }),
      expect.objectContaining({ requireNothingStarted: true }),
    );
  });

  // Staff can see the food and are the ones entitled to waste it.
  it('applies no such restriction to staff', async () => {
    await cancelOrderAsStaff('r1', 'tok', { id: 's1', role: 'admin' }, { reason: 'Customer left' });
    const opts = repo.cancelOrderItems.mock.calls[0][3];
    expect(opts.requireNothingStarted).toBeUndefined();
    expect(opts.reason).toBe('Customer left');
  });

  it('snapshots the staff name so the audit survives the account going', async () => {
    await cancelOrderAsStaff('r1', 'tok', { id: 's1', role: 'waiter' });
    expect(repo.cancelOrderItems).toHaveBeenCalledWith(
      'r1',
      'tok',
      expect.objectContaining({ kind: 'staff', name: 'Amani Admin', role: 'waiter' }),
      expect.anything(),
    );
  });
});
