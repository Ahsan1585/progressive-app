import { NavLink, Link } from 'react-router-dom';
import { MarketingBrand } from './IzayaMark';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/download', label: 'Practitioner app' },
  { to: '/contact', label: 'Contact' },
];

export function MarketingNav() {
  return (
    <nav className="mk-nav">
      <Link to="/" className="mk-nav-brand" aria-label="Izaya EI Simplified home">
        <MarketingBrand />
      </Link>
      <div className="mk-nav-right">
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `mk-nav-link${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
        <Link to="/login" className="mk-nav-login">Log In</Link>
        <Link to="/contact" className="mk-nav-cta">Schedule a demo</Link>
      </div>
    </nav>
  );
}
