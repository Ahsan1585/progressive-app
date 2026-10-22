'use strict';
// A deterministic model of a SMALL New Jersey early-intervention agency running
// on Izaya EIS for ten months of 2026. No database, no I/O: pure functions that
// return providers, children, session logs and the matching EIMS export rows, so
// the shape of the data can be unit-tested before anything is written anywhere.
//
// How real EI agencies work, as modelled here:
//  - Children are 0-3. A child gets a small IFSP team (mostly 1-2 services, a few
//    3-4) from different disciplines, at a set frequency, mostly in the home.
//  - A provider's caseload is bounded by their FTE. A new referral goes to the
//    provider with room (preferring their counties); when nobody has room the
//    service waits (real agencies have waitlists). When a provider leaves, their
//    children are handed to colleagues after a short gap.
//  - Weekly visits are scheduled onto the provider's workdays, one after another
//    with travel time, never on holidays; snow days turn into telehealth or
//    cancellations. About 1 in 8 visits is cancelled by the family or provider;
//    about half of those are made up.
//  - Documentation errors are uneven: most providers are careful, a few are not,
//    each has a typical way of getting it wrong, new hires start rough and
//    improve, and "not yet entered in EIMS" piles up at month end.

// ---------------------------------------------------------------- random + dates
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toDate = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const addMonths = (s, n) => { const d = toDate(s); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const dow = (s) => toDate(s).getUTCDay(); // 0 Sunday .. 6 Saturday
const weekStart = (s) => addDays(s, -((dow(s) + 6) % 7)); // the Monday
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
const monthKey = (s) => s.slice(0, 7);
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (min) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const shiftTime = (t, delta) => hhmm(Math.max(0, minutesOf(t) + delta));

// Closed days (federal/NJ holidays; July 4th fell on a Saturday so Friday was observed).
const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07']);
// Winter storm closures: the agency is closed for in-person visits.
const SNOW_DAYS = new Set(['2026-01-26', '2026-02-20']);

// ---------------------------------------------------------------- reference data
const POSITION_TITLE = {
  DI: 'Developmental Interventionist', SLP: 'Speech Language Pathologist', OT: 'Occupational Therapist',
  PT: 'Physical Therapist', SW: 'Social Worker',
};
const SERVICE_LABEL = {
  DI: 'Developmental Intervention', SLP: 'Speech Language Therapy', OT: 'Occupational Therapy',
  PT: 'Physical Therapy', SW: 'Social Work', FT: 'Family Training', EV: 'Evaluation',
  IFSP: 'IFSP Meeting', TPC: 'Transition Planning Conference',
};
const LOCATION_LABEL = {
  1: 'Home', 3: 'Service Provider Clinic/Office', 6: 'EC Program - Inclusive Community', 8: 'Phone/Video Conferencing',
};
const GROUP_LABEL = {
  individual: 'Direct Child Service - Individual', consultation: 'Consultation/Facilitation with Others',
  evaluation: 'Evaluation/Assessment',
};
const VISIT_STATUS_LABEL = {
  1: 'Direct Child Service', 2: 'Practitioner Cancelled (inc weather related)', 3: 'Family Cancelled (inc weather related)',
  4: 'Make Up Direct Child Service', 5: 'Family Missed (within 3 hours)', IFSP: 'Team Mtg – IFSP', TPC: 'Transition Planning Conference',
};
const BILLABLE_STATUS = new Set(['1', '4', 'IFSP', 'TPC']);

const PROVIDER_FIRST = ['Priya', 'Marcus', 'Danielle', 'Tomas', 'Keisha', 'Rachel', 'Omar', 'Jenna', 'Victor', 'Alicia',
  'Brian', 'Nadia', 'Colleen', 'Raj', 'Monica', 'Derek', 'Lauren', 'Hector', 'Simone', 'Patrick'];
const PROVIDER_LAST = ['Okafor', 'Delgado', 'Whitaker', 'Nguyen', 'Brennan', 'Castellano', 'Abernathy', 'Kowalski', 'Mehta',
  'Rosario', 'Fitzpatrick', 'Banerjee', 'Lombardi', 'Washington', 'Yoon', 'Santiago', 'McAllister', 'Petrov', 'Adeyemi', 'Haddad'];
const KID_FIRST = ['Mateo', 'Sophia', 'Liam', 'Isabella', 'Noah', 'Amara', 'Ethan', 'Zoe', 'Lucas', 'Camila', 'Aiden', 'Layla',
  'Elijah', 'Nora', 'Jayden', 'Mila', 'Daniel', 'Aaliyah', 'Julian', 'Ruby', 'Caleb', 'Leah', 'Santiago', 'Hazel', 'Wyatt',
  'Naomi', 'Henry', 'Ivy', 'Owen', 'Maya', 'Leo', 'Ella', 'Gabriel', 'Chloe', 'Isaac', 'Emma', 'Adrian', 'Lily', 'Dominic',
  'Avery', 'Theo', 'Sienna', 'Jaden', 'Aria', 'Miles', 'Eliana', 'Nico', 'Harper', 'Xavier', 'Penelope', 'Kai', 'Willow',
  'Rowan', 'Esme', 'Beckett', 'Anaya', 'Ezra', 'Delilah', 'Micah', 'Priya', 'Arjun', 'Fatima', 'Yusuf', 'Mei', 'Kenji',
  'Adaeze', 'Tobias', 'Imani', 'Rafael', 'Luciana', 'Andre', 'Talia', 'Jasper', 'Valentina', 'Cruz', 'Nia', 'Soren', 'Alma',
  'Emeka', 'Rosa', 'Felix', 'Greta', 'Hugo', 'Ingrid', 'Jonah', 'Kira', 'Lorenzo', 'Marisol', 'Nolan', 'Odette', 'Pablo',
  'Quinn', 'Remy', 'Stella', 'Tariq', 'Uma', 'Vera', 'Wesley', 'Ximena', 'Yara', 'Zane', 'Beatrice', 'Cedric', 'Dahlia',
  'Eamon', 'Freya', 'Gideon', 'Honor', 'Idris', 'Juno', 'Knox', 'Luz', 'Mabel', 'Nash'];
const KID_LAST = ['Alvarez', 'Bianchi', 'Carter', 'Dubois', 'Edwards', 'Fernandez', 'Gallagher', 'Hernandez', 'Ibrahim', 'Jackson',
  'Kim', 'Lopez', 'Moreno', 'Nakamura', 'Oliveira', 'Patel', 'Quintero', 'Robinson', 'Singh', 'Thompson', 'Underwood',
  'Vasquez', 'Williams', 'Xu', 'Young', 'Zimmerman', 'Anderson', 'Baptiste', 'Cohen', 'Diaz', 'Evans', 'Flores', 'Garcia',
  'Harris', 'Irving', 'Jenkins', 'Khan', 'Lewis', 'Martinez', 'Nelson', 'Ortiz', 'Parker', 'Ramirez', 'Sanders', 'Torres',
  'Usman', 'Valdez', 'Walker', 'Yilmaz', 'Zhang', 'Abdi', 'Brooks', 'Cruz', 'Dang', 'Esposito', 'Foster', 'Gomez', 'Hughes',
  'Iqbal', 'Jordan', 'Kowalczyk', 'Lee', 'Murphy', 'Nunez', "O'Connor", 'Perez', 'Quinn', 'Rivera', 'Sullivan', 'Tran',
  'Ulloa', 'Vega', 'Wright', 'Yadav', 'Zielinski', 'Adams', 'Bell', 'Chavez', 'Dixon', 'Ellis', 'Francis', 'Grant', 'Howard',
  'Ivanov', 'James', 'Keller', 'Lawson', 'Mason', 'Newman', 'Owens', 'Price', 'Reed', 'Stone', 'Turner', 'Upton', 'Vargas',
  'Watson', 'Xiong', 'York', 'Zamora', 'Bailey', 'Crawford', 'Daniels', 'Escobar', 'Fuentes', 'Gibson', 'Holland', 'Jimenez',
  'Kaplan', 'Lowe', 'Mendoza', 'Navarro', 'Pruitt', 'Ramos', 'Silva', 'Trujillo'];
const COUNTY_WEIGHTS = { Essex: 35, Hudson: 25, Bergen: 25, Passaic: 15 };

// The provider roster. cap = most visits per week at full speed. err.mix says how
// THIS person tends to get it wrong; err.rate is their share of sessions with a problem.
const PROVIDER_PLAN = [
  { d: 'DI', fte: 'full', days: [1, 2, 3, 4, 5], cap: 21, counties: ['Essex', 'Passaic'], hire: '2023-09-05', pay: 62,
    err: { rate: 0.018, mix: { time_drift: 3, location: 1, missing_in_eims: 1, parent_signature: 0.5 } } },
  { d: 'DI', fte: 'full', days: [1, 2, 3, 4, 5], cap: 21, counties: ['Hudson', 'Bergen'], hire: '2024-02-12', end: '2026-06-12', pay: 60,
    err: { rate: 0.045, mix: { time_drift: 4, missing_in_eims: 2, location: 1 } } },
  { d: 'DI', fte: 'full', days: [1, 2, 3, 4, 5], cap: 20, counties: ['Bergen', 'Passaic'], hire: '2024-06-03', pay: 61,
    err: { rate: 0.105, mix: { location: 6, time_drift: 2, missing_in_eims: 1 } } },
  { d: 'DI', fte: 'part', days: [1, 2, 4], cap: 12, counties: ['Essex', 'Hudson'], hire: '2025-01-13', pay: 63,
    err: { rate: 0.022, mix: { time_drift: 2, missing_in_eims: 1, parent_signature: 1 } } },
  { d: 'DI', fte: 'part', days: [1, 2, 3, 4], cap: 15, counties: ['Essex', 'Hudson', 'Bergen'], hire: '2026-03-09', pay: 59, newHire: true,
    err: { rate: 0.06, mix: { time_drift: 5, location: 2, missing_in_eims: 1.5, parent_signature: 1 } } },
  { d: 'DI', fte: 'part', days: [2, 3, 4], cap: 11, counties: ['Passaic', 'Bergen', 'Essex'], hire: '2026-08-17', pay: 0, newHire: true,
    err: { rate: 0.06, mix: { time_drift: 2, location: 3, missing_in_eims: 1 } } },
  { d: 'SLP', fte: 'full', days: [1, 2, 3, 4, 5], cap: 19, counties: ['Essex', 'Hudson', 'Bergen'], hire: '2023-11-06', pay: 92,
    err: { rate: 0.036, mix: { time_drift: 5, missing_in_eims: 2, location: 1 } } },
  { d: 'SLP', fte: 'part', days: [1, 3, 5], cap: 11, counties: ['Passaic', 'Bergen'], hire: '2025-04-07', pay: 90,
    err: { rate: 0.09, mix: { parent_signature: 6, time_drift: 2, missing_in_eims: 1 } } },
  { d: 'SLP', fte: 'perdiem', days: [2, 4], cap: 6, counties: ['Hudson', 'Essex'], hire: '2025-09-15', pay: 95,
    err: { rate: 0.07, mix: { missing_in_eims: 7, time_drift: 1 } } },
  { d: 'OT', fte: 'full', days: [1, 2, 3, 4, 5], cap: 17, counties: ['Essex', 'Hudson', 'Bergen', 'Passaic'], hire: '2024-01-08', pay: 88,
    err: { rate: 0.025, mix: { time_drift: 3, missing_in_eims: 1, location: 1 } } },
  { d: 'OT', fte: 'part', days: [2, 3, 5], cap: 9, counties: ['Bergen', 'Passaic'], hire: '2025-06-02', pay: 86,
    err: { rate: 0.038, mix: { time_drift: 3, service_code: 2, location: 1 } } },
  { d: 'PT', fte: 'part', days: [1, 2, 3], cap: 10, counties: ['Essex', 'Hudson', 'Bergen', 'Passaic'], hire: '2024-09-09', pay: 90,
    err: { rate: 0.05, mix: { time_drift: 6, location: 1 } } },
  { d: 'SW', fte: 'part', days: [3, 4], cap: 5, counties: ['Essex', 'Hudson', 'Bergen', 'Passaic'], hire: '2024-05-20', pay: 66,
    err: { rate: 0.012, mix: { time_drift: 1, missing_in_eims: 1 } } },
];

// How often each discipline sees a child (visits/month) and how long (minutes).
const FREQUENCY = {
  DI: [[4, 55], [8, 20], [2, 25]],
  SLP: [[2, 40], [4, 45], [6, 15]],
  OT: [[2, 55], [4, 45]],
  PT: [[2, 60], [4, 40]],
  SW: [[1, 70], [2, 30]],
};
const MINUTES = {
  DI: [[60, 70], [45, 20], [30, 10]],
  SLP: [[45, 40], [60, 40], [30, 20]],
  OT: [[45, 50], [60, 40], [30, 10]],
  PT: [[45, 50], [60, 40], [30, 10]],
  SW: [[60, 60], [45, 40]],
};
const TEAM_SIZE = [[1, 52], [2, 33], [3, 12], [4, 3]];
const FIRST_SERVICE = [['DI', 60], ['SLP', 22], ['OT', 9], ['PT', 6], ['SW', 3]];
const OTHER_SERVICE = [['SLP', 38], ['OT', 26], ['DI', 20], ['PT', 12], ['SW', 4]];

const NOTE_TEMPLATES = {
  DI: ['Played with stacking cups and shape sorter, worked on turn taking.', 'Practiced pointing to request items during snack. Caregiver modeled.',
    'Reviewed sleep routine with mom and set a visual schedule.', 'Floor play focused on imitation of gestures. Good eye contact.',
    'Sensory bin activity, tolerated textures for 10 minutes. Caregiver coached.', 'Practiced transitions using a timer and a song.'],
  SLP: ['Targeted 2 word combinations during book reading.', 'Modeled signs for more and all done. Child imitated 3 of 5.',
    'Worked on following 1-step directions in play.', 'Introduced picture exchange for snack choices.', 'Oral motor warm up, then sound play with bubbles.'],
  OT: ['Fine motor: pincer grasp with puffs and a container.', 'Practiced spoon use during lunch. Caregiver coached on grip.',
    'Sensory diet review. Added heavy work before transitions.', 'Bilateral hand use with pop beads and play dough.'],
  PT: ['Practiced pull to stand at the couch, then cruising.', 'Tummy time progressions and weight shift activities.',
    'Stair practice with hand held assist, 4 steps.', 'Balance on a foam pad and step overs.'],
  SW: ['Reviewed community resources and WIC paperwork with parent.', 'Check in on family stress and sleep. Provided respite list.',
    'Helped family with SPOE paperwork and transportation options.'],
  EV: ['Completed developmental evaluation with parent interview.'],
  IFSP: ['IFSP meeting with family and team. Outcomes reviewed and updated.'],
  TPC: ['Transition planning conference. Preschool options discussed with parent.'],
};

function buildAgency(options = {}) {
  const seed = options.seed ?? 20260101;
  const START = options.start || '2026-01-01';
  const TODAY = options.today || '2026-10-22';
  const rand = mulberry32(seed);
  const chance = (p) => rand() < p;
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const weighted = (pairs) => {
    const total = pairs.reduce((s, [, w]) => s + w, 0);
    let r = rand() * total;
    for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  const weightedObj = (obj) => weighted(Object.entries(obj));
  const shuffled = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ------------------------------------------------------------ names (unique)
  const usedNames = new Set();
  const uniqueName = (firsts, lasts) => {
    for (let i = 0; i < 500; i += 1) {
      const f = pick(firsts); const l = pick(lasts);
      const k = `${f} ${l}`;
      if (!usedNames.has(k)) { usedNames.add(k); return [f, l]; }
    }
    throw new Error('name pool exhausted');
  };

  // ------------------------------------------------------------ providers
  const providers = PROVIDER_PLAN.map((plan, i) => {
    const [firstName, lastName] = uniqueName(PROVIDER_FIRST, PROVIDER_LAST);
    return {
      key: `P${pad2(i + 1)}`,
      firstName, lastName,
      email: `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z.]/g, '') + '@izayaedge-demo.test',
      discipline: plan.d,
      positionTitle: POSITION_TITLE[plan.d],
      payRate: plan.pay,
      fte: plan.fte,
      workDays: plan.days,
      cap: plan.cap,
      counties: plan.counties,
      hireDate: plan.hire,
      endDate: plan.end || null,
      newHire: !!plan.newHire,
      errorProfile: plan.err,
    };
  });
  const providerByKey = new Map(providers.map((p) => [p.key, p]));
  const activeOn = (p, date) => p.hireDate <= date && (!p.endDate || p.endDate >= date);
  // New hires take a ramp: they cannot carry a full caseload on day one.
  const capOn = (p, date) => {
    if (p.hireDate <= START) return p.cap;
    const weeks = daysBetween(p.hireDate, date) / 7;
    return p.cap * Math.min(1, 0.3 + weeks / 10);
  };

  // ------------------------------------------------------------ children
  const children = [];
  const makeTeam = (ageMonths) => {
    const size = weighted(TEAM_SIZE);
    const picked = [weighted(FIRST_SERVICE)];
    while (picked.length < size) {
      const d = weighted(OTHER_SERVICE);
      if (!picked.includes(d)) picked.push(d);
    }
    return picked.map((d) => ({
      discipline: d,
      perMonth: weighted(FREQUENCY[d]),
      minutes: weighted(MINUTES[d]),
      segments: [],
      usualDay: null,
    }));
  };
  const makeChild = (index, kind, startDate, ageAtStartMonths) => {
    const [firstName, lastName] = uniqueName(KID_FIRST, KID_LAST);
    const dob = addDays(addMonths(startDate, -ageAtStartMonths), -int(0, 27));
    const age36 = addDays(addMonths(dob, 36), -1);
    let endDate = age36;
    let exitReason = 'aged_out';
    if (chance(0.10)) { endDate = addDays(startDate, int(60, 260)); exitReason = 'goals_met'; }
    else if (chance(0.03)) { endDate = addDays(startDate, int(30, 200)); exitReason = 'moved'; }
    if (endDate > age36) { endDate = age36; exitReason = 'aged_out'; }
    const lastDay = endDate;
    return {
      key: `C${String(index).padStart(3, '0')}`,
      firstName, lastName,
      childId: `71${String(10000000 + index)}`,
      dob,
      county: weightedObj(COUNTY_WEIGHTS),
      startDate,
      endDate: lastDay > TODAY ? null : lastDay,
      lastDay,
      exitReason: lastDay > TODAY ? null : exitReason,
      parentName: `${pick(['Maria', 'John', 'Aisha', 'David', 'Priya', 'Michael', 'Jennifer', 'Carlos', 'Fatima', 'Robert', 'Linda', 'Ahmed', 'Sarah', 'Wei'])} ${lastName}`,
      parentEmail: `${lastName}.family${index}@example.com`.toLowerCase().replace(/[^a-z0-9.@]/g, ''),
      kind,
      cancelRate: Math.min(0.3, 0.05 + 0.18 * rand() * rand() * 2),
      defaultLocation: weighted([['1', 86], ['6', 10], ['3', 4]]),
      telehealthLean: chance(0.12) ? 0.3 : 0.03,
      preferMorning: chance(0.55),
      team: makeTeam(ageAtStartMonths),
      ifspAnchor: kind === 'census' ? addDays(START, -int(10, 175)) : startDate,
    };
  };
  let childIndex = 1;
  // Census on January 1st: already enrolled, ages 6-30 months.
  for (let i = 0; i < 72; i += 1) {
    const age = int(6, 30);
    children.push(makeChild(childIndex, 'census', START, age)); childIndex += 1;
  }
  // New referrals starting through the year (a bit slower in the summer).
  const referralsPerMonth = [6, 6, 6, 7, 6, 6, 5, 3, 6, 5];
  for (let m = 0; m < 10; m += 1) {
    for (let n = 0; n < referralsPerMonth[m]; n += 1) {
      const monthStart = addMonths(START, m);
      let d = addDays(monthStart, int(0, 26));
      while (dow(d) === 0 || dow(d) === 6 || HOLIDAYS.has(d)) d = addDays(d, 1);
      if (d > addDays(TODAY, -3)) continue;
      children.push(makeChild(childIndex, 'referral', d, weighted([[int(4, 11), 25], [int(12, 22), 55], [int(23, 30), 20]])));
      childIndex += 1;
    }
  }
  children.forEach((c) => { c.team.forEach((s) => { s.usualDay = int(0, 4); }); });

  // ------------------------------------------------------------ assignment (events)
  const load = new Map(providers.map((p) => [p.key, 0]));
  const perWeekOf = (svc) => svc.perMonth / 4.33;
  const assignProvider = (date, svc, child) => {
    const need = perWeekOf(svc);
    let best = null;
    for (const p of providers) {
      if (p.discipline !== svc.discipline || !activeOn(p, date)) continue;
      const room = capOn(p, date);
      if (load.get(p.key) + need > room * 1.03) continue;
      const score = (load.get(p.key) + need) / room + (p.counties.includes(child.county) ? 0 : 0.4) + rand() * 0.05;
      if (!best || score < best.score) best = { p, score };
    }
    return best ? best.p : null;
  };
  const events = [];
  const pushEvent = (e) => { events.push(e); events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order)); };
  children.forEach((c) => {
    c.team.forEach((svc) => pushEvent({ date: c.startDate, order: 1, type: 'assign', child: c, svc }));
    if (c.lastDay <= TODAY) pushEvent({ date: addDays(c.lastDay, 1), order: 0, type: 'release', child: c });
  });
  providers.filter((p) => p.endDate).forEach((p) => pushEvent({ date: addDays(p.endDate, 1), order: 0, type: 'leaves', provider: p }));

  const openSegment = (svc) => svc.segments.find((s) => s.to === null);
  while (events.length) {
    const e = events.shift();
    if (e.date > TODAY) continue;
    if (e.type === 'assign') {
      if (e.date > e.child.lastDay) continue;
      const p = assignProvider(e.date, e.svc, e.child);
      if (p) {
        e.svc.segments.push({ providerKey: p.key, from: e.date, to: null });
        load.set(p.key, load.get(p.key) + perWeekOf(e.svc));
      } else {
        // Nobody has room: the service waits a few weeks (a real waitlist).
        pushEvent({ ...e, date: addDays(e.date, 7 * int(2, 7)), order: 1 });
      }
    } else if (e.type === 'release') {
      e.child.team.forEach((svc) => {
        const seg = openSegment(svc);
        if (seg) { seg.to = addDays(e.date, -1); load.set(seg.providerKey, load.get(seg.providerKey) - perWeekOf(svc)); }
      });
    } else if (e.type === 'leaves') {
      children.forEach((c) => c.team.forEach((svc) => {
        const seg = openSegment(svc);
        if (seg && seg.providerKey === e.provider.key) {
          seg.to = e.provider.endDate;
          load.set(seg.providerKey, load.get(seg.providerKey) - perWeekOf(svc));
          // The hand-off: a colleague picks the child up after a short gap.
          if (c.lastDay > e.date) pushEvent({ date: addDays(e.date, int(5, 14)), order: 1, type: 'assign', child: c, svc });
        }
      }));
    }
  }

  // ------------------------------------------------------------ requests: who needs a visit when
  const requests = []; // { providerKey, childKey, date, svc info, kind }
  const providerWorkdays = (p) => p.workDays;
  const isWorkday = (p, date) => providerWorkdays(p).includes(dow(date)) && !HOLIDAYS.has(date) && activeOn(p, date);
  const nextWorkday = (p, from, maxAhead = 10) => {
    for (let i = 0; i <= maxAhead; i += 1) { const d = addDays(from, i); if (d <= TODAY && isWorkday(p, d)) return d; }
    return null;
  };

  const childByKey = new Map(children.map((c) => [c.key, c]));
  const addRequest = (r) => requests.push(r);

  children.forEach((c) => {
    c.team.forEach((svc) => {
      svc.segments.forEach((seg) => {
        const p = providerByKey.get(seg.providerKey);
        const from = seg.from > c.startDate ? seg.from : c.startDate;
        const to = [seg.to || '9999-12-31', c.lastDay, TODAY].sort()[0];
        if (from > to) return;
        const days = p.workDays;
        const perWeek = perWeekOf(svc);
        for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
          const candidates = [];
          for (const wd of days) {
            const d = addDays(w, wd - 1);
            if (d >= from && d <= to && !HOLIDAYS.has(d)) candidates.push(d);
          }
          if (!candidates.length) continue;
          const k = Math.floor(perWeek) + (chance(perWeek - Math.floor(perWeek)) ? 1 : 0);
          if (!k) continue;
          const usual = candidates.find((d) => dow(d) === days[svc.usualDay % days.length]);
          const chosen = new Set();
          if (usual && chance(0.78)) chosen.add(usual);
          const pool = shuffled(candidates);
          for (const d of pool) { if (chosen.size >= k) break; chosen.add(d); }
          for (const date of chosen) {
            addRequest({ providerKey: p.key, childKey: c.key, date, kind: 'regular', svc });
          }
        }
      });
    });
  });

  // Evaluations for new referrals (a DI evaluator, and an SLP one for half of them).
  const primaryProviderOn = (c, date) => {
    for (const svc of c.team) {
      const seg = svc.segments.find((s) => s.from <= date && (!s.to || s.to >= date));
      if (seg) return { providerKey: seg.providerKey, svc };
    }
    return null;
  };
  children.filter((c) => c.kind === 'referral').forEach((c) => {
    const evalDate = addDays(c.startDate, -int(9, 20));
    if (evalDate < START) return;
    const disciplines = chance(0.5) ? ['DI', 'SLP'] : ['DI'];
    disciplines.forEach((d) => {
      const p = shuffled(providers.filter((x) => x.discipline === d && activeOn(x, evalDate)))
        .find((x) => nextWorkday(x, evalDate, 6));
      if (!p) return;
      addRequest({ providerKey: p.key, childKey: c.key, date: nextWorkday(p, evalDate, 6), kind: 'EV', minutes: d === 'DI' ? 90 : 60, svc: { discipline: d } });
    });
  });
  // IFSP reviews every six months, and the transition conference around 28 months.
  children.forEach((c) => {
    for (let k = c.kind === 'census' ? 0 : 1; k < 4; k += 1) {
      const date = addMonths(c.ifspAnchor, 6 * k);
      if (date < START || date > TODAY || date > c.lastDay || date < c.startDate) continue;
      const who = primaryProviderOn(c, date);
      if (!who) continue;
      const p = providerByKey.get(who.providerKey);
      const d = nextWorkday(p, date, 5);
      if (d) addRequest({ providerKey: p.key, childKey: c.key, date: d, kind: 'IFSP', minutes: 60, svc: { discipline: 'IFSP' } });
    }
    const tpc = addDays(addMonths(c.dob, 28), int(0, 20));
    if (tpc >= (START > c.startDate ? START : c.startDate) && tpc <= TODAY && tpc <= c.lastDay) {
      const who = primaryProviderOn(c, tpc);
      if (who) {
        const p = providerByKey.get(who.providerKey);
        const d = nextWorkday(p, tpc, 5);
        if (d) addRequest({ providerKey: p.key, childKey: c.key, date: d, kind: 'TPC', minutes: 60, svc: { discipline: 'TPC' } });
      }
    }
  });

  // ------------------------------------------------------------ outcomes, placement, sessions
  const sessions = [];
  const placedByProviderDay = new Map();
  const byProviderDate = new Map();
  const enqueue = (r) => {
    const k = `${r.providerKey}|${r.date}`;
    if (!byProviderDate.has(k)) byProviderDate.set(k, []);
    byProviderDate.get(k).push(r);
  };
  requests.forEach(enqueue);

  const logCancelled = (r, status) => {
    if (!chance(0.7)) return; // the family called ahead and nobody wrote it down
    sessions.push({ providerKey: r.providerKey, childKey: r.childKey, serviceDate: r.date, startTime: null, endTime: null, totalMinutes: 0,
      visitStatus: status, serviceCode: r.svc.discipline, location: '1', groupSize: 'individual', notes: '', errorType: null, signatureIssue: null,
      missingFromEims: false, truth: null, logged: { startTime: null, endTime: null, location: '1', serviceCode: r.svc.discipline } });
  };
  const scheduleMakeup = (r) => {
    if (!chance(0.5)) return;
    const p = providerByKey.get(r.providerKey);
    const d = nextWorkday(p, addDays(r.date, int(3, 8)), 4);
    if (d) enqueue({ ...r, date: d, kind: 'makeup', moves: 0 });
  };

  const allKeys = [...byProviderDate.keys()].sort((a, b) => {
    const [pa, da] = a.split('|'); const [pb, db] = b.split('|');
    return da < db ? -1 : da > db ? 1 : pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  const processed = new Set();
  // Dates are processed in order; overflow and make-ups add keys, so loop until stable.
  let guard = 0;
  while (guard < 200000) {
    guard += 1;
    const keys = [...byProviderDate.keys()].filter((k) => !processed.has(k)).sort((a, b) => {
      const da = a.split('|')[1]; const db = b.split('|')[1];
      return da < db ? -1 : da > db ? 1 : a < b ? -1 : 1;
    });
    if (!keys.length) break;
    const key = keys[0];
    processed.add(key);
    const [providerKey, date] = key.split('|');
    const p = providerByKey.get(providerKey);
    const list = byProviderDate.get(key);
    const child = (r) => childByKey.get(r.childKey);

    // 1. outcome of each request
    const live = [];
    for (const r of list) {
      const c = child(r);
      if (date > c.lastDay) continue;
      if (SNOW_DAYS.has(date)) {
        const x = rand();
        if (x < 0.6) { live.push({ ...r, forceLocation: '8' }); continue; }
        if (x < 0.75) { logCancelled(r, '2'); continue; }
        logCancelled(r, '3'); continue;
      }
      if (r.kind === 'regular' && chance(c.cancelRate)) {
        const x = rand();
        if (x < 0.22) { logCancelled(r, '2'); scheduleMakeup(r); }
        else if (x < 0.78) { logCancelled(r, '3'); scheduleMakeup(r); }
        else { logCancelled(r, '5'); }
        continue;
      }
      live.push(r);
    }
    if (!live.length) continue;

    // 2. place the day's visits one after another with travel time
    const ordered = live.map((r) => {
      const c = child(r);
      const pref = (c.preferMorning ? 9 * 60 + int(0, 150) : 13 * 60 + 30 + int(0, 180));
      return { r, pref };
    }).sort((a, b) => a.pref - b.pref);
    let cursor = 8 * 60 + 30 + int(0, 50);
    for (const { r, pref } of ordered) {
      const c = child(r);
      const baseMinutes = r.minutes || r.svc.minutes || 45;
      const consult = r.kind === 'regular' && chance(0.09) && r.svc.discipline !== 'DI' ? false : (r.kind === 'regular' && chance(0.07));
      const minutes = consult ? 30 : Math.max(20, baseMinutes + pick([0, 0, 0, 5, -5, 10]));
      const telehealth = r.forceLocation === '8' || (r.kind === 'regular' && chance(c.telehealthLean));
      const location = telehealth ? '8' : (r.kind === 'IFSP' || r.kind === 'TPC' ? (chance(0.45) ? '8' : '1') : (chance(0.9) ? c.defaultLocation : pick(['1', '6'])));
      let start = Math.max(cursor, Math.min(pref, 16 * 60));
      start = Math.round(start / 5) * 5;
      if (start < 12 * 60 + 30 && start + minutes > 12 * 60 + 30) start = 13 * 60 + 15; // lunch
      if (start + minutes > 17 * 60 + 30) {
        // out of day: slide to the provider's next workday (up to twice), else give up and cancel
        const moves = (r.moves || 0) + 1;
        const nd = moves <= 2 ? nextWorkday(p, addDays(date, 1), 5) : null;
        if (nd) enqueue({ ...r, date: nd, moves });
        else logCancelled(r, '2');
        continue;
      }
      cursor = start + minutes + (location === '8' ? 5 : 15 + int(0, 15));
      const status = r.kind === 'IFSP' ? 'IFSP' : r.kind === 'TPC' ? 'TPC' : r.kind === 'makeup' ? '4' : '1';
      const serviceCode = r.kind === 'EV' ? 'EV' : r.kind === 'IFSP' ? 'IFSP' : r.kind === 'TPC' ? 'TPC' : r.svc.discipline;
      const groupSize = r.kind === 'EV' ? 'evaluation' : (r.kind === 'IFSP' || r.kind === 'TPC' || consult) ? 'consultation' : 'individual';
      const templates = NOTE_TEMPLATES[r.kind === 'EV' ? 'EV' : r.kind === 'IFSP' ? 'IFSP' : r.kind === 'TPC' ? 'TPC' : r.svc.discipline] || NOTE_TEMPLATES.DI;
      sessions.push({
        providerKey: r.providerKey, childKey: r.childKey, serviceDate: date,
        startTime: hhmm(start), endTime: hhmm(start + minutes), totalMinutes: minutes,
        visitStatus: status, serviceCode, location, groupSize,
        notes: pick(templates), errorType: null, signatureIssue: null, missingFromEims: false,
        truth: null, logged: null,
      });
    }
  }

  // ------------------------------------------------------------ truth vs logged, with uneven errors
  const tenureMult = (p, date) => (p.hireDate > START ? 1 + 2.6 * Math.exp(-(daysBetween(p.hireDate, date) / 7) / 7) : 1);
  const ERROR_ALT_LOCATION = { 1: ['6', '8'], 6: ['1'], 8: ['1'], 3: ['1'] };
  const ERROR_ALT_SERVICE = { DI: 'FT', SLP: 'DI', OT: 'PT', PT: 'OT', SW: 'DI' };
  const eimsRows = [];
  // A batch is one provider's month of logs (what billing reviews together). Many
  // batches are entirely clean; the provider's overall error rate is kept by making
  // the batches that DO have problems proportionally worse. Careful providers have
  // mostly clean months, weak ones rarely do, and a new hire's first months are dirty.
  const batchClean = new Map();
  const cleanProbFor = (p, date) => {
    const effective = p.errorProfile.rate * tenureMult(p, `${monthKey(date)}-15`);
    return Math.min(0.85, Math.max(0.05, 0.9 - 7 * effective));
  };
  const isCleanBatch = (p, date) => {
    const k = `${p.key}|${monthKey(date)}`;
    if (!batchClean.has(k)) batchClean.set(k, chance(cleanProbFor(p, date)));
    return batchClean.get(k);
  };

  sessions.sort((a, b) => (a.serviceDate < b.serviceDate ? -1 : a.serviceDate > b.serviceDate ? 1 : a.providerKey < b.providerKey ? -1 : a.providerKey > b.providerKey ? 1 : (a.startTime || '') < (b.startTime || '') ? -1 : 1));

  sessions.forEach((s) => {
    const p = providerByKey.get(s.providerKey);
    const c = childByKey.get(s.childKey);
    if (!s.truth) {
      s.truth = {
        childId: c.childId, childName: `${c.firstName} ${c.lastName}`, practitionerName: `${p.firstName} ${p.lastName}`,
        serviceDate: s.serviceDate, startTime: s.startTime, endTime: s.endTime, serviceCode: s.serviceCode, location: s.location,
        groupSize: s.groupSize, visitStatus: s.visitStatus, totalMinutes: s.totalMinutes,
      };
    }
    if (!s.logged) s.logged = { startTime: s.startTime, endTime: s.endTime, location: s.location, serviceCode: s.serviceCode };
    if (!BILLABLE_STATUS.has(s.visitStatus) || s.totalMinutes === 0) return;

    const prof = p.errorProfile;
    const day = Number(s.serviceDate.slice(8, 10));
    if (isCleanBatch(p, s.serviceDate)) return;
    const prob = Math.min(0.5, (prof.rate * tenureMult(p, s.serviceDate)) / (1 - cleanProbFor(p, s.serviceDate)));
    // Telehealth visits are where remote parent signatures go missing.
    const weights = {};
    for (const [t, w] of Object.entries(prof.mix)) {
      let ww = w;
      if (t === 'missing_in_eims' && day >= 24) ww *= 3.2;
      if (t === 'missing_in_eims' && day <= 10) ww *= 0.5;
      if (t === 'parent_signature') ww *= s.location === '8' ? 3 : 0.5;
      if (t === 'location' && s.location === '3') ww *= 0.4;
      if (t === 'service_code' && !ERROR_ALT_SERVICE[s.serviceCode]) ww = 0;
      weights[t] = ww;
    }
    if (!chance(prob)) return;
    const type = weightedObj(weights);
    s.errorType = type;
    if (type === 'time_drift') {
      const small = chance(0.4);
      const d = small ? pick([-10, -5, 5, 10]) : pick([-30, -25, -20, -15, 15, 20, 25, 30]);
      s.logged.startTime = shiftTime(s.startTime, d);
      s.logged.endTime = shiftTime(s.endTime, d);
    } else if (type === 'location') {
      s.logged.location = pick(ERROR_ALT_LOCATION[s.location] || ['1']);
      if (s.logged.location === s.location) s.logged.location = s.location === '1' ? '6' : '1';
    } else if (type === 'service_code') {
      s.logged.serviceCode = ERROR_ALT_SERVICE[s.serviceCode];
    } else if (type === 'missing_in_eims') {
      s.missingFromEims = true;
    } else if (type === 'parent_signature') {
      s.signatureIssue = 'parent';
    }
  });

  // ------------------------------------------------------------ the EIMS export
  const eimsRowFor = (s, extra = {}) => {
    const lag = Math.min(addDays(s.serviceDate, int(0, 3)), TODAY);
    return {
      childId: s.truth.childId, childName: s.truth.childName, practitionerName: s.truth.practitionerName,
      serviceDate: s.serviceDate, startTime: s.truth.startTime, endTime: s.truth.endTime,
      serviceLabel: SERVICE_LABEL[s.truth.serviceCode] || s.truth.serviceCode,
      locationLabel: LOCATION_LABEL[s.truth.location] || s.truth.location,
      groupLabel: GROUP_LABEL[s.truth.groupSize] || s.truth.groupSize,
      visitStatusLabel: VISIT_STATUS_LABEL[s.truth.visitStatus] || s.truth.visitStatus,
      loggedDate: lag, ...extra,
    };
  };
  const billable = sessions.filter((s) => BILLABLE_STATUS.has(s.visitStatus) && s.totalMinutes > 0);
  billable.forEach((s) => {
    if (s.missingFromEims) return;
    eimsRows.push(eimsRowFor(s));
    if (chance(0.0015)) eimsRows.push(eimsRowFor(s, { duplicate: true })); // entered twice in EIMS
  });
  // A few visits that exist only in EIMS: entered there, never logged in the app.
  const orphanCount = Math.max(3, Math.round(billable.length * 0.003));
  for (let i = 0; i < orphanCount; i += 1) {
    const base = billable[int(0, billable.length - 1)];
    let date = addDays(base.serviceDate, 7 * pick([-1, 1]));
    while (dow(date) === 0 || dow(date) === 6 || HOLIDAYS.has(date)) date = addDays(date, 1);
    if (date > TODAY || date < START) continue;
    if (sessions.some((x) => x.childKey === base.childKey && x.providerKey === base.providerKey && x.serviceDate === date)) continue;
    eimsRows.push(eimsRowFor({ ...base, serviceDate: date, truth: { ...base.truth, serviceDate: date } }, { eimsOnly: true }));
  }

  // ------------------------------------------------------------ summary
  const stats = {
    providers: providers.length,
    children: children.length,
    sessions: sessions.length,
    billable: billable.length,
    eimsRows: eimsRows.length,
    errors: billable.filter((s) => s.errorType).length,
  };
  return { providers, children, sessions, eimsRows, stats, labels: { SERVICE_LABEL, LOCATION_LABEL, GROUP_LABEL, VISIT_STATUS_LABEL } };
}

module.exports = { buildAgency, monthKey, BILLABLE_STATUS, HOLIDAYS, SNOW_DAYS };
