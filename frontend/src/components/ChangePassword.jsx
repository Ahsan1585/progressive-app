import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axiosInstance'; // Double check this path matches your setup!

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
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full border border-slate-200">
        <h2 className="text-2xl font-bold text-slate-800 mb-2">Update Required</h2>
        <p className="text-slate-500 mb-6 text-sm">
          For security purposes, you must change your temporary password before accessing the portal.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">New Password</label>
            <input 
              type="password" 
              required
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Confirm New Password</label>
            <input 
              type="password" 
              required
              className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-blue-500"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          <button 
            type="submit" 
            disabled={isUpdating} 
            className="w-full bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 mt-4 font-medium transition-colors"
          >
            {isUpdating ? 'Updating...' : 'Secure Account & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChangePassword;