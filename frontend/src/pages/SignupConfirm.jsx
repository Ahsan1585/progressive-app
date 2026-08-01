import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { AuthLayout } from '@/components/AuthLayout';

// Landing page for the "confirm your signup" email link — this is where
// the real infrastructure provisioning (CREATE DATABASE, schema, seed rows)
// actually happens, deferred from the signup form submission itself (see
// signupController.js's requestSignup/confirmSignup split).
const SignupConfirm = () => {
  const { token } = useParams();
  const [status, setStatus] = useState(() => (token ? 'loading' : 'error')); // 'loading' | 'success' | 'error'
  const [message, setMessage] = useState(() => (token ? '' : 'This confirmation link is missing or invalid.'));
  const [slug, setSlug] = useState(null);

  useEffect(() => {
    if (!token) return;
    api.post(`/api/signup/confirm/${token}`)
      .then(({ data }) => {
        setStatus('success');
        setSlug(data.slug);
        try { if (data.slug) localStorage.setItem('companySlug', data.slug); } catch { /* ignore */ }
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err.response?.data?.error || 'Failed to confirm your signup. Please try signing up again.');
      });
  }, [token]);

  return (
    <AuthLayout>
      {status === 'loading' && (
        <div className="flex flex-col items-center gap-3 py-8 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <p className="text-sm">Setting up your company…</p>
        </div>
      )}

      {status === 'success' && (
        <div className="text-center space-y-6">
          <div className="bg-teal-50 border-l-4 border-teal-600 p-4 rounded-lg text-sm text-teal-800 font-medium text-left">
            Your company{slug ? ` (${slug})` : ''} is set up and your 15-day free trial has started. You can now log in.
          </div>
          <Link to="/" className="inline-block font-semibold text-cyan-700 hover:underline">
            Go to Sign In
          </Link>
        </div>
      )}

      {status === 'error' && (
        <div className="text-center space-y-6">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg text-sm text-red-700 font-medium text-left">
            {message}
          </div>
          <Link to="/signup" className="inline-block font-semibold text-cyan-700 hover:underline">
            Sign up again
          </Link>
        </div>
      )}
    </AuthLayout>
  );
};

export default SignupConfirm;
