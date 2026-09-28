export type NotificationChannel = 'sms' | 'email';
export type NotificationTrigger = 'order_received' | 'order_ready' | 'receipt';

export interface NotificationJob {
  orderId: string;
  channel: NotificationChannel;
  contactValue: string;
  trigger: NotificationTrigger;
  templateData: {
    restaurantName: string;
    trackingUrl: string;
    /** Only set for the 'receipt' trigger. */
    receiptUrl?: string;
  };
}
