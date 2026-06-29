import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppConfig } from '@metaxperts/config';

/** A file attachment carried through the (JSON-serialised) email queue — content is base64. */
export interface EmailAttachment {
  filename: string;
  contentBase64: string;
  contentType: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

/**
 * SMTP delivery via Nodemailer (open-source; works against MailHog/Mailpit locally). Best-effort by
 * design: `send` throws on failure so the BullMQ email worker can retry with backoff, but the caller
 * (the notifications flow) never lets an SMTP outage block the durable in-app notification. Short
 * connection/socket timeouts so a black-holed SMTP host fails fast rather than hanging a worker.
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter?: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.from = config.get('SMTP_FROM', { infer: true });
  }

  private transport(): Transporter {
    if (this.transporter) return this.transporter;
    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASS', { infer: true });
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: false,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    return this.transporter;
  }

  /** Send one email (optionally with HTML body + attachments). Throws on failure (the queue worker retries). */
  async send(msg: EmailMessage): Promise<void> {
    await this.transport().sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.contentBase64, 'base64'),
        contentType: a.contentType,
      })),
    });
    this.logger.debug(`email sent to ${msg.to}: ${msg.subject}`);
  }
}
