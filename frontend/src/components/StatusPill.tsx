import type { OrderItemStatus } from '../api/types';

export function StatusPill({ status }: { status: OrderItemStatus }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}
