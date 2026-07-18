import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { AuthLayout } from '@/components/AuthLayout';

const isPasswordStrong = (pw) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(pw);

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (!isPasswordStrong(newPassword)) {
      setError('Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (@$!%*?&).');
      return;
    }

    setIsSubmitting(true);
    try {
      await api.post('/api/auth/reset-password', { token, newPassword });
      navigate('/', { state: { resetSuccess: true } });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to reset password. Please request a new link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {!token ? (
        <div className="text-center space-y-6">
          <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg text-sm text-red-700 font-medium text-left">
            This reset link is missing or invalid. Please request a new one.
          </div>
          <Link to="/forgot-password" className="inline-block font-semibold text-cyan-700 hover:underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <>
          <h2 className="text-lg font-semibold text-slate-800 mb-6 text-center">Set a new password</h2>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-5 rounded-lg text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="newPassword" className="text-slate-700">New Password</Label>
              <PasswordInput
                id="newPassword"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
                placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-slate-700">Confirm New Password</Label>
              <PasswordInput
                id="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
                autoComplete="new-password"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-11 mt-2 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(8,74,90,0.4)] transition-colors"
            >
              {isSubmitting ? 'Updating...' : 'Reset Password'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
};

export default ResetPassword;
