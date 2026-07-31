import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import {
  Users, UserCog, DollarSign, Info, CreditCard, ShieldCheck, Download, Loader2, CheckCircle2,
} from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { showConfirm } from '@/utils/dialogStore';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const initials = (first, last) => `${(first || '?')[0] || ''}${(last || '')[0] || ''}`.toUpperCase();
const formatPeriod = (start, end) => {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const opts = { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} – ${e.toLocaleDateString('en-US', opts)}`;
};
const formatDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const STATUS_STYLES = {
  paid: 'bg-teal-50 text-teal-700 border-teal-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  void: 'bg-slate-100 text-slate-500 border-slate-200',
};

// --- Card (Stripe Elements) setup form — mounted only once a publishable
// key is available. Card details never touch our backend: CardElement is a
// Stripe-hosted iframe, and we only ever send the resulting paymentMethodId. ---
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: { fontSize: '14px', color: '#0f172a', fontFamily: 'inherit', '::placeholder': { color: '#94a3b8' } },
    invalid: { color: '#dc2626' },
  },
};

function CardSetupForm({ onSaved, setToast }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setIsSaving(true);
    setToast(null);
    try {
      const { data } = await api.post('/api/subscription/payment-method/setup-intent');
      const result = await stripe.confirmCardSetup(data.clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (result.error) {
        setToast({ type: 'error', message: result.error.message });
        return;
      }
      await api.post('/api/subscription/payment-method/confirm', {
        paymentMethodId: result.setupIntent.payment_method,
        type: 'card',
      });
      elements.getElement(CardElement).clear();
      setToast({ type: 'success', message: 'Payment method saved.' });
      onSaved();
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to save payment method.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
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

// --- Google Pay (Stripe Payment Request Button), driven by the same
// SetupIntent flow as the card form above. ---
function GooglePaySetupForm({ totalAmount, onSaved, setToast }) {
  const stripe = useStripe();
  const [paymentRequest, setPaymentRequest] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!stripe) return;
    const pr = stripe.paymentRequest({
      country: 'US',
      currency: 'usd',
      total: { label: 'Izaya Subscription', amount: Math.max(50, Math.round((totalAmount || 0) * 100)) },
      requestPayerName: false,
      requestPayerEmail: false,
    });
    pr.canMakePayment().then((result) => {
      if (result) setPaymentRequest(pr);
      setChecking(false);
    });

    pr.on('paymentmethod', async (ev) => {
      try {
        const { data } = await api.post('/api/subscription/payment-method/setup-intent');
        const confirmResult = await stripe.confirmCardSetup(
          data.clientSecret,
          { payment_method: ev.paymentMethod.id },
          { handleActions: false }
        );
        if (confirmResult.error) {
          ev.complete('fail');
          setToast({ type: 'error', message: confirmResult.error.message });
          return;
        }
        ev.complete('success');
        await api.post('/api/subscription/payment-method/confirm', {
          paymentMethodId: ev.paymentMethod.id,
          type: 'google_pay',
        });
        setToast({ type: 'success', message: 'Google Pay saved as your payment method.' });
        onSaved();
      } catch (error) {
        ev.complete('fail');
        setToast({ type: 'error', message: error.response?.data?.error || 'Failed to save Google Pay.' });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripe]);

  if (checking) {
    return <div className="text-sm text-slate-500 text-center py-6">Checking Google Pay availability…</div>;
  }
  if (!paymentRequest) {
    return (
      <div className="text-sm text-slate-600 text-center py-6 px-4 leading-relaxed">
        Google Pay isn't available in this browser. Try Chrome on a device with a saved Google Pay card, or use the Card tab instead.
      </div>
    );
  }
  return (
    <div className="[&_iframe]:!rounded-lg">
      {/* PaymentRequestButtonElement would need `elements` context; we render Stripe's
          default button via the PaymentRequest object directly for simplicity. */}
      <GooglePayButton paymentRequest={paymentRequest} />
    </div>
  );
}

function GooglePayButton({ paymentRequest }) {
  const elements = useElements();
  const ref = React.useRef(null);
  useEffect(() => {
    if (!elements || !ref.current) return;
    const prButton = elements.create('paymentRequestButton', { paymentRequest });
    prButton.mount(ref.current);
    return () => { try { prButton.unmount(); } catch { /* already unmounted */ } };
  }, [elements, paymentRequest]);
  return <div ref={ref} />;
}

// Admin-only ('ceo') — what this agency owes Izaya, based on active
// practitioners this month plus any office seats beyond the included 5.
// Distinct from the "Billing & Invoices" tab, which is this agency's own
// pay invoices to its practitioners.
export const SubscriptionBilling = () => {
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [config, setConfig] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pmTab, setPmTab] = useState('card');
  const [toast, setToast] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);
  const [isPayingBill, setIsPayingBill] = useState(false);

  // Most recent invoice that still has money owed on it — that's what's
  // due, with the due date set to the 15th of the month after the period it
  // covers (the same day Cloud Scheduler retries automatic billing).
  const currentBillDue = useMemo(
    () => invoices.find((inv) => inv.status === 'pending' || inv.status === 'failed') || null,
    [invoices]
  );
  const currentBillDueDate = useMemo(() => {
    if (!currentBillDue) return null;
    const end = new Date(`${currentBillDue.period_end}T00:00:00Z`);
    const due = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 15));
    return due.toISOString().slice(0, 10);
  }, [currentBillDue]);

  const fetchAll = useCallback(async () => {
    try {
      const [summaryRes, invoicesRes, configRes, pmRes] = await Promise.all([
        api.get('/api/subscription/summary'),
        api.get('/api/subscription/invoices'),
        api.get('/api/subscription/config'),
        api.get('/api/subscription/payment-method'),
      ]);
      setSummary(summaryRes.data.summary);
      setInvoices(invoicesRes.data.invoices);
      setConfig(configRes.data);
      setPaymentMethod(pmRes.data.paymentMethod);
    } catch (error) {
      console.error('Failed to load subscription billing', error);
      setToast({ type: 'error', message: 'Failed to load subscription billing.' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const refreshPaymentMethod = async () => {
    const { data } = await api.get('/api/subscription/payment-method');
    setPaymentMethod(data.paymentMethod);
  };

  const stripePromise = useMemo(
    () => (config?.stripeConfigured && config?.stripePublishableKey ? loadStripe(config.stripePublishableKey) : null),
    [config]
  );

  const handleGenerateInvoice = async () => {
    const confirmed = await showConfirm(
      config?.stripeConfigured && paymentMethod
        ? "Close out the last completed billing period and charge the saved payment method? This can't be undone."
        : "Close out the last completed billing period and record an invoice? No card is on file yet, so it will be recorded as pending — nothing will be charged."
    );
    if (!confirmed) return;
    setIsGenerating(true);
    setToast(null);
    try {
      const { data } = await api.post('/api/subscription/invoices/generate');
      setToast({
        type: data.invoice.status === 'paid' ? 'success' : 'success',
        message: `Invoice for ${formatPeriod(data.invoice.period_start, data.invoice.period_end)} recorded (${data.invoice.status}).`,
      });
      const { data: invoicesData } = await api.get('/api/subscription/invoices');
      setInvoices(invoicesData.invoices);
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to generate invoice.' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePayBill = async () => {
    if (!currentBillDue) return;
    const confirmed = await showConfirm(`Charge the saved payment method ${money(currentBillDue.total_amount)} for this bill now?`);
    if (!confirmed) return;
    setIsPayingBill(true);
    setToast(null);
    try {
      const { data } = await api.post(`/api/subscription/invoices/${currentBillDue.id}/pay`);
      setToast({ type: 'success', message: `Payment successful — invoice marked as paid.` });
      const { data: invoicesData } = await api.get('/api/subscription/invoices');
      setInvoices(invoicesData.invoices);
    } catch (error) {
      setToast({ type: 'error', message: error.response?.data?.error || 'Failed to pay bill.' });
    } finally {
      setIsPayingBill(false);
    }
  };

  const handleDownloadInvoicePdf = async (invoice) => {
    setDownloadingId(invoice.id);
    setToast(null);
    try {
      const response = await api.get(`/api/subscription/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Izaya-Invoice-${invoice.period_start}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setToast({ type: 'error', message: 'Failed to download invoice PDF.' });
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }
  if (!summary) return null;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold tracking-wide uppercase text-teal-600 mb-1.5">Admin Settings</p>
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Subscription &amp; Billing</h1>
        <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
          Your plan is <span className="font-semibold text-slate-800">{money(summary.pricePerPractitioner)} per active practitioner</span> per month, and includes {summary.includedStaffSeats} office staff seats.
          Additional office staff seats are {money(summary.extraStaffSeatPrice)}/month each. Charges are based on who actually logged a session this month.
        </p>
      </div>

      {toast && (
        <div className={`text-sm rounded-lg border px-4 py-3 ${toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-teal-50 border-teal-200 text-teal-700'}`}>
          {toast.message}
        </div>
      )}

      {/* METRICS */}
      <div>
        <div className="flex items-center gap-2.5 mb-1.5">
          <h2 className="text-lg font-bold text-slate-800">Current Billing Period</h2>
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />In progress
          </span>
        </div>
        <p className="text-sm text-slate-500 mb-4">
          These 3 cards update live as sessions get logged this month ({formatPeriod(summary.periodStart, summary.periodEnd)}) and reset on the 1st. Past closed months are in Invoice History below.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-slate-600">Active Practitioners</span>
            <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center"><Users className="w-4 h-4 text-sky-600" /></div>
          </div>
          <div className="text-4xl font-bold text-slate-900 tracking-tight">{summary.activePractitionerCount}</div>
          <div className="text-sm text-slate-500 mt-1.5">of {summary.totalPractitionerCount} total practitioners &middot; {formatPeriod(summary.periodStart, summary.periodEnd)}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-slate-600">Office Staff</span>
            <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center"><UserCog className="w-4 h-4 text-violet-600" /></div>
          </div>
          <div className="text-4xl font-bold text-slate-900 tracking-tight">
            {summary.officeStaffCount}<span className="text-slate-300 text-2xl"> / {summary.includedStaffSeats}</span>
          </div>
          <div className="text-sm text-slate-500 mt-1.5">
            {summary.extraStaffSeats > 0 ? `${summary.extraStaffSeats} extra office staff` : 'included in your plan'}
          </div>
        </div>
        </div>
      </div>

      {/* CURRENT BILL DUE */}
      {currentBillDue && (
        <div className="bg-white border-2 border-teal-200 rounded-2xl p-5 shadow-sm shadow-teal-100">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center"><DollarSign className="w-4 h-4 text-teal-600" /></div>
                <span className="text-[13px] font-semibold text-slate-600">Current Bill Due</span>
              </div>
              <div className="text-4xl font-bold text-teal-700 tracking-tight mt-1.5">{money(currentBillDue.total_amount)}</div>
              <div className="text-sm text-slate-500 mt-1.5">For {formatPeriod(currentBillDue.period_start, currentBillDue.period_end)} &middot; due {formatDate(currentBillDueDate)}</div>
              <button
                type="button"
                onClick={() => handleDownloadInvoicePdf(currentBillDue)}
                disabled={downloadingId === currentBillDue.id}
                className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:text-sky-700 disabled:opacity-50 disabled:cursor-wait mt-2"
              >
                {downloadingId === currentBillDue.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} View Bill
              </button>
            </div>
            <div className="flex flex-col items-end gap-3">
              <span className={`text-xs font-bold border px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[currentBillDue.status] || STATUS_STYLES.pending}`}>{currentBillDue.status}</span>
              <Button size="sm" onClick={handlePayBill} disabled={isPayingBill} className="h-8 text-xs">
                {isPayingBill ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Pay Bill
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* INFO PANEL */}
      <div className="flex gap-3.5 items-start bg-sky-50 border border-sky-200 rounded-xl px-5 py-4">
        <Info className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="text-base font-bold text-slate-800 mb-1.5">How this charge is calculated</h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            A practitioner counts as <b className="text-slate-900 font-semibold">active for the entire month</b> the moment they submit one session log — even a single log on the last day of the month bills the full {money(summary.pricePerPractitioner)}.
            Charges are not prorated. Removing a practitioner takes effect the following billing cycle; it does not refund the current one.
            Your first {summary.includedStaffSeats} office staff seats are included at no extra cost — each additional office account beyond that is {money(summary.extraStaffSeatPrice)}/month.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
        {/* LEFT: activity + invoices */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Practitioner Activity</h3>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" />{summary.activePractitionerCount} active</span>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />{summary.totalPractitionerCount - summary.activePractitionerCount} no activity</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="pb-2.5 pr-2">Practitioner</th>
                    <th className="pb-2.5 pr-2">Logs This Month</th>
                    <th className="pb-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.practitioners.map((p) => (
                    <tr key={p.id} className="border-b border-slate-50 last:border-b-0">
                      <td className="py-3 pr-2">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-teal-100 to-sky-100 text-teal-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0">{initials(p.firstName, p.lastName)}</div>
                          <span className="font-semibold text-slate-800 text-[15px]">{p.firstName} {p.lastName}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-2 text-slate-600">{p.logCount} log{p.logCount === 1 ? '' : 's'}</td>
                      <td className="py-3">
                        {p.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-teal-500" />Active</span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-slate-400" />No activity</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {summary.practitioners.length === 0 && (
                    <tr><td colSpan={3} className="py-6 text-center text-slate-400 text-sm">No practitioners on staff yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-800">Invoice History</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={handleGenerateInvoice}
                disabled={isGenerating}
                className="text-xs h-8"
              >
                {isGenerating ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
                Close &amp; Bill Last Period
              </Button>
            </div>
            {invoices.length === 0 ? (
              <div className="text-center py-8 text-sm text-slate-500">
                No invoices yet — your first monthly invoice will appear here once a billing period closes.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200">
                      <th className="pb-2.5 pr-2">Period</th>
                      <th className="pb-2.5 pr-2">Active Practitioners</th>
                      <th className="pb-2.5 pr-2">Amount</th>
                      <th className="pb-2.5 pr-2">Status</th>
                      <th className="pb-2.5">PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-slate-50 last:border-b-0">
                        <td className="py-3 pr-2 text-slate-800 font-medium">{formatPeriod(inv.period_start, inv.period_end)}</td>
                        <td className="py-3 pr-2 text-slate-600">{inv.active_practitioner_count}</td>
                        <td className="py-3 pr-2 font-bold text-slate-900 text-[15px]">{money(inv.total_amount)}</td>
                        <td className="py-3 pr-2">
                          <span className={`text-xs font-bold border px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[inv.status] || STATUS_STYLES.pending}`}>{inv.status}</span>
                        </td>
                        <td className="py-3 text-left">
                          <button
                            type="button"
                            onClick={() => handleDownloadInvoicePdf(inv)}
                            disabled={downloadingId === inv.id}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-sky-600 hover:text-sky-700 disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} PDF
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: next charge + payment method */}
        <div className="space-y-5">
          <div className="rounded-2xl p-6 text-white bg-gradient-to-br from-slate-800 to-slate-950">
            <div className="text-xs font-bold uppercase tracking-wide text-teal-400 mb-2">Next Invoice</div>
            <div className="text-2xl font-bold mb-1.5 tracking-tight">{formatDate(summary.nextBillingDate)}</div>
            <div className="text-sm text-white/70">Your next invoice will be generated and, if a payment method is on file, charged automatically on this date.</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">Payment Method</h3>

            {!config?.stripeConfigured && (
              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3 mb-4 leading-relaxed">
                Stripe isn't connected yet. Add <code className="font-mono text-[13px] bg-amber-100 px-1 rounded">STRIPE_SECRET_KEY</code> and <code className="font-mono text-[13px] bg-amber-100 px-1 rounded">STRIPE_PUBLISHABLE_KEY</code> to the backend environment to enable card and Google Pay collection here — no other changes needed.
              </div>
            )}

            {paymentMethod && (
              <div className="flex items-center gap-3.5 p-3.5 bg-slate-50 border border-slate-200 rounded-xl mb-4">
                <div className="w-10 h-7 rounded-md bg-gradient-to-br from-slate-800 to-sky-700 flex items-center justify-center text-white text-[9px] font-bold uppercase flex-shrink-0">
                  {paymentMethod.type === 'google_pay' ? 'GPay' : (paymentMethod.brand || 'Card')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-base font-bold text-slate-800 font-mono">•••• •••• •••• {paymentMethod.last4 || '····'}</div>
                  <div className="text-sm text-slate-500 mt-0.5">{paymentMethod.exp ? `Expires ${paymentMethod.exp}` : ''}</div>
                </div>
                <span className="text-xs font-bold text-teal-700 bg-teal-100 px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Default</span>
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setPmTab('card')}
                className={`flex-1 text-center py-2.5 rounded-lg border text-sm font-bold transition-colors ${pmTab === 'card' ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <CreditCard className="w-4 h-4 inline mr-1.5 -mt-0.5" />Card (Stripe)
              </button>
              <button
                type="button"
                onClick={() => setPmTab('gpay')}
                className={`flex-1 text-center py-2.5 rounded-lg border text-sm font-bold transition-colors ${pmTab === 'gpay' ? 'border-teal-400 bg-teal-50 text-teal-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                Google Pay
              </button>
            </div>

            {config?.stripeConfigured && stripePromise ? (
              <Elements stripe={stripePromise}>
                {pmTab === 'card' ? (
                  <CardSetupForm onSaved={refreshPaymentMethod} setToast={setToast} />
                ) : config.googlePayReady ? (
                  <GooglePaySetupForm totalAmount={summary.totalAmount} onSaved={refreshPaymentMethod} setToast={setToast} />
                ) : (
                  <div className="text-sm text-slate-600 text-center py-6 px-4 leading-relaxed">
                    Google Pay needs a verified merchant domain in the Stripe Dashboard (set <code className="font-mono bg-slate-100 px-1 rounded text-[13px]">STRIPE_PUBLISHABLE_KEY</code> and register the domain) before it can be offered here.
                  </div>
                )}
              </Elements>
            ) : (
              <div className="opacity-50 pointer-events-none select-none">
                {pmTab === 'card' ? (
                  <>
                    <div className="mb-3">
                      <label className="block text-sm font-bold text-slate-700 mb-1.5">Card Number</label>
                      <input disabled placeholder="1234 1234 1234 1234" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" />
                    </div>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">Expiry</label>
                        <input disabled placeholder="MM / YY" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1.5">CVC</label>
                        <input disabled placeholder="CVC" className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50" />
                      </div>
                    </div>
                    <Button disabled className="w-full">Update Payment Method</Button>
                  </>
                ) : (
                  <div className="text-center py-6">
                    <div className="inline-flex items-center gap-2 bg-black text-white text-sm font-semibold px-5 py-2.5 rounded-lg">Pay with Google Pay</div>
                    <p className="text-sm text-slate-500 mt-3 px-4 leading-relaxed">You'll confirm your card through Google Pay once it's connected. Izaya never stores your card number directly.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
