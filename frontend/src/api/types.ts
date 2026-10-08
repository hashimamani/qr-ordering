export type StaffRole = 'admin' | 'waiter' | 'kitchen' | 'bar' | 'services';
export type OrderItemStatus = 'received' | 'preparing' | 'ready' | 'served';
/**
 * Mirrors the server's FulfilmentDestination (src/lib/domain.ts).
 * 'services' covers work that is neither cooked nor poured -- Chillax
 * Zone's carwash and laundry, for instance.
 */
export type Destination = 'kitchen' | 'bar' | 'services';

/** Rendered wherever a station has to be named in the UI. */
export const DESTINATION_LABELS: Record<Destination, string> = {
  kitchen: 'Kitchen',
  bar: 'Bar',
  services: 'Services',
};
/** WhatsApp is the default; SMS and email remain available. */
export type ContactChannel = 'sms' | 'email' | 'whatsapp';

export interface MenuCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string;
  is_available: boolean;
  destination?: Destination;
}

export interface ResolveTableResponse {
  restaurant: { name: string; slug: string; brand_color: string | null };
  /** Channels this deployment can actually deliver on, in preference order. */
  available_channels: ContactChannel[];
  table_session_status: string;
  menu: { categories: MenuCategory[]; items: MenuItem[] };
}

export interface PlaceOrderResponse {
  public_token: string;
  tracking_url: string;
}

export interface TrackedOrderItem {
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: OrderItemStatus;
}

export interface TrackedOrder {
  public_token: string;
  submitted_at: string;
  restaurant_name: string;
  brand_color: string | null;
  items: TrackedOrderItem[];
}

export interface LoginResponse {
  token: string;
  role: StaffRole;
  name: string;
  restaurant_name: string;
  brand_color: string | null;
}

export interface RestaurantBranding {
  id: string;
  name: string;
  slug: string;
  brand_color: string | null;
}

export interface QueuedOrderItem {
  table_number: string;
  order_public_token: string;
  order_item_id: string;
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: OrderItemStatus;
  submitted_at: string;
}

export interface DashboardTable {
  table_number: string;
  items: QueuedOrderItem[];
}

export interface WaiterOrderItem {
  order_item_id: string;
  menu_item_name: string;
  quantity: number;
  status: OrderItemStatus;
}

export type PaymentStatus = 'unpaid' | 'paid';

export interface WaiterOrder {
  public_token: string;
  contact_channel: 'sms' | 'email';
  submitted_at: string;
  payment_status: PaymentStatus;
  items: WaiterOrderItem[];
}

export interface WaiterTableSession {
  session_id: string;
  session_status: 'active' | 'awaiting_payment' | 'closed';
  table_id: string;
  table_number: string;
  opened_at: string;
  assigned_waiter_id: string | null;
  assigned_waiter_name: string | null;
  calling_since: string | null;
  orders: WaiterOrder[];
}

export interface StaffUserSummary {
  id: string;
  restaurant_id: string;
  name: string;
  role: StaffRole;
  phone_or_email: string;
  created_at: string;
}

export interface AdminTable {
  id: string;
  restaurant_id: string;
  table_number: string;
  qr_token: string;
  assigned_waiter_id: string | null;
  assigned_waiter_name: string | null;
}

export interface CreatedTableWithQr {
  table: AdminTable;
  ordering_url: string;
  qr_code_png_base64: string;
}

export interface PlatformAdminLoginResponse {
  token: string;
  name: string;
}

export type RestaurantMode = 'test' | 'live';

export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  /** Only 'test' restaurants can have their trading history reset. */
  mode: RestaurantMode;
  created_at: string;
}

export interface ResetCounts {
  orders: number;
  table_sessions: number;
}

export interface ResetPreview {
  restaurant: { id: string; name: string; slug: string; mode: RestaurantMode };
  counts: ResetCounts;
}

export interface RestaurantSignupResponse {
  restaurant_id: string;
}

export interface RestaurantAdmin {
  id: string;
  name: string;
  phone_or_email: string;
}

export interface VapidPublicKeyResponse {
  publicKey: string;
}

export interface IdleTable {
  id: string;
  table_number: string;
}

// Money is always a decimal string (matches MenuItem.price above) --
// never a JS number, to avoid float drift on sums. Rendered with
// Number(...) at display time, same as everywhere else in this app.

export interface ReportTotals {
  gross_sales: string;
  paid_sales: string;
  unpaid_sales: string;
  order_count: number;
  item_count: number;
  average_order_value: string;
}

export interface TodaySummary extends ReportTotals {
  date: string;
}

export interface DayBucket {
  day: string;
  gross_sales: string;
  paid_sales: string;
  order_count: number;
}

export interface ReportSummary {
  from: string;
  to: string;
  totals: ReportTotals;
  by_day: DayBucket[];
}

export type BreakdownDimension = 'menu_item' | 'category' | 'waiter' | 'table';

export interface BreakdownRow {
  key: string | null;
  label: string;
  quantity: number;
  gross_sales: string;
  paid_sales: string;
  order_count: number;
  share_of_sales: number;
}

export interface BreakdownResponse {
  dimension: BreakdownDimension;
  rows: BreakdownRow[];
}

export interface StationItem {
  order_item_id: string;
  order_id: string;
  order_public_token: string;
  table_id: string;
  table_number: string;
  menu_item_name: string;
  quantity: number;
  notes: string | null;
  status: OrderItemStatus;
  submitted_at: string;
  /** The table's current assignee -- populated while the session is open. */
  waiter_name: string | null;
  /** Who moved it to served, from the audit trail (served column only). */
  served_by_name: string | null;
}

export interface StationBoard {
  pending: StationItem[];
  preparing: StationItem[];
  ready: StationItem[];
  served: StationItem[];
}

export interface ActivityEntry {
  id: string;
  actor_name: string;
  actor_role: StaffRole;
  from_status: OrderItemStatus;
  to_status: OrderItemStatus;
  is_override: boolean;
  is_backward: boolean;
  reason: string | null;
  created_at: string;
  menu_item_name: string;
  table_number: string;
  order_public_token: string;
}

export interface ReceiptChallengePrompt {
  /**
   * Mirrors the server's ChallengePrompt. 'whatsapp' was missing here,
   * which is why the page could not branch on it and told WhatsApp
   * recipients to enter an email address.
   */
  channel: 'sms' | 'email' | 'whatsapp';
  hint: string;
}

export interface ReceiptLineItem {
  menu_item_name: string;
  quantity: number;
  unit_price: string;
  line_total: string;
}

export interface VatBreakdown {
  net: string;
  vat: string;
  total: string;
  ratePercent: number;
}

export interface ReceiptDetail {
  order_public_token: string;
  submitted_at: string;
  paid_at: string;
  restaurant_name: string;
  brand_color: string | null;
  /** Computed server-side so this page and the PDF cannot disagree. */
  vat: VatBreakdown | null;
  vat_number: string | null;
  table_number: string;
  items: ReceiptLineItem[];
  total: string;
  prices_reconstructed: boolean;
}

export interface VerifiedReceipt {
  receipt: ReceiptDetail;
  download_grant: string;
}
