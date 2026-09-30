import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import AfricasTalking from 'africastalking';
import { logger } from '../../lib/logger';
import type { NotificationChannel } from './notifications.types';
import type { WhatsAppTemplateMessage } from './whatsappTemplates';

export interface SendResult {
  success: boolean;
  providerResponse: string;
  /** Provider-side id, for tracing a "I never got it" back to the carrier. */
  providerMessageId?: string;
}

export interface NotificationProvider {
  send(to: string, message: { subject?: string; body: string }): Promise<SendResult>;
  /**
   * WhatsApp only. Business-initiated WhatsApp messages can't carry
   * free-form text -- outside the 24-hour window opened by an inbound
   * customer message (which never happens in our flow) only templates
   * pre-approved by Meta may be sent. So the WhatsApp provider takes a
   * template reference rather than a rendered string, and the SMS/email
   * providers simply don't implement this.
   */
  sendTemplate?(to: string, template: WhatsAppTemplateMessage): Promise<SendResult>;
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

  // Logs the resolved template id and parameter values, which is what
  // makes the WhatsApp path verifiable end-to-end before any Meta
  // approval exists -- a transposed parameter is visible right here.
  async sendTemplate(to: string, template: WhatsAppTemplateMessage): Promise<SendResult> {
    logger.info({ channel: this.channel, to, template }, '[dry-run] whatsapp template not actually sent');
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
      // Confirmed live: passing from: '' (an unconfigured sender id,
      // which arrives here as an empty string rather than undefined --
      // see awsSecrets.ts's `?? ''`) makes the SDK's own request
      // validation reject the call outright ("from" is not allowed to
      // be empty) -- every real send failed this way until omitting the
      // field entirely for the no-sender-id case, which the API accepts
      // fine (it just uses Africa's Talking's default/shared shortcode).
      const result = await this.client.SMS.send({
        to,
        message: message.body,
        ...(this.senderId ? { from: this.senderId } : {}),
      });
      // Africa's Talking's numeric statusCode varies by outcome (100
      // Processed, 101 Sent, 102 Queued are all non-failures) -- the
      // "Success" string status is the stable signal. Confirmed live:
      // an initial version of this check only accepted 101 and would
      // have silently mismarked a real, successfully-delivered send
      // (statusCode 100) as failed.
      const recipient = result.SMSMessageData.Recipients[0];
      const success = recipient?.status === 'Success';
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

/**
 * WhatsApp via Africa's Talking' chat API. Deliberately the same vendor as
 * the SMS provider above -- the credentials, account and billing already
 * exist, which is most of why this was the cheapest route to a channel
 * that isn't subject to promotional-SMS filtering.
 *
 * Only ever sends templates. See the sendTemplate docs on
 * NotificationProvider for why free-form text isn't an option here.
 */
class AfricasTalkingWhatsAppProvider implements NotificationProvider {
  private readonly client: ReturnType<typeof AfricasTalking>;

  constructor(
    apiKey: string,
    username: string,
    private readonly waNumber: string,
  ) {
    this.client = AfricasTalking({ apiKey, username });
  }

  // Present only to satisfy the interface. Reaching it would mean a
  // caller routed a plain-text notification down the WhatsApp path, which
  // Meta would reject anyway -- better to fail here with a clear reason
  // than to be told "message undeliverable" by the provider.
  async send(): Promise<SendResult> {
    return {
      success: false,
      providerResponse: 'WhatsApp requires a pre-approved template; plain text is not sendable',
    };
  }

  async sendTemplate(to: string, template: WhatsAppTemplateMessage): Promise<SendResult> {
    try {
      const result = await this.client.WHATSAPP.sendMessage({
        waNumber: this.waNumber,
        phoneNumber: to,
        body: {
          templateId: template.templateId,
          headerValue: template.headerValue,
          bodyValues: template.bodyValues,
        },
      });
      // AT's chat API shape isn't as well documented as their SMS one, so
      // this reads defensively rather than assuming a field: the id is for
      // support tracing, and failing to find it must not fail the send.
      const messageId =
        (result as { messageId?: string; id?: string })?.messageId ??
        (result as { id?: string })?.id;
      return {
        success: true,
        providerResponse: JSON.stringify(result),
        providerMessageId: messageId,
      };
    } catch (err) {
      return {
        success: false,
        providerResponse: err instanceof Error ? err.message : JSON.stringify(err),
      };
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

  if (channel === 'whatsapp') {
    const apiKey = process.env.AFRICASTALKING_API_KEY;
    const username = process.env.AFRICASTALKING_USERNAME;
    const waNumber = process.env.WHATSAPP_SENDER_NUMBER;
    // Same fallback contract as the other channels: without credentials
    // this logs instead of sending, which is what lets the whole WhatsApp
    // path ship and be exercised before Meta has approved anything.
    if (dryRun || !apiKey || !username || !waNumber) {
      return new ConsoleProvider('whatsapp');
    }
    return new AfricasTalkingWhatsAppProvider(apiKey, username, waNumber);
  }

  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (dryRun || !fromAddress) {
    return new ConsoleProvider('email');
  }
  return new SesEmailProvider(fromAddress);
}
