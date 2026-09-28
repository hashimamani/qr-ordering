import type { NotificationJob } from './notifications.types';

export function renderTemplate(job: NotificationJob): { subject?: string; body: string } {
  const { restaurantName, trackingUrl, receiptUrl } = job.templateData;

  if (job.trigger === 'receipt') {
    return {
      subject: `Your receipt from ${restaurantName}`,
      // The link is deliberately the only thing here -- the receipt itself
      // is behind a challenge, so the message carries nothing about the
      // order that would be readable from a lock screen.
      body: `Thanks for visiting ${restaurantName}! View your receipt: ${receiptUrl}`,
    };
  }

  if (job.trigger === 'order_received') {
    return {
      subject: `Your order at ${restaurantName}`,
      body: `Thanks for ordering at ${restaurantName}! Track your order here: ${trackingUrl}`,
    };
  }

  return {
    subject: `Your order at ${restaurantName} is ready`,
    body: `Your order at ${restaurantName} is ready! Details: ${trackingUrl}`,
  };
}
