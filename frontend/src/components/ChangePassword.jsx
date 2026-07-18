import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance'; // Double check this path matches your setup!
import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

const ChangePassword = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Mirror the backend policy for immediate feedback (backend remains the enforcement boundary)
  const isPasswordStrong = (pw) =>
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(pw);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (newPassword !== confirmPassword) {
      alert("Passwords do not match!");
      return;
    }

    if (!isPasswordStrong(newPassword)) {
      alert("Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (@$!%*?&).");
      return;
    }

    setIsUpdating(true);
    try {
      // The token is already in localStorage from the login step,
      // so your api instance should send it automatically.
      const response = await api.post('/api/auth/change-password', { newPassword });

      if (response.data.success) {
        alert("Password successfully changed! Welcome to the portal.");
        navigate('/dashboard');
      }
    } catch {
      alert("Failed to update password. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold text-slate-800 mb-2 text-center">Update Required</h2>
      <p className="text-sm text-slate-500 mb-6 text-center">
        For security purposes, you must change your temporary password before accessing the portal.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <Label className="text-slate-700">New Password</Label>
          <PasswordInput
            required
            className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-slate-700">Confirm New Password</Label>
          <PasswordInput
            required
            className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          disabled={isUpdating}
          className="w-full h-11 mt-2 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(8,74,90,0.4)] transition-colors"
        >
          {isUpdating ? 'Updating...' : 'Secure Account & Continue'}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ChangePassword;
