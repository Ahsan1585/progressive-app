import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom'; // <-- Kept useNavigate to prevent crashes!
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Import the logo from your assets folder
import logo from '@/assets/logo.png';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const resetSuccess = location.state?.resetSuccess;

  const handleLogin = async (e) => {
    e.preventDefault();
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
      alert(err.response?.data?.error || "Login failed. Please check your credentials.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden border border-neutral-200">
        <div className="p-8">
          
          {/* Header with Logo */}
          <div className="flex flex-col items-center justify-center mb-8 text-center">
            <img 
              src={logo} 
              alt="Progressive Steps" 
              className="w-56 h-auto object-contain mb-3" 
            />
            <p className="text-neutral-500 font-medium">Practitioner Portal</p>
          </div>

          {/* Reset Success Message */}
          {resetSuccess && (
            <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 mb-6 rounded-r-md text-sm text-emerald-700 font-medium">
              Your password has been reset. You can now sign in.
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6 rounded-r-md text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-neutral-700">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-950"
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-neutral-700">Password</Label>
                <Link to="/forgot-password" className="text-sm font-medium text-neutral-500 hover:text-neutral-950 transition-colors">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-neutral-50 border-neutral-200 focus-visible:ring-neutral-950"
                required
              />
            </div>

            <Button 
              type="submit" 
              className="w-full bg-neutral-950 hover:bg-neutral-800 text-white py-6 text-base font-semibold rounded-lg transition-all"
            >
              Sign In
            </Button>
          </form>

          {/* NEW: Admin Portal Access Link */}
          <div className="mt-8 text-center pt-6 border-t border-neutral-100">
            <p className="text-sm text-neutral-500">
              Are you a system administrator?{' '}
              <Link to="/admin-login" className="font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors">
                Admin Portal Access
              </Link>
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="px-8 py-5 bg-neutral-50 border-t border-neutral-100 text-center">
          <p className="text-sm text-neutral-600">
            Need an account? <a href="#" className="font-semibold text-neutral-950 hover:underline">Contact Administrator</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;