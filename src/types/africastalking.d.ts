// The africastalking SDK ships no type declarations of its own.
declare module 'africastalking' {
  interface AfricasTalkingSmsResult {
    SMSMessageData: {
      Recipients: { status: string; statusCode: number; number: string; cost: string }[];
    };
  }

  /**
   * The chat API's response shape isn't documented as precisely as the SMS
   * one, so this is deliberately loose: we read an id from it for support
   * tracing, but nothing depends on a field being present.
   */
  interface AfricasTalkingWhatsAppResult {
    messageId?: string;
    id?: string;
    status?: string;
    [key: string]: unknown;
  }

  /**
   * Mirrors the `templateId / headerValue / bodyValues` branch of the
   * SDK's own Joi schema (lib/whatsapp.js). Business-initiated WhatsApp
   * messages have to be templates, so that's the only branch we model --
   * the SDK also accepts plain text, media and interactive bodies, which
   * are only usable inside the 24-hour customer-service window.
   */
  interface AfricasTalkingWhatsAppTemplateBody {
    templateId: string;
    headerValue: string;
    bodyValues: string[];
  }

  interface AfricasTalkingClient {
    SMS: {
      send(opts: { to: string | string[]; message: string; from?: string }): Promise<AfricasTalkingSmsResult>;
    };
    WHATSAPP: {
      sendMessage(opts: {
        waNumber: string;
        phoneNumber: string;
        body: AfricasTalkingWhatsAppTemplateBody;
      }): Promise<AfricasTalkingWhatsAppResult>;
    };
  }

  function AfricasTalking(opts: { apiKey: string; username: string }): AfricasTalkingClient;

  export = AfricasTalking;
}
