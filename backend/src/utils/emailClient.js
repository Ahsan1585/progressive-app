const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping password reset email send.');
    return;
  }
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Reset your Progressive Portal password',
    html: `
      <p>We received a request to reset your Progressive Portal password.</p>
      <p><a href="${resetUrl}">Click here to reset your password</a>. This link expires in 30 minutes.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
};

const sendSessionScheduledEmail = async (toEmail, {
  childName, practitionerName, sessionDate, startTime, endTime, location, icsContent, cancelled,
}) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping session schedule email send.');
    return;
  }
  const subject = cancelled
    ? `Cancelled: ${childName}'s session on ${sessionDate}`
    : `${childName}'s session scheduled for ${sessionDate}`;
  const html = cancelled
    ? `
      <p>The session for <b>${childName}</b> on <b>${sessionDate}</b> (${startTime}–${endTime}) with ${practitionerName} has been cancelled.</p>
      <p>A calendar update is attached to remove it from your calendar.</p>
    `
    : `
      <p>A session for <b>${childName}</b> has been scheduled with ${practitionerName}.</p>
      <ul>
        <li><b>Date:</b> ${sessionDate}</li>
        <li><b>Time:</b> ${startTime} – ${endTime}</li>
        ${location ? `<li><b>Location:</b> ${location}</li>` : ''}
      </ul>
      <p>A calendar invite is attached — open it to add this session to your calendar.</p>
    `;
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject,
    html,
    attachments: [
      {
        filename: 'session.ics',
        content: Buffer.from(icsContent).toString('base64'),
        contentType: 'text/calendar; method=' + (cancelled ? 'CANCEL' : 'REQUEST'),
      },
    ],
  });
};

module.exports = { sendPasswordResetEmail, sendSessionScheduledEmail };
