import { minutesToLabel, roomName } from './schedule';

// Shared by create-booking (new bookings / new requests) and
// admin/booking-requests (approve / reject), so every email about a booking
// looks the same no matter which step sent it.

// Escapes user-typed text before it goes into email HTML, so a name or
// purpose containing <a>, <img> etc. shows up as plain text rather than
// becoming real links/images in an email sent from the academy's address.
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Groups a list of 30-minute slot starts (in minutes-from-midnight) into
// contiguous runs for a readable label — e.g. [600, 630] (10:00, 10:30)
// reads as "10am–11am" instead of two separate half-hour ranges.
export function slotsLabel(startMinutesList) {
  const sorted = [...startMinutesList].sort((a, b) => a - b);
  const runs = [];
  let runStart = sorted[0];
  let runEnd = sorted[0] + 30;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === runEnd) {
      runEnd = sorted[i] + 30;
    } else {
      runs.push([runStart, runEnd]);
      runStart = sorted[i];
      runEnd = sorted[i] + 30;
    }
  }
  runs.push([runStart, runEnd]);
  return runs.map(([s, e]) => `${minutesToLabel(s)}\u2013${minutesToLabel(e)}`).join(', ');
}

// Internal alert to admins. `needsApproval` switches the heading and adds
// a link to the Requests tab.
export function adminEmail({ roomId, date, hoursLabel, name, email, phone, purpose, needsApproval, adminUrl }) {
  const heading = needsApproval ? 'New booking request \u2014 approval needed' : 'New booking';
  return {
    subject: needsApproval
      ? `Approval needed: ${roomName(roomId)} on ${date}`
      : `New booking: ${roomName(roomId)} on ${date}`,
    html: `
      <h2>${heading}</h2>
      <p><b>Space:</b> ${roomName(roomId)}</p>
      <p><b>Date:</b> ${date}</p>
      <p><b>Hours:</b> ${hoursLabel}</p>
      <p><b>Name:</b> ${esc(name)}</p>
      <p><b>Email:</b> ${esc(email)}</p>
      <p><b>Phone:</b> ${phone ? esc(phone) : '\u2014'}</p>
      <p><b>Purpose:</b> ${purpose ? esc(purpose) : '\u2014'}</p>
      ${needsApproval && adminUrl ? `<p><a href="${adminUrl}">Open the Requests tab to approve or reject</a></p>` : ''}
    `,
  };
}

function studentShell({ heading, intro, roomId, date, hoursLabel, purpose, footer, extra = '' }) {
  return `
    <div style="font-family: Georgia, serif; color: #2b2116; max-width: 480px;">
      <p style="font-size: 12px; letter-spacing: 1px; text-transform: uppercase; color: #8a6d3b; margin-bottom: 4px;">
        Ajivasan Academy of Performing Arts
      </p>
      <h2 style="margin-top: 0;">${heading}</h2>
      ${intro}
      <table style="border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Space</td><td><b>${roomName(roomId)}</b></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Date</td><td><b>${date}</b></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Time</td><td><b>${hoursLabel}</b></td></tr>
        ${purpose ? `<tr><td style="padding: 4px 12px 4px 0; color: #6b5c47;">Purpose</td><td>${esc(purpose)}</td></tr>` : ''}
      </table>
      ${extra}
      <p style="font-size: 13px; color: #6b5c47;">${footer}</p>
    </div>
  `;
}

export function studentConfirmedEmail({ roomId, date, hoursLabel, name, purpose, afterApproval = false, timingChanged = false }) {
  return {
    subject: `Your booking is confirmed \u2014 ${roomName(roomId)}, ${date}`,
    html: studentShell({
      heading: 'Booking confirmed',
      intro: `<p>Hi ${esc(name)},</p><p>${afterApproval ? 'Good news \u2014 your booking request has been approved.' : 'Your booking is confirmed.'} Here are the details:</p>`,
      roomId, date, hoursLabel, purpose,
      extra: timingChanged
        ? '<p><b>Please note:</b> the academy has updated the room, date or timing of your request. The details above are the confirmed ones.</p>'
        : '',
      footer: 'If anything about this booking needs to change, please get in touch with the academy directly.',
    }),
  };
}

export function studentRequestReceivedEmail({ roomId, date, hoursLabel, name, purpose }) {
  return {
    subject: `Booking request received \u2014 ${roomName(roomId)}, ${date}`,
    html: studentShell({
      heading: 'Booking request submitted',
      intro: `<p>Hi ${esc(name)},</p><p>We've received your request. This space is allocated by the academy's management, so your booking will be confirmed once an admin approves it. We'll email you as soon as that happens.</p>`,
      roomId, date, hoursLabel, purpose,
      footer: 'This is not a confirmation yet \u2014 please wait for our approval email before planning around this slot.',
    }),
  };
}

export function studentRejectedEmail({ roomId, date, hoursLabel, name, purpose, reason }) {
  return {
    subject: `Booking request not approved \u2014 ${roomName(roomId)}, ${date}`,
    html: studentShell({
      heading: 'Booking request not approved',
      intro: `<p>Hi ${esc(name)},</p><p>Unfortunately we're unable to approve your booking request for the following slot:</p>`,
      roomId, date, hoursLabel, purpose,
      extra: reason ? `<p><b>Note from the academy:</b> ${esc(reason)}</p>` : '',
      footer: 'You\u2019re welcome to request a different time, or get in touch with the academy directly.',
    }),
  };
}
