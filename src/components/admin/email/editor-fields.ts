// Plain (non-client) module so both the server page and the client editor can use it.

export interface EditorFields {
  name: string;
  description: string;
  category: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  cc: string;
  bcc: string;
}

export function toEditorFields(raw: Record<string, unknown>): EditorFields {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    name: s(raw.name), description: s(raw.description), category: s(raw.category), subject: s(raw.subject),
    htmlBody: s(raw.htmlBody), textBody: s(raw.textBody), fromName: s(raw.fromName), fromEmail: s(raw.fromEmail),
    replyTo: s(raw.replyTo), cc: s(raw.cc), bcc: s(raw.bcc),
  };
}
