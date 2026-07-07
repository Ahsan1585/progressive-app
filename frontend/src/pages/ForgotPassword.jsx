import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import logo from '@/assets/logo.png';

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
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden border border-neutral-200">
        <div className="p-8">
          <div className="flex flex-col items-center justify-center mb-8 text-center">
            <img src={logo} alt="Progressive Steps" className="w-56 h-auto object-contain mb-3" />
            <p className="text-neutral-500 font-medium">Practitioner Portal</p>
          </div>

          {submitted ? (
            <div className="text-center space-y-6">
              <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-md text-sm text-emerald-700 font-medium text-left">
                If an account exists with that email, a password reset link has been sent. Check your inbox.
              </div>
              <Link to="/" className="inline-block font-semibold text-neutral-950 hover:underline">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-neutral-800 mb-2 text-center">Forgot your password?</h2>
              <p className="text-sm text-neutral-500 mb-6 text-center">
                Enter the email address on file and we'll send you a link to reset your password.
              </p>
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-neutral-700">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-950"
                    autoComplete="email"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-neutral-950 hover:bg-neutral-800 text-white py-6 text-base font-semibold rounded-lg transition-all"
                >
                  {isSubmitting ? 'Sending...' : 'Send Reset Link'}
                </Button>
              </form>

              <div className="mt-8 text-center pt-6 border-t border-neutral-100">
                <Link to="/" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950 transition-colors">
                  Back to Sign In
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
