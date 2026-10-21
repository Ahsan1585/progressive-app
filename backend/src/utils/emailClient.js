const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Same base path convention as every activation/reset link built elsewhere
// (see authController.js) — the app is served under /eis, not domain root.
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173/eis';
// A stable, unhashed path in frontend/public/ (not the bundled src/assets
// copy, which gets a new hashed filename every deploy) — email clients
// cache/reference image URLs long-term, so this one needs to never move.
const LOGO_URL = `${FRONTEND_URL}/email-logo.png`;
// Same stable-path convention, for the separately-branded "Izaya One"
// confirmation email (sendIndependentSignupConfirmationEmail) — the
// independent-practitioner-only app's own wordmark + coral "ONE" badge,
// not the shared mark every other transactional email uses.
const IZAYA_ONE_LOGO_URL = `${FRONTEND_URL}/email-logo-one.png`;
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
function emailShell({ preheader, eyebrow, heading, bodyHtml, footnote, logoUrl = LOGO_URL }) {
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
<img src="${logoUrl}" width="140" alt="Izaya" style="display:block; width:140px; max-width:100%; height:auto; margin-bottom:14px;" />
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

// Returns the Resend message id on success (or null when Resend isn't
// configured / the send failed) so callers can persist it against the
// practitioner and match it up later against the Resend delivery webhook.
const sendInviteEmail = async (toEmail, { activateUrl, companyName }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping account invite email send.');
    return null;
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
  const { data } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: `You've been invited to join ${companyName} on Izaya EIS`,
    html,
  });
  return data?.id || null;
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

// Independent-practitioner equivalent of sendSignupConfirmationEmail — a
// forked copy rather than a reused/parameterized one, since the wording is
// genuinely different (no "company," SEVF not invoicing, addressed to a
// person, not a business) and forcing one template to cover both would
// make future edits to either copy risk silently breaking the other.
const sendIndependentSignupConfirmationEmail = async (toEmail, { confirmUrl, practitionerName }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping independent-practitioner signup confirmation email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Thanks for signing up for Izaya One, <b style="color:${COLORS.navy};">${practitionerName}</b> — session logging, state matching, and SEVF generation, on your own account. Confirm your email to activate your account and start your 30-day free trial. No card required.</p>
    ${ctaButton(confirmUrl, 'Confirm & Start My Trial')}
    ${linkFallback(confirmUrl)}
  `;
  const html = emailShell({
    preheader: `One click and your 30-day trial begins — Izaya One for independent practitioners.`,
    eyebrow: 'Welcome to Izaya',
    heading: "You're one step from your trial",
    bodyHtml,
    footnote: "This link expires in 24 hours. If you didn't request this, you can safely ignore this email.",
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Confirm your Izaya EIS signup',
    html,
  });
};

// Sent once provisioning actually succeeds (confirmIndependentSignup),
// never at the request step above — this is the "your account is ready"
// moment, distinct from "confirm your email." Carries the login code
// (company_settings/companies.slug) front and center since it's the one
// piece of account info a practitioner has no other record of; email and
// password they chose themselves and are expected to remember, but the
// login code is either self-picked in a rush or auto-suggested, so it's
// the one detail worth putting somewhere they can always find again.
const sendIndependentWelcomeEmail = async (toEmail, { practitionerName, loginCode, loginUrl }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping independent-practitioner welcome email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Welcome to Izaya One, <b style="color:${COLORS.navy};">${practitionerName}</b> — your account is set up and your 30-day free trial has started. No card required.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
      <tr>
        <td align="center" bgcolor="${COLORS.paper}" style="border:1px solid ${COLORS.line}; border-radius:10px; padding:16px;">
          <div style="font-family:${SANS}; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase; color:${COLORS.slate}; margin-bottom:6px;">Your login code</div>
          <div style="font-family:${SANS}; font-size:20px; font-weight:700; color:${COLORS.navy}; letter-spacing:0.5px;">${loginCode}</div>
        </td>
      </tr>
    </table>
    <p style="margin:0;">You'll need this login code along with your email and password every time you sign in — keep this email somewhere you can find it later.</p>
    ${ctaButton(loginUrl, 'Log In to Izaya One')}
  `;
  const html = emailShell({
    preheader: `Your account is ready — here's your login code.`,
    eyebrow: 'Welcome to Izaya',
    heading: "You're all set up",
    bodyHtml,
    footnote: "If you didn't create this account, please contact support@izayaedge.com.",
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Welcome to Izaya One — your login code inside',
    html,
  });
};

// Sent to the REFERRED practitioner at signup confirmation, when they
// signed up via a valid ?ref= link — a fork of
// sendIndependentSignupConfirmationEmail's wording convention (see the
// comment on that function), not a shared/parameterized template.
const sendReferralFirstMonthFreeEmail = async (toEmail, referrerName) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping referral first-month-free email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Your first month is free, thanks to <b style="color:${COLORS.navy};">${referrerName}</b>. No charge for your first billing cycle — your card is only charged starting your second month.</p>
  `;
  const html = emailShell({
    preheader: `Your first month on Izaya One is on us.`,
    eyebrow: 'Referral applied',
    heading: 'Your first month is free',
    bodyHtml,
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Your first month on Izaya One is free',
    html,
  });
};

// Sent to the REFERRER once their reward vests (the referred practitioner's
// 2nd real paid invoice) — see maybeRewardReferrer in subscriptionController.js.
const sendReferralRewardEarnedEmail = async (toEmail, referredName) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping referral reward-earned email send.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;"><b style="color:${COLORS.navy};">${referredName}</b>'s second payment just went through — you've earned a free month on Izaya One. It'll apply automatically to your next bill.</p>
  `;
  const html = emailShell({
    preheader: `You've earned a free month on Izaya One.`,
    eyebrow: 'Referral reward',
    heading: 'You earned a free month',
    bodyHtml,
    logoUrl: IZAYA_ONE_LOGO_URL,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'You earned a free month on Izaya One',
    html,
  });
};

// FERPA 34 CFR 99.33 / IDEA Part C 34 CFR 303.414 redisclosure notice —
// must accompany every disclosure of a child's record to a third party
// (the SEVF-to-agency email + its secure-link download page, and the full
// child-record export's cover page).
const REDISCLOSURE_NOTICE = 'This record contains confidential information protected by FERPA (34 CFR Part 99) and IDEA Part C (34 CFR 303.401-303.417). You may not redisclose it to any other party without prior written parental consent.';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Independent-practitioner-only (see docs on the independent-practitioner
// feature): tells the early intervention agency a practitioner billed that
// their SEVF (and matching invoice, when one exists) is ready to download.
//
// Resend cannot sign a BAA, so the SEVF/invoice PDFs (child names, IDs,
// service details) must NEVER pass through it — this email carries only
// the practitioner's name, a neutral message, the redisclosure notice, and
// an expiring, token-gated link (sharedDocumentController.js) that serves
// the PDFs from Izaya's own BAA-covered infrastructure. No attachments, no
// child data. Any legacy pdfBuffer/invoiceBuffer a caller still passes is
// deliberately ignored.
const sendSevfToAgencyEmail = async (agencyEmail, { practitionerName, downloadUrl, expiresAt, includesInvoice = false }) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping SEVF-to-agency email send.');
    return;
  }
  const name = escapeHtml(practitionerName);
  const docs = includesInvoice ? 'Service Verification Form (SEVF) and invoice' : 'Service Verification Form (SEVF)';
  const expiryText = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const bodyHtml = `
    <p style="margin:0;"><b style="color:${COLORS.navy};">${name}</b> has shared a ${docs} with your agency for services they provided.</p>
    <p style="margin:16px 0 0;">For privacy, the documents are not attached to this email. Use the secure link below to view and download them.</p>
    ${ctaButton(downloadUrl, 'View &amp; Download Securely')}
    ${linkFallback(downloadUrl)}
    <p style="margin:20px 0 0; padding:12px 14px; border:1px solid ${COLORS.line}; border-radius:8px; font-size:12.5px; line-height:1.55; color:${COLORS.navy};"><b>Confidentiality notice:</b> ${REDISCLOSURE_NOTICE}</p>
  `;
  const html = emailShell({
    preheader: `${practitionerName} shared documents with your agency via a secure link.`,
    eyebrow: 'Secure document share',
    heading: 'A practitioner has shared documents with you',
    bodyHtml,
    footnote: `This private link${expiryText ? ` expires on ${expiryText}` : ' expires in 14 days'}. This email was sent at ${name}'s request via Izaya EIS, the billing platform they use to log sessions.`,
  });
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: agencyEmail,
    subject: `Secure documents from ${practitionerName}`,
    html,
  });
};

// Reduces a free-text session location to a non-identifying category so a
// family's home address never passes through Resend. Idempotent (the
// category labels map back to themselves).
const generalizeSessionLocation = (location) => {
  const text = String(location || '').trim();
  if (!text) return '';
  const lower = text.toLowerCase();
  if (/\b(tele|telehealth|telepractice|virtual|video|zoom|remote|online)/.test(lower)) return 'Telehealth';
  if (/\b(center|centre|clinic|office|agency|facility)\b/.test(lower)) return 'Center';
  return 'Home or community visit';
};

// PHI-minimization: Resend cannot sign a BAA, so this email carries NO
// child identifier at all — no name (first or last) in the subject, body,
// or the .ics (see scheduleController.notifyParent), and no free-text notes.
// The location is reduced to a generic category (generalizeSessionLocation)
// since the free-text field is often a family's home address. Date, time
// and practitioner name are kept — on their own they don't identify the
// child, and without them the calendar invite would be pointless.
// childFirstName is accepted for backward compatibility and ignored.
const sendSessionScheduledEmail = async (toEmail, {
  practitionerName, sessionDate, startTime, endTime, location, icsContent, cancelled,
}) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping session schedule email send.');
    return;
  }
  location = generalizeSessionLocation(location);
  const subject = cancelled
    ? `Cancelled: Session on ${sessionDate}`
    : `Session scheduled for ${sessionDate}`;

  const detailRow = (label, value) => (value ? `
    <tr>
      <td style="padding:9px 0; font-family:${SANS}; font-size:12.5px; color:${COLORS.slate}; width:96px; vertical-align:top;">${label}</td>
      <td style="padding:9px 0; font-family:${SANS}; font-size:13.5px; font-weight:600; color:${COLORS.navy};">${value}</td>
    </tr>` : '');
  const detailsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0; border-top:1px solid ${COLORS.line}; border-bottom:1px solid ${COLORS.line};">
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
// the session details and sign remotely.
//
// Deliberately carries NO session content (no child's name, service, date/
// time, location, etc.) in the email itself — only the practitioner's first
// name (not PHI on its own) and the signing link. The signing page
// (TelepracticeSign.jsx, reached via signUrl) already fetches and displays
// every session detail itself once the parent opens the token-gated link,
// which lives on Izaya's own BAA-covered infrastructure. Putting that same
// content in the email body/subject would mean it also passes through and
// rests in Resend's systems and the parent's inbox — a transactional email
// vendor Izaya does not have a BAA with. See the BAA draft's subcontractor
// review flag for the underlying reasoning; this function is the fix.
const sendParentSignatureRequestEmail = async (toEmail, {
  practitionerFirstName, signUrl, isResend = false,
}) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping telepractice signature request email send.');
    return;
  }

  const bodyHtml = `
    <p style="margin:0 0 4px;">Because this was a telehealth (video) visit, ${practitionerFirstName || 'your practitioner'} wasn't able to collect your signature in person. Follow the link below to review the session and add a quick digital signature.</p>
    ${stepGuide([
      { icon: STEP_ICON_REVIEW_URL, alt: 'Review icon', label: 'Review the details', subtext: 'Opens on a private, secure page' },
      { icon: STEP_ICON_SIGN_URL, alt: 'Sign icon', label: 'Add your signature', subtext: 'With your finger or mouse — takes seconds' },
      { icon: STEP_ICON_DONE_URL, alt: 'Done icon', label: "You're all set", subtext: 'No account or app needed' },
    ])}
    ${ctaButton(signUrl, 'Review & Sign Now')}
    ${linkFallback(signUrl)}
    <p style="margin:20px 0 0; font-size:12.5px; color:${COLORS.slate};">Questions about this session? Contact ${practitionerFirstName || 'your practitioner'} or your care team directly.</p>
  `;
  const html = emailShell({
    preheader: 'A quick signature is needed for a recent telehealth session.',
    eyebrow: isResend ? 'Signature Reminder' : 'Signature Needed',
    heading: 'Please review and sign your recent session',
    bodyHtml,
    footnote: 'This link is private to you and expires in 7 days. It takes less than a minute — no login, password, or app download required.',
  });

  const subject = isResend
    ? 'Reminder: Please review and sign your recent session'
    : 'Please review and sign your recent session';

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject,
    html,
  });
};

// FERPA 34 CFR 99.30 / IDEA Part C 303.414 e-signed disclosure consent.
// Same PHI-minimization rule as sendParentSignatureRequestEmail: Resend
// can't sign a BAA, so this carries NO child name, NO recipient, NO record
// detail, only a neutral message, the organization's name and the link.
// The signing page shows what is being consented to only after the parent
// confirms the child's date of birth. The destructured params are the
// whole allowed surface: anything else a caller passes is ignored.
//
// Unlike the other senders here, this one THROWS on any failure (client not
// configured, or Resend v6's `{ data, error }` result carrying an error
// instead of rejecting), so the caller can report the failure to staff
// rather than telling them the parent was sent a link they never got.
const sendConsentRequestEmail = async (toEmail, { signUrl, organizationName, isResend = false }) => {
  if (!resend) {
    throw new Error('Email is not configured (RESEND_API_KEY not set); consent request email was not sent.');
  }

  const org = organizationName ? escapeHtml(organizationName) : 'Your early intervention provider';
  const bodyHtml = `
    <p style="margin:0 0 4px;">${org} is asking for your consent. Follow the secure link below to review the request and decide whether to sign it.</p>
    <p style="margin:12px 0 0;">For your privacy, the details are only shown after you confirm your child's date of birth on the next page.</p>
    ${ctaButton(signUrl, 'Review the Request')}
    ${linkFallback(signUrl)}
    <p style="margin:20px 0 0; font-size:12.5px; color:${COLORS.slate};">You are never required to sign. Questions? Contact ${org} directly.</p>
  `;
  const html = emailShell({
    preheader: 'A consent request is waiting for your review.',
    eyebrow: isResend ? 'Consent Reminder' : 'Consent Requested',
    heading: 'A consent request is waiting for you',
    bodyHtml,
    footnote: 'This link is private to you and expires in 7 days. No login, password, or app download required.',
  });

  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: isResend ? 'Reminder: A consent request is waiting for your review' : 'A consent request is waiting for your review',
    html,
  });
  if (result?.error) {
    throw new Error(`Consent request email failed: ${result.error.message || result.error.name || 'unknown error'}`);
  }
};

// MFA self-recovery link (authController.js requestMfaResetEmail). Goes only
// to the account's own address, link-only, neutral copy; the organization
// name is the only company detail and nothing about any child is included,
// whatever a caller passes. THROWS on any failure (not configured, or a
// Resend `{ error }` result) so the caller can answer 502 and drop the
// request row instead of telling the user a link is on its way.
const sendMfaResetEmail = async (toEmail, { resetUrl, organizationName } = {}) => {
  if (!resend) {
    throw new Error('Email is not configured (RESEND_API_KEY not set); MFA reset email was not sent.');
  }
  const org = organizationName ? escapeHtml(organizationName) : null;
  const bodyHtml = `
    <p style="margin:0;">Someone, hopefully you, asked to turn off two-step verification after losing access to the authenticator app.${org ? ` This is for your ${org} account on Izaya EIS.` : ''}</p>
    ${ctaButton(resetUrl, 'Turn Off Two-Step Verification')}
    ${linkFallback(resetUrl)}
  `;
  const html = emailShell({
    preheader: 'A request to turn off two-step verification on your Izaya EIS account.',
    eyebrow: 'Account Security',
    heading: 'Turn off two-step verification',
    bodyHtml,
    footnote: 'This link works once and expires in 30 minutes. If this was not you, ignore this email and change your password.',
  });
  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Turn off two-step verification on your Izaya EIS account',
    html,
  });
  if (result?.error) {
    throw new Error(`MFA reset email failed: ${result.error.message || result.error.name || 'unknown error'}`);
  }
};

// Notice after an email-verified MFA reset completed (confirmMfaReset).
// The caller treats this as best-effort.
const sendMfaResetCompletedEmail = async (toEmail) => {
  if (!resend) {
    console.warn('RESEND_API_KEY not set — skipping MFA reset completed notice.');
    return;
  }
  const bodyHtml = `
    <p style="margin:0;">Two-step verification was turned off on your Izaya EIS account. If this was not you, change your password now and contact your administrator.</p>
  `;
  const html = emailShell({
    preheader: 'Two-step verification was turned off on your Izaya EIS account.',
    eyebrow: 'Account Security',
    heading: 'Two-step verification was turned off',
    bodyHtml,
    footnote: 'You are receiving this because a security setting on your account changed.',
  });
  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
    to: toEmail,
    subject: 'Two-step verification was turned off on your Izaya EIS account',
    html,
  });
  if (result?.error) {
    throw new Error(`MFA reset notice failed: ${result.error.message || result.error.name || 'unknown error'}`);
  }
};

module.exports = {
  sendMfaResetEmail,
  sendMfaResetCompletedEmail,
  sendConsentRequestEmail,
  sendPasswordResetEmail,
  sendInviteEmail,
  sendSignupConfirmationEmail,
  sendIndependentSignupConfirmationEmail,
  sendIndependentWelcomeEmail,
  sendReferralFirstMonthFreeEmail,
  sendReferralRewardEarnedEmail,
  sendSevfToAgencyEmail,
  sendSessionScheduledEmail,
  sendContactRequestEmail,
  sendParentSignatureRequestEmail,
  generalizeSessionLocation,
  escapeHtml,
  REDISCLOSURE_NOTICE,
};
