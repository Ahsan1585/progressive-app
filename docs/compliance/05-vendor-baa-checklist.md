# Vendor and Subprocessor BAA Checklist

> **DRAFT FOR ATTORNEY REVIEW. Not legal advice.** Does not state that Izaya is compliant or certified.
> **Status:** Draft v0.1, 2026-10-21, not adopted. **Last reviewed:** [DATE] by [REVIEWER]. Built from `backend/package.json`, `frontend/package.json`, `backend/src` environment variable use, and `frontend/vercel.json`.

| Vendor | Used for (evidence in code) | Data class touched | Agreement status | Action required |
|---|---|---|---|---|
| Google Cloud: Cloud SQL (Postgres) | All tenant and platform databases (`config/db.js`, `INSTANCE_UNIX_SOCKET`) | Child PII, early intervention records, audit logs | BAA signed (owner statement) | File copy of signed BAA; record covered services, region, backup/PITR settings [OWNER TO CONFIRM] |
| Google Cloud: Cloud Run | Hosts API (`Dockerfile`, `PORT`) | Child PII in memory and logs | Same Google BAA [OWNER TO CONFIRM service is covered] | Confirm covered-services list; ensure application logs contain no child PII |
| Google Cloud: Cloud Storage | SEVF/invoice PDFs and compliance docs (`config/storage.js`) | Child PII | Same Google BAA [OWNER TO CONFIRM] | Confirm covered; confirm bucket access is private and URLs signed 1 hour |
| Google Cloud: Secret Manager / Cloud Scheduler (cron with `CRON_SECRET`) | Secrets and scheduled jobs | Credentials; no child data | Same Google BAA | Confirm |
| Vercel | Hosts static web app and mobile PWA (`frontend/vercel.json`); serves no server-side child data | Static code only; page requests include IP | No BAA known [OWNER TO CONFIRM plan]. Child data goes browser to API directly | Confirm no API proxying/rewrites to child data and no analytics/log drains with PII; record decision. Do not enable Vercel features that capture request bodies |
| Resend | Transactional email (`utils/emailClient.js`, `RESEND_API_KEY`, webhook via svix) | Intended: none (links and non-child text). Recipient emails (parents, agency contacts, staff) are personal data | Cannot sign a BAA. No child PHI/PII by design | Record the vendor decision in writing. Verify after the 2026-10-21 fixes: (a) no SEVF/invoice attachments, (b) scheduled-session emails with child first name and `.ics` are removed or de-identified, (c) signature request email contains only a link, (d) no child data in subject lines or preheaders. Add a test that fails if child fields reach `resend.emails.send`. Parent email addresses alone may identify a child's family; counsel to advise |
| Stripe | Subscription billing for agencies and independents (`config/stripe.js`, webhook secret) | Billing contacts, company metadata; no child data (metadata contains invoice IDs only) | Stripe terms; BAA not required if no PHI [ATTORNEY TO CONFIRM] | Verify no child names in descriptions or metadata; keep it that way |
| Composio (Instagram posting) | Marketing automation (`config/composio.js`, `instagramClient.js`, `COMPOSIO_API_KEY`) | Marketing content only | None | Confirm no child data can reach this path; disable for tenants if any doubt |
| Instagram / Meta (via Composio) | Marketing posts | Marketing content | None | As above |
| Supabase (`@supabase/supabase-js` in backend dependencies) | No usage found in `backend/src` or `index.js` | None found | None | Remove unused dependency, or document if used elsewhere [OWNER TO CONFIRM] |
| Puppeteer / headless Chromium | Runs in the Cloud Run container to render PDFs; not a vendor service | Child PII in memory | n/a (open-source library in the Google environment) | Keep patched; run sandbox settings review (launched with `--no-sandbox`) |
| Google Fonts / third-party CDNs | Fonts are bundled (`@fontsource`); marketing code notes external fonts fail under CSP | None | n/a | Confirm no third-party scripts on authenticated pages |
| NJ DOH / EIMS (PCG) | Records validated against EIMS (agency-provided data) | Early intervention records | Governed by NJEIS agreements, not Izaya's | Obtain EIP Letter of Agreement and any third-party software rules [OWNER TO CONFIRM] |
| Browser/OS push or calendar providers (recipients of `.ics`) | Parent calendar invite | Child first name, date/time (pre-fix) | None | Remove child details from `.ics` or drop attachment |

## Rules

1. A vendor handling child PII needs a BAA (HIPAA) and a contract with use limits and redisclosure limits equivalent to 34 CFR 99.33.
2. A vendor that cannot sign must be technically prevented from receiving child data, with a test.
3. Review this table annually, on adding any dependency that makes network calls, and after any vendor incident.
4. Maintain a customer-facing subprocessor list (Google Cloud, Vercel, Resend, Stripe) matching this table (`legal-drafts/02` C.3).

## Open vendor questions

1. Which Google Cloud services does the signed BAA cover? [OWNER TO CONFIRM]
2. Does Vercel Pro/Enterprise terms need a BAA for any logs that could include identifiers? [ATTORNEY TO CONFIRM]
3. Is Resend's webhook data (`resendWebhookController.js`) storing recipient addresses and event metadata only? [OWNER TO CONFIRM]
