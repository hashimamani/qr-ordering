import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import AfricasTalking from 'africastalking';
import { logger } from '../../lib/logger';
import type { NotificationChannel } from './notifications.types';
import { toMetaComponents, type WhatsAppTemplateMessage } from './whatsappTemplates';

export interface SendResult {
  success: boolean;
  providerResponse: string;
  /** Provider-side id, for tracing a "I never got it" back to the carrier. */
  providerMessageId?: string;
  /**
   * Set by a provider that can tell its own permanent failures from its
   * transient ones, so the queue doesn't retry something that will fail
   * identically every time.
   */
  permanent?: boolean;
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
 * WhatsApp via Meta's Cloud API, integrated directly rather than through
 * a reseller -- no markup, and template submission/status is managed in
 * Meta's own console.
 *
 * Only ever sends templates. Business-initiated WhatsApp messages can't
 * carry free-form text: outside the 24-hour window opened by an inbound
 * customer message (which never happens in our flow) only templates Meta
 * has approved may be sent.
 */
class MetaCloudWhatsAppProvider implements NotificationProvider {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion: string,
  ) {}

  // Present only to satisfy the interface. Reaching it would mean a caller
  // routed plain text down the WhatsApp path, which Meta rejects anyway --
  // better to fail here with a reason than to decode their error code.
  async send(): Promise<SendResult> {
    return {
      success: false,
      providerResponse: 'WhatsApp requires a pre-approved template; plain text is not sendable',
    };
  }

  async sendTemplate(to: string, template: WhatsAppTemplateMessage): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      // Meta wants digits only. contact_value is stored E.164 ("+2547..."),
      // so the leading + is stripped here rather than at rest -- every
      // other channel, and the receipt last-4 challenge, wants it kept.
      to: to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: template.templateName,
        language: { code: template.languageCode },
        components: toMetaComponents(template),
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { message?: string; code?: number; error_subcode?: number };
      };

      if (!response.ok || body.error) {
        // Meta's errors are the only diagnostic available when a template
        // is unapproved, paused, or has the wrong parameter count, so the
        // whole error object is preserved rather than just a message.
        //
        // 4xx means Meta understood us and refused: a wrong parameter
        // count, an unapproved or paused template, an expired token, a
        // number that isn't on WhatsApp. None of those change by trying
        // again in ten seconds, and retrying writes the same failure row
        // each time. 5xx and network errors are genuinely transient and
        // stay retryable.
        const permanent = response.status >= 400 && response.status < 500;
        return {
          success: false,
          providerResponse: `meta ${response.status}: ${JSON.stringify(body.error ?? body)}`,
          permanent,
        };
      }

      return {
        success: true,
        providerResponse: JSON.stringify(body),
        providerMessageId: body.messages?.[0]?.id,
      };
    } catch (err) {
      return {
        success: false,
        providerResponse: err instanceof Error ? err.message : 'unknown error',
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
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    // Same fallback contract as the other channels: without credentials
    // this logs instead of sending, which is what lets the WhatsApp path
    // ship and be exercised before any template is approved.
    if (dryRun || !phoneNumberId || !accessToken) {
      return new ConsoleProvider('whatsapp');
    }
    return new MetaCloudWhatsAppProvider(
      phoneNumberId,
      accessToken,
      process.env.WHATSAPP_API_VERSION || 'v25.0',
    );
  }

  const fromAddress = process.env.SES_FROM_ADDRESS;
  if (dryRun || !fromAddress) {
    return new ConsoleProvider('email');
  }
  return new SesEmailProvider(fromAddress);
}
