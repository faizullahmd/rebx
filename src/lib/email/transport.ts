import "server-only";
import { Resend } from "resend";

let resendClient: Resend | undefined;
function getResend() {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export interface OutgoingEmail {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

/** The only place that talks to Resend. Tests mock the "resend" module to capture payloads. */
export async function deliver(email: OutgoingEmail) {
  return getResend().emails.send(email);
}
