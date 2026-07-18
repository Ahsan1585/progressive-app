import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
    } catch {
      // Intentionally ignored — the backend always responds generically either way.
    } finally {
      // Always show the same confirmation regardless of outcome, so we never reveal
      // whether an account exists for this email.
      setSubmitted(true);
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {submitted ? (
        <div className="text-center space-y-6">
          <div className="bg-teal-50 border-l-4 border-teal-600 p-4 rounded-lg text-sm text-teal-800 font-medium text-left">
            If an account exists with that email, a password reset link has been sent. Check your inbox.
          </div>
          <Link to="/" className="inline-block font-semibold text-cyan-700 hover:underline">
            Back to Sign In
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-slate-800 mb-2 text-center">Forgot your password?</h2>
          <p className="text-sm text-slate-500 mb-6 text-center">
            Enter the email address on file and we'll send you a link to reset your password.
          </p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-slate-700">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
                autoComplete="email"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 mt-2 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(8,74,90,0.4)] transition-colors"
            >
              {isSubmitting ? 'Sending...' : 'Send Reset Link'}
            </Button>
          </form>

          <div className="mt-8 text-center pt-6 border-t border-slate-100">
            <Link to="/" className="text-sm font-semibold text-slate-500 hover:text-cyan-700 transition-colors">
              Back to Sign In
            </Link>
          </div>
        </>
      )}
    </AuthLayout>
  );
};

export default ForgotPassword;
