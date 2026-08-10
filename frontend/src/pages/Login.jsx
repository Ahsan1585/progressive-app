import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { PasswordInput } from '@/components/ui/password-input';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';

const PIN_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>;

// Phase 2: every non-practitioner office account is 'ceo' or the catch-all 'staff'.
const ADMIN_ROLES = ['ceo', 'staff'];

const Login = () => {
  // Remembered from a previous successful login on this device — most
  // returning users never have to type it again after their first visit.
  const [companySlug, setCompanySlug] = useState(() => {
    try { return localStorage.getItem('companySlug') || ''; } catch { return ''; }
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const resetSuccess = location.state?.resetSuccess;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const slug = companySlug.trim().toLowerCase();
      const response = await api.post('/api/auth/login', { slug, email, password });

      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('role', response.data.practitioner.role);
        localStorage.setItem('companySlug', slug);

        const role = response.data.practitioner.role;

        if (response.data.requirePasswordChange) {
          navigate('/change-password');
        } else if (ADMIN_ROLES.includes(role)) {
          navigate('/admin-dashboard');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MarketingLayout>
      <div className="mk-login-wrap">
        <div className="mk-login-card">
          <h1>Welcome back</h1>
          <div className="mk-login-tag">{PIN_ICON}NJEIS Compliant</div>

          {resetSuccess && (
            <div className="mk-form-banner mk-success">Your password has been reset. You can now sign in.</div>
          )}
          {error && (
            <div className="mk-form-banner mk-error">{error}</div>
          )}

          <form onSubmit={handleLogin} noValidate>
            <div className="mk-field">
              <label htmlFor="login-company">Company Code</label>
              <input
                id="login-company"
                type="text"
                placeholder="your-company"
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </div>

            <div className="mk-field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="mk-field">
              <div className="mk-field-row">
                <label htmlFor="login-password" style={{ marginBottom: 0 }}>Password</label>
                <Link to="/forgot-password" className="mk-forgot">Forgot password?</Link>
              </div>
              <PasswordInput
                id="login-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-auto border-1.5 focus-visible:ring-0 rounded-[10px] p-[11px_13px] bg-[#FCFDFD]"
                required
              />
            </div>

            <button type="submit" className="mk-btn-primary" disabled={isSubmitting} style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
              {isSubmitting ? 'Signing in…' : 'Sign In'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 5l7 7-7 7" /></svg>
            </button>
          </form>

          <div className="mk-login-card-foot">
            New agency? <Link to="/signup">Sign up your company</Link> and start a free 15-day trial.<br />
            Already have an account but no Company Code? Ask your agency admin.<br />
            Trouble signing in? <a href="mailto:support@izayaedge.com">support@izayaedge.com</a>
          </div>
        </div>
      </div>
    </MarketingLayout>
  );
};

export default Login;
