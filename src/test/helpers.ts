export interface CapturedEmail {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

/** Shared in-memory outbox + controllable failure for the mocked Resend client. */
export const outbox: CapturedEmail[] = [];
export const resendBehavior = { failWith: null as string | null };

export function resendFactory() {
  return {
    Resend: class {
      emails = {
        send: async (payload: CapturedEmail) => {
          if (resendBehavior.failWith) {
            return { data: null, error: { name: "validation_error", message: resendBehavior.failWith, statusCode: 422 } };
          }
          outbox.push(payload);
          return { data: { id: "test_email_id" }, error: null };
        },
      };
    },
  };
}
