import { DEFAULT_CARD_LAYOUT, resolveCardLayout } from '@/components/dashboardLayout';
import React, { useState, useEffect, useRef } from 'react';
import api from '@/api/axiosInstance';
import {
  Tag, Activity, AlertTriangle, CalendarClock, TrendingUp, TrendingDown,
  CalendarRange, Calendar, X, Check, MessageCircle, GripVertical,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMessaging } from '@/context/useMessaging';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compactMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Age in whole days since a timestamp, for the action queue's "waiting
// since" tag — computed client-side from flaggedAt/serviceDate rather
// than adding another backend field for something this cheap.
// "2026-10" -> "October 2026"
function monthLabel(monthValue) {
  const [y, m] = String(monthValue || '').split('-').map(Number);
  if (!y || !m) return 'this month';
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

// Explicit year + month dropdowns (rather than a bare native
// <input type="month">) for the top stat row's "viewing" control — lets a
// CEO jump straight to any month/year combo, not just scrub one at a time.
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function MonthYearPicker({ value, onChange }) {
  const [yearStr, monthStr] = (value || '').split('-');
  const year = parseInt(yearStr, 10) || new Date().getFullYear();
  const month = parseInt(monthStr, 10) || new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - i);

  const setMonth = (m) => onChange(`${year}-${String(m).padStart(2, '0')}`);
  const setYear = (y) => onChange(`${y}-${String(month).padStart(2, '0')}`);

  return (
    <div className="flex items-center gap-2">
      <select
        value={month}
        onChange={(e) => setMonth(Number(e.target.value))}
        className="border border-slate-200 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-slate-700 bg-white cursor-pointer"
      >
        {MONTH_NAMES.map((name, i) => (
          <option key={name} value={i + 1}>{name}</option>
        ))}
      </select>
      <select
        value={year}
        onChange={(e) => setYear(Number(e.target.value))}
        className="border border-slate-200 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-slate-700 bg-white cursor-pointer"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

// Inline detail dialog for a flagged/returned session, opened by clicking a
// row in ActionQueue or ReturnedLogsPanel. Fetches the same field-by-field
// "our log" vs "EIMS record" comparison the Billing & Invoices Compliance
// Analysis tab renders (GET /api/dashboard/session-detail reuses
// computeSessionCompliance directly), so a CEO can see exactly what
// mismatched without leaving the Overview dashboard.
function SessionDetailDialog({ assessmentId, onClose }) {
  const { openThread } = useMessaging();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!assessmentId) return;
    setLoading(true);
    setError(null);
    api.get('/api/dashboard/session-detail', { params: { assessmentId } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load session detail.'))
      .finally(() => setLoading(false));
  }, [assessmentId]);

  const session = data?.session;
  const compliance = data?.compliance;
  const fields = compliance?.fields || [];

  const statusLabel = session?.status === 'on_hold' ? 'On hold'
    : session?.status === 'rejected' ? 'Returned'
    : session?.status === 'declined' ? 'Declined'
    : session?.status || '';

  return (
    <Dialog open={!!assessmentId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl bg-white max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {session ? `${session.patientName} · ${session.practitionerName}` : 'Session detail'}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="text-sm text-slate-400 text-center py-10">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                <span className="font-bold uppercase px-2 py-1 rounded-full bg-amber-50 text-amber-700">{statusLabel}</span>
                <span className="text-slate-500">Service date {session?.serviceDate}</span>
                {session?.rejectionCount > 1 && <span className="text-slate-500">Sent back {session.rejectionCount}x</span>}
              </div>
              {session?.practitionerId && (
                <button
                  type="button"
                  onClick={() => { openThread(session.practitionerId); onClose(); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors rounded-lg px-2.5 py-1.5 cursor-pointer flex-shrink-0"
                >
                  <MessageCircle className="size-3.5" />
                  Message {session.practitionerName}
                </button>
              )}
            </div>

            {session?.note && (
              <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">Note on file</div>
                <div className="text-slate-700">{session.note}</div>
              </div>
            )}

            {!compliance?.documentOnFile ? (
              <div className="text-sm text-slate-500 text-center py-6">No compliance reference document on file to compare against.</div>
            ) : fields.length === 0 ? (
              <div className="text-sm text-slate-500 text-center py-6">Nothing to compare for this session.</div>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-[11px] font-bold uppercase text-slate-500">
                    <th className="text-left px-3 py-2 w-[28%]"></th>
                    <th className="px-3 py-2 w-[36%]"><span className="text-sky-700 bg-sky-50 rounded px-2 py-0.5">Our Log</span></th>
                    <th className="px-3 py-2 w-[36%]"><span className="text-amber-700 bg-amber-50 rounded px-2 py-0.5">EIMS Record</span></th>
                  </tr>
                </thead>
                <tbody>
                  {!compliance.matched && (
                    <tr>
                      <td className="px-3 py-2 text-center text-orange-600 text-xs font-semibold" colSpan={3}>
                        No matching record found in EIMS for this session — showing our own logged values below.
                      </td>
                    </tr>
                  )}
                  {fields.map((f) => (
                    <tr key={f.key} className={f.match === false ? 'bg-red-50/60' : ''}>
                      <td className="px-3 py-2 font-semibold text-slate-700 align-top">
                        <div className="flex items-center gap-1.5">
                          {f.match === false ? <X className="size-3.5 text-red-500 flex-shrink-0" /> : f.match === true ? <Check className="size-3.5 text-emerald-500 flex-shrink-0" /> : null}
                          {f.label}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-800 align-top break-words">{f.ours ?? '—'}</td>
                      <td className={`px-3 py-2 align-top break-words ${f.match === false ? 'text-red-700 font-semibold' : 'text-slate-800'}`}>{f.state ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Leadership-visible scorecard: who's consistently submitting clean,
// EIMS-matching session logs vs. who's generating mismatches/holds/
// returns, for the selected month. Sorted worst-first by the backend
// (practitionerAccuracy) so the practitioners most worth a conversation
// surface at the top without the viewer having to sort for it. Excludes
// independent practitioners — their "match" is self-reported, not a real
// cross-reference, so mixing them in would compare two different things.
function PractitionerAccuracyTable({ month }) {
  const rows = month?.practitionerAccuracy || [];
  const [sortBy, setSortBy] = useState('accuracyPct'); // 'accuracyPct' | 'sessionsChecked' | 'heldOrReturned'
  const [sortDir, setSortDir] = useState('asc');

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortBy] ?? (sortBy === 'accuracyPct' ? 101 : 0);
    const bv = b[sortBy] ?? (sortBy === 'accuracyPct' ? 101 : 0);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir(key === 'accuracyPct' ? 'asc' : 'desc'); }
  };

  const tierTone = (pct) => {
    if (pct == null) return { text: 'text-slate-500', bg: 'bg-slate-50', bar: '#cbd5e1' };
    if (pct >= 90) return { text: 'text-teal-700', bg: 'bg-teal-50', bar: '#0d9488' };
    if (pct >= 70) return { text: 'text-amber-700', bg: 'bg-amber-50', bar: '#d97706' };
    return { text: 'text-rose-700', bg: 'bg-rose-50', bar: '#e11d48' };
  };

  const SortHeader = ({ label, sortKey, className }) => (
    <th className={`text-[14px] font-bold uppercase text-slate-600 px-3 py-2.5 cursor-pointer select-none ${className || ''}`} onClick={() => toggleSort(sortKey)}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sortBy === sortKey && <span className="text-[13px]">{sortDir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Practitioner accuracy</div>
        <p className="text-[14px] text-slate-600 mt-0.5 max-w-2xl">
          How cleanly each practitioner's logged sessions matched EIMS this month — holds, returns, and still-pending sessions already flagged by Compliance Analysis all count against the score. Independent practitioners (self-reported, not cross-checked) aren't included.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="text-[15px] text-slate-500 text-center py-10">No agency practitioner sessions checked against EIMS this month yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left text-[14px] font-bold uppercase text-slate-600 px-5 py-2.5">Practitioner</th>
                <SortHeader label="Accuracy" sortKey="accuracyPct" />
                <SortHeader label="Checked" sortKey="sessionsChecked" />
                <SortHeader label="Held / Returned" sortKey="heldOrReturned" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const tone = tierTone(r.accuracyPct);
                return (
                  <tr key={r.practitionerId} className="hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <div className="text-[17px] font-bold text-slate-900">{r.name}</div>
                      {r.discipline && <div className="text-[13px] text-slate-600">{r.discipline}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-24 h-2.5 rounded-full bg-slate-100 overflow-hidden flex-shrink-0">
                          <div className="h-full rounded-full" style={{ width: `${r.accuracyPct ?? 0}%`, background: tone.bar }} />
                        </div>
                        <span className={`text-[15px] font-extrabold px-3 py-1 rounded-full ${tone.bg} ${tone.text}`}>
                          {r.accuracyPct != null ? `${r.accuracyPct}%` : '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-[17px] font-semibold text-slate-700 font-mono tabular-nums">{r.sessionsChecked}</td>
                    <td className="px-3 py-3 text-[17px] font-semibold text-slate-700 font-mono tabular-nums">{r.heldOrReturned}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Verdict banner: a plain-language judgment, not a stat tile, with
// the supporting numbers underneath it rather than standing alone. ---
function VerdictBanner({ day, ap }) {
  if (!day || !ap) {
    return (
      <section className="rounded-[24px] p-7 sm:p-8 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
        <div className="text-[15px] text-white/80">Loading today's picture...</div>
      </section>
    );
  }

  const flaggedCount = day.flaggedCount || 0;
  const totalOwed = ap.totalOwed || 0;
  const totalHeld = ap.totalHeld || 0;
  const heldPct = totalOwed > 0 ? Math.round((totalHeld / totalOwed) * 100) : 0;
  const clearPct = 100 - heldPct;

  const isHealthy = flaggedCount === 0 && totalHeld === 0;
  const headline = isHealthy
    ? 'Billing is healthy. Nothing is waiting on you today.'
    : flaggedCount > 0 && totalHeld === 0
      ? `Billing is healthy. ${flaggedCount} session${flaggedCount === 1 ? ' is' : 's are'} stuck and need${flaggedCount === 1 ? 's' : ''} a decision.`
      : `${flaggedCount > 0 ? `${flaggedCount} sessions need a decision and ` : ''}${compactMoney(totalHeld)} is being held pending verification.`;

  return (
    <section className="rounded-[24px] p-7 sm:p-8 text-white shadow-sm flex flex-col min-w-0" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
      <div>
        <div className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.14em] mb-3" style={{ color: '#fcd34d' }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fcd34d' }} />
          {isHealthy ? 'All clear' : 'Needs a look today'}
        </div>
        <h1 className="text-[26px] sm:text-[34px] font-extrabold leading-[1.12] tracking-tight mb-4" style={{ textWrap: 'balance' }}>{headline}</h1>
        <p className="text-[16px] sm:text-[18px] leading-relaxed max-w-2xl" style={{ color: 'rgba(253,253,255,0.9)' }}>
          <b className="text-white font-extrabold">{money(totalOwed)}</b> is owed to practitioners.
          {flaggedCount > 0 && <> The open item is <b className="text-white font-extrabold">{flaggedCount} flagged session{flaggedCount === 1 ? '' : 's'}</b>.</>}
        </p>
      </div>
      {totalOwed > 0 && (
        <div className="mt-auto pt-8">
          <div className="flex items-end justify-between text-[15px] font-semibold mb-2">
            <span className="text-white/80">Cleared to pay</span>
            <span className="text-[28px] leading-none font-extrabold font-mono tabular-nums">{clearPct}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${clearPct}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

function StatCard({ icon: Icon, tone, label, value, deltaText, deltaTone }) {
  const toneBg = {
    teal: 'bg-teal-50 text-teal-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
    rose: 'bg-rose-50 text-rose-600',
  };
  const deltaClasses = {
    up: 'text-teal-700',
    down: 'text-rose-700',
    flat: 'text-slate-500',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0 relative">
      <div className={`absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center ${toneBg[tone]}`}>
        <Icon className="size-5" />
      </div>
      <div className="text-[16px] font-semibold text-slate-600 mb-2 pr-12">{label}</div>
      <div className="text-[34px] leading-none font-extrabold tracking-tight mb-3 font-mono tabular-nums">{value}</div>
      <div className={`inline-flex items-center gap-1 text-[15px] font-bold ${deltaClasses[deltaTone || 'flat']}`}>{deltaText}</div>
    </div>
  );
}

function ActionQueue({ day, onSelectSession }) {
  const sessions = day?.flaggedSessions || [];
  const total = day?.flaggedCount || 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">What needs you</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full">{total} open</div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-[15px] text-slate-500 text-center py-8">No open holds or returns this month. Nice.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
          {sessions.map((s) => {
            const age = daysAgo(s.flaggedAt || s.serviceDate);
            const isCritical = age !== null && age > 30;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSession(s.id)}
                className="w-full flex items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl px-4 py-3 min-w-0 text-left cursor-pointer"
              >
                <div className={`w-[3px] self-stretch rounded-sm flex-shrink-0 ${isCritical ? 'bg-rose-600' : 'bg-amber-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-semibold text-slate-900 truncate">
                    {s.patientName} &middot; {s.practitionerName}
                  </div>
                  <div className="text-[14px] text-slate-600 truncate">
                    {s.note || 'On hold, no note on file'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[18px] font-extrabold text-slate-900 font-mono tabular-nums">{money(s.amount)}</span>
                  {age !== null && (
                    <span className={`text-[13px] font-extrabold px-2.5 py-1 rounded-full ${isCritical ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                      {age}d
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// The four funnel stages and their bars. Shared by the monthly "Billing
// pipeline" card and the all-time panel beside the banner, so both always read
// the same way. Bars are scaled to Logged, which is the largest stage.
function FunnelRows({ pipeline }) {
  const { logged, reviewed, invoiced, paid } = pipeline;
  const held = (pipeline.exceptions?.on_hold || 0) + (pipeline.exceptions?.rejected || 0);

  const stages = [
    { label: 'Logged', value: logged },
    { label: 'Reviewed', value: reviewed, sub: held > 0 ? `${held.toLocaleString()} held back` : null },
    { label: 'Invoiced', value: invoiced },
    { label: 'Paid', value: paid },
  ];
  const max = Math.max(logged, 1);

  return stages.map((s) => (
    <div key={s.label} className="flex items-center gap-4 mb-4 last:mb-0">
      <div className="w-[116px] flex-shrink-0">
        <div className="text-[16px] font-bold text-slate-700">{s.label}</div>
        {s.sub && <div className="text-[13px] font-bold text-rose-700 mt-0.5">{s.sub}</div>}
      </div>
      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-teal-500"
          style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 2 : 0)}%` }}
        />
      </div>
      <div className="w-16 flex-shrink-0 text-right text-[20px] font-extrabold text-slate-900 font-mono tabular-nums">{s.value.toLocaleString()}</div>
    </div>
  ));
}

function BillingFunnel({ pipeline }) {
  if (!pipeline) return null;
  const { logged, invoiced, paid } = pipeline;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Billing pipeline</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0">{logged.toLocaleString()} total</div>
      </div>
      <FunnelRows pipeline={pipeline} />
      <div className="text-[14px] text-slate-500 mt-3.5 pt-3 border-t border-dashed border-slate-200">
        {paid === 0
          ? "Nothing from this month has been marked paid yet."
          : `${Math.round((paid / Math.max(invoiced, 1)) * 100)}% of invoiced sessions are confirmed paid.`}
      </div>
    </div>
  );
}

// The overall picture, every month combined, beside the verdict banner. The
// cards below follow the month picker; this one deliberately never does, so
// the month-by-month view always has the whole history to be read against.
function AllTimeStatus({ pipeline }) {
  const shell = 'rounded-[24px] bg-white border border-slate-200 shadow-sm p-6 min-w-0 flex flex-col';
  if (!pipeline) {
    return (
      <section className={shell}>
        <div className="text-[15px] text-slate-500">Loading all months...</div>
      </section>
    );
  }
  const { logged, paid, invoiced } = pipeline;
  const ex = pipeline.exceptions || {};
  const rate = pipeline.eimsMatchRate;
  const eimsTotal = rate ? rate.matched + rate.flagged + rate.missing + rate.unverified : 0;
  const eimsPct = eimsTotal > 0 ? Math.round((rate.matched / eimsTotal) * 100) : null;
  const facts = [
    { label: 'On hold', value: (ex.on_hold || 0).toLocaleString(), tone: (ex.on_hold || 0) > 0 ? 'text-amber-700' : 'text-slate-900' },
    { label: 'Returned', value: (ex.rejected || 0).toLocaleString(), tone: (ex.rejected || 0) > 0 ? 'text-rose-700' : 'text-slate-900' },
    { label: 'Declined', value: (ex.declined || 0).toLocaleString(), tone: (ex.declined || 0) > 0 ? 'text-rose-700' : 'text-slate-900' },
    { label: 'EIMS match', value: eimsPct === null ? '—' : `${eimsPct}%`, tone: 'text-teal-700' },
  ];

  return (
    <section className={shell}>
      <div className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-teal-700 mb-1">All months combined</div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Status of every log</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0">{logged.toLocaleString()} total</div>
      </div>
      <p className="text-[15px] text-slate-600 mb-3">Every session ever logged, across all months.</p>
      <FunnelRows pipeline={pipeline} />
      <div className="grid grid-cols-4 gap-2 mt-3 pt-4 border-t border-dashed border-slate-200">
        {facts.map((f) => (
          <div key={f.label} className="rounded-xl bg-slate-50 px-3 py-2 min-w-0">
            <div className={`text-[20px] leading-none font-extrabold font-mono tabular-nums ${f.tone}`}>{f.value}</div>
            <div className="text-[13px] font-semibold text-slate-600 mt-1 truncate">{f.label}</div>
          </div>
        ))}
      </div>
      <div className="text-[13px] text-slate-500 mt-3">
        {paid === 0
          ? 'Nothing has been marked paid yet.'
          : `${Math.round((paid / Math.max(invoiced, 1)) * 100)}% of all invoiced sessions are confirmed paid.`}
      </div>
    </section>
  );
}

function EimsDonut({ pipeline }) {
  const rate = pipeline?.eimsMatchRate;
  if (!rate) return null;
  const total = rate.matched + rate.flagged + rate.missing + rate.unverified;
  // No billed sessions in the month: the same ring and legend, grayed out, so
  // the card keeps its shape instead of collapsing to a sentence.
  const empty = total === 0;

  const matchedPct = empty ? null : Math.round((rate.matched / total) * 100);
  const C = 2 * Math.PI * 46;
  const seg = (count) => (empty ? 0 : (count / total) * C);
  const matchedLen = seg(rate.matched);
  const flaggedLen = seg(rate.flagged);
  const missingLen = seg(rate.missing + rate.unverified);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col items-center">
      <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 self-start mb-4">EIMS match status</div>
      <svg viewBox="0 0 120 120" width="200" height="200">
        <circle cx="60" cy="60" r="46" fill="none" stroke={empty ? '#e2e8f0' : '#f6f7fb'} strokeWidth="16" />
        {/* A segment is drawn only when it has sessions: a zero-length stroke
            with a round cap still paints a dot, which showed as a red blip at
            the top of the ring when Missing was 0. Flat ends so a small segment
            never overlaps its neighbor. */}
        {rate.matched > 0 && (
          <circle cx="60" cy="60" r="46" fill="none" stroke="#0d9488" strokeWidth="16"
            strokeDasharray={`${matchedLen} ${C - matchedLen}`} strokeDashoffset="0" transform="rotate(-90 60 60)" />
        )}
        {rate.flagged > 0 && (
          <circle cx="60" cy="60" r="46" fill="none" stroke="#d97706" strokeWidth="16"
            strokeDasharray={`${flaggedLen} ${C - flaggedLen}`} strokeDashoffset={-matchedLen} transform="rotate(-90 60 60)" />
        )}
        {rate.missing + rate.unverified > 0 && (
          <circle cx="60" cy="60" r="46" fill="none" stroke="#e11d48" strokeWidth="16"
            strokeDasharray={`${missingLen} ${C - missingLen}`} strokeDashoffset={-(matchedLen + flaggedLen)} transform="rotate(-90 60 60)" />
        )}
        <text x="60" y="56" textAnchor="middle" fontSize="27" fontWeight="800" fill={empty ? '#94a3b8' : '#0f172a'}>{empty ? '—' : `${matchedPct}%`}</text>
        <text x="60" y="73" textAnchor="middle" fontSize="10" fontWeight="600" fill={empty ? '#64748b' : '#475569'}>{empty ? 'no sessions' : 'matched'}</text>
      </svg>
      <div className={`flex flex-col gap-2 mt-4 w-full ${empty ? 'opacity-50' : ''}`}>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#0d9488' }} />Matched</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{rate.matched.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#d97706' }} />Mismatch / pending</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{rate.flagged.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#e11d48' }} />Missing / unverified</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{(rate.missing + rate.unverified).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

const SERVICES_DIMENSIONS = [
  { key: 'byServiceType', label: 'Service type' },
  { key: 'byStatus', label: 'Status' },
  { key: 'byLocation', label: 'Location' },
  { key: 'byDiscipline', label: 'Discipline' },
];
const SERVICES_COLORS = ['#0d9488', '#2563eb', '#d97706', '#e11d48', '#7c3aed', '#64748b', '#94a3b8'];

function ServicesBreakdown({ data }) {
  const [dimension, setDimension] = useState('byServiceType');
  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 mb-4">Services provided</div>
        <div className="text-[15px] text-slate-500 text-center py-8">Loading…</div>
      </div>
    );
  }

  const rows = data[dimension] || [];
  const total = rows.reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Services provided</div>
      </div>
      <p className="text-[14px] text-slate-600 mb-4">This month, by category</p>

      <div className="inline-flex bg-slate-50 rounded-[10px] p-[3px] gap-0.5 mb-4 flex-wrap">
        {SERVICES_DIMENSIONS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setDimension(d.key)}
            className={`px-4 py-2 rounded-lg text-[15px] font-bold transition-colors cursor-pointer ${
              dimension === d.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="text-[15px] text-slate-500 text-center py-8">No sessions logged this month yet.</div>
      ) : (
        <>
          <div className="w-full h-3.5 rounded-full overflow-hidden flex mb-5">
            {rows.map((r, i) => (
              <div
                key={r.key ?? 'null'}
                style={{ width: `${total > 0 ? (r.count / total) * 100 : 0}%`, background: SERVICES_COLORS[i % SERVICES_COLORS.length] }}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {rows.map((r, i) => (
              <div key={r.key ?? 'null'} className="flex items-center justify-between text-[16px]">
                <div className="flex items-center gap-2 text-slate-700 font-semibold min-w-0">
                  <span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: SERVICES_COLORS[i % SERVICES_COLORS.length] }} />
                  <span className="truncate">{r.label}</span>
                </div>
                <span className="font-mono font-extrabold text-[18px] text-slate-900 flex-shrink-0">{r.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const DOC_STATUS_TONE = {
  matched: { bg: 'bg-teal-50', text: 'text-teal-700', label: 'Matched' },
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending' },
  mismatch: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Mismatch' },
};

function DocumentsFeed({ documents }) {
  if (!documents) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 mb-4">Invoices &amp; SEVF forms</div>
        <div className="text-[15px] text-slate-500 text-center py-8">Loading…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">Invoices &amp; SEVF forms</div>
      <p className="text-[14px] text-slate-600 mb-4">Covering this month's sessions</p>
      {documents.length === 0 ? (
        <div className="text-[15px] text-slate-500 text-center py-8">No invoices or SEVF forms for this month.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
          {documents.map((d) => {
            const tone = DOC_STATUS_TONE[d.status] || DOC_STATUS_TONE.pending;
            return (
              <div key={d.batchId} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3 min-w-0">
                <div className="flex-1 min-w-0">
                  <div className="text-[16px] font-semibold text-slate-900 truncate">
                    {d.documentNumber} &middot; {d.documentType === 'sevf' ? 'SEVF' : 'Invoice'}
                  </div>
                  <div className="text-[14px] text-slate-600 truncate">
                    {d.practitionerName} &middot; {d.sessionCount} session{d.sessionCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[18px] font-extrabold text-slate-900 font-mono tabular-nums">{money(d.amount)}</span>
                  <span className={`text-[13px] font-extrabold px-2.5 py-1 rounded-full ${tone.bg} ${tone.text}`}>{tone.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TrajectoryTabs({ active, onChange }) {
  const tabs = [
    { key: 'month', label: 'Month', icon: CalendarRange },
    { key: 'year', label: 'Year', icon: Calendar },
  ];
  return (
    <div className="inline-flex bg-slate-50 rounded-[10px] p-[3px] gap-0.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[15px] font-bold transition-colors cursor-pointer ${
            active === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          <t.icon className="size-3.5" /> {t.label}
        </button>
      ))}
    </div>
  );
}

// Replaces the old "sessions today" sparkline tile — that duplicated
// ActionQueue's holds/returns summary without adding detail. This shows
// every returned/declined log (all-time), scrollable, each with its
// status and full comment thread so a CEO can see exactly why a log
// bounced back to a practitioner without leaving the dashboard.
function ReturnedLogsPanel({ returnedLogs, onSelectSession }) {
  const logs = returnedLogs?.logs || [];
  const count = returnedLogs?.count || 0;
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Returned logs</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0">{count} total</div>
      </div>
      <div className="text-[14px] text-slate-500 mb-3">Sessions from this month that billing sent back, oldest first.</div>

      {logs.length === 0 ? (
        <div className="text-[15px] text-slate-500 text-center py-8">No returned or declined logs this month. Nice.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
          {logs.map((log) => {
            const age = daysAgo(log.rejectedAt || log.serviceDate);
            const isDeclined = log.status === 'declined';
            const isOpen = expandedId === log.id;
            return (
              <div key={log.id} className="bg-slate-50 rounded-xl overflow-hidden min-w-0">
                <div className="w-full min-w-0 flex items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : log.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className={`w-[3px] self-stretch rounded-sm flex-shrink-0 ${isDeclined ? 'bg-rose-600' : 'bg-amber-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[16px] font-semibold text-slate-900 truncate">
                        {log.patientName} &middot; {log.practitionerName}
                      </div>
                      <div className="text-[14px] text-slate-600 truncate">
                        {isDeclined ? 'Declined' : 'Returned'}{log.rejectionCount > 1 ? ` &middot; sent back ${log.rejectionCount}x` : ''}
                        {log.note ? ` — ${log.note}` : ''}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSession(log.id)}
                    className="text-[13px] font-semibold text-slate-600 hover:text-slate-800 underline flex-shrink-0 cursor-pointer"
                  >
                    Details
                  </button>
                  {age !== null && (
                    <span className={`text-[13px] font-extrabold px-2.5 py-1 rounded-full flex-shrink-0 ${isDeclined ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                      {age}d
                    </span>
                  )}
                </div>
                {isOpen && log.comments.length > 0 && (
                  <div className="border-t border-slate-200 bg-white px-3.5 py-3 space-y-2.5">
                    {log.comments.map((c, i) => (
                      <div key={i} className="text-[14px]">
                        <div className="font-semibold text-slate-700 mb-0.5 capitalize">{c.authorRole || 'Staff'}</div>
                        <div className="text-slate-600">{c.note}</div>
                        <div className="text-[13px] text-slate-500 mt-0.5">{new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonthTrajectory({ month, onMonthChange, monthValue }) {
  if (!month) return null;
  return (
    <div className="space-y-4">
      <input
        type="month"
        value={monthValue}
        onChange={(e) => onMonthChange(e.target.value)}
        className="border border-slate-200 rounded-lg px-3 py-2 text-[15px] font-semibold text-slate-700"
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center gap-6 flex-wrap mb-4">
          <div>
            <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono">{month.volumeVsPriorMonth.current.toLocaleString()}</div>
            <div className={`text-[14px] font-semibold mt-1 ${month.volumeVsPriorMonth.pctChange >= 0 ? 'text-teal-700' : 'text-rose-700'}`}>
              {month.volumeVsPriorMonth.pctChange !== null ? (
                <span className="inline-flex items-center gap-1">
                  {month.volumeVsPriorMonth.pctChange >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {Math.abs(month.volumeVsPriorMonth.pctChange)}% vs prior month
                </span>
              ) : 'No prior month to compare'}
            </div>
          </div>
          <div>
            <div className="text-[14px] text-slate-600">Children seen</div>
            <div className="text-[26px] font-extrabold font-mono">{month.patientRosterCount}</div>
          </div>
        </div>
        {(() => {
          // Two bars, not a daily trend: this month's total so far vs. last
          // month's total — the comparison the stat line above already
          // states in words, shown as a simple colorful bar pair instead
          // of a 30-point daily series.
          const priorDate = new Date(month.year, month.month - 2, 1);
          const priorLabel = priorDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          const currentLabel = new Date(month.year, month.month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
          const data = [
            { label: priorLabel, count: month.volumeVsPriorMonth.prior, fill: '#818cf8' },
            { label: currentLabel, count: month.volumeVsPriorMonth.current, fill: '#2dd4bf' },
          ];
          return (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 14, fill: '#475569', fontWeight: 700 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 13, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: '#f6f7fb' }} formatter={(v) => [v.toLocaleString(), 'Sessions']} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={90}>
                    {data.map((d, i) => (
                      <Cell key={`cell-${i}`} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function YearTrajectory() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    api.get('/api/dashboard/year', { params: { year } })
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setIsLoading(false));
  }, [year]);

  return (
    <div className="space-y-4">
      <input
        type="number"
        value={year}
        onChange={(e) => setYear(parseInt(e.target.value, 10) || new Date().getFullYear())}
        className="border border-slate-200 rounded-lg px-3 py-2 text-[15px] font-semibold text-slate-700 w-28"
      />
      {isLoading || !data ? (
        <div className="text-[15px] text-slate-500 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center gap-6 flex-wrap mb-4">
            <div>
              <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono">{data.yoyComparison.current.count.toLocaleString()}</div>
              <div className={`text-[14px] font-semibold mt-1 ${data.yoyComparison.pctChange >= 0 ? 'text-teal-700' : 'text-rose-700'}`}>
                {data.yoyComparison.pctChange !== null ? `${Math.abs(data.yoyComparison.pctChange)}% YoY` : 'No prior year to compare'}
              </div>
            </div>
            <div>
              <div className="text-[14px] text-slate-600">Est. billable this year</div>
              <div className="text-[26px] font-extrabold font-mono">{compactMoney(data.yoyComparison.current.estBillable)}</div>
            </div>
            <div>
              <div className="text-[14px] text-slate-600">Active practitioners</div>
              <div className="text-[26px] font-extrabold font-mono">{data.practitionerRoster.activeNow}</div>
            </div>
          </div>
          {data.monthlyVolume.length > 0 && (
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.monthlyVolume}>
                  <defs>
                    <linearGradient id="yearArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0d9488" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0d9488" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e8f0" />
                  <XAxis dataKey="month" tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })} tick={{ fontSize: 13, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 13, fill: '#64748b', fontWeight: 600 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} />
                  <Area type="monotone" dataKey="count" stroke="#0d9488" strokeWidth={2.5} fill="url(#yearArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="text-[14px] text-slate-500 mt-2.5">
            {data.fullYearCompliance.coverageRate !== null
              ? `${data.fullYearCompliance.coverageRate}% of this year's billed sessions have a matching state record on file.`
              : 'Not enough billed sessions this year to compute coverage.'}
          </div>
        </div>
      )}
    </div>
  );
}

// Returns [cardLayout, reorderLocally, persistLayout] — split so a drag's
// continuous dragover events can move cards on screen without firing a PUT
// per event (which, on a short card dragged over a taller one, oscillates
// back and forth as the cursor crosses the swapped boundary, firing a
// stream of PUTs that can resolve out of order and persist a mid-drag
// layout). Only drop/dragend calls persistLayout. cardLayout is an array
// of {key, width} in display order — width lives in the saved state, not
// inferred, so a resize survives independently of any later reorder.
function useDashboardLayout() {
  const [cardLayout, setCardLayout] = useState(DEFAULT_CARD_LAYOUT);
  useEffect(() => {
    api.get('/api/dashboard/layout')
      // Nothing saved, an unusable layout, or the old all-full-width default
      // (never a deliberate choice) all resolve to the designed default.
      .then((res) => setCardLayout(resolveCardLayout(res.data.cardLayout)))
      .catch(() => {});
  }, []);

  const persistLayout = (newLayout) => {
    api.put('/api/dashboard/layout', { cardLayout: newLayout }).catch((err) => console.error('Failed to save dashboard layout:', err));
  };

  return [cardLayout, setCardLayout, persistLayout];
}

function CustomizeToggle({ active, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 text-[14px] font-semibold px-3 py-1.5 rounded-lg border transition-colors cursor-pointer ${
        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {active ? 'Done' : 'Customize'}
    </button>
  );
}

// Each card's wrapper controls its own flex-basis (full vs. half width) so
// two half-width cards wrap onto the same row — plain flex-wrap rather
// than a fixed-column grid, since a grid can't let some rows have one
// full-width item and others have two half-width items without naming
// explicit row/column spans per card.
function DraggableCard({ cardKey, width, isCustomizing, onDragStart, onDragOver, onDrop, onToggleWidth, children }) {
  return (
    <div
      draggable={isCustomizing}
      onDragStart={isCustomizing ? (e) => onDragStart(e, cardKey) : undefined}
      onDragOver={isCustomizing ? (e) => { e.preventDefault(); onDragOver(e, cardKey); } : undefined}
      onDrop={isCustomizing ? (e) => onDrop(e, cardKey) : undefined}
      onDragEnd={isCustomizing ? onDrop : undefined}
      className={`relative w-full ${width === 'half' ? '@4xl:w-[calc(50%-0.75rem)] [&>div:last-child]:h-full [&>div:last-child]:flex [&>div:last-child]:flex-col [&>div:last-child>:last-child]:flex-1' : ''} ${isCustomizing ? 'outline outline-2 outline-dashed outline-slate-300 outline-offset-2 rounded-2xl cursor-grab active:cursor-grabbing' : ''}`}
    >
      {isCustomizing && (
        <div className="absolute -top-3 right-3 flex items-center gap-1 z-10">
          <button
            type="button"
            onClick={() => onToggleWidth(cardKey)}
            className="bg-slate-900 text-white text-[13px] font-bold px-2 py-1 rounded-full cursor-pointer hover:bg-slate-700"
            title={width === 'half' ? 'Make full width' : 'Make half width'}
          >
            {width === 'half' ? 'Half' : 'Full'}
          </button>
          <div className="bg-slate-900 text-white rounded-full p-1">
            <GripVertical className="size-3" />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function CompanyDashboard() {
  const [day, setDay] = useState(null);
  const [ap, setAp] = useState(null);
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [month, setMonth] = useState(null);
  const [trajectoryTab, setTrajectoryTab] = useState('month');
  // Everything below the stat row follows the month picker, so the cards agree
  // with each other and with the stat row: the sessions whose service date is
  // in the selected month. Only the verdict banner (day / ap) above the picker
  // stays an all-time, today's-picture view.
  const [pipeline, setPipeline] = useState(null);
  const [allTime, setAllTime] = useState(null); // every month combined; never follows the picker
  const [returnedLogs, setReturnedLogs] = useState(null);
  const [monthDay, setMonthDay] = useState(null); // the "What needs you" list for the selected month
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [services, setServices] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [cardLayout, setCardLayout, persistCardLayout] = useDashboardLayout();
  const [isCustomizing, setIsCustomizing] = useState(false);
  const dragKeyRef = useRef(null);

  useEffect(() => {
    api.get('/api/dashboard/day').then((res) => setDay(res.data)).catch(() => setDay(null));
    api.get('/api/dashboard/ap').then((res) => setAp(res.data)).catch(() => setAp(null));
    // No month param = all history combined.
    api.get('/api/dashboard/pipeline').then((res) => setAllTime(res.data)).catch(() => setAllTime(null));
  }, []);

  // One fetch per card for the selected month. `stale` drops a response that
  // arrives after the picker has moved on, so flipping months quickly can
  // never leave one card showing a different month from the rest.
  useEffect(() => {
    let stale = false;
    const params = { month: monthValue };
    const load = (url, onOk, onFail) => api.get(url, { params })
      .then((res) => { if (!stale) onOk(res.data); })
      .catch(() => { if (!stale) onFail(); });
    load('/api/dashboard/month', setMonth, () => setMonth(null));
    load('/api/dashboard/services', setServices, () => setServices(null));
    load('/api/dashboard/pipeline', setPipeline, () => setPipeline(null));
    load('/api/dashboard/day', setMonthDay, () => setMonthDay(null));
    load('/api/dashboard/returned-logs', setReturnedLogs, () => setReturnedLogs(null));
    load('/api/dashboard/documents', (d) => setDocuments(d.documents), () => setDocuments([]));
    return () => { stale = true; };
  }, [monthValue]);

  const handleDragStart = (e, key) => { dragKeyRef.current = key; };
  const handleDragOver = (e, overKey) => {
    const draggedKey = dragKeyRef.current;
    if (!draggedKey || draggedKey === overKey) return;
    const current = [...cardLayout];
    const fromIdx = current.findIndex((c) => c.key === draggedKey);
    const toIdx = current.findIndex((c) => c.key === overKey);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = current.splice(fromIdx, 1);
    current.splice(toIdx, 0, moved);
    setCardLayout(current);
  };
  const handleDrop = () => {
    dragKeyRef.current = null;
    persistCardLayout(cardLayout);
  };
  const handleResetLayout = () => {
    setCardLayout(DEFAULT_CARD_LAYOUT);
    persistCardLayout(DEFAULT_CARD_LAYOUT);
  };
  const handleToggleWidth = (key) => {
    const next = cardLayout.map((c) => (c.key === key ? { ...c, width: c.width === 'half' ? 'full' : 'half' } : c));
    setCardLayout(next);
    persistCardLayout(next);
  };

  const cardsByKey = {
    billing_pipeline: (
      <div>
        <div className="text-[30px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">From session to payment</div>
        <p className="text-[17px] text-slate-600 mb-5 max-w-3xl">Sessions from {monthLabel(monthValue)}, by where they are in billing.</p>
        <BillingFunnel pipeline={pipeline} />
      </div>
    ),
    action_queue: (
      <div>
        <ActionQueue day={monthDay} onSelectSession={setSelectedSessionId} />
      </div>
    ),
    services_breakdown: (
      <div>
        <ServicesBreakdown data={services} />
      </div>
    ),
    documents_feed: (
      <div>
        <DocumentsFeed documents={documents} />
      </div>
    ),
    accuracy_table: (
      <div>
        <div className="text-[30px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">Who's submitting clean logs</div>
        <p className="text-[17px] text-slate-600 mb-5 max-w-3xl">Sorted lowest accuracy first, so the practitioners most worth a conversation surface at the top.</p>
        <PractitionerAccuracyTable month={month} />
      </div>
    ),
    eims_status: (
      <div>
        <div className="text-[30px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">EIMS match status</div>
        <p className="text-[17px] text-slate-600 mb-5 max-w-3xl">Sessions from {monthLabel(monthValue)}, reconciled against state records.</p>
        <EimsDonut pipeline={pipeline} />
      </div>
    ),
    returned_logs: (
      <div>
        <ReturnedLogsPanel returnedLogs={returnedLogs} onSelectSession={setSelectedSessionId} />
      </div>
    ),
    trajectory_chart: (
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="text-[30px] font-extrabold tracking-tight leading-tight text-slate-900">Where this is headed</div>
          <TrajectoryTabs active={trajectoryTab} onChange={setTrajectoryTab} />
        </div>
        <p className="text-[17px] text-slate-600 mb-5 max-w-3xl">The volume trend, and how it's reconciling against the state.</p>
        {trajectoryTab === 'month' && <MonthTrajectory month={month} monthValue={monthValue} onMonthChange={setMonthValue} />}
        {trajectoryTab === 'year' && <YearTrajectory />}
      </div>
    ),
  };

  return (
    <div className="space-y-6">
      {/* Side by side once the dashboard area is wide enough (container query,
          so an open sidebar cannot squeeze them); stacked otherwise. */}
      <div className="@container">
        <div className="grid gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <VerdictBanner day={day} ap={ap} />
          <AllTimeStatus pipeline={allTime} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[15px] font-semibold text-slate-600">Viewing</div>
          <div className="flex items-center gap-2">
            <MonthYearPicker value={monthValue} onChange={setMonthValue} />
            {isCustomizing && (
              <button
                type="button"
                onClick={handleResetLayout}
                className="text-[14px] font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Reset layout
              </button>
            )}
            <CustomizeToggle active={isCustomizing} onToggle={() => setIsCustomizing((v) => !v)} />
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <StatCard
            icon={Tag} tone="teal" label="Ready to pay"
            value={month ? money(month.ap.totalClear) : '—'}
            deltaText={month && month.ap.totalOwed > 0 ? `${Math.round((month.ap.totalClear / month.ap.totalOwed) * 100)}% cleared · ${Math.round((month.ap.totalHeld / month.ap.totalOwed) * 100)}% held` : 'Nothing owed this month'}
            deltaTone="up"
          />
          <StatCard
            icon={Activity} tone="violet" label="Sessions this month"
            value={month ? month.volumeVsPriorMonth.current.toLocaleString() : '—'}
            deltaText="across the active roster"
            deltaTone="flat"
          />
          <StatCard
            icon={AlertTriangle} tone="amber" label="Needs a decision"
            value={month ? String(month.exceptions.on_hold) : '—'}
            deltaText={month && month.exceptions.on_hold > 0 ? 'see the queue below' : 'nothing flagged'}
            deltaTone={month && month.exceptions.on_hold > 0 ? 'down' : 'flat'}
          />
          <StatCard
            icon={CalendarClock} tone="rose" label="Paid this month"
            value={month ? String(month.paidCount) : '—'}
            deltaText={month && month.paidCount === 0 ? 'nothing paid yet' : 'sessions marked paid'}
            deltaTone="flat"
          />
        </div>
      </div>

      <div className="@container">
      <div className="flex flex-wrap gap-6">
        {cardLayout.map(({ key, width }) => (
          <DraggableCard
            key={key}
            cardKey={key}
            width={width}
            isCustomizing={isCustomizing}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onToggleWidth={handleToggleWidth}
          >
            {cardsByKey[key]}
          </DraggableCard>
        ))}
      </div>
      </div>

      <SessionDetailDialog assessmentId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
    </div>
  );
}
