export type NotificationChannel = 'sms' | 'email' | 'whatsapp';
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
    /**
     * Only set for the 'receipt' trigger on WhatsApp: a single-use,
     * short-lived URL the messaging provider can fetch the PDF from to
     * attach it. Distinct from receiptUrl, which is the customer-facing
     * page behind the last-4 challenge.
     */
    receiptMediaUrl?: string;
  };
}
