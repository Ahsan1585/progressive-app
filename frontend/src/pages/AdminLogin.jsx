import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const AdminLogin = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleAdminLogin = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/api/auth/login', { email, password });
      const role = response.data.practitioner.role;

      if (role === 'practitioner') {
        alert('This portal is for administrative users only. Please use the Practitioner Portal.');
        return;
      }

      localStorage.setItem('token', response.data.token);
      localStorage.setItem('role', role);
      navigate('/admin-dashboard');
    } catch (error) {
      alert('Invalid admin credentials');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 font-sans">
      <div className="bg-white w-full max-w-md p-10 rounded-2xl shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4">
            <svg className="w-6 h-6 text-blue-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Admin Portal</h2>
          <p className="text-sm text-slate-500 mt-2">Authorized personnel only</p>
        </div>

        <form onSubmit={handleAdminLogin} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Admin Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Security Passkey</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <Button type="submit" className="w-full bg-blue-700 hover:bg-blue-800 text-white py-6 rounded-xl">
            Access System
          </Button>
        </form>

        <div className="mt-8 text-center pt-6 border-t border-slate-100">
          <Link to="/" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
            ← Return to Practitioner Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default AdminLogin;