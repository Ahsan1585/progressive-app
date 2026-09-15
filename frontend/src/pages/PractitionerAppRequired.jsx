import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLayout, MOBILE_APP_INSTALL_URL } from '@/components/AuthLayout';

// Dead-end for a practitioner who successfully authenticates on the web app.
// Mirrors mobile/src/pages/UnsupportedRole.tsx's own inverse case (an
// office-staff account landing in the practitioner mobile app) — same
// pattern, same reasoning: practitioners now use the mobile app
// exclusively, so instead of loading the legacy /dashboard, this explains
// why and sends them to the right place. Clears the session rather than
// leaving them authenticated in a dead-end tab.
export default function PractitionerAppRequired() {
  const navigate = useNavigate();

  const handleBackToLogin = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    window.dispatchEvent(new Event('auth-changed'));
    navigate('/login', { replace: true });
  };

  return (
    <AuthLayout>
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-amber-600" />
          </div>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Practitioners use the Izaya mobile app</h2>
          <p className="text-sm text-slate-500">
            This web portal is for office staff. Please use the Izaya mobile app on your phone to log your sessions and manage your patients.
          </p>
        </div>
        <a
          href={MOBILE_APP_INSTALL_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full h-11 rounded-lg bg-cyan-700 hover:bg-cyan-800 text-white text-base font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(8,74,90,0.4)] transition-colors flex items-center justify-center"
        >
          Open the Izaya App
        </a>
        <Button type="button" variant="outline" onClick={handleBackToLogin} className="w-full h-11">
          Back to Sign In
        </Button>
      </div>
    </AuthLayout>
  );
}
