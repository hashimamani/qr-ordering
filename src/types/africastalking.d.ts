// The africastalking SDK ships no type declarations of its own.
declare module 'africastalking' {
  interface AfricasTalkingSmsResult {
    SMSMessageData: {
      Recipients: { status: string; statusCode: number; number: string; cost: string }[];
    };
  }

  interface AfricasTalkingClient {
    SMS: {
      send(opts: { to: string | string[]; message: string; from?: string }): Promise<AfricasTalkingSmsResult>;
    };
  }

  function AfricasTalking(opts: { apiKey: string; username: string }): AfricasTalkingClient;

  export = AfricasTalking;
}
