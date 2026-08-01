import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Hard, full-screen block — not a dismissable banner — matching the
// backend's own enforcement in authMiddleware.js's `protect`: every
// PHI-touching route already 403s with `code: 'BAA_REQUIRED'` while a
// company has no accepted Business Associate Agreement on file, so the UI
// must block just as completely, or every screen behind this would just
// show broken, confusing per-request errors instead of one clear reason.
// Wraps the entire authenticated app shell (both AdminDashboard.jsx and
// dashboard.jsx use this) rather than being a per-page concern.
export function BaaGate({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'blocked' | 'ok'
  const [companyName, setCompanyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const userRole = localStorage.getItem('role');

  const fetchStatus = () => {
    api.get('/api/auth/company-status')
      .then(({ data }) => {
        setCompanyName(data.displayName || '');
        setStatus(data.baaAccepted ? 'ok' : 'blocked');
      })
      .catch(() => setStatus('ok')); // fail open on a transient error — the backend still enforces the real gate on every actual request
  };

  useEffect(() => { fetchStatus(); }, []);

  const handleAccept = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setError('Your full name and email are required.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      await api.post('/api/auth/accept-baa', { name, email });
      setStatus('ok');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to accept the agreement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
              <ShieldAlert className="w-5 h-5 text-red-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Business Associate Agreement required</h1>
          </div>

          {userRole === 'ceo' ? (
            <>
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                {companyName || 'Your organization'} does not have a current Business Associate Agreement on file with Izaya.
                A BAA must be accepted before continuing, since this platform stores Protected Health Information (PHI) on your behalf.
              </p>
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600 leading-relaxed max-h-40 overflow-y-auto mb-4">
                Izaya EIS ("Izaya") acts as a Business Associate under HIPAA for any Protected Health Information
                (PHI) your organization stores on this platform. By accepting this agreement, you confirm your
                organization ("Covered Entity") authorizes Izaya to store and process PHI on your behalf, subject to
                a full Business Associate Agreement to be executed between the parties. Izaya will safeguard PHI per
                HIPAA's Security and Privacy Rules, including encryption at rest and in transit, access controls, and
                audit logging.
              </div>

              {error && (
                <div className="bg-red-50 border-l-4 border-red-500 p-3 mb-4 rounded-lg text-sm text-red-700 font-medium">
                  {error}
                </div>
              )}

              <form onSubmit={handleAccept} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="baa-name">Your Full Name</Label>
                  <Input id="baa-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="baa-email">Your Email</Label>
                  <Input id="baa-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <Button type="submit" disabled={isSubmitting} className="w-full h-11">
                  {isSubmitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                  Accept Agreement
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-slate-600 leading-relaxed">
              Your administrator needs to accept Izaya's Business Associate Agreement before you can continue. Please contact them.
            </p>
          )}
        </div>
      </div>
    );
  }

  return children;
}
