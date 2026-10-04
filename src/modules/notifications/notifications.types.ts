export type NotificationChannel = 'sms' | 'email' | 'whatsapp';
export type NotificationTrigger = 'order_received' | 'order_ready' | 'receipt';

/**
 * Mirrors the notification_status enum. 'sent' means a provider accepted
 * the message; 'delivered' and 'read' are reported later over Meta's
 * webhook. 'failed' is our send being rejected, 'undelivered' is the
 * provider accepting it and then not getting it there -- see the
 * add-notification-delivery-status migration for why those stay apart.
 */
export type NotificationStatus = 'sent' | 'failed' | 'delivered' | 'read' | 'undelivered';

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
