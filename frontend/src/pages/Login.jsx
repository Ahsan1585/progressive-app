import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { PasswordInput } from '@/components/ui/password-input';
import { MarketingLayout } from '@/components/marketing/MarketingLayout';
import { MfaSetup } from '@/components/mfa/MfaSetup';
import { mfaVerify, mfaRecoveryEmail, errMsg } from '@/components/mfa/mfaApi';
import { getDeviceToken, setDeviceToken, clearDeviceToken, setCurrentUser } from '@/components/mfa/trustedDevice';

const PIN_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></svg>;
const CHECK_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>;

const TRIAL_PERKS = [
  'No manual SEVF or invoice prep',
  'Clean logs approve themselves',
  'Full setup in under a day',
];

// Phase 2: every non-practitioner office account is 'ceo' or the catch-all 'staff'.
const ADMIN_ROLES = ['ceo', 'staff'];

const Login = () => {
  // Remembered from a previous successful login on this device — most
  // returning users never have to type it again after their first visit.
  const [companySlug, setCompanySlug] = useState(() => {
    try { return localStorage.getItem('companySlug') || ''; } catch { return ''; }
  });
  const location = useLocation();
  // Pre-filled when arriving here right after ActivateAccount/ResetPassword
  // succeeded (see their handleGoToLogin/navigate calls) — the whole point
  // of landing here instead of a route the user has to re-navigate from
  // scratch is that company + email are already filled in for them.
  const [email, setEmail] = useState(location.state?.email || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const resetSuccess = location.state?.resetSuccess;

  // 'password' | 'code' (MFA challenge) | 'enroll' (forced MFA enrollment)
  const [step, setStep] = useState('password');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetSentTo, setResetSentTo] = useState('');

  const finishLogin = (data, slug) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('role', data.practitioner.role);
    localStorage.setItem('companySlug', slug);
    setCurrentUser(slug, email);
    // Wakes the MessagingProvider (App.jsx) to connect the chat socket.
    window.dispatchEvent(new Event('auth-changed'));

    const role = data.practitioner.role;

    if (data.requirePasswordChange) {
      // ChangePassword.jsx does its own role check afterward (same
      // ADMIN_ROLES/practitioner branch as here) once the new password
      // is actually set.
      navigate('/change-password');
    } else if (ADMIN_ROLES.includes(role)) {
      navigate('/admin-dashboard');
    } else if (role === 'independent_practitioner') {
      // The one legitimate reason this role logs into the web app at
      // all — everything else (session logging, SEVF generation) is
      // mobile-only for them too, same as a normal practitioner.
      navigate('/billing/independent');
    } else {
      // Practitioners now use the mobile app exclusively — the legacy
      // web /dashboard is no longer reachable via login.
      navigate('/practitioner-app-required');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const slug = companySlug.trim().toLowerCase();
      const deviceToken = getDeviceToken(slug, email);
      const response = await api.post('/api/auth/login', deviceToken ? { slug, email, password, deviceToken } : { slug, email, password });
      if (response.data.clearDeviceToken) clearDeviceToken(slug, email);

      if (response.data.mfaRequired) {
        setMfaToken(response.data.mfaToken);
        setMfaCode('');
        setUseRecovery(false);
        setRememberDevice(false);
        resetRecoveryState();
        setStep('code');
      } else if (response.data.mfaEnrollmentRequired) {
        setMfaToken(response.data.mfaToken);
        setStep('enroll');
      } else if (response.data.success) {
        finishLogin(response.data, slug);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const body = useRecovery ? { mfaToken, recoveryCode: mfaCode.trim() } : { mfaToken, code: mfaCode };
      if (rememberDevice) body.rememberDevice = true;
      const data = await mfaVerify(body);
      if (data.success) {
        const slug = companySlug.trim().toLowerCase();
        if (data.deviceToken) setDeviceToken(slug, email, data.deviceToken, data.deviceTokenExpiresAt, data.deviceId);
        finishLogin(data, slug);
      }
    } catch (err) {
      setError(errMsg(err, 'Verification failed. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetRecoveryState = () => {
    setConfirmingReset(false);
    setSendingReset(false);
    setResetError('');
    setResetSentTo('');
  };

  const sendResetLink = async () => {
    setResetError('');
    setSendingReset(true);
    try {
      const data = await mfaRecoveryEmail(mfaToken);
      setResetSentTo(data.maskedEmail || 'your email address');
      setConfirmingReset(false);
    } catch (err) {
      setResetError(errMsg(err, 'We could not send the email. Please try again or contact your administrator.'));
    } finally {
      setSendingReset(false);
    }
  };

  const backToPassword = () => {
    resetRecoveryState();
    setStep('password');
    setMfaToken('');
    setMfaCode('');
    setError('');
  };

  return (
    <MarketingLayout>
      <div className="mk-login-wrap">
        <div className="mk-login-split">
          <div className="mk-login-card">
          <h1>Welcome back</h1>
          <div className="mk-login-tag">{PIN_ICON}NJEIS Compliant</div>

          {resetSuccess && (
            <div className="mk-form-banner mk-success">Your password has been reset. You can now sign in.</div>
          )}
          {error && (
            <div className="mk-form-banner mk-error">{error}</div>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerify} noValidate>
              <p style={{ fontSize: 14, marginBottom: 14 }}>
                {useRecovery
                  ? 'Enter one of your saved recovery codes.'
                  : 'Enter the 6-digit code from your authenticator app.'}
              </p>
              <div className="mk-field">
                <label htmlFor="login-mfa-code">{useRecovery ? 'Recovery code' : 'Verification code'}</label>
                <input
                  id="login-mfa-code"
                  type="text"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus
                  maxLength={useRecovery ? 32 : 6}
                  placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, marginBottom: 14, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={rememberDevice}
                  onChange={(e) => setRememberDevice(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  Remember this device for 30 days
                  <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                    Only on a device you trust. You can remove devices any time in Security settings.
                  </span>
                </span>
              </label>
              <button
                type="submit"
                className="mk-btn-primary"
                disabled={isSubmitting || (useRecovery ? !mfaCode.trim() : mfaCode.length !== 6)}
                style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
              >
                {isSubmitting ? 'Verifying…' : 'Verify'}
              </button>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 14 }}>
                <button type="button" className="mk-btn-text" onClick={backToPassword}>Back</button>
                <button type="button" className="mk-btn-text" onClick={() => { setUseRecovery((v) => !v); setMfaCode(''); setError(''); }}>
                  {useRecovery ? 'Use authenticator code instead' : 'Use a recovery code instead'}
                </button>
              </div>

              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.08)', fontSize: 14 }}>
                {resetSentTo ? (
                  <div className="mk-form-banner mk-success" role="status">
                    We sent a link to {resetSentTo}. Open it on this device or any device, then come back and sign in.
                  </div>
                ) : confirmingReset ? (
                  <div style={{ border: '1px solid rgba(0,0,0,0.12)', borderRadius: 10, padding: 12 }}>
                    <p style={{ marginBottom: 10 }}>
                      We will email a one-time link to the address on your account. Opening it turns off two-step verification so you can sign in and set it up again. The link expires in 30 minutes.
                    </p>
                    {resetError && <div className="mk-form-banner mk-error" role="alert">{resetError}</div>}
                    <div style={{ display: 'flex', gap: 12 }}>
                      <button type="button" className="mk-btn-text" onClick={sendResetLink} disabled={sendingReset}>
                        {sendingReset ? 'Sending…' : 'Send link'}
                      </button>
                      <button type="button" className="mk-btn-text" onClick={() => { setConfirmingReset(false); setResetError(''); }} disabled={sendingReset}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="mk-btn-text" onClick={() => setConfirmingReset(true)}>
                    Lost your authenticator? Email me a reset link
                  </button>
                )}
              </div>
            </form>
          )}

          {step === 'enroll' && (
            <div>
              <p style={{ fontSize: 14, marginBottom: 14 }}>
                Your company requires two-step verification. Set it up now to finish signing in.
              </p>
              <MfaSetup
                mfaToken={mfaToken}
                trustedKey={{ slug: companySlug.trim().toLowerCase(), email }}
                onEnrolled={(payload) => finishLogin(payload, companySlug.trim().toLowerCase())}
              />
              <div style={{ marginTop: 14 }}>
                <button type="button" className="mk-btn-text" onClick={backToPassword}>Back to sign in</button>
              </div>
            </div>
          )}

          {step === 'password' && (
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
          )}

          <div className="mk-login-card-foot">
            Already have an account but no Company Code? Ask your agency admin.<br />
            Trouble signing in? <a href="mailto:support@izayaedge.com">support@izayaedge.com</a>
          </div>
          </div>

          <aside
            className="mk-login-promo"
            style={{ '--mk-login-promo-img': `url(${import.meta.env.BASE_URL}hero-practitioner.jpg)` }}
          >
            <div className="mk-login-promo-eyebrow">New to Izaya EISimplified™?</div>
            <h2>See what your billing team has been missing.</h2>
            <ul className="mk-login-promo-list">
              {TRIAL_PERKS.map((perk) => (
                <li key={perk} className="mk-login-promo-item">{CHECK_ICON}{perk}</li>
              ))}
            </ul>
            <Link to="/contact" className="mk-btn-primary">Schedule a demo</Link>
          </aside>
        </div>
      </div>
    </MarketingLayout>
  );
};

export default Login;
