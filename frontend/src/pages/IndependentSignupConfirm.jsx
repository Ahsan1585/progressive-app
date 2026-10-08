import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { AuthLayout, IZAYA_ONE_INSTALL_URL } from '@/components/AuthLayout';

// Independent-practitioner equivalent of SignupConfirm.jsx — same
// deferred-provisioning shape (see independentSignupController.js's
// requestIndependentSignup/confirmIndependentSignup split), just pointed
// at the independent-signup endpoint.
const IndependentSignupConfirm = () => {
  const { token } = useParams();
  const [status, setStatus] = useState(() => (token ? 'loading' : 'error'));
  const [message, setMessage] = useState(() => (token ? '' : 'This confirmation link is missing or invalid.'));

  useEffect(() => {
    if (!token) return;
    api.post(`/api/independent-signup/confirm/${token}`)
      .then(() => {
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Failed to confirm your signup. Please try signing up again.');
      });
  }, [token]);

  return (
    <AuthLayout isOne>
      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-8 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Setting up your account…</p>
        </div>
      )}

      {status === 'success' && (
        <div className="text-center space-y-6">
          <div className="bg-teal-50 border-l-4 border-teal-600 p-4 rounded-lg text-sm text-teal-800 font-medium text-left">
            Your account is set up and your 15-day free trial has started. Download the practitioner app to log in.
          </div>
          <a href={IZAYA_ONE_INSTALL_URL} target="_blank" rel="noopener noreferrer" className="inline-block font-semibold text-cyan-700 hover:underline">
            Get the Izaya One app
          </a>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center space-y-6">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg text-sm text-red-700 font-medium text-left">
            {message}
          </div>
          <Link to="/signup/independent" className="inline-block font-semibold text-cyan-700 hover:underline">
            Sign up again
          </Link>
        </div>
      )}
    </AuthLayout>
  );
};

export default IndependentSignupConfirm;
