import type { NotificationJob } from './notifications.types';

export function renderTemplate(job: NotificationJob): { subject?: string; body: string } {
  const { restaurantName, trackingUrl } = job.templateData;

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
