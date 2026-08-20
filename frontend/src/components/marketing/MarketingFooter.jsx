import { Link } from 'react-router-dom';
import { MarketingBrand } from './IzayaMark';

export function MarketingFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-inner">
        <div>
          <MarketingBrand className="mk-footer-brand" />
          <p className="mk-footer-blurb">
            Izaya EISimplified™ automates the entire billing process from session log to SEVF and invoice — so your team can focus on what truly matters: children.
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <ul>
            <li><Link to="/how-it-works">How it works</Link></li>
            <li><Link to="/download">Practitioner app</Link></li>
            <li><Link to="/contact">Schedule a demo</Link></li>
          </ul>
        </div>
        <div>
          <h3>Contact</h3>
          <ul>
            <li><a href="mailto:support@izayaedge.com">support@izayaedge.com</a></li>
            <li><a href="tel:+14057402647">(405) 740-2647</a></li>
            <li>Old Bridge, NJ 08857</li>
          </ul>
        </div>
      </div>
      <p className="mk-footer-bottom">
        © {new Date().getFullYear()} Izaya Consulting. Izaya EISimplified™ is a trademark of Izaya Consulting.
      </p>
    </footer>
  );
}
