import { useEffect, useState } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import api from '@/api/axiosInstance';

// Shown across the admin dashboard while the company is on a trial —
// reuses the same amber "Next Bill Coming" treatment already established in
// SubscriptionBilling.jsx rather than inventing a new alert style. Once the
// trial has actually expired this becomes the stronger red treatment
// already used for the "Overdue" invoice badge, since at that point the
// backend is actively blocking non-billing routes (see authMiddleware.js).
export function TrialStatusBanner() {
  const [company, setCompany] = useState(null);
  const userRole = localStorage.getItem('role');

  useEffect(() => {
    api.get('/api/auth/company-status')
      .then(({ data }) => setCompany(data))
      .catch(() => setCompany(null));
  }, []);

  if (!company || company.status !== 'trial' || !company.trialEndsAt) return null;

  const daysLeft = Math.ceil((new Date(company.trialEndsAt) - new Date()) / (24 * 60 * 60 * 1000));
  const expired = daysLeft < 0;

  if (expired) {
    return (
      <div className="flex gap-3 items-start bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-4">
        <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-base font-bold text-slate-800 mb-1">Your free trial has ended</h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            {userRole === 'ceo'
              ? 'Add a payment method under Subscription & Billing to keep using Izaya EIS.'
              : 'Ask your admin to add a payment method under Subscription & Billing to keep using Izaya EIS.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-4">
      <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
      <div>
        <h4 className="text-base font-bold text-slate-800 mb-1">Free trial</h4>
        <p className="text-sm text-slate-600 leading-relaxed">
          {daysLeft === 0 ? 'Your free trial ends today.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial.`}
        </p>
      </div>
    </div>
  );
}
