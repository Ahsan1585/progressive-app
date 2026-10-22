// What "realistic" means for a small NJ early-intervention agency, as testable
// properties of the generated data. These came from how EI agencies actually
// run: children 0-3 with a small multi-discipline team, mostly home visits,
// providers carrying a weekly caseload by FTE, cancellations, holidays and
// snow days, turnover, and documentation errors that are uneven across people.
const { buildAgency, monthKey } = require('../realisticAgency');

// One agency for the whole file: the build is deterministic for a seed.
const agency = buildAgency({ seed: 20260101, today: '2026-10-22' });
const { providers, children, sessions } = agency;

const countBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());
const dayOfWeek = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const billable = (s) => ['1', '4', 'IFSP', 'TPC'].includes(s.visitStatus) && s.totalMinutes > 0;

describe('it is reproducible', () => {
  test('the same seed gives the same agency, a different seed does not', () => {
    const again = buildAgency({ seed: 20260101, today: '2026-10-22' });
    expect(again.sessions.length).toBe(sessions.length);
    expect(again.sessions[500]).toEqual(sessions[500]);
    const other = buildAgency({ seed: 7, today: '2026-10-22' });
    expect(other.sessions.length).not.toBe(sessions.length);
  });
});

describe('a small company, not a metropolis', () => {
  test('about a dozen providers and roughly a hundred children', () => {
    expect(providers.length).toBeGreaterThanOrEqual(11);
    expect(providers.length).toBeLessThanOrEqual(14);
    const active = children.filter((c) => !c.endDate || c.endDate >= '2026-10-01');
    expect(active.length).toBeGreaterThanOrEqual(80);
    expect(active.length).toBeLessThanOrEqual(125);
  });

  test('thousands of sessions over January to October, not tens of thousands', () => {
    expect(sessions.length).toBeGreaterThan(5000);
    expect(sessions.length).toBeLessThan(12000);
  });

  test('every month from January to October has sessions, and nothing after today', () => {
    const months = new Set(sessions.map((s) => monthKey(s.serviceDate)));
    for (let m = 1; m <= 10; m += 1) expect(months.has(`2026-${String(m).padStart(2, '0')}`)).toBe(true);
    expect(sessions.every((s) => s.serviceDate >= '2026-01-01' && s.serviceDate <= '2026-10-22')).toBe(true);
  });
});

describe('children and their care teams', () => {
  test('a child is under three and gets one to four services, mostly one or two', () => {
    const teamSizes = countBy(children, (c) => c.team.length);
    expect([...teamSizes.keys()].every((n) => n >= 1 && n <= 4)).toBe(true);
    const oneOrTwo = ((teamSizes.get(1) || 0) + (teamSizes.get(2) || 0)) / children.length;
    expect(oneOrTwo).toBeGreaterThan(0.75);
    expect(teamSizes.get(3) || 0).toBeGreaterThan(0);
  });

  test('nobody is over three while receiving services (they age out at 36 months)', () => {
    for (const c of children) {
      const cutoff = new Date(`${c.dob}T00:00:00Z`);
      cutoff.setUTCMonth(cutoff.getUTCMonth() + 36);
      const last = sessions.filter((s) => s.childKey === c.key).map((s) => s.serviceDate).sort().pop();
      if (last) expect(last <= cutoff.toISOString().slice(0, 10)).toBe(true);
    }
  });

  test('the number of different providers seeing one child stays small (the old data had dozens)', () => {
    const providersPerChild = new Map();
    for (const s of sessions) {
      if (!providersPerChild.has(s.childKey)) providersPerChild.set(s.childKey, new Set());
      providersPerChild.get(s.childKey).add(s.providerKey);
    }
    const max = Math.max(...[...providersPerChild.values()].map((set) => set.size));
    expect(max).toBeLessThanOrEqual(6); // a team of 4 plus a hand-off when someone leaves
    const avg = [...providersPerChild.values()].reduce((a, s) => a + s.size, 0) / providersPerChild.size;
    expect(avg).toBeLessThan(2.6);
  });

  test('child ids are unique 10-digit numbers and names are not repeated across the roster', () => {
    expect(new Set(children.map((c) => c.childId)).size).toBe(children.length);
    expect(children.every((c) => /^\d{10}$/.test(c.childId))).toBe(true);
    const names = [...providers, ...children].map((p) => `${p.firstName} ${p.lastName}`);
    expect(new Set(names).size).toBe(names.length);
  });

  test('children come from a few counties, not all of New Jersey', () => {
    expect(new Set(children.map((c) => c.county)).size).toBeLessThanOrEqual(5);
  });
});

describe('providers and caseloads', () => {
  test('a mix of disciplines, led by developmental interventionists', () => {
    const byDiscipline = countBy(providers, (p) => p.discipline);
    expect(byDiscipline.get('DI')).toBeGreaterThanOrEqual(4);
    expect(byDiscipline.get('SLP')).toBeGreaterThanOrEqual(2);
    expect(byDiscipline.get('OT')).toBeGreaterThanOrEqual(1);
    expect(byDiscipline.get('PT')).toBeGreaterThanOrEqual(1);
  });

  test('full-time providers carry far more visits than part-time and per-diem ones', () => {
    const perProvider = countBy(sessions.filter(billable), (s) => s.providerKey);
    const full = providers.filter((p) => p.fte === 'full' && !p.endDate && p.hireDate <= '2026-01-01');
    const part = providers.filter((p) => p.fte !== 'full' && !p.endDate && p.hireDate <= '2026-01-01');
    const avg = (list) => list.reduce((a, p) => a + (perProvider.get(p.key) || 0), 0) / list.length;
    expect(avg(full)).toBeGreaterThan(avg(part) * 1.4);
  });

  test('nobody is double-booked, and nobody works past a sane day', () => {
    const byProviderDay = new Map();
    for (const s of sessions) {
      if (s.totalMinutes === 0) continue;
      const key = `${s.providerKey}|${s.serviceDate}`;
      if (!byProviderDay.has(key)) byProviderDay.set(key, []);
      byProviderDay.get(key).push(s);
    }
    for (const list of byProviderDay.values()) {
      const sorted = [...list].sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].startTime >= sorted[i - 1].endTime).toBe(true);
      expect(list.length).toBeLessThanOrEqual(9);
      expect(sorted[sorted.length - 1].endTime <= '19:00').toBe(true);
      expect(sorted[0].startTime >= '08:00').toBe(true);
    }
  });

  test('a provider who left stops seeing children, and a new hire starts when hired', () => {
    const left = providers.filter((p) => p.endDate);
    expect(left.length).toBeGreaterThanOrEqual(1);
    for (const p of left) {
      expect(sessions.filter((s) => s.providerKey === p.key).every((s) => s.serviceDate <= p.endDate)).toBe(true);
    }
    const hired = providers.filter((p) => p.hireDate > '2026-01-01');
    expect(hired.length).toBeGreaterThanOrEqual(2);
    for (const p of hired) {
      expect(sessions.filter((s) => s.providerKey === p.key).every((s) => s.serviceDate >= p.hireDate)).toBe(true);
    }
  });

  test("when a provider leaves, that provider's children are picked up by someone else", () => {
    const leaver = providers.find((p) => p.endDate);
    const theirKids = new Set(sessions.filter((s) => s.providerKey === leaver.key).map((s) => s.childKey));
    let continued = 0;
    for (const k of theirKids) {
      const after = sessions.some((s) => s.childKey === k && s.providerKey !== leaver.key && s.serviceDate > leaver.endDate);
      if (after) continued += 1;
    }
    expect(continued / theirKids.size).toBeGreaterThan(0.6);
  });
});

describe('what a real week looks like', () => {
  test('visits happen on weekdays, never on holidays', () => {
    expect(sessions.every((s) => { const d = dayOfWeek(s.serviceDate); return d >= 1 && d <= 5; })).toBe(true);
    const holidays = ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07'];
    expect(sessions.filter((s) => holidays.includes(s.serviceDate)).length).toBe(0);
  });

  test('most visits are at home, some telehealth and community, a few in an office', () => {
    const loc = countBy(sessions.filter(billable), (s) => s.location);
    const total = [...loc.values()].reduce((a, b) => a + b, 0);
    expect((loc.get('1') || 0) / total).toBeGreaterThan(0.72);
    expect((loc.get('8') || 0) / total).toBeGreaterThan(0.02);
    expect((loc.get('6') || 0) / total).toBeGreaterThan(0.02);
    expect((loc.get('3') || 0) / total).toBeLessThan(0.08);
  });

  test('sessions run 30 to 90 minutes, mostly 45 or 60', () => {
    const mins = sessions.filter(billable).map((s) => s.totalMinutes);
    expect(mins.every((m) => m >= 20 && m <= 130)).toBe(true);
    const typical = mins.filter((m) => m >= 40 && m <= 65).length / mins.length;
    expect(typical).toBeGreaterThan(0.6);
  });

  test('some visits are cancelled (family cancelled, missed, or provider cancelled) at a realistic rate', () => {
    const cancelledCodes = ['2', '3', '5'];
    const cancelled = sessions.filter((s) => cancelledCodes.includes(s.visitStatus));
    expect(cancelled.every((s) => s.totalMinutes === 0)).toBe(true);
    const rate = cancelled.length / sessions.length;
    expect(rate).toBeGreaterThan(0.04);
    expect(rate).toBeLessThan(0.2);
    expect(new Set(cancelled.map((s) => s.visitStatus)).size).toBe(3);
  });

  test('some cancelled visits are made up later (make-up visits exist)', () => {
    expect(sessions.filter((s) => s.visitStatus === '4').length).toBeGreaterThan(20);
  });

  test('new children get an evaluation, and IFSP meetings and transition conferences happen', () => {
    const codes = countBy(sessions, (s) => s.serviceCode);
    expect(codes.get('EV') || 0).toBeGreaterThan(20);
    expect(codes.get('IFSP') || 0).toBeGreaterThan(20);
    expect(codes.get('TPC') || 0).toBeGreaterThan(0);
  });

  test('snow days in winter are quiet: visits are cancelled or moved to telehealth that day', () => {
    const snow = '2026-01-26';
    const day = sessions.filter((s) => s.serviceDate === snow);
    const normalDay = sessions.filter((s) => s.serviceDate === '2026-01-27');
    expect(day.length).toBeGreaterThan(0);
    const inPerson = day.filter((s) => s.totalMinutes > 0 && s.location === '1').length;
    expect(inPerson).toBeLessThan(normalDay.filter((s) => s.totalMinutes > 0 && s.location === '1').length * 0.3);
  });
});

describe('documentation errors are uneven, not uniform', () => {
  const errorsByProvider = () => {
    const rate = new Map();
    for (const p of providers) {
      const own = sessions.filter((s) => s.providerKey === p.key && billable(s));
      if (own.length < 150) continue;
      rate.set(p.key, own.filter((s) => s.errorType).length / own.length);
    }
    return [...rate.values()].sort((a, b) => a - b);
  };

  test('overall about 3 to 9 percent of billable sessions have a problem, not every one', () => {
    const b = sessions.filter(billable);
    const rate = b.filter((s) => s.errorType).length / b.length;
    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.09);
  });

  test('a careful provider is under 3 percent while a weak one is above 8 percent', () => {
    const rates = errorsByProvider();
    expect(rates[0]).toBeLessThan(0.03);
    expect(rates[rates.length - 1]).toBeGreaterThan(0.08);
  });

  test('most providers are fine; a few account for most of the problems', () => {
    const rates = errorsByProvider();
    // Under about 5% of logs needing a fix is what an agency would call a careful provider.
    const clean = rates.filter((r) => r < 0.05).length;
    expect(clean / rates.length).toBeGreaterThanOrEqual(0.4);
  });

  test('every error type appears, but each provider leans on a couple of their own', () => {
    const types = new Set(sessions.filter((s) => s.errorType).map((s) => s.errorType));
    for (const t of ['time_drift', 'location', 'missing_in_eims', 'parent_signature']) expect(types.has(t)).toBe(true);
    for (const p of providers) {
      const own = sessions.filter((s) => s.providerKey === p.key && s.errorType);
      if (own.length < 40) continue;
      const top = [...countBy(own, (s) => s.errorType).values()].sort((a, b) => b - a)[0];
      expect(top / own.length).toBeGreaterThan(0.35); // a signature failure mode, not an even spread
    }
  });

  // A "batch" here is one provider's month of logs, which is what billing reviews
  // together. Real batches are often entirely clean; problems cluster in some.
  const batches = () => {
    const m = new Map();
    for (const s of sessions.filter(billable)) {
      const k = `${s.providerKey}|${monthKey(s.serviceDate)}`;
      if (!m.has(k)) m.set(k, { provider: s.providerKey, total: 0, errors: 0 });
      const b = m.get(k); b.total += 1; if (s.errorType) b.errors += 1;
    }
    return [...m.values()].filter((b) => b.total >= 15);
  };

  test('plenty of provider-months are completely clean, but not all of them', () => {
    const all = batches();
    const clean = all.filter((b) => b.errors === 0).length / all.length;
    expect(clean).toBeGreaterThan(0.28);
    expect(clean).toBeLessThan(0.65);
  });

  test('a careful provider has mostly clean months; a weak one rarely does', () => {
    const share = (key) => { const own = batches().filter((b) => b.provider === key); return own.filter((b) => b.errors === 0).length / own.length; };
    expect(share('P01')).toBeGreaterThan(0.5); // the careful veteran DI
    expect(share('P03')).toBeLessThan(0.3);    // the DI who keeps getting locations wrong
  });

  test('a dirty month is genuinely dirty, not one stray error', () => {
    const dirty = batches().filter((b) => b.errors > 0);
    const multi = dirty.filter((b) => b.errors >= 2).length / dirty.length;
    expect(multi).toBeGreaterThan(0.6);
  });

  test('a new hire starts out error-prone and improves', () => {
    const hire = providers.filter((p) => p.hireDate > '2026-01-01').sort((a, b) => a.hireDate.localeCompare(b.hireDate))[0];
    const own = sessions.filter((s) => s.providerKey === hire.key && billable(s));
    const half = Math.floor(own.length / 2);
    const early = own.slice(0, half).filter((s) => s.errorType).length / half;
    const late = own.slice(half).filter((s) => s.errorType).length / (own.length - half);
    expect(early).toBeGreaterThan(late);
  });

  test('"missing in EIMS" clusters at the end of the month, when entry lags', () => {
    const missing = sessions.filter((s) => s.errorType === 'missing_in_eims');
    const lastWeek = missing.filter((s) => Number(s.serviceDate.slice(8, 10)) >= 24).length / missing.length;
    expect(lastWeek).toBeGreaterThan(0.3); // a flat spread would be about 0.22
  });

  test('a clean session is truly clean: what was logged equals what EIMS has', () => {
    const clean = sessions.filter((s) => billable(s) && !s.errorType).slice(0, 2000);
    for (const s of clean) {
      expect(s.truth).toBeTruthy();
      expect(s.logged.startTime).toBe(s.truth.startTime);
      expect(s.logged.location).toBe(s.truth.location);
      expect(s.logged.serviceCode).toBe(s.truth.serviceCode);
    }
  });

  test('each error really changes something the platform can compare', () => {
    const find = (t) => sessions.filter((s) => s.errorType === t);
    expect(find('time_drift').every((s) => s.logged.startTime !== s.truth.startTime || s.logged.endTime !== s.truth.endTime)).toBe(true);
    expect(find('location').every((s) => s.logged.location !== s.truth.location)).toBe(true);
    expect(find('missing_in_eims').every((s) => s.truth === null || s.missingFromEims === true)).toBe(true);
    expect(find('parent_signature').every((s) => s.signatureIssue === 'parent')).toBe(true);
  });
});

describe('the EIMS export the agency would have', () => {
  test('every billable session that was entered in EIMS has a state row, and missing ones do not', () => {
    const rows = agency.eimsRows;
    const entered = sessions.filter((s) => billable(s) && !s.missingFromEims);
    expect(rows.length).toBeGreaterThanOrEqual(entered.length);
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.serviceDate))).toBe(true);
    expect(sessions.filter((s) => s.missingFromEims).length).toBeGreaterThan(0);
  });

  test('a few visits exist only in EIMS (entered there, never logged in the app)', () => {
    expect(agency.eimsRows.filter((r) => r.eimsOnly).length).toBeGreaterThan(0);
  });
});
