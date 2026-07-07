import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import logo from '@/assets/logo.png';

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
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden border border-neutral-200">
        <div className="p-8">
          <div className="flex flex-col items-center justify-center mb-8 text-center">
            <img src={logo} alt="Progressive Steps" className="w-56 h-auto object-contain mb-3" />
            <p className="text-neutral-500 font-medium">Practitioner Portal</p>
          </div>

          {!token ? (
            <div className="text-center space-y-6">
              <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md text-sm text-red-700 font-medium text-left">
                This reset link is missing or invalid. Please request a new one.
              </div>
              <Link to="/forgot-password" className="inline-block font-semibold text-neutral-950 hover:underline">
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-neutral-800 mb-2 text-center">Set a new password</h2>

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-md text-sm text-red-700 font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-neutral-700">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-950"
                    placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-neutral-700">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-950"
                    autoComplete="new-password"
                    required
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-neutral-950 hover:bg-neutral-800 text-white py-6 text-base font-semibold rounded-lg transition-all"
                >
                  {isSubmitting ? 'Updating...' : 'Reset Password'}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
