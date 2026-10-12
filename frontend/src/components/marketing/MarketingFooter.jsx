import { Link } from 'react-router-dom';
import { MarketingBrand } from './IzayaMark';

// Mirrors MarketingNav's isOne handling: on Izaya One pages, "Practitioner
// app" and "Schedule a demo" previously still pointed at the shared
// tenant-company /download and /contact pages — the same "leaves Izaya One
// for the general site" bug fixed in the header nav, just in the footer.
export function MarketingFooter({ isOne = false }) {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div>
          <MarketingBrand className="mk-footer-brand" isOne={isOne} />
          <p className="mk-footer-blurb">
            {isOne
              ? 'Izaya One is a simple app for independent early intervention practitioners — log sessions, generate your own SEVFs and invoices, and get parent signatures, all from your phone.'
              : 'Izaya EISimplified™ automates the entire billing process from session log to SEVF and invoice — so your team can focus on what truly matters: children.'}
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <ul>
            <li><Link to={isOne ? '/practitioners#how-it-works' : '/how-it-works'}>How it works</Link></li>
            <li><Link to="/about">About</Link></li>
            <li><Link to={isOne ? '/practitioners#download' : '/download'}>Practitioner app</Link></li>
            {isOne
              ? <li><Link to="/signup/independent">Start free trial</Link></li>
              : <li><Link to="/contact">Schedule a demo</Link></li>}
          </ul>
        </div>
        <div>
          <h3>Contact</h3>
          <ul>
            <li><a href="mailto:support@izayaedge.com">support@izayaedge.com</a></li>
          </ul>
        </div>
      </div>
      <p className="mk-footer-bottom">
        © {new Date().getFullYear()} Izaya Consulting LLC. {isOne ? 'Izaya One™' : 'Izaya EISimplified™'} is a trademark of Izaya Consulting LLC.
      </p>
    </footer>
  );
}
