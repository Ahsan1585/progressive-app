import { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Loader2, AlertTriangle, ShieldCheck, Tag } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: { fontSize: '14px', color: '#0f172a', fontFamily: 'inherit', '::placeholder': { color: '#94a3b8' } },
    invalid: { color: '#dc2626' },
  },
};

// Mirrors CardSetupForm in SubscriptionBilling.jsx (same three-call Stripe
// SetupIntent flow) — kept as its own smaller copy here rather than shared,
// since this one has to run standalone inside a blocking gate that mounts
// before the rest of the dashboard (and its permission-gated Subscription
// tab) is reachable at all.
function CardSetupForm({ onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setIsSaving(true);
    setError('');
    try {
      const { data } = await api.post('/api/subscription/payment-method/setup-intent');
      const result = await stripe.confirmCardSetup(data.clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (result.error) {
        setError(result.error.message);
        return;
      }
      await api.post('/api/subscription/payment-method/confirm', {
        paymentMethodId: result.setupIntent.payment_method,
        type: 'card',
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save payment method.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      {error && <p className="text-sm text-red-600 font-medium mb-3">{error}</p>}
      <Button type="submit" disabled={!stripe || isSaving} className="w-full h-11">
        {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
        Start Subscription
      </Button>
      <div className="flex items-center justify-center gap-1.5 mt-3 text-xs text-slate-500">
        <ShieldCheck className="w-3.5 h-3.5" /> Processed securely by Stripe — card details never touch Izaya's servers
      </div>
    </form>
  );
}

function PromoCodeForm({ onRedeemed }) {
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setIsSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const { data } = await api.post('/api/subscription/redeem-promo', { code: code.trim() });
      const until = data.trialEndsAt ? new Date(data.trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
      setSuccess(until ? `Trial extended through ${until}.` : 'Trial extended.');
      setCode('');
      onRedeemed();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to redeem promo code.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Promo code"
          className="uppercase"
          disabled={isSubmitting}
        />
        <Button type="submit" variant="outline" disabled={isSubmitting || !code.trim()} className="shrink-0">
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
        </Button>
      </div>
      {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
      {success && <p className="text-sm text-teal-700 font-medium">{success}</p>}
    </form>
  );
}

// Hard, full-screen block — same pattern as BaaGate.jsx, and for the same
// reason: authMiddleware.js's `protect` already 402s every non-subscription
// route once a trial has expired or a company is suspended, so the UI needs
// to block just as completely instead of leaving the dashboard silently
// empty (which is exactly what used to happen — see the sidebar/Invoice
// Status bug this was built to fix: AdminDashboard.jsx's /api/auth/me call
// used to 402 too, so `me` fell back to zero permissions and every tab
// vanished with no explanation).
export function TrialGate({ children }) {
  const [status, setStatus] = useState('loading'); // 'loading' | 'trial_expired' | 'suspended' | 'ok'
  const [companyName, setCompanyName] = useState('');
  const userRole = localStorage.getItem('role');

  const fetchStatus = () => {
    api.get('/api/auth/company-status')
      .then(({ data }) => {
        setCompanyName(data.displayName || '');
        const trialExpired = data.status === 'trial' && data.trialEndsAt && new Date(data.trialEndsAt) < new Date();
        if (data.status === 'suspended') setStatus('suspended');
        else if (trialExpired) setStatus('trial_expired');
        else setStatus('ok');
      })
      .catch(() => setStatus('ok')); // fail open on a transient error — the backend still enforces the real gate on every actual request
  };

  useEffect(() => { fetchStatus(); }, []);

  const [config, setConfig] = useState(null);
  useEffect(() => {
    if (status !== 'trial_expired' || userRole !== 'ceo') return;
    api.get('/api/subscription/config').then(({ data }) => setConfig(data)).catch(() => setConfig(null));
  }, [status, userRole]);

  const stripePromise = useMemo(
    () => (config?.stripeConfigured && config?.stripePublishableKey ? loadStripe(config.stripePublishableKey) : null),
    [config]
  );

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (status === 'suspended') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-lg p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Account suspended</h1>
          </div>
          <p className="text-sm text-slate-600 leading-relaxed">
            {companyName || 'This account'} has been suspended. Please contact{' '}
            <a href="mailto:support@izayaedge.com" className="text-teal-700 font-medium underline">support@izayaedge.com</a> to resolve this.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'trial_expired') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50 p-4 overflow-y-auto">
        <div className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl shadow-lg p-8 my-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-red-50 border border-red-200 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">Your free trial has ended</h1>
          </div>

          {userRole === 'ceo' ? (
            <>
              <p className="text-sm text-slate-600 mb-6 leading-relaxed">
                {companyName || 'Your organization'}'s free trial with Izaya EIS has ended. Extend it with a promo code, or add a payment method to start your subscription.
              </p>

              <div className="mb-6">
                <Label className="flex items-center gap-1.5 mb-2"><Tag className="w-3.5 h-3.5" /> Have a promo code?</Label>
                <PromoCodeForm onRedeemed={fetchStatus} />
              </div>

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                <div className="relative flex justify-center text-xs"><span className="bg-white px-2 text-slate-400 font-medium uppercase tracking-wide">Or</span></div>
              </div>

              <div>
                <Label className="mb-2 block">Add a payment method</Label>
                {config === null ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
                ) : !config.stripeConfigured ? (
                  <p className="text-sm text-slate-500">
                    Online payment isn't set up yet — email{' '}
                    <a href="mailto:support@izayaedge.com" className="text-teal-700 font-medium underline">support@izayaedge.com</a> to add a payment method.
                  </p>
                ) : (
                  <Elements stripe={stripePromise}>
                    <CardSetupForm onSaved={fetchStatus} />
                  </Elements>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600 leading-relaxed">
              Your administrator needs to add a payment method (or apply a promo code) to keep using Izaya EIS. Please contact them.
            </p>
          )}
        </div>
      </div>
    );
  }

  return children;
}
