import nodemailer from "nodemailer";
import { env } from "../../config/env.js";

export function isSmtpConfigured(): boolean {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass && (env.smtpFrom || env.smtpUser));
}

export function createSmtpTransport() {
  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    }
  });
}

export type SendMailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
};

export async function sendMail(input: SendMailInput): Promise<void> {
  const transport = createSmtpTransport();
  const from = env.smtpFrom || env.smtpUser;
  await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    attachments: input.attachments
  });
}
