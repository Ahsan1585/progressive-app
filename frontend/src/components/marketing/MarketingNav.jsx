import { NavLink, Link } from 'react-router-dom';
import { MarketingBrand } from './IzayaMark';
import { IZAYA_ONE_URL } from '../AuthLayout';

const NAV_LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
  { to: '/download', label: 'Practitioner app' },
  { to: '/contact', label: 'Contact' },
];

// On /practitioners (Izaya One), "How it works" scrolls to that page's own
// workflow section instead of leaving for the shared tenant-company page,
// and "Contact" is dropped since Izaya One is self-serve with no sales
// contact flow. The rest (Home/About/Practitioner app) still point at the
// shared pages — there's no separate Izaya One version of those.
const NAV_LINKS_ONE = [
  { to: '/', label: 'Home', end: true },
  { to: '/practitioners#how-it-works', label: 'How it works' },
  { to: '/about', label: 'About' },
  { to: '/download', label: 'Practitioner app' },
];

export function MarketingNav({ isOne = false }) {
  const links = isOne ? NAV_LINKS_ONE : NAV_LINKS;
  return (
    <nav className="mk-nav">
      <Link to="/" className="mk-nav-brand" aria-label="Izaya EISimplified home">
        <MarketingBrand isOne={isOne} />
      </Link>
      <div className="mk-nav-right">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => `mk-nav-link${isActive ? ' active' : ''}`}
          >
            {link.label}
          </NavLink>
        ))}
        {isOne ? (
          <>
            <a href={IZAYA_ONE_URL} target="_blank" rel="noopener noreferrer" className="mk-nav-login">Log In</a>
            <Link to="/signup/independent" className="mk-nav-cta">Start free trial</Link>
          </>
        ) : (
          <>
            <Link to="/login" className="mk-nav-login">Log In</Link>
            <Link to="/contact" className="mk-nav-cta">Schedule a demo</Link>
          </>
        )}
      </div>
    </nav>
  );
}
