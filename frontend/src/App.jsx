import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Home from './pages/marketing/Home';
import HowItWorks from './pages/marketing/HowItWorks';
import PractitionerApp from './pages/marketing/PractitionerApp';
import Contact from './pages/marketing/Contact';
import Dashboard from './pages/dashboard';
import ChangePassword from './components/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SignupWizard from './pages/SignupWizard';
import SignupConfirm from './pages/SignupConfirm';
import ActivateAccount from './pages/ActivateAccount';
import AdminDashboard from './pages/AdminDashboard';
import { DialogHost } from './components/DialogHost';

// Office-side accounts. Phase 2 collapsed the old fine-grained staff role strings
// ('staff_director', 'billing', 'account_specialist') into the single catch-all 'staff';
// what each of them can actually DO is now decided by their role's permissions, not this list.
const ADMIN_ROLES = ['ceo', 'staff'];

// HIPAA automatic logoff: clear the session and return to login after inactivity.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function IdleLogout() {
  useEffect(() => {
    let timer;
    const logout = () => {
      if (localStorage.getItem('token')) {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        window.location.assign(`${import.meta.env.BASE_URL}login`); // '/eis/login' — dumping an idled-out user on the marketing homepage instead of the sign-in form would be a bad landing
      }
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(logout, IDLE_TIMEOUT_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, reset));
    };
  }, []);
  return null;
}

// React Router doesn't reset scroll position on navigation the way a
// traditional multi-page site does — without this, clicking an in-app link
// from partway down a page lands the new page scrolled to that same
// mid-page offset instead of the top.
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const ProtectedRoute = ({ element, allowedRoles }) => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (!token) return <Navigate to="/login" replace />;

  if (allowedRoles && !allowedRoles.includes(role)) {
    return ADMIN_ROLES.includes(role)
      ? <Navigate to="/admin-dashboard" replace />
      : <Navigate to="/login" replace />;
  }

  return element;
};

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <IdleLogout />
      <ScrollToTop />
      <DialogHost />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/download" element={<PractitionerApp />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/signup" element={<SignupWizard />} />
        <Route path="/signup/confirm/:token" element={<SignupConfirm />} />
        <Route path="/:companySlug/activate/:token" element={<ActivateAccount />} />
        <Route
          path="/dashboard"
          element={<ProtectedRoute element={<Dashboard />} allowedRoles={['practitioner']} />}
        />
        <Route
          path="/admin-dashboard"
          element={<ProtectedRoute element={<AdminDashboard />} allowedRoles={ADMIN_ROLES} />}
        />
      </Routes>
    </Router>
  );
}

export default App;
