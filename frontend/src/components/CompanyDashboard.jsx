import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import {
  Tag, Activity, AlertTriangle, CalendarClock, TrendingUp, TrendingDown,
  CalendarDays, CalendarRange, Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

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

// --- Verdict banner: a plain-language judgment, not a stat tile, with
// the supporting numbers underneath it rather than standing alone. ---
function VerdictBanner({ day, ap }) {
  if (!day || !ap) {
    return (
      <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' }}>
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
    <section className="rounded-[20px] p-7 text-white shadow-sm" style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' }}>
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide mb-2.5" style={{ color: '#fde68a' }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fde68a' }} />
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

function ActionQueue({ day }) {
  const sessions = day?.flaggedSessions || [];
  const total = day?.flaggedCount || 0;
  const shown = sessions.slice(0, 4);
  const extra = Math.max(0, total - shown.length);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[15.5px] font-bold text-slate-900">What needs you</div>
        <div className="text-xs font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">{total} open</div>
      </div>
      {shown.length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-8">No open holds or returns. Nice.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((s) => {
            const age = daysAgo(s.flaggedAt || s.serviceDate);
            const isCritical = age !== null && age > 30;
            return (
              <div key={s.id} className="flex items-center gap-3 bg-slate-50 rounded-xl px-3.5 py-2.5">
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
              </div>
            );
          })}
          {extra > 0 && <div className="text-center text-xs text-slate-400 py-1.5">+ {extra} more</div>}
        </div>
      )}
    </div>
  );
}

function BillingFunnel({ pipeline }) {
  if (!pipeline) return null;
  const { logged, reviewed, invoiced, paid } = pipeline;

  const stages = [
    { label: 'Logged', value: logged, gradient: 'linear-gradient(90deg, #60a5fa, #2563eb)' },
    { label: 'Reviewed', value: reviewed, gradient: 'linear-gradient(90deg, #a78bfa, #7c3aed)' },
    { label: 'Invoiced', value: invoiced, gradient: 'linear-gradient(90deg, #2dd4bf, #0d9488)' },
    { label: 'Paid', value: paid, gradient: 'linear-gradient(90deg, #fbbf24, #d97706)' },
  ];
  const max = Math.max(logged, 1);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[15.5px] font-bold text-slate-900">Billing pipeline</div>
        <div className="text-[11.5px] font-semibold text-slate-500 bg-slate-50 px-2.5 py-1 rounded-full">{logged.toLocaleString()} total</div>
      </div>
      {stages.map((s) => (
        <div key={s.label} className="flex items-center gap-3 mb-3 last:mb-0">
          <div className="w-[88px] flex-shrink-0 text-xs font-semibold text-slate-500">{s.label}</div>
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

function EimsDonut({ month }) {
  const rate = month?.eimsMatchRate;
  if (!rate) return null;
  const total = rate.matched + rate.flagged + rate.missing + rate.unverified;
  if (total === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center">
        <div className="text-[15.5px] font-bold text-slate-900 self-start mb-4">EIMS match status</div>
        <div className="text-sm text-slate-400 py-8">No billed sessions yet this month.</div>
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

function DayTrajectory({ day, month }) {
  const daily = month?.dailyVolume || [];
  const last14 = daily.slice(-14);
  const todayCount = day?.sessionsLoggedToday || 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="text-2xl font-bold tracking-tight font-mono">
        {todayCount} <span className="text-sm text-slate-400 font-sans font-medium">sessions today</span>
      </div>
      <div className="text-xs text-slate-400 mt-1 mb-3">
        {todayCount === 0 ? 'Quiet so far — check back later if it stays empty.' : 'Logging is active today.'}
      </div>
      {last14.length > 0 && (
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={last14}>
              <defs>
                <linearGradient id="dayArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e8f0" />
              <XAxis dataKey="date" tickFormatter={(d) => new Date(d + 'T00:00:00').getDate()} tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9a9eb2' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip labelFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} />
              <Area type="monotone" dataKey="count" stroke="#7c3aed" strokeWidth={2.5} fill="url(#dayArea)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="text-[11.5px] text-slate-400 mt-2.5">Last 14 days of session volume.</div>
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

  useEffect(() => {
    api.get('/api/dashboard/day').then((res) => setDay(res.data)).catch(() => setDay(null));
    api.get('/api/dashboard/ap').then((res) => setAp(res.data)).catch(() => setAp(null));
    api.get('/api/dashboard/pipeline').then((res) => setPipeline(res.data)).catch(() => setPipeline(null));
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
          <ActionQueue day={day} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="text-lg font-bold text-slate-900">Where this is headed</div>
          <TrajectoryTabs active={trajectoryTab} onChange={setTrajectoryTab} />
        </div>
        <p className="text-sm text-slate-500 mb-4 max-w-2xl">Same work, three distances — the volume trend, and how it's reconciling against the state.</p>
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 items-start">
          {trajectoryTab === 'day' && <DayTrajectory day={day} month={month} />}
          {trajectoryTab === 'month' && <MonthTrajectory month={month} monthValue={monthValue} onMonthChange={setMonthValue} />}
          {trajectoryTab === 'year' && <YearTrajectory />}
          <EimsDonut month={month} />
        </div>
      </div>
    </div>
  );
}
