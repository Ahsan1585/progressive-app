import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import {
  Tag, Activity, AlertTriangle, CalendarClock, TrendingUp, TrendingDown,
  CalendarDays, CalendarRange, Calendar, X, Check,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compactMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Age in whole days since a timestamp, for the action queue's "waiting
// since" tag — computed client-side from flaggedAt/serviceDate rather
// than adding another backend field for something this cheap.
function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 86400000));
}

// Inline detail dialog for a flagged/returned session, opened by clicking a
// row in ActionQueue or ReturnedLogsPanel. Fetches the same field-by-field
// "our log" vs "EIMS record" comparison the Billing & Invoices Compliance
// Analysis tab renders (GET /api/dashboard/session-detail reuses
// computeSessionCompliance directly), so a CEO can see exactly what
// mismatched without leaving the Overview dashboard.
function SessionDetailDialog({ assessmentId, onClose }) {
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
            <div className="flex items-center gap-3 flex-wrap text-xs">
              <span className="font-bold uppercase px-2 py-1 rounded-full bg-amber-50 text-amber-700">{statusLabel}</span>
              <span className="text-slate-500">Service date {session?.serviceDate}</span>
              {session?.rejectionCount > 1 && <span className="text-slate-500">Sent back {session.rejectionCount}x</span>}
            </div>

            {session?.note && (
              <div className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
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

// --- Verdict banner: a plain-language judgment, not a stat tile, with
// the supporting numbers underneath it rather than standing alone. ---
function VerdictBanner({ day, ap }) {
  if (!day || !ap) {
    return (
      <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #4c3a8f 0%, #1e3a6e 100%)' }}>
        <div className="text-sm text-white/80">Loading today's picture...</div>
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
    <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #4c3a8f 0%, #1e3a6e 100%)' }}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: '#fcd34d' }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fcd34d' }} />
        {isHealthy ? 'All clear' : 'Needs a look today'}
      </div>
      <h1 className="text-2xl sm:text-[26px] font-bold leading-snug mb-2.5" style={{ textWrap: 'balance' }}>{headline}</h1>
      <p className="text-sm leading-relaxed max-w-2xl" style={{ color: 'rgba(253,253,255,0.86)' }}>
        <b className="text-white font-bold">{money(totalOwed)}</b> is currently owed to practitioners
        {totalOwed > 0 && ` — ${clearPct}% cleared and safe to pay, ${heldPct}% held pending verification`}.
        {flaggedCount > 0 && <> The open item is <b className="text-white font-bold">{flaggedCount} flagged session{flaggedCount === 1 ? '' : 's'}</b>.</>}
      </p>
    </section>
  );
}

function StatCard({ icon: Icon, tone, label, value, deltaText, deltaTone }) {
  const toneGradients = {
    teal: 'linear-gradient(135deg, #2dd4bf, #0d9488)',
    violet: 'linear-gradient(135deg, #a78bfa, #7c3aed)',
    amber: 'linear-gradient(135deg, #fbbf24, #d97706)',
    rose: 'linear-gradient(135deg, #fb7185, #e11d48)',
  };
  const deltaClasses = {
    up: 'text-teal-700',
    down: 'text-rose-700',
    flat: 'text-slate-400',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-[18px] pb-4 min-w-0">
      <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center mb-3.5" style={{ background: toneGradients[tone] }}>
        <Icon className="size-5 text-white" />
      </div>
      <div className="text-sm text-slate-500 mb-1.5">{label}</div>
      <div className="text-[25px] font-bold tracking-tight mb-2 font-mono tabular-nums">{value}</div>
      <div className={`inline-flex items-center gap-1 text-xs font-semibold ${deltaClasses[deltaTone || 'flat']}`}>{deltaText}</div>
    </div>
  );
}

function ActionQueue({ day, onSelectSession }) {
  const sessions = day?.flaggedSessions || [];
  const total = day?.flaggedCount || 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[15.5px] font-bold text-slate-900">What needs you</div>
        <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">{total} open</div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">No open holds or returns. Nice.</div>
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
                className="w-full flex items-center gap-3 bg-slate-50 hover:bg-slate-100 transition-colors rounded-xl px-3.5 py-2.5 min-w-0 text-left cursor-pointer"
              >
                <div className={`w-[3px] self-stretch rounded-sm flex-shrink-0 ${isCritical ? 'bg-rose-600' : 'bg-amber-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                    {s.patientName} &middot; {s.practitionerName}
                  </div>
                  <div className="text-[11.5px] text-slate-500 truncate">
                    {s.note || (s.status === 'on_hold' ? 'On hold, no note on file' : 'Returned, awaiting resubmission')}
                  </div>
                </div>
                {age !== null && (
                  <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${isCritical ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                    {age}d
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BillingFunnel({ pipeline }) {
  if (!pipeline) return null;
  const { logged, reviewed, invoiced, paid } = pipeline;
  const held = (pipeline.exceptions?.on_hold || 0) + (pipeline.exceptions?.rejected || 0);

  const stages = [
    { label: 'Logged', value: logged, gradient: 'linear-gradient(90deg, #60a5fa, #2563eb)' },
    { label: 'Reviewed', value: reviewed, gradient: 'linear-gradient(90deg, #a78bfa, #7c3aed)', sub: held > 0 ? `${held.toLocaleString()} held back` : null },
    { label: 'Invoiced', value: invoiced, gradient: 'linear-gradient(90deg, #2dd4bf, #0d9488)' },
    { label: 'Paid', value: paid, gradient: 'linear-gradient(90deg, #fbbf24, #d97706)' },
  ];
  const max = Math.max(logged, 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[15.5px] font-bold text-slate-900">Billing pipeline</div>
        <div className="text-[11.5px] font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0">{logged.toLocaleString()} total</div>
      </div>
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3 mb-3 last:mb-0">
          <div className="w-[88px] flex-shrink-0">
            <div className="text-xs font-semibold text-slate-500">{s.label}</div>
            {s.sub && <div className="text-[10px] font-semibold text-rose-600 mt-0.5">{s.sub}</div>}
          </div>
          <div className="flex-1 h-[30px] bg-slate-50 rounded-lg overflow-hidden">
            <div
              className="h-full rounded-lg flex items-center justify-end px-2.5 text-xs font-bold text-white font-mono"
              style={{ width: `${Math.max((s.value / max) * 100, s.value > 0 ? 8 : 0)}%`, background: s.gradient }}
            >
              {s.value.toLocaleString()}
            </div>
          </div>
        </div>
      ))}
      <div className="text-xs text-slate-400 mt-3.5 pt-3 border-t border-dashed border-slate-200">
        {paid === 0
          ? "Nothing in the pipeline has been marked paid yet."
          : `${Math.round((paid / Math.max(invoiced, 1)) * 100)}% of invoiced sessions are confirmed paid, across all time.`}
      </div>
    </div>
  );
}

function EimsDonut({ pipeline }) {
  const rate = pipeline?.eimsMatchRate;
  if (!rate) return null;
  const total = rate.matched + rate.flagged + rate.missing + rate.unverified;
  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center">
        <div className="text-[15.5px] font-bold text-slate-900 self-start mb-4">EIMS match status</div>
        <div className="text-sm text-slate-400 py-8">No billed sessions yet.</div>
      </div>
    );
  }

  const matchedPct = Math.round((rate.matched / total) * 100);
  const C = 2 * Math.PI * 46;
  const seg = (count) => (count / total) * C;
  const matchedLen = seg(rate.matched);
  const flaggedLen = seg(rate.flagged);
  const missingLen = seg(rate.missing + rate.unverified);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center">
      <div className="text-[15.5px] font-bold text-slate-900 self-start mb-4">EIMS match status</div>
      <svg viewBox="0 0 120 120" width="150" height="150">
        <circle cx="60" cy="60" r="46" fill="none" stroke="#f6f7fb" strokeWidth="16" />
        <circle cx="60" cy="60" r="46" fill="none" stroke="#0d9488" strokeWidth="16"
          strokeDasharray={`${matchedLen} ${C - matchedLen}`} strokeDashoffset="0" transform="rotate(-90 60 60)" strokeLinecap="round" />
        <circle cx="60" cy="60" r="46" fill="none" stroke="#d97706" strokeWidth="16"
          strokeDasharray={`${flaggedLen} ${C - flaggedLen}`} strokeDashoffset={-matchedLen} transform="rotate(-90 60 60)" />
        <circle cx="60" cy="60" r="46" fill="none" stroke="#e11d48" strokeWidth="16"
          strokeDasharray={`${missingLen} ${C - missingLen}`} strokeDashoffset={-(matchedLen + flaggedLen)} transform="rotate(-90 60 60)" strokeLinecap="round" />
        <text x="60" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="#1b1d2a">{matchedPct}%</text>
        <text x="60" y="72" textAnchor="middle" fontSize="9" fill="#9a9eb2">matched</text>
      </svg>
      <div className="flex flex-col gap-2 mt-4 w-full">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-500"><span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ background: '#0d9488' }} />Matched</div>
          <span className="font-mono font-semibold text-slate-900">{rate.matched.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-500"><span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ background: '#d97706' }} />Mismatch / pending</div>
          <span className="font-mono font-semibold text-slate-900">{rate.flagged.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-500"><span className="w-2 h-2 rounded-[3px] flex-shrink-0" style={{ background: '#e11d48' }} />Missing / unverified</div>
          <span className="font-mono font-semibold text-slate-900">{(rate.missing + rate.unverified).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function TrajectoryTabs({ active, onChange }) {
  const tabs = [
    { key: 'day', label: 'Day', icon: CalendarDays },
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
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
            active === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
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
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[15.5px] font-bold text-slate-900">Returned logs</div>
        <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0">{count} total</div>
      </div>
      <div className="text-xs text-slate-400 mb-3">Everything billing has sent back, oldest first.</div>

      {logs.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">No returned or declined logs. Nice.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1">
          {logs.map((log) => {
            const age = daysAgo(log.rejectedAt || log.serviceDate);
            const isDeclined = log.status === 'declined';
            const isOpen = expandedId === log.id;
            return (
              <div key={log.id} className="bg-slate-50 rounded-xl overflow-hidden min-w-0">
                <div className="w-full min-w-0 flex items-center gap-3 px-3.5 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : log.id)}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                  >
                    <div className={`w-[3px] self-stretch rounded-sm flex-shrink-0 ${isDeclined ? 'bg-rose-600' : 'bg-amber-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-900 truncate">
                        {log.patientName} &middot; {log.practitionerName}
                      </div>
                      <div className="text-[11.5px] text-slate-500 truncate">
                        {isDeclined ? 'Declined' : 'Returned'}{log.rejectionCount > 1 ? ` &middot; sent back ${log.rejectionCount}x` : ''}
                        {log.note ? ` — ${log.note}` : ''}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSession(log.id)}
                    className="text-[10.5px] font-semibold text-slate-500 hover:text-slate-800 underline flex-shrink-0 cursor-pointer"
                  >
                    Details
                  </button>
                  {age !== null && (
                    <span className={`text-[10.5px] font-bold px-2 py-1 rounded-full flex-shrink-0 ${isDeclined ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                      {age}d
                    </span>
                  )}
                </div>
                {isOpen && log.comments.length > 0 && (
                  <div className="border-t border-slate-200 bg-white px-3.5 py-3 space-y-2.5">
                    {log.comments.map((c, i) => (
                      <div key={i} className="text-xs">
                        <div className="font-semibold text-slate-700 mb-0.5 capitalize">{c.authorRole || 'Staff'}</div>
                        <div className="text-slate-600">{c.note}</div>
                        <div className="text-[10.5px] text-slate-400 mt-0.5">{new Date(c.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
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
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700"
      />
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center gap-6 flex-wrap mb-4">
          <div>
            <div className="text-2xl font-bold tracking-tight font-mono">{month.volumeVsPriorMonth.current.toLocaleString()}</div>
            <div className={`text-xs font-semibold mt-1 ${month.volumeVsPriorMonth.pctChange >= 0 ? 'text-teal-700' : 'text-rose-700'}`}>
              {month.volumeVsPriorMonth.pctChange !== null ? (
                <span className="inline-flex items-center gap-1">
                  {month.volumeVsPriorMonth.pctChange >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                  {Math.abs(month.volumeVsPriorMonth.pctChange)}% vs prior month
                </span>
              ) : 'No prior month to compare'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Children seen</div>
            <div className="text-lg font-bold font-mono">{month.patientRosterCount}</div>
          </div>
        </div>
        {month.dailyVolume.length > 0 && (
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={month.dailyVolume}>
                <defs>
                  <linearGradient id="monthArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e8f0" />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d + 'T00:00:00').getDate()} tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip labelFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
                <Area type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2.5} fill="url(#monthArea)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
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
        className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 w-28"
      />
      {isLoading || !data ? (
        <div className="text-sm text-slate-400 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-6 flex-wrap mb-4">
            <div>
              <div className="text-2xl font-bold tracking-tight font-mono">{data.yoyComparison.current.count.toLocaleString()}</div>
              <div className={`text-xs font-semibold mt-1 ${data.yoyComparison.pctChange >= 0 ? 'text-teal-700' : 'text-rose-700'}`}>
                {data.yoyComparison.pctChange !== null ? `${Math.abs(data.yoyComparison.pctChange)}% YoY` : 'No prior year to compare'}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Est. billable this year</div>
              <div className="text-lg font-bold font-mono">{compactMoney(data.yoyComparison.current.estBillable)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Active practitioners</div>
              <div className="text-lg font-bold font-mono">{data.practitionerRoster.activeNow}</div>
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
                  <XAxis dataKey="month" tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short' })} tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} />
                  <Area type="monotone" dataKey="count" stroke="#0d9488" strokeWidth={2.5} fill="url(#yearArea)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="text-[11.5px] text-slate-400 mt-2.5">
            {data.fullYearCompliance.coverageRate !== null
              ? `${data.fullYearCompliance.coverageRate}% of this year's billed sessions have a matching state record on file.`
              : 'Not enough billed sessions this year to compute coverage.'}
          </div>
        </div>
      )}
    </div>
  );
}

export function CompanyDashboard() {
  const [day, setDay] = useState(null);
  const [ap, setAp] = useState(null);
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [month, setMonth] = useState(null);
  const [trajectoryTab, setTrajectoryTab] = useState('day');
  // The billing pipeline (Logged -> Reviewed -> Invoiced -> Paid) is
  // deliberately NOT scoped to a calendar month — it's the current state
  // of every session across all time, the actual operational backlog, so
  // it fetches once and doesn't depend on monthValue below.
  const [pipeline, setPipeline] = useState(null);
  // Same all-time framing as pipeline — "what's been returned" is a
  // standing backlog question, not a today-only one, so it fetches once.
  const [returnedLogs, setReturnedLogs] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  useEffect(() => {
    api.get('/api/dashboard/day').then((res) => setDay(res.data)).catch(() => setDay(null));
    api.get('/api/dashboard/ap').then((res) => setAp(res.data)).catch(() => setAp(null));
    api.get('/api/dashboard/pipeline').then((res) => setPipeline(res.data)).catch(() => setPipeline(null));
    api.get('/api/dashboard/returned-logs').then((res) => setReturnedLogs(res.data)).catch(() => setReturnedLogs(null));
  }, []);

  useEffect(() => {
    api.get('/api/dashboard/month', { params: { month: monthValue } })
      .then((res) => setMonth(res.data))
      .catch(() => setMonth(null));
  }, [monthValue]);

  return (
    <div className="space-y-6">
      <VerdictBanner day={day} ap={ap} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <StatCard
          icon={Tag} tone="teal" label="Ready to pay"
          value={ap ? money(ap.totalClear) : '—'}
          deltaText={ap && ap.totalOwed > 0 ? `${Math.round((ap.totalClear / ap.totalOwed) * 100)}% cleared · ${Math.round((ap.totalHeld / ap.totalOwed) * 100)}% held` : 'Nothing currently owed'}
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
          value={day ? String(day.flaggedCount) : '—'}
          deltaText={day && day.flaggedCount > 0 ? 'see the queue below' : 'nothing flagged'}
          deltaTone={day && day.flaggedCount > 0 ? 'down' : 'flat'}
        />
        <StatCard
          icon={CalendarClock} tone="rose" label="Logged today"
          value={day ? String(day.sessionsLoggedToday) : '—'}
          deltaText={day && day.sessionsLoggedToday === 0 ? 'quiet so far' : 'active today'}
          deltaTone="flat"
        />
      </div>

      <div>
        <div className="text-lg font-bold text-slate-900 mb-1">From session to payment</div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Everything currently in the pipeline, and what's stuck along the way.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-4 items-start">
          <BillingFunnel pipeline={pipeline} />
          <ActionQueue day={day} onSelectSession={setSelectedSessionId} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="text-lg font-bold text-slate-900">Where this is headed</div>
          <TrajectoryTabs active={trajectoryTab} onChange={setTrajectoryTab} />
        </div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Same work, three distances — the volume trend, and how it's reconciling against the state.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
          {trajectoryTab === 'day' && <ReturnedLogsPanel returnedLogs={returnedLogs} onSelectSession={setSelectedSessionId} />}
          {trajectoryTab === 'month' && <MonthTrajectory month={month} monthValue={monthValue} onMonthChange={setMonthValue} />}
          {trajectoryTab === 'year' && <YearTrajectory />}
          <EimsDonut pipeline={pipeline} />
        </div>
      </div>

      <SessionDetailDialog assessmentId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
    </div>
  );
}
