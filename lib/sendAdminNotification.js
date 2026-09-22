import nodemailer from 'nodemailer';

// Sends a plain notification email through your Google Workspace account
// over SMTP, using nodemailer. Reuses one connection across requests
// rather than reconnecting every time.
//
// GMAIL_USER: the Workspace address to send FROM, e.g. bookings@ajivasan.com
//   (or your own staff address — any mailbox on your Workspace domain works).
// GMAIL_APP_PASSWORD: a 16-character App Password generated for that
//   account (NOT its normal login password) — see setup notes below.
// ADMIN_NOTIFICATION_EMAIL: where new-booking emails get sent. Can be the
//   same address as GMAIL_USER, or a different staff inbox.
//
// If any of these aren't set, this quietly does nothing rather than
// breaking the booking itself — a booking should still succeed even if
// email notifications aren't configured yet.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

export async function sendAdminNotification({ subject, html }) {
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  const user = process.env.GMAIL_USER;
  const t = getTransporter();

  if (!t || !to) {
    console.warn('Email notification skipped — GMAIL_USER, GMAIL_APP_PASSWORD or ADMIN_NOTIFICATION_EMAIL is not set.');
    return;
  }

  try {
    await t.sendMail({
      from: `"Ajivasan Booking" <${user}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    // Never let an email failure break the booking that triggered it.
    console.error('Gmail SMTP send failed:', err);
  }
}
