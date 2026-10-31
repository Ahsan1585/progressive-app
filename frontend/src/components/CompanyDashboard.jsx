import { DEFAULT_CARD_LAYOUT, resolveCardLayout, moveCard, moveCardToEnd } from '@/components/dashboardLayout';
import React, { useState, useEffect, useRef } from 'react';
import api from '@/api/axiosInstance';
import {
  Tag, Activity, AlertTriangle, CalendarClock, TrendingUp, TrendingDown,
  CalendarRange, Calendar, X, Check, MessageCircle, GripVertical, Search,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useMessaging } from '@/context/useMessaging';

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compactMoney = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
// Picks a row's count or hours field depending on the Overview control
// bar's sessions/hours toggle, and a matching unit label for display text.
const pick = (row, countKey, hoursKey, unit) => (row ? (unit === 'hours' ? row[hoursKey] : row[countKey]) : null);
const unitLabel = (unit, n) => (unit === 'hours' ? 'hrs' : n === 1 ? 'session' : 'sessions');

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

// Practitioner filter + sessions/hours toggle + search, in one row under
// the month picker. The practitioner filter re-fetches every card (plumbed
// through CompanyDashboard's own month-fetch effect, same stale-response
// guard as the month picker); the unit toggle is purely local (no
// refetch, just which field each component reads); search filters rows
// already on screen in PractitionerAccuracyTable/ReturnedLogsPanel.
function OverviewControlBar({ practitioners, practitionerId, onPractitionerChange, unit, onUnitChange, searchQuery, onSearchChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <select
        value={practitionerId ?? ''}
        onChange={(e) => onPractitionerChange(e.target.value ? Number(e.target.value) : null)}
        className="border border-slate-200 rounded-lg px-3 py-1.5 text-[15px] font-semibold text-slate-700 bg-white cursor-pointer"
      >
        <option value="">All practitioners</option>
        {practitioners.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
        {['sessions', 'hours'].map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => onUnitChange(u)}
            className={`px-3 py-1.5 text-[14px] font-semibold capitalize cursor-pointer transition-colors ${
              unit === u ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {u}
          </button>
        ))}
      </div>
      <div className="relative flex-1 min-w-[180px] max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" aria-hidden="true" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search practitioner or patient..."
          className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-[15px] text-slate-700 bg-white"
        />
      </div>
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
// The accuracy list is a scroll window: this many practitioners are visible at
// once, the rest are a scroll away. Rows and header have a fixed height and a
// one-line name, so the window shows exactly this many rows.
const ACCURACY_VISIBLE_ROWS = 6;
const ACCURACY_ROW_PX = 74;
const ACCURACY_HEADER_PX = 44;

function PractitionerAccuracyTable({ month, unit = 'sessions', searchQuery = '' }) {
  const allRows = month?.practitionerAccuracy || [];
  const rows = searchQuery.trim()
    ? allRows.filter((r) => r.name?.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : allRows;
  const [sortBy, setSortBy] = useState('accuracyPct'); // 'accuracyPct' | 'sessionsChecked' | 'notClean'
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
        <div className="text-[15px] text-slate-500 text-center py-10">
          {searchQuery.trim() && allRows.length > 0 ? `No practitioner matching "${searchQuery.trim()}".` : 'No agency practitioner sessions checked against EIMS this month yet.'}
        </div>
      ) : (
        <div
          className="overflow-auto"
          style={rows.length > ACCURACY_VISIBLE_ROWS ? { maxHeight: ACCURACY_HEADER_PX + ACCURACY_VISIBLE_ROWS * ACCURACY_ROW_PX } : undefined}
        >
          <table className="w-full text-[15px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50 border-b border-slate-100" style={{ height: ACCURACY_HEADER_PX }}>
                <th className="text-left text-[14px] font-bold uppercase text-slate-600 px-5 py-2.5">Practitioner</th>
                <SortHeader label="Accuracy" sortKey="accuracyPct" />
                <SortHeader label={unit === 'hours' ? 'Hours' : 'Checked'} sortKey="sessionsChecked" />
                <SortHeader label={unit === 'hours' ? 'Not Clean Hrs' : 'Not Clean'} sortKey="notClean" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((r) => {
                const tone = tierTone(r.accuracyPct);
                return (
                  <tr key={r.practitionerId} className="hover:bg-slate-50" style={{ height: ACCURACY_ROW_PX }}>
                    <td className="px-5 py-3 max-w-[280px]">
                      <div className="text-[17px] font-bold text-slate-900 truncate" title={r.name}>{r.name}</div>
                      {r.discipline && <div className="text-[13px] text-slate-600 truncate" title={r.discipline}>{r.discipline}</div>}
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
                    <td className="px-3 py-3 text-[17px] font-semibold text-slate-700 font-mono tabular-nums">{unit === 'hours' ? r.hoursChecked : r.sessionsChecked}</td>
                    <td className="px-3 py-3 text-[17px] font-semibold text-slate-700 font-mono tabular-nums">{unit === 'hours' ? r.notCleanHours : r.notClean}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > ACCURACY_VISIBLE_ROWS && (
        <div className="px-5 py-2.5 text-[14px] font-semibold text-slate-600 border-t border-slate-100 bg-slate-50">
          Showing {ACCURACY_VISIBLE_ROWS} of {rows.length} practitioners. Scroll the list to see the rest.
        </div>
      )}
    </div>
  );
}

// --- Verdict banner: a plain-language judgment, not a stat tile, with
// the supporting numbers underneath it rather than standing alone. ---
function VerdictBanner({ day, ap, monthLabel, unit = 'sessions' }) {
  if (!day || !ap) {
    return (
      <section className="rounded-[24px] p-7 sm:p-8 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
        <div className="text-[15px] text-white/80">Loading {monthLabel}...</div>
      </section>
    );
  }

  const flaggedCount = unit === 'hours' ? (day.flaggedHours || 0) : (day.flaggedCount || 0);
  const flaggedUnitWord = unit === 'hours' ? 'hrs' : (flaggedCount === 1 ? 'session' : 'sessions');
  const totalOwed = ap.totalOwed || 0;
  const totalClear = ap.totalClear || 0;
  const totalHeld = ap.totalHeld || 0;
  const totalPaid = ap.totalPaid || 0;
  // Against the month's TOTAL billing (paid + still owed), not just the
  // still-owed remainder — totalOwed excludes everything already paid, so
  // once most of a month is paid out, totalOwed is small and a percentage
  // computed against only that remainder makes a tiny held-back amount
  // look like it's most of the month's billing (e.g. "40% held" when it's
  // really 40% of a $79 leftover out of $2,000 billed, not 40% of $2,000).
  const totalBilled = totalPaid + totalOwed;
  const paidPct = totalBilled > 0 ? Math.round(((totalPaid + totalClear) / totalBilled) * 100) : 0;
  // Blended $/hr across the month's whole billed total (paid + still owed)
  // so the CEO can see the dollar figure and the hours figure as one
  // relationship, not two separate numbers they have to divide themselves.
  const totalBilledHours = (ap.totalPaidHours || 0) + (ap.totalOwedHours || 0);
  const blendedRate = totalBilledHours > 0 ? totalBilled / totalBilledHours : null;

  const isHealthy = flaggedCount === 0 && totalHeld === 0;
  const headline = isHealthy
    ? `Billing is healthy. Nothing is waiting on you for ${monthLabel}.`
    : flaggedCount > 0 && totalHeld === 0
      ? unit === 'hours'
        ? `Billing is healthy. ${flaggedCount} ${flaggedUnitWord} stuck and need a decision.`
        : `Billing is healthy. ${flaggedCount} session${flaggedCount === 1 ? ' is' : 's are'} stuck and need${flaggedCount === 1 ? 's' : ''} a decision.`
      : `${flaggedCount > 0 ? `${flaggedCount} ${flaggedUnitWord} need${unit === 'sessions' && flaggedCount === 1 ? 's' : ''} a decision and ` : ''}${compactMoney(totalHeld)} is being held back.`;

  return (
    <section className="rounded-[24px] p-7 sm:p-8 text-white shadow-sm flex flex-col min-w-0" style={{ background: 'linear-gradient(135deg, #1a2744 0%, #0f1829 100%)' }}>
      <div>
        <div className="flex items-center gap-2 text-[13px] font-extrabold uppercase tracking-[0.14em] mb-3" style={{ color: '#fcd34d' }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fcd34d' }} />
          {isHealthy ? 'All clear' : `Needs a look: ${monthLabel}`}
        </div>
        <h1 className="text-[26px] sm:text-[34px] font-extrabold leading-[1.12] tracking-tight mb-4" style={{ textWrap: 'balance' }}>{headline}</h1>
        {/* One sentence ties owed/clear/held together instead of splitting them
            across this banner and a separate "Ready to pay" stat tile — the two
            used to show the same ap.total* figures with no visible connection
            (e.g. "$79 held" here vs. "$116.92 ready" in the tile, with nothing
            saying they're both slices of the same $196.09 owed this month). */}
        <p className="text-[16px] sm:text-[18px] leading-relaxed max-w-2xl" style={{ color: 'rgba(253,253,255,0.9)' }}>
          <b className="text-white font-extrabold">{money(totalOwed)}</b> is owed to practitioners this month
          {totalOwed > 0 && <>: <b className="text-white font-extrabold">{money(totalClear)}</b> is ready to pay now, <b className="text-white font-extrabold">{money(totalHeld)}</b> is being held back</>}.
          {blendedRate !== null && <> That's <b className="text-white font-extrabold">{totalBilledHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hrs</b> billed this month, averaging <b className="text-white font-extrabold">{money(blendedRate)}/hr</b>.</>}
          {flaggedCount > 0 && <> The open item is <b className="text-white font-extrabold">{flaggedCount} flagged {unit === 'hours' ? 'hrs' : `session${flaggedCount === 1 ? '' : 's'}`}</b>.</>}
        </p>
      </div>
      {totalBilled > 0 && (
        <div className="mt-auto pt-8">
          <div className="flex items-end justify-between text-[15px] font-semibold mb-2">
            <span className="text-white/80">Paid or ready to pay, this month</span>
            <span className="text-[28px] leading-none font-extrabold font-mono tabular-nums">{paidPct}%</span>
          </div>
          <div className="w-full h-3 rounded-full bg-white/15 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400" style={{ width: `${paidPct}%` }} />
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

function ActionQueue({ day, onSelectSession, unit = 'sessions' }) {
  const sessions = day?.flaggedSessions || [];
  const total = unit === 'hours' ? (day?.flaggedHours || 0) : (day?.flaggedCount || 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">What needs you</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full">{total} {unit === 'hours' ? 'hrs' : 'open'}</div>
      </div>
      {sessions.length === 0 ? (
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">No open holds this month. Nice.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1 [&>*]:shrink-0">
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
function FunnelRows({ pipeline, unit = 'sessions' }) {
  const logged = unit === 'hours' ? pipeline.loggedHours : pipeline.logged;
  const reviewed = unit === 'hours' ? pipeline.reviewedHours : pipeline.reviewed;
  const invoiced = unit === 'hours' ? pipeline.invoicedHours : pipeline.invoiced;
  const paid = unit === 'hours' ? pipeline.paidHours : pipeline.paid;
  const held = unit === 'hours'
    ? (pipeline.exceptionsHours?.on_hold || 0) + (pipeline.exceptionsHours?.rejected || 0)
    : (pipeline.exceptions?.on_hold || 0) + (pipeline.exceptions?.rejected || 0);
  const heldLabel = unit === 'hours' ? `${held.toLocaleString()} hrs held back` : `${held.toLocaleString()} held back`;

  const stages = [
    { label: 'Logged', value: logged },
    { label: 'Reviewed', value: reviewed, sub: held > 0 ? heldLabel : null },
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

function BillingFunnel({ pipeline, unit = 'sessions' }) {
  if (!pipeline) return null;
  const logged = unit === 'hours' ? pipeline.loggedHours : pipeline.logged;
  const invoiced = unit === 'hours' ? pipeline.invoicedHours : pipeline.invoiced;
  const paid = unit === 'hours' ? pipeline.paidHours : pipeline.paid;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Billing pipeline</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0">{logged.toLocaleString()} {unit === 'hours' ? 'hrs' : 'total'}</div>
      </div>
      <FunnelRows pipeline={pipeline} unit={unit} />
      <div className="text-[14px] text-slate-500 mt-3.5 pt-3 border-t border-dashed border-slate-200">
        {paid === 0
          ? "Nothing from this month has been marked paid yet."
          : `${Math.round((paid / Math.max(invoiced, 1)) * 100)}% of invoiced ${unit === 'hours' ? 'hours' : 'sessions'} are confirmed paid.`}
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

function EimsDonut({ pipeline, unit = 'sessions' }) {
  const rate = pipeline?.eimsMatchRate;
  const displayRate = unit === 'hours' ? pipeline?.eimsMatchRateHours : rate;
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
  const missingLen = seg(rate.missing);
  const unverifiedLen = seg(rate.unverified);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col items-center">
      <svg viewBox="0 0 120 120" width="200" height="200">
        <circle cx="60" cy="60" r="46" fill="none" stroke={empty ? '#b8c4d3' : '#f6f7fb'} strokeWidth="16" />
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
        {rate.missing > 0 && (
          <circle cx="60" cy="60" r="46" fill="none" stroke="#e11d48" strokeWidth="16"
            strokeDasharray={`${missingLen} ${C - missingLen}`} strokeDashoffset={-(matchedLen + flaggedLen)} transform="rotate(-90 60 60)" />
        )}
        {rate.unverified > 0 && (
          <circle cx="60" cy="60" r="46" fill="none" stroke="#94a3b8" strokeWidth="16"
            strokeDasharray={`${unverifiedLen} ${C - unverifiedLen}`} strokeDashoffset={-(matchedLen + flaggedLen + missingLen)} transform="rotate(-90 60 60)" />
        )}
        {!empty && (
          <>
            <text x="60" y="56" textAnchor="middle" fontSize="27" fontWeight="800" fill="#0f172a">{`${matchedPct}%`}</text>
            <text x="60" y="73" textAnchor="middle" fontSize="10" fontWeight="600" fill="#475569">matched</text>
          </>
        )}
      </svg>
      {/* No billed sessions this month: just the gray ring, with the words under it. */}
      {empty && <div className="mt-4 mb-2 text-[20px] font-bold text-slate-700">no sessions</div>}
      {!empty && (
      <div className="flex flex-col gap-2 mt-4 w-full">
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#0d9488' }} />Matched</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{displayRate.matched.toLocaleString()}{unit === 'hours' ? ' hrs' : ''}</span>
        </div>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#d97706' }} />Mismatch / pending</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{displayRate.flagged.toLocaleString()}{unit === 'hours' ? ' hrs' : ''}</span>
        </div>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#e11d48' }} />Missing in EIMS</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{displayRate.missing.toLocaleString()}{unit === 'hours' ? ' hrs' : ''}</span>
        </div>
        <div className="flex items-center justify-between text-[16px]">
          <div className="flex items-center gap-2 text-slate-700 font-semibold"><span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: '#94a3b8' }} />Unverified (no state file)</div>
          <span className="font-mono font-extrabold text-[18px] text-slate-900">{displayRate.unverified.toLocaleString()}{unit === 'hours' ? ' hrs' : ''}</span>
        </div>
      </div>
      )}
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

function ServicesBreakdown({ data, unit = 'sessions' }) {
  const [dimension, setDimension] = useState('byServiceType');
  if (!data) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 mb-4">Services provided</div>
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">Loading…</div>
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
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">No sessions logged this month yet.</div>
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
                <span className="font-mono font-extrabold text-[18px] text-slate-900 flex-shrink-0">{(unit === 'hours' ? r.hours : r.count).toLocaleString()}{unit === 'hours' ? ' hrs' : ''}</span>
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
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">Loading…</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">Invoices &amp; SEVF forms</div>
      <p className="text-[14px] text-slate-600 mb-4">Covering this month's sessions</p>
      {documents.length === 0 ? (
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">No invoices or SEVF forms for this month.</div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1 [&>*]:shrink-0">
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
    <div className="inline-flex bg-white/10 rounded-[10px] p-[3px] gap-0.5">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[15px] font-bold transition-colors cursor-pointer ${
            active === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white'
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
function ReturnedLogsPanel({ returnedLogs, onSelectSession, unit = 'sessions', searchQuery = '' }) {
  const allLogs = returnedLogs?.logs || [];
  const q = searchQuery.trim().toLowerCase();
  const logs = q
    ? allLogs.filter((l) => l.patientName?.toLowerCase().includes(q) || l.practitionerName?.toLowerCase().includes(q))
    : allLogs;
  const count = unit === 'hours' ? Math.round(logs.reduce((sum, l) => sum + (l.hours || 0), 0) * 100) / 100 : logs.length;
  const totalAmount = logs.reduce((sum, l) => sum + (l.amount || 0), 0);
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="text-[24px] font-extrabold tracking-tight leading-tight text-slate-900">Returned &amp; declined logs</div>
        <div className="text-[14px] font-bold text-slate-700 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap flex-shrink-0">
          {count} {unit === 'hours' ? 'hrs' : 'total'}
        </div>
      </div>
      <div className="text-[14px] text-slate-500 mb-3">
        Sessions from this month that billing sent back, oldest first.
        {logs.length > 0 && <> <span className="font-semibold text-slate-700">{money(totalAmount)} total</span> not yet billable.</>}
      </div>

      {logs.length === 0 ? (
        <div className="text-[16px] font-semibold text-slate-600 text-center py-8">
          {q && allLogs.length > 0 ? `No returned or declined logs matching "${searchQuery.trim()}".` : 'No returned or declined logs this month. Nice.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2 max-h-[340px] overflow-y-auto pr-1 [&>*]:shrink-0">
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
                  <span className="text-[14px] font-bold text-slate-700 tabular-nums flex-shrink-0">{money(log.amount)}</span>
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

// All twelve calendar months of a year, empty ones included. The API returns
// only the months that have sessions, with timestamps, so the slots are built
// here from the "YYYY-MM" part of each row.
function fillYearMonths(year, rows) {
  const byMonth = new Map((rows || []).map((r) => [String(r.month).slice(0, 7), r.count]));
  return MONTH_NAMES.map((name, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`;
    return { key, label: name.slice(0, 3), full: `${name} ${year}`, count: byMonth.get(key) || 0 };
  });
}

// One year of monthly volume. The answer for a year never depends on the month
// picker, so this fetches by year; a stale response (picker moved on) is dropped.
function useYearData(year) {
  const [state, setState] = useState({ year: null, data: null });
  useEffect(() => {
    let stale = false;
    api.get('/api/dashboard/year', { params: { year } })
      .then((res) => { if (!stale) setState({ year, data: res.data }); })
      .catch(() => { if (!stale) setState({ year, data: null }); });
    return () => { stale = true; };
  }, [year]);
  return { data: state.year === year ? state.data : null, loading: state.year !== year };
}

// Bars on the dark panel for any series of {key, label, full, count}: twelve
// months of a year, or one bar per year. Every slot gets a faint track, so an
// empty period reads as empty rather than missing. highlightKey picks one bar
// out in bright teal; without it every bar is teal.
function VolumeBars({ data, highlightKey, maxBarSize = 44, onSelect }) {
  const bars = data.map((d) => ({
    ...d,
    fill: !highlightKey || d.key === highlightKey ? '#2dd4bf' : '#52678a',
  }));
  return (
    <div style={{ height: 240, cursor: onSelect ? 'pointer' : 'default' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bars}
          barCategoryGap="22%"
          // Clicking anywhere in a column picks it, so an empty month (no visible
          // bar) can still be selected. v3 reports an index; older versions a payload.
          onClick={onSelect ? (state) => {
            const i = Number(state?.activeTooltipIndex);
            const key = state?.activePayload?.[0]?.payload?.key ?? (Number.isInteger(i) ? bars[i]?.key : undefined);
            if (key) onSelect(key);
          } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a3547" />
          <XAxis dataKey="label" interval={0} tick={{ fontSize: 14, fill: '#e2e8f0', fontWeight: 700 }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, (max) => Math.max(max, 4)]} tick={{ fontSize: 13, fill: '#94a3b8', fontWeight: 600 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.06)' }}
            contentStyle={{ background: '#111827', border: '1px solid #334155', borderRadius: 10, color: '#f1f5f9' }}
            labelStyle={{ color: '#f1f5f9', fontWeight: 700 }}
            itemStyle={{ color: '#e2e8f0' }}
            labelFormatter={(label, payload) => payload?.[0]?.payload?.full || label}
            formatter={(v) => [v.toLocaleString(), 'Sessions']}
          />
          <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={maxBarSize} background={{ fill: 'rgba(255,255,255,0.05)', radius: 6 }}>
            {bars.map((d) => <Cell key={d.key} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Jan to Dec of one year.
function YearBars({ year, rows, highlightKey, onSelect }) {
  return <VolumeBars data={fillYearMonths(year, rows)} highlightKey={highlightKey} onSelect={onSelect} />;
}

// The month-over-month line under the session count. A prior month with no
// sessions is said plainly ("No sessions in February to compare") instead of
// the misleading "No prior month": the month exists, it just has nothing to
// divide by.
function monthComparison(volume, priorName) {
  if (volume.pctChange !== null && volume.pctChange !== undefined) {
    const up = volume.pctChange >= 0;
    return { tone: up ? 'up' : 'down', text: `${Math.abs(volume.pctChange)}% ${up ? 'more' : 'fewer'} than ${priorName}` };
  }
  if (volume.prior === 0) return { tone: 'flat', text: `No sessions in ${priorName} to compare` };
  return { tone: 'flat', text: 'Nothing to compare against' };
}

// Every year from the first one with sessions through the current year (years in
// between with no sessions included as empty), newest on the right.
function fillYears(rows, currentYear) {
  const list = rows || [];
  const byYear = new Map(list.map((r) => [r.year, r.count]));
  const first = Math.min(currentYear, ...list.map((r) => r.year));
  const last = Math.max(currentYear, ...list.map((r) => r.year));
  const out = [];
  for (let y = first; y <= last; y += 1) out.push({ key: String(y), label: String(y), full: String(y), count: byYear.get(y) || 0 });
  return out;
}

// Session totals for every year on record (the Year tab). Never depends on the
// month picker; a stale response is dropped.
function useAllYears() {
  const [state, setState] = useState({ done: false, data: null });
  useEffect(() => {
    let stale = false;
    api.get('/api/dashboard/years')
      .then((res) => { if (!stale) setState({ done: true, data: res.data }); })
      .catch(() => { if (!stale) setState({ done: true, data: null }); });
    return () => { stale = true; };
  }, []);
  return { data: state.data, loading: !state.done };
}

function MonthTrajectory({ month, onMonthChange }) {
  const yearData = useYearData(month?.year ?? new Date().getFullYear());
  if (!month) return null;
  const selectedKey = `${month.year}-${String(month.month).padStart(2, '0')}`;
  const selectedName = `${MONTH_NAMES[month.month - 1]} ${month.year}`;
  const priorName = MONTH_NAMES[(month.month + 10) % 12]; // the month before, wrapping Jan -> Dec
  const cmp = monthComparison(month.volumeVsPriorMonth, priorName);
  const yearTotal = (yearData.data?.monthlyVolume || [])
    .filter((r) => String(r.month).slice(0, 4) === String(month.year))
    .reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white/[0.04] rounded-2xl border border-white/10 p-6">
        <div className="flex items-start gap-x-8 gap-y-4 flex-wrap mb-5">
          <div>
            <div className="text-[14px] text-slate-300">Sessions in {selectedName}</div>
            <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono text-white mt-1">{month.volumeVsPriorMonth.current.toLocaleString()}</div>
            <div className={`text-[14px] font-semibold mt-1.5 ${cmp.tone === 'down' ? 'text-rose-300' : cmp.tone === 'up' ? 'text-teal-300' : 'text-slate-400'}`}>
              <span className="inline-flex items-center gap-1">
                {cmp.tone === 'up' && <TrendingUp className="size-3.5" />}
                {cmp.tone === 'down' && <TrendingDown className="size-3.5" />}
                {cmp.text}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[14px] text-slate-300">Children seen in {MONTH_NAMES[month.month - 1]}</div>
            <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono text-white mt-1">{month.patientRosterCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[14px] text-slate-300">Sessions in {month.year}</div>
            <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono text-white mt-1">{yearData.loading ? '—' : yearTotal.toLocaleString()}</div>
            <div className="text-[14px] font-semibold mt-1.5 text-slate-400">all twelve months</div>
          </div>
        </div>
        <div className="text-[15px] font-semibold text-slate-300 mb-2">
          Sessions per month, {month.year}
          <span className="text-slate-400 font-normal"> (click a month to select it)</span>
        </div>
        {yearData.loading
          ? <div className="text-[16px] font-semibold text-slate-300 text-center" style={{ height: 240, paddingTop: 100 }}>Loading...</div>
          : <YearBars year={month.year} rows={yearData.data?.monthlyVolume} highlightKey={selectedKey} onSelect={onMonthChange} />}
      </div>
    </div>
  );
}

function YearTrajectory() {
  const currentYear = new Date().getFullYear();
  const all = useAllYears();
  // Only for the "state coverage" footnote about the current year.
  const thisYear = useYearData(currentYear);
  const series = fillYears(all.data?.years, currentYear);
  const current = series.find((y) => y.key === String(currentYear))?.count ?? 0;
  const prior = series.find((y) => y.key === String(currentYear - 1))?.count;
  const pctChange = prior > 0 ? Math.round(((current - prior) / prior) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      {all.loading || !all.data ? (
        <div className="text-[16px] font-semibold text-slate-300 text-center py-8">Loading...</div>
      ) : (
        <div className="bg-white/[0.04] rounded-2xl border border-white/10 p-6">
          <div className="flex items-center gap-6 flex-wrap mb-4">
            <div>
              <div className="text-[38px] leading-none font-extrabold tracking-tight font-mono text-white">{current.toLocaleString()}</div>
              <div className={`text-[14px] font-semibold mt-1 ${pctChange !== null && pctChange < 0 ? 'text-rose-300' : 'text-teal-300'}`}>
                {pctChange !== null ? `${Math.abs(pctChange)}% ${pctChange >= 0 ? 'up' : 'down'} on ${currentYear - 1}` : `${currentYear} so far`}
              </div>
            </div>
            <div>
              <div className="text-[14px] text-slate-300">All years combined</div>
              <div className="text-[26px] font-extrabold font-mono text-white">{all.data.totalSessions.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[14px] text-slate-300">Est. billable, all years</div>
              <div className="text-[26px] font-extrabold font-mono text-white">{compactMoney(all.data.totalEstBillable)}</div>
            </div>
            <div>
              <div className="text-[14px] text-slate-300">Active practitioners</div>
              <div className="text-[26px] font-extrabold font-mono text-white">{all.data.practitionerRoster.activeNow}</div>
            </div>
          </div>
          <div className="text-[15px] font-semibold text-slate-300 mb-2">
            Sessions per year
            <span className="text-slate-400 font-normal"> ({currentYear} highlighted)</span>
          </div>
          <VolumeBars data={series} highlightKey={String(currentYear)} maxBarSize={90} />
          <div className="text-[14px] text-slate-400 mt-2.5">
            {thisYear.data?.fullYearCompliance?.coverageRate != null
              ? `${thisYear.data.fullYearCompliance.coverageRate}% of ${currentYear}'s billed sessions have a matching state record on file.`
              : `Not enough billed sessions in ${currentYear} to compute coverage.`}
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
// While arranging, each card is shown as a compact numbered tile instead of its
// full content, so all of them fit on one screen and every drop spot is in view.
// Pressing Done shows the real cards in the arranged order.
const CARD_META = {
  billing_pipeline: { title: 'Billing pipeline', hint: 'Logged, reviewed, invoiced, paid' },
  action_queue: { title: 'What needs you', hint: 'Sessions on hold waiting for a decision' },
  services_breakdown: { title: 'Services provided', hint: 'Sessions by type, status, location' },
  documents_feed: { title: 'Invoices & SEVF forms', hint: 'Recent documents and their status' },
  accuracy_table: { title: 'Practitioner accuracy', hint: 'Who is submitting clean logs' },
  eims_status: { title: 'EIMS match status', hint: 'Matched, mismatched, missing' },
  returned_logs: { title: 'Returned & declined logs', hint: 'Logs billing sent back or declined' },
  trajectory_chart: { title: 'Where this is headed', hint: 'Monthly and yearly volume' },
};

function LayoutTile({ cardKey, index }) {
  const meta = CARD_META[cardKey] || { title: cardKey, hint: '' };
  return (
    <div className="h-full min-h-[96px] rounded-2xl border-2 border-slate-300 bg-white px-5 py-4 pr-24 flex items-center gap-4 shadow-sm">
      <div className="size-10 rounded-full bg-slate-900 text-white flex items-center justify-center text-[18px] font-extrabold font-mono flex-shrink-0">{index + 1}</div>
      <div className="min-w-0">
        <div className="text-[20px] font-extrabold tracking-tight leading-tight text-slate-900 truncate">{meta.title}</div>
        <div className="text-[14px] text-slate-600 truncate">{meta.hint}</div>
      </div>
    </div>
  );
}

function DraggableCard({ cardKey, width, isCustomizing, compact, isDragging, dropPos, onDragStart, onDragOver, onDrop, onDragEnd, onToggleWidth, children }) {
  return (
    <div
      draggable={isCustomizing}
      onDragStart={isCustomizing ? (e) => onDragStart(e, cardKey) : undefined}
      onDragOver={isCustomizing ? (e) => { e.preventDefault(); onDragOver(e, cardKey, width); } : undefined}
      onDrop={isCustomizing ? (e) => { e.preventDefault(); onDrop(e, cardKey, width); } : undefined}
      onDragEnd={isCustomizing ? onDragEnd : undefined}
      className={`relative w-full ${width === 'half' ? `${compact ? 'w-[calc(50%-0.75rem)]' : '@4xl:w-[calc(50%-0.75rem)]'} [&>div:last-child]:h-full [&>div:last-child]:flex [&>div:last-child]:flex-col [&>div:last-child>:last-child]:flex-1` : ''} ${isCustomizing && !compact ? 'outline outline-2 outline-dashed outline-slate-300 outline-offset-2 rounded-2xl' : ''} ${isCustomizing ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* Where the dragged card will land: a bar on the near edge of this card
          (left/right beside a half-width card, top/bottom above or below a full one). */}
      {isCustomizing && dropPos && (
        <div
          aria-hidden="true"
          className={`absolute z-20 rounded bg-teal-400 pointer-events-none ${
            width === 'half'
              ? `top-0 bottom-0 w-2 ${dropPos === 'before' ? '-left-[18px]' : '-right-[18px]'}`
              : `left-0 right-0 h-2 ${dropPos === 'before' ? '-top-[18px]' : '-bottom-[18px]'}`
          }`}
        />
      )}
      {isCustomizing && (
        <div className={`absolute ${compact ? 'top-1/2 -translate-y-1/2' : '-top-3'} right-3 flex items-center gap-1 z-10`}>
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
  const [monthValue, setMonthValue] = useState(() => new Date().toISOString().slice(0, 7));
  const [month, setMonth] = useState(null);
  const [trajectoryTab, setTrajectoryTab] = useState('month');
  // Overview control bar: practitioner scope, sessions/hours unit, search.
  // practitionerId re-fetches every card (same pattern as monthValue); unit
  // is a pure display toggle (no refetch); searchQuery filters already-
  // loaded rows client-side in PractitionerAccuracyTable/ReturnedLogsPanel.
  const [practitioners, setPractitioners] = useState([]);
  const [practitionerId, setPractitionerId] = useState(null);
  const [unit, setUnit] = useState('sessions'); // 'sessions' | 'hours'
  const [searchQuery, setSearchQuery] = useState('');
  // Everything below the stat row follows the month picker, so the cards agree
  // with each other and with the stat row: the sessions whose service date is
  // in the selected month. The verdict banner (day / ap) follows it too; only the
  // all-months status panel (allTime) never moves.
  const [pipeline, setPipeline] = useState(null);
  const [allTime, setAllTime] = useState(null); // every month combined; never follows the picker
  const [returnedLogs, setReturnedLogs] = useState(null);
  const [monthDay, setMonthDay] = useState(null); // the "What needs you" list for the selected month
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [services, setServices] = useState(null);
  const [documents, setDocuments] = useState(null);
  const [cardLayout, setCardLayout, persistCardLayout] = useDashboardLayout();
  const [monthLoading, setMonthLoading] = useState(true);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const dragKeyRef = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const editorRef = useRef(null);
  const [dropHint, setDropHint] = useState(null); // { key, pos: 'before' | 'after' } | null

  useEffect(() => {
    // No month param = all history combined.
    api.get('/api/dashboard/pipeline').then((res) => setAllTime(res.data)).catch(() => setAllTime(null));
    api.get('/api/dashboard/practitioners').then((res) => setPractitioners(res.data.practitioners || [])).catch(() => setPractitioners([]));
  }, []);

  // One fetch per card for the selected month. `stale` drops a response that
  // arrives after the picker has moved on, so flipping months quickly can
  // never leave one card showing a different month from the rest.
  useEffect(() => {
    let stale = false;
    const params = { month: monthValue, ...(practitionerId ? { practitionerId } : {}) };
    // Drop the previous month's numbers straight away so nothing stale sits on
    // screen while the new month loads; the cards show their loading state.
    setMonth(null); setServices(null); setPipeline(null); setMonthDay(null); setDay(null);
    setReturnedLogs(null); setDocuments(null);
    setMonthLoading(true);
    let pending = 0;
    const settle = () => { pending -= 1; if (!stale && pending === 0) setMonthLoading(false); };
    const load = (url, onOk, onFail) => {
      pending += 1;
      api.get(url, { params })
        .then((res) => { if (!stale) onOk(res.data); })
        .catch(() => { if (!stale) onFail(); })
        .finally(settle);
    };
    load('/api/dashboard/month', setMonth, () => setMonth(null));
    load('/api/dashboard/services', setServices, () => setServices(null));
    load('/api/dashboard/pipeline', setPipeline, () => setPipeline(null));
    load('/api/dashboard/day', (d) => { setMonthDay(d); setDay(d); }, () => { setMonthDay(null); setDay(null); });
    load('/api/dashboard/returned-logs', setReturnedLogs, () => setReturnedLogs(null));
    load('/api/dashboard/documents', (d) => setDocuments(d.documents), () => setDocuments([]));
    return () => { stale = true; };
  }, [monthValue, practitionerId]);

  // Cards are placed by dropping them, not shuffled live under the cursor: while
  // dragging, a bar shows where the card will land, and the move (and the save)
  // happens once, on drop. A half-width target is approached from the side (left
  // or right half), a full-width one from above or below.
  const clearDrag = () => { dragKeyRef.current = null; setDraggingKey(null); setDropHint(null); };
  const handleDragStart = (e, key) => {
    dragKeyRef.current = key;
    setDraggingKey(key);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', key); // Firefox will not start a drag without data
  };
  const dropPosFor = (e, targetWidth) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (targetWidth === 'half') return e.clientX < r.left + r.width / 2 ? 'before' : 'after';
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };
  const handleDragOver = (e, overKey, overWidth) => {
    const draggedKey = dragKeyRef.current;
    if (!draggedKey || draggedKey === overKey) { setDropHint((h) => (h ? null : h)); return; }
    const pos = dropPosFor(e, overWidth);
    setDropHint((h) => (h && h.key === overKey && h.pos === pos ? h : { key: overKey, pos }));
  };
  const handleDrop = (e, overKey, overWidth) => {
    const draggedKey = dragKeyRef.current;
    if (draggedKey && draggedKey !== overKey) {
      const next = moveCard(cardLayout, draggedKey, overKey, dropPosFor(e, overWidth), { sideBySide: overWidth === 'half' });
      if (next !== cardLayout) { setCardLayout(next); persistCardLayout(next); }
    }
    clearDrag();
  };
  const handleDropAtEnd = (e) => {
    e.preventDefault();
    const draggedKey = dragKeyRef.current;
    if (draggedKey) {
      const next = moveCardToEnd(cardLayout, draggedKey);
      if (next !== cardLayout) { setCardLayout(next); persistCardLayout(next); }
    }
    clearDrag();
  };
  // Bring the arranging area into view when Customize is switched on.
  useEffect(() => {
    if (isCustomizing) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [isCustomizing]);

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
        <BillingFunnel pipeline={pipeline} unit={unit} />
      </div>
    ),
    action_queue: (
      <div>
        <ActionQueue day={monthDay} onSelectSession={setSelectedSessionId} unit={unit} />
      </div>
    ),
    services_breakdown: (
      <div>
        <ServicesBreakdown data={services} unit={unit} />
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
        <PractitionerAccuracyTable month={month} unit={unit} searchQuery={searchQuery} />
      </div>
    ),
    eims_status: (
      <div>
        <div className="text-[30px] font-extrabold tracking-tight leading-tight text-slate-900 mb-1">EIMS match status</div>
        <p className="text-[17px] text-slate-600 mb-5 max-w-3xl">Sessions from {monthLabel(monthValue)}, reconciled against state records.</p>
        <EimsDonut pipeline={pipeline} unit={unit} />
      </div>
    ),
    returned_logs: (
      <div>
        <ReturnedLogsPanel returnedLogs={returnedLogs} onSelectSession={setSelectedSessionId} unit={unit} searchQuery={searchQuery} />
      </div>
    ),
    trajectory_chart: (
      // Dark panel: everything inside (tabs, picker, tiles, chart, tooltip) is
      // styled for a black background, not just placed on top of one.
      <div className="rounded-[24px] bg-[#0b0f14] p-6 sm:p-8 text-white">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="text-[30px] font-extrabold tracking-tight leading-tight text-white">Where this is headed</div>
          <TrajectoryTabs active={trajectoryTab} onChange={setTrajectoryTab} />
        </div>
        <p className="text-[17px] text-slate-300 mb-5 max-w-3xl">The volume trend, and how it's reconciling against the state.</p>
        {trajectoryTab === 'month' && <MonthTrajectory month={month} onMonthChange={setMonthValue} />}
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
          <VerdictBanner day={day} ap={month?.ap} unit={unit} monthLabel={new Date(`${monthValue}-01T12:00:00`).toLocaleString('en-US', { month: 'long', year: 'numeric' })} />
          <AllTimeStatus pipeline={allTime} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[15px] font-semibold text-slate-600">Viewing</div>
          <div className="flex items-center gap-2">
            {monthLoading && (
              <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-slate-600" role="status" aria-live="polite">
                <span className="size-4 rounded-full border-2 border-slate-300 border-t-teal-600 animate-spin" />
                Loading {new Date(`${monthValue}-01T12:00:00`).toLocaleString('en-US', { month: 'long' })}...
              </span>
            )}
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
        <div className="mb-3">
          <OverviewControlBar
            practitioners={practitioners}
            practitionerId={practitionerId}
            onPractitionerChange={setPractitionerId}
            unit={unit}
            onUnitChange={setUnit}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </div>
        {/* "Ready to pay" used to live here too, repeating the same ap.totalClear
            / totalOwed figures the Needs-a-look banner above already states in
            full (clear vs. held vs. owed) — same money, two different places,
            no visible link between them. This row now covers ground the banner
            doesn't: volume, open decisions, payment progress, and EIMS health. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <StatCard
            icon={Activity} tone="violet" label={unit === 'hours' ? 'Hours this month' : 'Sessions this month'}
            value={month ? (unit === 'hours' ? month.volumeVsPriorMonth.currentHours.toLocaleString() : month.volumeVsPriorMonth.current.toLocaleString()) : '—'}
            deltaText="across the active roster"
            deltaTone="flat"
          />
          <StatCard
            icon={AlertTriangle} tone="amber" label="Needs a decision"
            value={month ? String(unit === 'hours' ? month.exceptionsHours.on_hold : month.exceptions.on_hold) : '—'}
            deltaText={month && month.exceptions.on_hold > 0 ? 'see the queue below' : 'nothing flagged'}
            deltaTone={month && month.exceptions.on_hold > 0 ? 'down' : 'flat'}
          />
          <StatCard
            icon={CalendarClock} tone="rose" label="Paid this month"
            value={month ? String(unit === 'hours' ? month.paidCountHours : month.paidCount) : '—'}
            deltaText={month && month.paidCount === 0 ? 'nothing paid yet' : (unit === 'hours' ? 'hours marked paid' : 'sessions marked paid')}
            deltaTone="flat"
          />
          <StatCard
            icon={Tag} tone="teal" label="EIMS match rate"
            value={(() => {
              const r = month?.eimsMatchRate;
              if (!r) return '—';
              const total = r.matched + r.flagged + r.missing + r.unverified;
              return total > 0 ? `${Math.round((r.matched / total) * 100)}%` : '—';
            })()}
            deltaText="matched against state records"
          />
        </div>
      </div>

      <div className="@container" ref={editorRef}>
      {isCustomizing && (
        <div className="rounded-xl bg-slate-900 text-white px-5 py-4 mb-5 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-[18px] font-extrabold">Arrange your dashboard</span>
          <span className="text-[15px] text-slate-300">
            Drag a tile to where you want it. A teal bar shows where it will land; drop it beside a Half tile to sit next to it, and use Full / Half to resize. Press Done to see your dashboard.
          </span>
        </div>
      )}
        {/* While customizing the cards are compact numbered tiles, so every card and
            every drop spot is visible at once. */}
        <div className="flex flex-wrap gap-6">
        {cardLayout.map(({ key, width }, index) => (
          <DraggableCard
            key={key}
            cardKey={key}
            width={width}
            isCustomizing={isCustomizing}
            compact={isCustomizing}
            isDragging={draggingKey === key}
            dropPos={dropHint && dropHint.key === key ? dropHint.pos : null}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={clearDrag}
            onToggleWidth={handleToggleWidth}
          >
            {isCustomizing ? <LayoutTile cardKey={key} index={index} /> : cardsByKey[key]}
          </DraggableCard>
        ))}
        {isCustomizing && (
          <div
            onDragOver={(e) => { if (dragKeyRef.current) { e.preventDefault(); setDropHint((h) => (h ? null : h)); } }}
            onDrop={handleDropAtEnd}
            className="w-full rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 text-[16px] font-bold text-center py-5"
          >
            Drop here to move a card to the end
          </div>
        )}
        </div>
      </div>

      <SessionDetailDialog assessmentId={selectedSessionId} onClose={() => setSelectedSessionId(null)} />
    </div>
  );
}
