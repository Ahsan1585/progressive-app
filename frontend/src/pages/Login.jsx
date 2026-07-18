import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom'; // <-- Kept useNavigate to prevent crashes!
import api from '@/api/axiosInstance';
import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const resetSuccess = location.state?.resetSuccess;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await api.post('/api/auth/login', { email, password });

      if (response.data.success) {
        localStorage.setItem('token', response.data.token);
        localStorage.setItem('role', response.data.practitioner.role);

        const role = response.data.practitioner.role;
        const ADMIN_ROLES = ['staff_director', 'billing', 'ceo'];

        if (response.data.requirePasswordChange) {
          navigate('/change-password');
        } else if (ADMIN_ROLES.includes(role)) {
          navigate('/admin-dashboard');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || "Login failed. Please check your credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      {/* Reset Success Message */}
      {resetSuccess && (
        <div className="bg-teal-50 border-l-4 border-teal-600 p-4 mb-5 rounded-lg text-sm text-teal-800 font-medium">
          Your password has been reset. You can now sign in.
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-5 rounded-lg text-sm text-red-700 font-medium">
          {error}
        </div>
      )}

      {/* Login Form */}
      <form onSubmit={handleLogin} className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-slate-700">Email Address</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
            required
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-slate-700">Password</Label>
            <Link to="/forgot-password" className="text-sm font-medium text-slate-500 hover:text-cyan-700 transition-colors">
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-11 rounded-lg bg-slate-50 border-slate-200 focus-visible:border-cyan-600 focus-visible:ring-cyan-600/40"
            required
          />
        </div>

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full h-11 mt-2 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(8,74,90,0.4)] transition-colors"
        >
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default Login;
