import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import AfricasTalking from 'africastalking';
import { logger } from '../../lib/logger';
import type { NotificationChannel } from './notifications.types';

export interface SendResult {
  success: boolean;
  providerResponse: string;
}

export interface NotificationProvider {
  send(to: string, message: { subject?: string; body: string }): Promise<SendResult>;
}

/**
 * Dry-run stand-in used whenever real provider credentials aren't
 * configured (the default for local development) — logs instead of
 * placing a real call, so the order-submission flow can be exercised
 * end-to-end without an Africa's Talking or SES account.
 */
class ConsoleProvider implements NotificationProvider {
  constructor(private readonly channel: NotificationChannel) {}

  async send(to: string, message: { subject?: string; body: string }): Promise<SendResult> {
    logger.info({ channel: this.channel, to, message }, '[dry-run] notification not actually sent');
    return { success: true, providerResponse: 'dry_run' };
  }
}

class AfricasTalkingSmsProvider implements NotificationProvider {
  private readonly client: ReturnType<typeof AfricasTalking>;
  private readonly senderId?: string;

  constructor(apiKey: string, username: string, senderId?: string) {
    this.client = AfricasTalking({ apiKey, username });
    this.senderId = senderId;
  }

  async send(to: string, message: { body: string }): Promise<SendResult> {
    try {
      const result = await this.client.SMS.send({
        to,
        message: message.body,
        from: this.senderId,
      });
      const recipient = result.SMSMessageData.Recipients[0];
      const success = recipient?.statusCode === 101;
      return { success, providerResponse: JSON.stringify(result.SMSMessageData) };
    } catch (err) {
      return { success: false, providerResponse: err instanceof Error ? err.message : 'unknown error' };
    }
  }
}

class SesEmailProvider implements NotificationProvider {
  private readonly client: SESClient;
  private readonly fromAddress: string;

  constructor(fromAddress: string) {
    this.client = new SESClient({});
    this.fromAddress = fromAddress;
  }

  async send(to: string, message: { subject?: string; body: string }): Promise<SendResult> {
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          Source: this.fromAddress,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: message.subject ?? 'Order update' },
            Body: { Text: { Data: message.body } },
          },
        }),
      );
      return { success: true, providerResponse: result.MessageId ?? 'sent' };
    } catch (err) {
      return { success: false, providerResponse: err instanceof Error ? err.message : 'unknown error' };
    }
  }
}

export function getProviderForChannel(channel: NotificationChannel): NotificationProvider {
  const dryRun = process.env.NOTIFICATIONS_DRY_RUN !== 'false';

  if (channel === 'sms') {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;
    if (dryRun || !apiKey || !username) {
      return new ConsoleProvider('sms');
    }
    return new AfricasTalkingSmsProvider(apiKey, username, process.env.AFRICASTALKING_SENDER_ID);
  }

  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (dryRun || !fromAddress) {
    return new ConsoleProvider('email');
  }
  return new SesEmailProvider(fromAddress);
}
