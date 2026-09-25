export type StaffRole = 'admin' | 'waiter' | 'kitchen' | 'bar';
export type OrderItemStatus = 'received' | 'preparing' | 'ready' | 'served';
export type Destination = 'kitchen' | 'bar';

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
  restaurant: { name: string; slug: string };
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
  items: TrackedOrderItem[];
}

export interface LoginResponse {
  token: string;
  role: StaffRole;
  name: string;
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

export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  created_at: string;
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
