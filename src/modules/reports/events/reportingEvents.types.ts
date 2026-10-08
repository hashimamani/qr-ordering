import type { FulfilmentDestination } from '../../../lib/domain';
export interface ReportingOrderItemFact {
  orderItemId: string;
  menuItemId: string;
  menuItemName: string;
  categoryId: string | null;
  categoryName: string | null;
  destination: FulfilmentDestination;
  quantity: number;
  unitPrice: string;
}

/**
 * Self-contained by design -- each event carries everything a fact row
 * needs, captured at the moment the operational data existed. The worker
 * never re-queries menu_item.price or "table".assigned_waiter_id at
 * processing time, so a delayed/DLQ-retried event still writes the
 * correct historical snapshot even if a price or assignment has since
 * changed.
 */
export type ReportingEvent =
  | {
      type: 'order_placed';
      orderId: string;
      restaurantId: string;
      submittedAt: string;
      tableId: string;
      tableNumber: string;
      items: ReportingOrderItemFact[];
    }
  | { type: 'order_waiter_assigned'; orderId: string; restaurantId: string; waiterId: string }
  | { type: 'order_paid'; orderId: string; restaurantId: string }
  /**
   * Corrects a fact already written. The fact is created when the order
   * is placed, so without this a cancelled item would keep counting as
   * revenue for the life of the report. Carries the cancelled value
   * rather than a list of ids so the worker never has to re-query
   * transactional data -- the same self-contained rule as every other
   * event here.
   */
  | {
      type: 'order_items_cancelled';
      orderId: string;
      restaurantId: string;
      cancelledTotal: string;
      cancelledItemCount: number;
      orderItemIds: string[];
    };

export type OrderPlacedEvent = Extract<ReportingEvent, { type: 'order_placed' }>;
