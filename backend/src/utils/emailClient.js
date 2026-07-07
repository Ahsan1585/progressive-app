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

module.exports = { sendPasswordResetEmail };
