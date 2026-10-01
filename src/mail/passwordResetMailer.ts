import nodemailer from 'nodemailer';
import type { Logger } from '../logger';

export interface PasswordResetMailer {
  sendPasswordReset(input: {
    to: string;
    link: string;
    ttlMinutes: number;
  }): Promise<{ sent: boolean; reason?: string }>;
}

export interface SmtpMailerConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string | null;
  from: string;
}

export function readSmtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpMailerConfig | null {
  const host = env.SMTP_HOST ?? '';
  const from = env.SMTP_FROM ?? '';
  if (host === '' || from === '') return null;
  const port = env.SMTP_PORT !== undefined && env.SMTP_PORT !== '' ? Number(env.SMTP_PORT) : 587;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const secureRaw = env.SMTP_SECURE ?? '';
  const secure = secureRaw === '1' || secureRaw.toLowerCase() === 'true' || port === 465;
  const user = env.SMTP_USER !== undefined && env.SMTP_USER !== '' ? env.SMTP_USER : null;
  const pass = env.SMTP_PASS !== undefined && env.SMTP_PASS !== '' ? env.SMTP_PASS : null;
  return { host, port, secure, user, pass, from };
}

type SendMailFn = (mail: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<unknown>;

export interface PasswordResetMailerOptions {
  baseUrl: string;
  smtp: SmtpMailerConfig | null;
  sendMail?: SendMailFn;
  logger: Logger;
}

function smtpSendMail(smtp: SmtpMailerConfig): SendMailFn {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user !== null && smtp.pass !== null ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return async (mail) => transport.sendMail(mail);
}

export function createPasswordResetMailer(options: PasswordResetMailerOptions): PasswordResetMailer {
  const { baseUrl, smtp, logger } = options;
  const sendMail: SendMailFn | null =
    options.sendMail ?? (smtp !== null ? smtpSendMail(smtp) : null);

  return {
    async sendPasswordReset({ to, link, ttlMinutes }) {
      if (baseUrl === '') {
        logger.warn('password reset delivery unavailable', { reason: 'reset_url_not_configured' });
        return { sent: false, reason: 'reset_url_not_configured' };
      }
      if (smtp === null || sendMail === null) {
        logger.warn('password reset delivery unavailable', { reason: 'smtp_not_configured' });
        return { sent: false, reason: 'smtp_not_configured' };
      }
      try {
        await sendMail({
          from: smtp.from,
          to,
          subject: 'Reset your Apex Dentalistics password',
          text: [
            'A password reset was requested for your clinic account.',
            '',
            `Open this link to choose a new password (valid for ${ttlMinutes} minutes):`,
            link,
            '',
            'If you did not request this, you can ignore this message.',
          ].join('\n'),
        });
        return { sent: true };
      } catch (err) {
        logger.warn('password reset delivery failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { sent: false, reason: 'send_failed' };
      }
    },
  };
}

export function createPasswordResetMailerFromEnv(logger: Logger): PasswordResetMailer {
  return createPasswordResetMailer({
    baseUrl: process.env.RESET_BASE_URL ?? '',
    smtp: readSmtpConfigFromEnv(),
    logger,
  });
}
