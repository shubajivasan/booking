// Sends a WhatsApp notification via Meta's WhatsApp Cloud API, using a
// pre-approved message template (required for any business-initiated
// message — you can't just send free text to someone who hasn't messaged
// you first). The template itself is created and approved once in Meta's
// WhatsApp Manager; this code just fills in its variables per booking.
//
// Note: the WhatsApp Business Platform has no concept of sending to a
// "group" — groups are a personal-WhatsApp feature the Business API simply
// doesn't support. To keep several people in the loop, this sends the same
// message to each of them individually instead.
//
// WHATSAPP_PHONE_NUMBER_ID: from your WhatsApp app's API Setup page.
// WHATSAPP_ACCESS_TOKEN: a permanent access token (see setup notes).
// WHATSAPP_ADMIN_NUMBER: one or more numbers to notify, comma-separated,
//   international format with no + or spaces — e.g.
//   919876543210,919812345678
// WHATSAPP_TEMPLATE_NAME: defaults to "new_booking_alert" — must exactly
//   match an APPROVED template name in WhatsApp Manager.
//
// If any of these aren't set, this quietly does nothing rather than
// breaking the booking itself — a booking should still succeed even if
// WhatsApp notifications aren't configured yet.
export async function sendWhatsAppNotification({ roomLabel, date, timeLabel, studentName, purpose }) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const adminNumbers = process.env.WHATSAPP_ADMIN_NUMBER;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'new_booking_alert';

  if (!phoneNumberId || !accessToken || !adminNumbers) {
    console.warn('WhatsApp notification skipped — WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN or WHATSAPP_ADMIN_NUMBER is not set.');
    return;
  }

  const numbers = adminNumbers.split(',').map(n => n.trim()).filter(Boolean);

  // Sent independently and in parallel — one number failing (e.g. a typo,
  // or someone hasn't accepted the template's opt-in yet) doesn't stop the
  // message from reaching everyone else.
  await Promise.all(numbers.map(toNumber => sendToOneNumber({ phoneNumberId, accessToken, templateName, toNumber, roomLabel, date, timeLabel, studentName, purpose })));
}

async function sendToOneNumber({ phoneNumberId, accessToken, templateName, toNumber, roomLabel, date, timeLabel, studentName, purpose }) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toNumber,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: roomLabel },
                { type: 'text', text: date },
                { type: 'text', text: timeLabel },
                { type: 'text', text: studentName },
                { type: 'text', text: purpose || '\u2014' },
              ],
            },
          ],
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`WhatsApp send to ${toNumber} failed:`, res.status, body);
    }
  } catch (err) {
    // Never let a WhatsApp failure break the booking that triggered it.
    console.error(`WhatsApp send to ${toNumber} threw:`, err);
  }
}
