import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/AuthLayout';
import { mfaResetWithToken, errMsg } from '@/components/mfa/mfaApi';

// Opened from the emailed reset link. Deliberately does nothing on load:
// email scanners prefetch links, so the user must press the button.
const MfaReset = () => {
  const { slug, token } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // 'idle' | 'working' | 'done' | 'invalid'
  const [error, setError] = useState('');
  const [companyRequiresMfa, setCompanyRequiresMfa] = useState(false);

  const handleReset = async () => {
    setStatus('working');
    setError('');
    try {
      const data = await mfaResetWithToken(slug, token);
      setCompanyRequiresMfa(Boolean(data.companyRequiresMfa));
      setStatus('done');
    } catch (err) {
      setError(errMsg(err, 'This reset link is no longer valid.'));
      setStatus('invalid');
    }
  };

  const goToLogin = () => navigate('/login');

  return (
    <AuthLayout>
      {status === 'done' ? (
        <div className="text-center space-y-5">
          <h2 className="text-lg font-semibold text-slate-800">Two-step verification is off</h2>
          <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-lg text-sm text-emerald-800 font-medium text-left space-y-2" role="status">
            <p>Two-step verification is off for your account. Sign in to continue.</p>
            {companyRequiresMfa && (
              <p>Your organization requires two-step verification, so you will be asked to set it up again when you sign in.</p>
            )}
          </div>
          <Button
            type="button"
            onClick={goToLogin}
            className="w-full h-11 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold transition-colors"
          >
            Sign in
          </Button>
        </div>
      ) : status === 'invalid' ? (
        <div className="text-center space-y-6">
          <div role="alert" className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg text-sm text-red-700 font-medium text-left">
            {error}
          </div>
          <Link to="/login" className="inline-block font-semibold text-cyan-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <div className="text-center space-y-5">
          <h2 className="text-lg font-semibold text-slate-800">Reset two-step verification</h2>
          <p className="text-sm text-slate-600">
            Turning this off lets you sign in without your authenticator app. You can set it up again afterward.
          </p>
          <Button
            type="button"
            onClick={handleReset}
            disabled={status === 'working'}
            className="w-full h-11 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold transition-colors"
          >
            {status === 'working' ? 'Working...' : 'Turn off two-step verification'}
          </Button>
          <Link to="/login" className="inline-block text-sm font-medium text-slate-500 hover:underline">
            Back to sign in
          </Link>
        </div>
      )}
    </AuthLayout>
  );
};

export default MfaReset;
