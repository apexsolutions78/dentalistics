import nodemailer from 'nodemailer';
import type { Logger } from '../logger';
import { readSmtpConfigFromEnv } from './passwordResetMailer';
import type { SmtpMailerConfig } from './passwordResetMailer';

export interface BookingConfirmationMail {
  to: string;
  clinicName: string;
  whenLabel: string;
  doctorName: string;
  confirmed: boolean;
}

export interface BookingMailer {
  sendBookingConfirmation(
    input: BookingConfirmationMail,
  ): Promise<{ sent: boolean; reason?: string }>;
}

type SendMailFn = (mail: {
  from: string;
  to: string;
  subject: string;
  text: string;
}) => Promise<unknown>;

function smtpSendMail(smtp: SmtpMailerConfig): SendMailFn {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth:
      smtp.user !== null && smtp.pass !== null ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return async (mail) => transport.sendMail(mail);
}

export function createBookingMailer(options: {
  smtp: SmtpMailerConfig | null;
  sendMail?: SendMailFn;
  logger: Logger;
}): BookingMailer {
  const sendMail: SendMailFn | null =
    options.sendMail ?? (options.smtp !== null ? smtpSendMail(options.smtp) : null);
  const from = options.smtp?.from ?? '';

  return {
    async sendBookingConfirmation(input) {
      if (options.smtp === null || sendMail === null || from === '') {
        options.logger.warn('booking confirmation email skipped', { reason: 'smtp_not_configured' });
        return { sent: false, reason: 'smtp_not_configured' };
      }
      const statusLine = input.confirmed
        ? 'Your appointment is confirmed.'
        : 'The clinic still needs to confirm this request.';
      try {
        await sendMail({
          from,
          to: input.to,
          subject: input.confirmed
            ? `Appointment confirmed - ${input.clinicName}`
            : `Appointment request received - ${input.clinicName}`,
          text: [
            'Hello,',
            '',
            statusLine,
            '',
            `Clinic: ${input.clinicName}`,
            `When: ${input.whenLabel}`,
            `Doctor: ${input.doctorName}`,
            '',
            'If you need to change this visit, contact the clinic.',
          ].join('\n'),
        });
        return { sent: true };
      } catch (err) {
        options.logger.warn('booking confirmation email failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return { sent: false, reason: 'send_failed' };
      }
    },
  };
}

export function createBookingMailerFromEnv(logger: Logger): BookingMailer {
  return createBookingMailer({ smtp: readSmtpConfigFromEnv(), logger });
}
