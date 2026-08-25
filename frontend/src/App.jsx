import { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, clearSessionAndNotify } from './api/axiosInstance';
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
import TelepracticeSign from './pages/TelepracticeSign';
import AdminDashboard from './pages/AdminDashboard';
import PlatformAdmin from './pages/PlatformAdmin';
import { DialogHost } from './components/DialogHost';

// Office-side accounts. Phase 2 collapsed the old fine-grained staff role strings
// ('staff_director', 'billing', 'account_specialist') into the single catch-all 'staff';
// what each of them can actually DO is now decided by their role's permissions, not this list.
const ADMIN_ROLES = ['ceo', 'staff'];

// Set only by the desktop (Electron) build's env file (frontend/.env.desktop) —
// absent in the web build, so every check below defaults to today's behavior.
const IS_DESKTOP = import.meta.env.VITE_BUILD_TARGET === 'desktop';

// HIPAA automatic logoff: clear the session and return to login after inactivity.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

// Both idle-timeout here and the axios 401 interceptor (api/axiosInstance.js)
// need to end up at the same place: session cleared, user on /login.
// Previously each did its own `window.location.assign(`${BASE_URL}login`)`
// hard redirect — besides duplicating the logic, that hardcoded path breaks
// under the desktop build's relative ("./") base (BASE_URL becomes "./", so
// the old string would resolve to nonsense). SESSION_EXPIRED_EVENT and
// clearSessionAndNotify live in axiosInstance.js (session state's natural
// owner) and are shared here so both triggers funnel through one
// base-path-agnostic router navigation instead of two hardcoded redirects.
function SessionExpiredListener() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => navigate('/login');
    window.addEventListener(SESSION_EXPIRED_EVENT, handler);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handler);
  }, [navigate]);
  return null;
}

function IdleLogout() {
  useEffect(() => {
    let timer;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(clearSessionAndNotify, IDLE_TIMEOUT_MS);
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

// Desktop (Electron) build ships only the CEO/staff admin-dashboard flow —
// no marketing site, no practitioner /dashboard (practitioners use the
// separate mobile/ PWA), no /platform-admin. Trimming these out of the
// route table means their page modules aren't reachable, keeping the
// desktop installer's bundle smaller.
const DESKTOP_ROUTES = (
  <>
    <Route path="/login" element={<Login />} />
    <Route path="/change-password" element={<ChangePassword />} />
    <Route
      path="/admin-dashboard"
      element={<ProtectedRoute element={<AdminDashboard />} allowedRoles={ADMIN_ROLES} />}
    />
    <Route path="*" element={<Navigate to="/login" replace />} />
  </>
);

const WEB_ROUTES = (
  <>
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
    {/* Public, unauthenticated — a parent reaches this from the telepractice signature-request email, never from within the app. */}
    <Route path="/:companySlug/sign/:token" element={<TelepracticeSign />} />
    <Route
      path="/dashboard"
      element={<ProtectedRoute element={<Dashboard />} allowedRoles={['practitioner']} />}
    />
    <Route
      path="/admin-dashboard"
      element={<ProtectedRoute element={<AdminDashboard />} allowedRoles={ADMIN_ROLES} />}
    />
    {/* Not tenant-scoped — its own shared-secret gate (KeyPrompt), no ProtectedRoute/JWT involved. See platformAdminRoutes.js. */}
    <Route path="/platform-admin" element={<PlatformAdmin />} />
  </>
);

function App() {
  // Desktop build uses HashRouter, not BrowserRouter — verified empirically
  // (blank-page bug caught during Phase 6 packaging) that BrowserRouter's
  // pushState under file:// rewrites the address bar to an absolute path
  // like file:///C:/login, which is invalid relative to the app's actual
  // directory and breaks routing/asset resolution entirely. HashRouter
  // keeps all routing in the URL fragment (file:///.../index.html#/login),
  // which never touches the real file:// path at all. The web build is
  // unaffected — it keeps BrowserRouter with the basename it always had.
  if (IS_DESKTOP) {
    return (
      <HashRouter>
        <IdleLogout />
        <SessionExpiredListener />
        <ScrollToTop />
        <DialogHost />
        <Routes>
          {DESKTOP_ROUTES}
        </Routes>
      </HashRouter>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <IdleLogout />
      <SessionExpiredListener />
      <ScrollToTop />
      <DialogHost />
      <Routes>
        {WEB_ROUTES}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
