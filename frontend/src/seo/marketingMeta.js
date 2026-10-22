// Per-route <title>/<meta description>/Open Graph content for the public
// marketing pages, served under izayaedge.com/eis/*. Consumed by two
// places that must stay in sync with the route table in App.jsx's
// WEB_ROUTES: scripts/prerender.mjs (build-time static HTML generation)
// and, for the client-rendered navigation case (soft nav between marketing
// pages without a full page load), src/components/marketing/PageMeta.jsx.
//
// Before this file existed, every /eis* page shipped the same static
// "Izaya EIS" <title> baked into index.html with no description at all —
// the direct cause of /eis being invisible in Google search while the
// unrelated izayaedge.com root domain (a separate Next.js app with real
// per-page metadata) ranked instead.
const SITE_URL = 'https://izayaedge.com';

export const MARKETING_META = {
  // Homepage: software + FAQ structured data, so search can classify the product
  // and read the FAQ answers. Only claims the product backs.
  '/': {
    "title": "Early Intervention Billing Software for NJ Agencies | Izaya EIS",
    "description": "Automated early intervention billing for NJ agencies. Errors caught before they reach the state, clean sessions generate SEVFs and invoices, and EIMS matching is built in. Start a 30-day free pilot.",
    "path": "/eis",
    "jsonLd": {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SoftwareApplication",
          "name": "Izaya EIS",
          "applicationCategory": "BusinessApplication",
          "operatingSystem": "Web, iOS, Android",
          "url": "https://izayaedge.com/eis",
          "description": "Early intervention software for New Jersey agencies: practitioners log session notes on a phone, every note is checked against the EIMS export before billing, and clean sessions generate SEVFs and invoices.",
          "audience": {
            "@type": "Audience",
            "audienceType": "New Jersey early intervention agencies"
          },
          "areaServed": {
            "@type": "State",
            "name": "New Jersey"
          },
          "featureList": [
            "EIMS reconciliation",
            "SEVF and invoice generation",
            "Practitioner session notes",
            "Consent and records management"
          ],
          "publisher": {
            "@type": "Organization",
            "name": "Izaya Consulting LLC",
            "url": "https://izayaedge.com"
          }
        },
        {
          "@type": "FAQPage",
          "mainEntity": [
            {
              "@type": "Question",
              "name": "How do I reconcile service logs with EIMS?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Upload your monthly EIMS service log export. Izaya EIS compares 11 fields on every session note (child ID, child name, practitioner, service date, start and end time, service, location, group size, service status and IFSP event ID) and holds any note that doesn't match until it's fixed or approved."
              }
            },
            {
              "@type": "Question",
              "name": "What is an SEVF, and can it be generated automatically?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "The SEVF is the NJEIS form an agency submits for a practitioner's sessions. When every session in a practitioner's batch is clean, Izaya EIS generates the SEVF and the invoice automatically. Batches with flagged notes wait for a person to review them."
              }
            },
            {
              "@type": "Question",
              "name": "How do we stop billing errors from reaching the state?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Every session note is compared with EIMS before billing. Mismatches, sessions missing from EIMS and duplicate entries are flagged and held, so they're corrected before the SEVF goes out instead of being found in a later review."
              }
            },
            {
              "@type": "Question",
              "name": "Is this early intervention software only for billing?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "No. You also manage practitioners and their caseloads, every child and their care team, child records, consents and records releases, office staff roles and permissions, and an audit trail, all in the same platform."
              }
            },
            {
              "@type": "Question",
              "name": "How long does setup take for an early intervention agency?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "We set up your agency and add your practitioners and children for you during the pilot. Your team walks through it with us on a call."
              }
            },
            {
              "@type": "Question",
              "name": "Do practitioners need training to log sessions?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Very little. They open the app from a link on any phone. A session note is a short form with the child, service, times, location and the parent's signature."
              }
            },
            {
              "@type": "Question",
              "name": "How is child and family information protected?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Each practitioner only sees their own caseload, and access ends as soon as someone is deactivated. Records are shared only with recorded parental consent, sensitive fields are encrypted, and there is an audit trail of who viewed and changed records."
              }
            },
            {
              "@type": "Question",
              "name": "What does it cost?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "Pricing depends on your agency's size. We share it on the demo, and the 30-day pilot is free."
              }
            },
            {
              "@type": "Question",
              "name": "What happens after the pilot?",
              "acceptedAnswer": {
                "@type": "Answer",
                "text": "You decide. Keep going on a paid plan, or stop. There is nothing to cancel."
              }
            }
          ]
        }
      ]
    }
  },
  '/download': {
    title: 'Download the Practitioner App | Izaya EIS',
    description:
      'Get the Izaya EIS practitioner app: log sessions in the field, capture signatures on the device, save drafts, and fix returned logs in seconds.',
    path: '/eis/download',
  },
  '/book': {
    "title": "Book a Demo | Izaya EIS",
    "description": "Book a 30-minute demo of Izaya EIS, early intervention billing software for New Jersey agencies. Pick a time and get a calendar invite.",
    "path": "/eis/book"
  },
  '/about': {
    title: 'About Us | Izaya EIS',
    description:
      'Izaya EIS is a Central New Jersey startup building billing and compliance software for early intervention agencies and practitioners. Launched summer 2025.',
    path: '/eis/about',
    // Organization structured data (JSON-LD) — read by Google and AI
    // crawlers to answer "who/what/when" questions about the company
    // directly (founding date, location, description) rather than
    // inferring them from prose. Only this route defines jsonLd; every
    // other entry's `jsonLd` is simply undefined and injectHead skips it.
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Izaya Consulting LLC',
      alternateName: 'Izaya EIS',
      url: 'https://izayaedge.com',
      logo: 'https://izayaedge.com/eis/email-logo.png',
      description:
        "Izaya EIS is a startup based in Central New Jersey that builds billing and compliance automation software for early intervention agencies and practitioners. The company launched its digital platform, Izaya EIS, in summer 2025.",
      foundingDate: '2025',
      foundingLocation: {
        '@type': 'Place',
        name: 'Central New Jersey, United States',
      },
      areaServed: {
        '@type': 'State',
        name: 'New Jersey',
      },
      knowsAbout: [
        'Early intervention billing',
        'NJEIS compliance',
        'Service Verification Forms (SEVF)',
        'Practitioner session logging',
      ],
    },
  },
};

export function absoluteUrl(routePath) {
  const entry = MARKETING_META[routePath];
  return `${SITE_URL}${entry ? entry.path : '/eis'}`;
}
