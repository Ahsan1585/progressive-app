import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/dashboard';
import ChangePassword from './components/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SignupWizard from './pages/SignupWizard';
import SignupConfirm from './pages/SignupConfirm';
import ActivateAccount from './pages/ActivateAccount';
import AdminDashboard from './pages/AdminDashboard';
import { DialogHost } from './components/DialogHost';

const ADMIN_ROLES = ['staff_director', 'billing', 'ceo', 'account_specialist'];

// HIPAA automatic logoff: clear the session and return to login after inactivity.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function IdleLogout() {
  useEffect(() => {
    let timer;
    const logout = () => {
      if (localStorage.getItem('token')) {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        window.location.assign(import.meta.env.BASE_URL); // '/eis/' — this app is served under that base path, not the domain root
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

const ProtectedRoute = ({ element, allowedRoles }) => {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');

  if (!token) return <Navigate to="/" replace />;

  if (allowedRoles && !allowedRoles.includes(role)) {
    return ADMIN_ROLES.includes(role)
      ? <Navigate to="/admin-dashboard" replace />
      : <Navigate to="/" replace />;
  }

  return element;
};

function App() {
  return (
    <Router basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <IdleLogout />
      <DialogHost />
      <Routes>
        <Route path="/" element={<Login />} />
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
