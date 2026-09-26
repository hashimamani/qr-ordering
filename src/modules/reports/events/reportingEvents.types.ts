export interface ReportingOrderItemFact {
  orderItemId: string;
  menuItemId: string;
  menuItemName: string;
  categoryId: string | null;
  categoryName: string | null;
  destination: 'kitchen' | 'bar';
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
  | { type: 'order_paid'; orderId: string; restaurantId: string };

export type OrderPlacedEvent = Extract<ReportingEvent, { type: 'order_placed' }>;
