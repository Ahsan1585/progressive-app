import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/dashboard';
import ChangePassword from './components/ChangePassword';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';

const ADMIN_ROLES = ['staff_director', 'billing', 'ceo'];

// HIPAA automatic logoff: clear the session and return to login after inactivity.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function IdleLogout() {
  useEffect(() => {
    let timer;
    const logout = () => {
      if (localStorage.getItem('token')) {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        window.location.assign('/');
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
    <Router>
      <IdleLogout />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/admin-login" element={<AdminLogin />} />
        <Route path="/change-password" element={<ChangePassword />} />
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
