import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { ShieldCheck, Loader2, CheckCircle2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { AuthLayout } from '@/components/AuthLayout';

// Minimal web page for an independent practitioner to add/update their
// Stripe payment method — deep-linked to from the mobile app's Billing tab
// (mobile/src/pages/shell/Billing.tsx), since building a native Stripe
// Elements card-capture flow directly in the mobile PWA was deliberately
// deferred (no Stripe SDK there at all yet). Reuses the exact same
// CardSetupForm shape/endpoints as SubscriptionBilling.jsx's tenant-company
// admin screen, just without the surrounding per-seat dashboard — this
// role's summary/invoices/payment-method endpoints are already role-
// agnostic (see subscriptionController.js), so no new backend work.
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const formatDate = (iso) => iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: { fontSize: '14px', color: '#0f172a', fontFamily: 'inherit', '::placeholder': { color: '#94a3b8' } },
    invalid: { color: '#dc2626' },
  },
};

function CardSetupForm({ onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setIsSaving(true);
    setError(null);
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
      elements.getElement(CardElement).clear();
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save payment method.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-3 mb-3 rounded-lg text-sm text-red-700 font-medium">
          {error}
        </div>
      )}
      <div className="rounded-lg border border-slate-200 bg-white p-3 mb-3">
        <CardElement options={CARD_ELEMENT_OPTIONS} />
      </div>
      <Button type="submit" disabled={!stripe || isSaving} className="w-full bg-gradient-to-r from-teal-700 to-slate-900 hover:opacity-90 text-white font-semibold">
        {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
        Save Payment Method
      </Button>
      <div className="flex items-center justify-center gap-1.5 mt-3 text-sm text-slate-500">
        <ShieldCheck className="w-4 h-4" /> Processed securely by Stripe — card details never touch Izaya's servers
      </div>
    </form>
  );
}

export default function IndependentBilling() {
  const [config, setConfig] = useState(null);
  const [summary, setSummary] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [saved, setSaved] = useState(false);

  const fetchAll = useCallback(async () => {
    const [configRes, summaryRes, paymentRes] = await Promise.all([
      api.get('/api/subscription/config'),
      api.get('/api/subscription/summary'),
      api.get('/api/subscription/payment-method'),
    ]);
    setConfig(configRes.data);
    setSummary(summaryRes.data.summary);
    setPaymentMethod(paymentRes.data.paymentMethod);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const stripePromise = useMemo(
    () => (config?.stripeConfigured && config?.stripePublishableKey ? loadStripe(config.stripePublishableKey) : null),
    [config]
  );

  const handleSaved = () => {
    setSaved(true);
    fetchAll();
  };

  return (
    <AuthLayout isOne>
      <h2 className="text-lg font-semibold text-slate-800 mb-1 text-center">Billing</h2>
      <p className="text-sm text-slate-500 mb-5 text-center">Manage your Izaya EIS subscription.</p>

      {summary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 mb-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">This month</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{money(summary.totalAmount)}</p>
          <p className="text-xs text-slate-500 mt-1">Next billing date {formatDate(summary.nextBillingDate)}</p>
        </div>
      )}

      {paymentMethod && !saved ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-teal-600 shrink-0" />
          <span className="text-sm text-slate-700">
            {paymentMethod.brand ? `${paymentMethod.brand} ····` : 'Card ····'} {paymentMethod.last4} on file
          </span>
        </div>
      ) : null}

      {saved ? (
        <div className="bg-teal-50 border-l-4 border-teal-600 p-4 rounded-lg text-sm text-teal-800 font-medium">
          Payment method saved.
        </div>
      ) : config?.stripeConfigured && stripePromise ? (
        <Elements stripe={stripePromise}>
          <CardSetupForm onSaved={handleSaved} />
        </Elements>
      ) : (
        <p className="text-sm text-slate-500 text-center">Payments aren't configured yet — check back soon.</p>
      )}
    </AuthLayout>
  );
}
