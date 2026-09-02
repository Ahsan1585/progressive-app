const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Same base path convention as every activation/reset link built elsewhere
// (see authController.js) — the app is served under /eis, not domain root.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
// A stable, unhashed path in frontend/public/ (not the bundled src/assets
// copy, which gets a new hashed filename every deploy) — email clients
// cache/reference image URLs long-term, so this one needs to never move.
const LOGO_URL = `${FRONTEND_URL}/email-logo.png`;
// Step-guide icons for sendParentSignatureRequestEmail's "what happens
// next" row — same stable-path convention as LOGO_URL.
const STEP_ICON_REVIEW_URL = `${FRONTEND_URL}/email-icon-review.png`;
const STEP_ICON_SIGN_URL = `${FRONTEND_URL}/email-icon-sign.png`;
const STEP_ICON_DONE_URL = `${FRONTEND_URL}/email-icon-done.png`;

// Reused directly from the web app's own palette (Login.jsx's --il-* custom
// properties) rather than a separate email-specific palette, so a
// transactional email still reads as unmistakably Izaya.
const COLORS = {
  navy: '#132A3E',
  teal: '#0E6E67',
  mint: '#2FBF9F',
  paper: '#F7FAF9',
  card: '#FFFFFF',
  slate: '#5C6B73',
  line: '#E2EAE8',
};
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

// Table-based "bulletproof" button — renders correctly (and stays fully
// clickable) even in Outlook desktop, which ignores most CSS on <a> tags.
// On mobile (see emailShell's <style> block) il-cta-table/il-cta-link go
// full-width — a small centered button is an easy-to-miss, hard-to-tap
// target on a phone, and this link is usually opened on one.
function ctaButton(url, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="il-cta-table" style="margin: 26px 0 0;">
      <tr>
        <td bgcolor="${COLORS.teal}" align="center" style="border-radius: 10px;">
          <a href="${url}" target="_blank" class="il-cta-link" style="display:inline-block; padding:14px 32px; font-family:${SANS}; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:10px;">
            ${label}
          </a>
        </td>
      </tr>
    </table>
  `;
}

// 3-column "here's what happens next" step row — icon above a bold label
// above one line of muted subtext, per column. The icon is a nice-to-have:
// each column carries its own real alt text and the bold label sits right
// under it, so the step is still fully legible in image-blocked clients
// (Gmail/Outlook default to blocking remote images until the user clicks
// "show images"). A bare width="33%" <td> only shrinks on narrow screens,
// it doesn't stack — the il-step-cell media-query rule in emailShell does
// the actual stacking to one full-width row per step under ~480px.
function stepGuide(steps) {
  const cell = ({ icon, alt, label, subtext }) => `
    <td class="il-step-cell" width="33%" align="center" valign="top" style="padding:0 6px;">
      <img src="${icon}" width="40" height="40" alt="${alt}" style="display:block; width:40px; height:40px; margin:0 auto 10px;" />
      <div style="font-family:${SANS}; font-size:12.5px; font-weight:700; color:${COLORS.navy}; margin-bottom:3px;">${label}</div>
      <div style="font-family:${SANS}; font-size:11.5px; line-height:1.4; color:${COLORS.slate};">${subtext}</div>
    </td>`;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
      <tr>${steps.map(cell).join('')}</tr>
    </table>
  `;
}

// Plain-link fallback under every CTA — some clients strip button styling
// or block images/links inside them, so the raw URL is always available too.
function linkFallback(url) {
  return `
    <p style="margin:20px 0 0; font-size:12px; line-height:1.6; color:${COLORS.slate};">
      Or paste this link into your browser:<br/>
      <a href="${url}" style="color:${COLORS.teal}; word-break:break-all;">${url}</a>
    </p>
  `;
}

// Shared shell for every transactional email this app sends — logo, brand
// eyebrow, headline, free-form body slot, an optional small-print footnote,
// and a minimal footer. Plain tables + inline styles throughout (no flexbox/
// grid, no custom web fonts, no gradients) so it renders consistently across
// Gmail, Apple Mail, and Outlook desktop alike.
function emailShell({ preheader, eyebrow, heading, bodyHtml, footnote }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Izaya EIS</title>
<style>
  @media only screen and (max-width: 480px) {
    .il-card-pad { padding-left: 22px !important; padding-right: 22px !important; }
    .il-step-cell { display: block !important; width: 100% !important; padding: 0 0 16px !important; }
    .il-step-cell:last-child { padding-bottom: 0 !important; }
    .il-cta-table { width: 100% !important; }
    .il-cta-link { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:${COLORS.paper};">
<div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader || ''}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.paper};">
<tr>
<td align="center" style="padding:40px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px; background-color:${COLORS.card}; border-radius:16px;">
<tr><td style="height:5px; line-height:5px; font-size:0; background-color:${COLORS.teal};" bgcolor="${COLORS.teal}">&nbsp;</td></tr>
<tr>
<td align="center" class="il-card-pad" style="padding:36px 40px 6px;">
<img src="${LOGO_URL}" width="140" alt="Izaya" style="display:block; width:140px; max-width:100%; height:auto; margin-bottom:14px;" />
<div style="font-family:${SANS}; font-size:10.5px; font-weight:700; letter-spacing:1.4px; text-transform:uppercase; color:${COLORS.slate};">Early Intervention Simplified</div>
</td>
</tr>
<tr>
<td class="il-card-pad" style="padding:22px 40px 0;">
${eyebrow ? `<div style="font-family:${SANS}; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; color:${COLORS.mint}; margin-bottom:10px;">${eyebrow}</div>` : ''}
<h1 style="margin:0 0 14px; font-family:${SERIF}; font-weight:600; font-size:23px; line-height:1.32; color:${COLORS.navy};">${heading}</h1>
<div style="font-family:${SANS}; font-size:14.5px; line-height:1.65; color:${COLORS.slate};">${bodyHtml}</div>
</td>
</tr>
${footnote ? `
<tr>
<td class="il-card-pad" style="padding:28px 40px 36px;">
<div style="border-top:1px solid ${COLORS.line}; padding-top:18px; font-family:${SANS}; font-size:12px; line-height:1.6; color:${COLORS.slate};">${footnote}</div>
</td>
</tr>` : `<tr><td style="padding-bottom:36px;"></td></tr>`}
</table>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr>
<td align="center" style="padding:20px 16px 0; font-family:${SANS}; font-size:11.5px; color:${COLORS.slate};">
Izaya Consulting LLC &middot; <a href="mailto:support@izayaedge.com" style="color:${COLORS.teal}; text-decoration:none;">support@izayaedge.com</a>
</td>
</tr>
</table>

</td>
</tr>
</table>
</body>
</html>`;
}

const sendPasswordResetEmail = async (toEmail, resetUrl) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping password reset email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">We received a request to reset your Izaya EIS password. Click below to choose a new one.</p>
    ${ctaButton(resetUrl, 'Reset My Password')}
    ${linkFallback(resetUrl)}
  `;
  const html = emailShell({
    preheader: 'Reset your Izaya EIS password — this link expires in 30 minutes.',
    eyebrow: 'Account Security',
    heading: 'Reset your password',
    bodyHtml,
    footnote: "This link expires in 30 minutes. If you didn't request this, you can safely ignore this email — your password won't change.",
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Reset your Izaya EIS password',
    html,
  });
};

const sendInviteEmail = async (toEmail, { activateUrl, companyName }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping account invite email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">An administrator at <b style="color:${COLORS.navy};">${companyName}</b> has set up an account for you on Izaya EIS. Choose your password below to activate it.</p>
    ${ctaButton(activateUrl, 'Set Up My Account')}
    ${linkFallback(activateUrl)}
  `;
  const html = emailShell({
    preheader: `Set up your account for ${companyName} on Izaya EIS.`,
    eyebrow: companyName,
    heading: `You've been added to ${companyName}`,
    bodyHtml,
    footnote: "This link expires in 7 days. If you weren't expecting this, you can safely ignore this email.",
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: `You've been invited to join ${companyName} on Izaya EIS`,
    html,
  });
};

const sendSignupConfirmationEmail = async (toEmail, { confirmUrl, companyName }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping signup confirmation email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Thanks for signing up <b style="color:${COLORS.navy};">${companyName}</b> for Izaya EIS — session logging, state matching, and invoicing, on one record. Confirm your email to activate your account and start your 15-day free trial. No card required.</p>
    ${ctaButton(confirmUrl, 'Confirm & Start My Trial')}
    ${linkFallback(confirmUrl)}
  `;
  const html = emailShell({
    preheader: `One click and your 15-day trial begins — ${companyName} on Izaya EIS.`,
    eyebrow: 'Welcome to Izaya',
    heading: "You're one step from your trial",
    bodyHtml,
    footnote: "This link expires in 24 hours. If you didn't request this, you can safely ignore this email.",
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: `Confirm your Izaya EIS signup — ${companyName}`,
    html,
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

  const detailRow = (label, value) => (value ? `
    <tr>
      <td style="padding:9px 0; font-family:${SANS}; font-size:12.5px; color:${COLORS.slate}; width:96px; vertical-align:top;">${label}</td>
      <td style="padding:9px 0; font-family:${SANS}; font-size:13.5px; font-weight:600; color:${COLORS.navy};">${value}</td>
    </tr>` : '');
  const detailsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0; border-top:1px solid ${COLORS.line}; border-bottom:1px solid ${COLORS.line};">
      ${detailRow('Child', childName)}
      ${detailRow('Date', sessionDate)}
      ${detailRow('Time', `${startTime} – ${endTime}`)}
      ${detailRow('Practitioner', practitionerName)}
      ${detailRow('Location', location)}
    </table>
  `;
  const bodyHtml = cancelled
    ? `
      <p style="margin:0;">The session below has been <b style="color:#B91C1C;">cancelled</b>.</p>
      ${detailsTable}
      <p style="margin:0; font-size:13px;">A calendar update is attached to remove it from your calendar.</p>
    `
    : `
      <p style="margin:0;">A session has been scheduled. Details below.</p>
      ${detailsTable}
      <p style="margin:0; font-size:13px;">A calendar invite is attached — open it to add this session to your calendar.</p>
    `;
  const html = emailShell({
    preheader: subject,
    eyebrow: cancelled ? 'Session Cancelled' : 'Session Scheduled',
    heading: cancelled ? 'Session cancelled' : 'Session scheduled',
    bodyHtml,
    footnote: '',
  });

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

const sendContactRequestEmail = async ({
  fullName, workEmail, agencyName, practitionerCount, message,
}) => {
  const to = process.env.CONTACT_TO_EMAIL || 'support@izayaedge.com';
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping contact/demo request email send.');
    return;
  }
  const detailRow = (label, value) => (value ? `
    <tr>
      <td style="padding:9px 0; font-family:${SANS}; font-size:12.5px; color:${COLORS.slate}; width:130px; vertical-align:top;">${label}</td>
      <td style="padding:9px 0; font-family:${SANS}; font-size:13.5px; font-weight:600; color:${COLORS.navy};">${value}</td>
    </tr>` : '');
  const bodyHtml = `
    <p style="margin:0 0 4px;">New demo request from the marketing site.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0; border-top:1px solid ${COLORS.line}; border-bottom:1px solid ${COLORS.line};">
      ${detailRow('Name', fullName)}
      ${detailRow('Work email', `<a href="mailto:${workEmail}" style="color:${COLORS.teal};">${workEmail}</a>`)}
      ${detailRow('Agency', agencyName)}
      ${detailRow('Practitioners', practitionerCount)}
    </table>
    ${message ? `<p style="margin:0; white-space:pre-wrap;">${message}</p>` : ''}
  `;
  const html = emailShell({
    preheader: `Demo request from ${agencyName || fullName}`,
    eyebrow: 'Demo Request',
    heading: 'Let us show you the workflow',
    bodyHtml,
    footnote: '',
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to,
    replyTo: workEmail,
    subject: `Demo request — ${agencyName || fullName}`,
    html,
  });
};

// Sent to a parent (not an app user — no account, no context on this app)
// after a practitioner logs a telepractice session, asking them to review
// the session details and sign remotely. Every value here must already be
// fully humanized by the caller (full labels, spelled-out duration, 12-hour
// time, long-form date) — this function does no further translation, since
// a parent must never see an internal code or abbreviation (e.g. a raw
// service-type code, "SLP", a location code).
const sendParentSignatureRequestEmail = async (toEmail, {
  childFirstName, practitionerFirstName, serviceLabel, sessionDate, startTime, endTime,
  durationLabel, sessionTypeLabel, locationLabel, practitionerName, practitionerDisciplineLabel, signUrl,
  isResend = false,
}) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping telepractice signature request email send.');
    return;
  }

  const detailRow = (label, value) => (value ? `
    <tr>
      <td style="padding:9px 0; font-family:${SANS}; font-size:12.5px; color:${COLORS.slate}; width:110px; vertical-align:top;">${label}</td>
      <td style="padding:9px 0; font-family:${SANS}; font-size:13.5px; font-weight:600; color:${COLORS.navy};">${value}</td>
    </tr>` : '');
  const detailsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px; border-top:1px solid ${COLORS.line}; border-bottom:1px solid ${COLORS.line};">
      ${detailRow('Child', childFirstName)}
      ${detailRow('Service', serviceLabel)}
      ${detailRow('Date', sessionDate)}
      ${detailRow('Time', startTime && endTime ? `${startTime} &ndash; ${endTime}` : '')}
      ${detailRow('Duration', durationLabel)}
      ${detailRow('Session Type', sessionTypeLabel)}
      ${detailRow('Location', locationLabel)}
      ${detailRow('Provided By', practitionerDisciplineLabel ? `${practitionerName}, ${practitionerDisciplineLabel}` : practitionerName)}
    </table>
  `;

  const bodyHtml = `
    <p style="margin:0 0 4px;">Because this was a telehealth (video) visit, ${practitionerFirstName} wasn't able to collect your signature in person. We just need a quick digital signature to confirm the session details below.</p>
    ${stepGuide([
      { icon: STEP_ICON_REVIEW_URL, alt: 'Review icon', label: 'Review the details', subtext: 'Session date, time, and service' },
      { icon: STEP_ICON_SIGN_URL, alt: 'Sign icon', label: 'Add your signature', subtext: 'With your finger or mouse — takes seconds' },
      { icon: STEP_ICON_DONE_URL, alt: 'Done icon', label: "You're all set", subtext: 'No account or app needed' },
    ])}
    ${detailsTable}
    ${ctaButton(signUrl, 'Review & Sign Now')}
    ${linkFallback(signUrl)}
    <p style="margin:20px 0 0; font-size:12.5px; color:${COLORS.slate};">Questions about this session? Contact ${practitionerFirstName || 'your practitioner'} or your care team directly.</p>
  `;
  const html = emailShell({
    preheader: `A quick signature is needed for ${childFirstName}'s session on ${sessionDate}.`,
    eyebrow: isResend ? 'Signature Reminder' : 'Signature Needed',
    heading: `Please review and sign ${childFirstName}'s session`,
    bodyHtml,
    footnote: 'This link is private to you and expires in 7 days. It takes less than a minute — no login, password, or app download required.',
  });

  // A resend's subject is deliberately distinct from the original send's
  // (not just re-sent verbatim) — Gmail auto-threads new mail by matching
  // subject + participants even without In-Reply-To headers, and once
  // threaded it collapses near-identical content between messages behind a
  // "•••" toggle. An identical subject on every resend made the parent's
  // actual session details disappear behind that toggle.
  const subject = isResend
    ? `Reminder: Please review and sign ${childFirstName}'s recent session`
    : `Please review and sign ${childFirstName}'s recent session`;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject,
    html,
  });
};

module.exports = {
  sendPasswordResetEmail,
  sendInviteEmail,
  sendSignupConfirmationEmail,
  sendSessionScheduledEmail,
  sendContactRequestEmail,
  sendParentSignatureRequestEmail,
};
