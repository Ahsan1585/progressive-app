// /eis/book: book a 30-minute demo call. Replaces the old Contact page.
// Open times come from GET /api/demo/slots (weekdays, 9:00 to 17:00 New York
// time, never today). The server refuses a slot someone else just took (409),
// which shows inline and refreshes the times. A cancel link from the
// confirmation email lands here as /book?cancel=<token>.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, Globe, CalendarCheck, AlertTriangle } from 'lucide-react';
import '@fontsource-variable/geist-mono';
import '../../styles/eis-home.css';
import api from '@/api/axiosInstance';
import { MarketingLayout } from '../../components/marketing/MarketingLayout';

const TZ = 'America/New_York';
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso, opts) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, ...opts });
const fmtWhen = (iso) => `${fmtDay(iso, { weekday: 'long', month: 'short', day: 'numeric' })} at ${fmtTime(iso)} ET`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function CancelView({ token }) {
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [msg, setMsg] = useState('');
  const cancel = async () => {
    setState('working');
    try {
      const { data } = await api.post('/api/demo/bookings/cancel', { token });
      setMsg(`Your call on ${fmtWhen(data.slotStart)} is cancelled.`);
      setState('done');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Something went wrong. Please try again.');
      setState('error');
    }
  };
  return (
    <div className="tone-dark booker">
      {state === 'done' ? (
        <div className="done">
          <h2>Cancelled.</h2>
          <p>{msg}</p>
          <Link className="btn btn-primary" to="/book">Pick a new time</Link>
        </div>
      ) : (
        <div className="done">
          <h2>Cancel your demo?</h2>
          <p>{state === 'error' ? msg : 'This frees your time slot. You can book a new one right after.'}</p>
          <button type="button" className="btn btn-primary" onClick={cancel} disabled={state === 'working'}>
            {state === 'working' ? 'Cancelling…' : 'Cancel my demo'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function BookDemo() {
  const [params] = useSearchParams();
  const cancelToken = params.get('cancel');
  const source = params.get('source') || 'direct';
  const pilot = source === 'pilot';

  const [slots, setSlots] = useState(null); // null = loading
  const [loadError, setLoadError] = useState('');
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [form, setForm] = useState({ fullName: '', workEmail: '', agencyName: '', practitionerCount: '' });
  const [errors, setErrors] = useState({});
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [booked, setBooked] = useState(null);
  const formRef = useRef(null);

  const loadSlots = async () => {
    try {
      const { data } = await api.get('/api/demo/slots');
      setLoadError('');
      setSlots(data.slots || []);
    } catch {
      setSlots([]);
      setLoadError('Could not load open times. Please refresh, or email support@izayaedge.com.');
    }
  };
  useEffect(() => {
    if (cancelToken) return undefined;
    let live = true;
    api.get('/api/demo/slots')
      .then(({ data }) => { if (live) setSlots(data.slots || []); })
      .catch(() => { if (live) { setSlots([]); setLoadError('Could not load open times. Please refresh, or email support@izayaedge.com.'); } });
    return () => { live = false; };
  }, [cancelToken]);

  const days = useMemo(() => {
    const map = new Map();
    (slots || []).forEach((iso) => {
      const k = dayKey(iso);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(iso);
    });
    return [...map.entries()].slice(0, 15).map(([key, list]) => ({ key, list }));
  }, [slots]);

  // The picked day, or the first open day when none is picked (or it filled up).
  const activeDay = days.some((d) => d.key === day) ? day : days[0]?.key;
  const dayList = days.find((d) => d.key === activeDay)?.list || [];

  const pickSlot = (iso) => {
    setSlot(iso);
    setConflict(false);
    setServerError('');
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!form.fullName.trim()) errs.fullName = 'Enter your name.';
    if (!EMAIL_RE.test(form.workEmail.trim())) errs.workEmail = 'Enter a valid work email.';
    if (!form.agencyName.trim()) errs.agencyName = 'Enter your agency name.';
    if (form.practitionerCount && !/^\d{1,4}$/.test(form.practitionerCount.trim())) errs.practitionerCount = 'Use a number, like 20.';
    setErrors(errs);
    if (Object.keys(errs).length || !slot) return;

    const utm = {};
    UTM_KEYS.forEach((k) => { const v = params.get(k); if (v) utm[k] = v; });
    setSubmitting(true);
    setServerError('');
    try {
      const { data } = await api.post('/api/demo/bookings', {
        ...form, slotStart: slot, source, utm: Object.keys(utm).length ? utm : undefined,
      });
      setBooked({ ...data.booking, email: form.workEmail.trim() });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.response?.status === 409) {
        setConflict(true);
        setSlot(null);
        loadSlots();
      } else {
        setServerError(err.response?.data?.error || 'Something went wrong booking your call. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MarketingLayout>
      <div id="eis-home" data-palette="ocean" data-depth="mixed">
        <section className="tone-light book">
          <div className="wrap book-grid">
            <div>
              <Link className="back" to="/"><ArrowLeft aria-hidden="true" />Back</Link>
              <h1>{cancelToken ? 'Change of plans?' : pilot ? 'Start your 30-day pilot.' : 'Book your 30-minute demo.'}</h1>
              <p className="book-sub">
                {pilot ? "Pick a time. We'll plan your pilot and set up your agency." : "Pick a time. We'll walk your team through a full billing month."}
              </p>
              <ul className="see">
                <li><span className="ic"><Check aria-hidden="true" /></span>Your billing month, start to finish</li>
                <li><span className="ic"><Check aria-hidden="true" /></span>How flagged notes get fixed</li>
                <li><span className="ic"><Check aria-hidden="true" /></span>Your 30-day pilot plan</li>
              </ul>
              <div className="tz"><Globe aria-hidden="true" />Times shown in Eastern Time (ET)</div>
            </div>

            {cancelToken ? <CancelView token={cancelToken} /> : booked ? (
              <div className="tone-dark booker">
                <div className="done">
                  <svg className="check" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="45" /><path d="M29 49l13 13 26-27" /></svg>
                  <h2>You're booked.</h2>
                  <div className="when">{fmtWhen(booked.slotStart)}</div>
                  <p>A confirmation with a calendar invite is on its way to {booked.email}.{booked.meetingUrl ? '' : ' The meeting link will follow by email.'}</p>
                  {booked.meetingUrl && <a className="btn btn-primary" href={booked.meetingUrl} target="_blank" rel="noopener noreferrer">Meeting link</a>}
                  <Link className="btn btn-ghost" to="/">Back to homepage</Link>
                </div>
              </div>
            ) : (
              <div className="tone-dark booker">
                <h3>Pick a day</h3>
                <div className="days" role="group" aria-label="Available days">
                  {slots === null
                    ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skel" style={{ width: 78, height: 84, flex: 'none' }} />)
                    : days.map((d) => (
                      <button
                        key={d.key} type="button" className="day" aria-pressed={d.key === activeDay}
                        aria-label={`${fmtDay(d.list[0], { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.list.length} times open`}
                        onClick={() => { setDay(d.key); setSlot(null); }}
                      >
                        <span>{fmtDay(d.list[0], { weekday: 'short' })}</span>
                        <b>{fmtDay(d.list[0], { day: 'numeric' })}</b>
                        <em>{d.list.length} open</em>
                      </button>
                    ))}
                </div>
                <h3>Pick a time</h3>
                <div className="times" role="group" aria-label="Available times">
                  {slots === null
                    ? Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" />)
                    : loadError ? <div className="empty"><b>{loadError}</b></div>
                      : !dayList.length ? <div className="empty"><b>No times open right now.</b>Email support@izayaedge.com and we'll find one.</div>
                        : dayList.map((iso) => (
                          <button key={iso} type="button" className="time" aria-pressed={iso === slot} onClick={() => pickSlot(iso)}>
                            {fmtTime(iso)}
                          </button>
                        ))}
                </div>

                {conflict && (
                  <div className="alert" role="alert"><AlertTriangle aria-hidden="true" /><span>That time was just taken. Pick another time.</span></div>
                )}

                {slot && (
                  <form className="details" ref={formRef} onSubmit={submit} noValidate>
                    <div className="picked"><CalendarCheck aria-hidden="true" /><span>{fmtWhen(slot)}</span></div>
                    {serverError && <div className="alert" role="alert"><AlertTriangle aria-hidden="true" /><span>{serverError}</span></div>}
                    <div className="form-grid">
                      {[
                        ['fullName', 'Full name', { autoComplete: 'name' }],
                        ['workEmail', 'Work email', { type: 'email', autoComplete: 'email' }],
                        ['agencyName', 'Agency', { autoComplete: 'organization' }],
                        ['practitionerCount', 'Practitioners', { inputMode: 'numeric', placeholder: 'e.g. 20' }],
                      ].map(([k, label, extra]) => (
                        <div className="field" key={k}>
                          <label htmlFor={`f-${k}`}>{label}</label>
                          <input id={`f-${k}`} value={form[k]} onChange={setField(k)} aria-invalid={errors[k] ? 'true' : 'false'} {...extra} />
                          <span className="err">{errors[k] || ''}</span>
                        </div>
                      ))}
                    </div>
                    <div className="submit-row">
                      <button className="btn btn-primary" type="submit" disabled={submitting}>{submitting ? 'Booking…' : 'Confirm demo'}</button>
                      <small>You'll get a confirmation email with a calendar invite.</small>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </MarketingLayout>
  );
}
