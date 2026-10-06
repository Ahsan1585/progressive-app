import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, Loader2, Lock, Plus, ShieldCheck, X } from 'lucide-react';
import api from '@/api/axiosInstance';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Reading this as: redesign-preserve of an existing multi-step signup
// wizard (not a landing page - multi-step forms are explicitly out of
// scope for the landing-page taste skill, Section 13), now restructured
// into a sidebar-plus-panel layout per a referenced design (persistent
// step list on the left, active step's fields on the right, matching the
// "Untitled UI"-style reference the user linked). Same brand tokens (navy
// #132A3E / teal #0E6E67 / mint #2FBF9F) and the same override-via-
// className approach as before (never editing the shared Input/Select/
// AuthLayout primitives other pages depend on). Field names/validation/
// payload shape for every pre-existing field are unchanged; new fields
// (disciplines, customDropdownOptions) are additive.

const isPasswordStrong = (pw) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(pw);

const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

const slugify = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const slugSuggestion = (firstName, lastName) => slugify(`${firstName} ${lastName}`).slice(0, 30);

// Curated clinical-discipline subset of the app-wide service_type
// vocabulary (dropdown_options) — mirrors
// backend/src/constants/independentDisciplines.js exactly. Deliberately
// excludes session-event codes from that same table (EV Evaluation, AS
// Assessment, IFSP Meeting, TPC, ES Escort/Security) since those describe
// a visit, not a practitioner's own discipline.
const DISCIPLINE_OPTIONS = [
  { code: 'AU', label: 'Audiology' },
  { code: 'DI', label: 'Developmental Intervention' },
  { code: 'FT', label: 'Family Training' },
  { code: 'HS', label: 'Health Service' },
  { code: 'MS', label: 'Medical Service' },
  { code: 'NU', label: 'Nursing' },
  { code: 'NT', label: 'Nutrition' },
  { code: 'OT', label: 'Occupational Therapy' },
  { code: 'PT', label: 'Physical Therapy' },
  { code: 'PSY', label: 'Psychological' },
  { code: 'SLP', label: 'Speech Language Therapy' },
  { code: 'SW', label: 'Social Work' },
  { code: 'VI', label: 'Vision' },
  { code: 'I/T', label: 'Interpreter/Translator' },
];

// Mirrors the 4 fixed categories every tenant's dropdown_options table is
// seeded with (backend/db/migrations/add_dropdown_categories.sql) — the
// only categories a custom option added at signup can target, since no
// tenant-specific custom category can exist before the tenant itself does.
const CUSTOM_OPTION_CATEGORIES = [
  { value: 'service_type', label: 'Service type' },
  { value: 'service_status', label: 'Service status' },
  { value: 'location', label: 'Location' },
  { value: 'group_size', label: 'Group size' },
];

const STEPS = [
  { label: 'Your info', description: 'Name, email, and login code' },
  { label: 'Your work', description: 'Disciplines, rate, and address' },
  { label: 'Vocabulary', description: 'Optional — customize your dropdowns' },
  { label: 'Agreement', description: 'Business Associate Agreement' },
  { label: 'Account', description: 'Set your password' },
];

const FIELD_LABEL_CLASS = 'text-base font-semibold text-slate-800';
const FIELD_INPUT_CLASS = 'h-14 rounded-xl border-slate-300 px-4 text-base md:text-base placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-teal-600/15 focus-visible:border-teal-600';
const FIELD_SELECT_CLASS = 'h-14 w-full rounded-xl border-slate-300 px-4 text-base font-normal text-slate-800 data-placeholder:text-slate-400';

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
    <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.94-2.91l-3.88-3c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.94H1.27v3.1A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.28 14.3a7.2 7.2 0 0 1 0-4.6v-3.1H1.27a12 12 0 0 0 0 10.8l4.01-3.1Z" />
    <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.94 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.6l4.01 3.1C6.23 6.86 8.88 4.75 12 4.75Z" />
  </svg>
);

// Sidebar step list, persistent on the left — matches the referenced
// design's left-rail pattern (numbered/checked circles, label + one-line
// description, connecting rail) rather than the previous top progress bar.
function StepSidebar({ current, steps }) {
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Signup steps">
      {steps.map((s, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={s.label} className="relative flex gap-3 pb-7 last:pb-0">
            {i < steps.length - 1 && (
              <div className={cn('absolute left-[15px] top-8 h-[calc(100%-1.25rem)] w-px', isDone ? 'bg-teal-600' : 'bg-slate-200')} aria-hidden="true" />
            )}
            <div
              className={cn(
                'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors',
                isDone && 'border-teal-600 bg-teal-600 text-white',
                isActive && 'border-teal-600 bg-white text-teal-700',
                !isDone && !isActive && 'border-slate-200 bg-white text-slate-400'
              )}
            >
              {isDone ? <Check className="size-4" aria-hidden="true" /> : i + 1}
            </div>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-base font-semibold', isActive || isDone ? 'text-slate-900' : 'text-slate-400')}>{s.label}</p>
              <p className={cn('text-sm', isActive ? 'text-slate-500' : 'text-slate-400')}>{s.description}</p>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function MobileStepProgress({ current, steps }) {
  return (
    <div className="mb-6 lg:hidden">
      <div className="mb-3 flex items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={s.label} className={cn('h-1.5 flex-1 rounded-full transition-colors duration-300', i <= current ? 'bg-teal-600' : 'bg-slate-200')} />
        ))}
      </div>
      <p className="text-sm font-bold text-slate-900">
        Step {current + 1} of {steps.length}: {steps[current].label}
      </p>
    </div>
  );
}

function DisciplinePicker({ selected, onToggle }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {DISCIPLINE_OPTIONS.map((d) => {
        const isChecked = selected.includes(d.code);
        return (
          <button
            key={d.code}
            type="button"
            onClick={() => onToggle(d.code)}
            aria-pressed={isChecked}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3.5 text-left text-base transition-colors',
              isChecked ? 'border-teal-600 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            )}
          >
            <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md border-2', isChecked ? 'border-teal-600 bg-teal-600' : 'border-slate-300 bg-white')}>
              {isChecked && <Check className="size-3.5 text-white" aria-hidden="true" />}
            </span>
            <span className="font-medium">
              <span className="font-mono text-sm text-teal-700">{d.code}</span>
              {' — '}{d.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const IndependentSignupWizard = () => {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [slugStatus, setSlugStatus] = useState('idle'); // idle | checking | available | taken
  const slugCheckRef = useRef(0);

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', disciplines: [], payRate: '', address: '',
    baaAcceptedByName: '', baaAcceptedByEmail: '', baaAccepted: false,
    slug: '', slugTouched: false,
    password: '', confirmPassword: '',
  });
  const [customOptions, setCustomOptions] = useState([]); // [{ category, label }]
  const [newOptionCategory, setNewOptionCategory] = useState('service_type');
  const [newOptionLabel, setNewOptionLabel] = useState('');

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => {
      const next = { ...f, [field]: value };
      if ((field === 'firstName' || field === 'lastName') && !f.slugTouched) {
        next.slug = slugSuggestion(field === 'firstName' ? value : f.firstName, field === 'lastName' ? value : f.lastName);
      }
      return next;
    });
  };
  const setSlug = (e) => {
    const value = e.target.value.toLowerCase();
    setForm((f) => ({ ...f, slug: value, slugTouched: true }));
  };
  const toggleDiscipline = (code) => {
    setForm((f) => ({
      ...f,
      disciplines: f.disciplines.includes(code) ? f.disciplines.filter((c) => c !== code) : [...f.disciplines, code],
    }));
  };

  // Debounced live slug-availability check — never the sole enforcement
  // (the backend re-checks at submit, see independentSignupController.js),
  // just lets the auto-suggested code catch a collision with another
  // tenant immediately instead of only at the very end of the form.
  useEffect(() => {
    const slug = form.slug.trim().toLowerCase();
    if (!SLUG_REGEX.test(slug)) {
      setSlugStatus('idle');
      return;
    }
    const requestId = ++slugCheckRef.current;
    setSlugStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get('/api/independent-signup/slug-available', { params: { slug } });
        if (slugCheckRef.current !== requestId) return; // a newer keystroke superseded this check
        setSlugStatus(data.available ? 'available' : 'taken');
      } catch {
        if (slugCheckRef.current === requestId) setSlugStatus('idle');
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [form.slug]);

  // Once the auto-suggested slug for a freshly-typed name turns out to be
  // taken, append -2/-3/... and let the check re-run — only while the
  // practitioner hasn't manually edited the slug themselves.
  useEffect(() => {
    if (slugStatus !== 'taken' || form.slugTouched) return;
    const base = form.slug.replace(/-\d+$/, '');
    const match = form.slug.match(/-(\d+)$/);
    const nextN = match ? Number(match[1]) + 1 : 2;
    setForm((f) => ({ ...f, slug: `${base}-${nextN}` }));
  }, [slugStatus, form.slug, form.slugTouched]);

  const addCustomOption = () => {
    const label = newOptionLabel.trim();
    if (!label) return;
    setCustomOptions((prev) => [...prev, { category: newOptionCategory, label }]);
    setNewOptionLabel('');
  };
  const removeCustomOption = (index) => {
    setCustomOptions((prev) => prev.filter((_, i) => i !== index));
  };

  const validateStep = (s) => {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'Your first and last name are required.';
      if (!form.email.trim()) return 'Email is required.';
      if (!SLUG_REGEX.test(form.slug.trim())) {
        return 'Login code must be 3-40 characters, lowercase letters/numbers/hyphens only.';
      }
      if (slugStatus === 'taken') return 'This login code is already taken — please choose another.';
    }
    if (s === 1) {
      if (form.disciplines.length === 0) return 'Select at least one discipline.';
      const rate = Number(form.payRate);
      if (!form.payRate || Number.isNaN(rate) || rate < 0) return 'A valid hourly rate is required.';
      if (!form.address.trim()) return 'Address is required.';
    }
    // Step 2 (Vocabulary) is entirely optional — no validation.
    if (s === 3) {
      if (!form.baaAcceptedByName.trim() || !form.baaAcceptedByEmail.trim()) {
        return 'Name and email are required to accept the agreement.';
      }
      if (!form.baaAccepted) return 'You must accept the Business Associate Agreement to continue.';
    }
    if (s === 4) {
      if (form.password !== form.confirmPassword) return 'Passwords do not match.';
      if (!isPasswordStrong(form.password)) {
        return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (@$!%*?&).';
      }
    }
    return null;
  };

  const handleNext = (e) => {
    e.preventDefault();
    const validationError = validateStep(step);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setError('');
    setStep((s) => s - 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validationError = validateStep(4);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const { slugTouched, ...payload } = form;
      await api.post('/api/independent-signup', {
        ...payload,
        slug: payload.slug.trim().toLowerCase(),
        customDropdownOptions: customOptions.length > 0 ? customOptions : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to sign up. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Google sign-up — UI only for now. No Google OAuth client exists yet
  // for this app (greenfield integration); this button is wired up to a
  // real flow once a Client ID is provisioned. Clicking it today surfaces
  // that plainly rather than pretending to work.
  const handleGoogleClick = () => {
    setError('Sign up with Google is coming soon — please use the form below for now.');
  };

  if (submitted) {
    return (
      <SignupShell>
        <div className="space-y-6 text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-teal-50">
            <Check className="size-8 text-teal-600" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Check your email</h2>
            <p className="mt-2 text-base text-slate-600">
              Confirm your signup to finish setting up your account. Your 15-day free trial starts once you confirm.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-left">
            <p className="text-sm font-semibold text-slate-500">Your login code</p>
            <p className="mt-1 font-mono text-xl font-bold text-slate-900">{form.slug}</p>
            <p className="mt-2 text-sm text-slate-500">You'll need this along with your email and password to sign in.</p>
          </div>
          <Link to="/" className="inline-block text-base font-semibold text-teal-700 hover:underline">
            Back to Sign In
          </Link>
        </div>
      </SignupShell>
    );
  }

  return (
    <SignupShell sidebar={<StepSidebar current={step} steps={STEPS} />}>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-900">{STEPS[step].label}</h2>
        <p className="mt-1.5 text-base text-slate-500">{STEPS[step].description}</p>
      </div>

      <MobileStepProgress current={step} steps={STEPS} />

      {step === 0 && (
        <>
          <button
            type="button"
            onClick={handleGoogleClick}
            className="flex h-14 w-full items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white text-base font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            {GOOGLE_ICON}
            Sign up with Google
          </button>
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-sm font-medium text-slate-400">OR</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
        </>
      )}

      {error && (
        <div className="mb-5 rounded-xl border-l-4 border-red-500 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={step === 4 ? handleSubmit : handleNext} className="space-y-5">
        {step === 0 && (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="firstName" className={FIELD_LABEL_CLASS}>First name</Label>
                <Input id="firstName" value={form.firstName} onChange={set('firstName')} className={FIELD_INPUT_CLASS} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName" className={FIELD_LABEL_CLASS}>Last name</Label>
                <Input id="lastName" value={form.lastName} onChange={set('lastName')} className={FIELD_INPUT_CLASS} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className={FIELD_LABEL_CLASS}>Email</Label>
              <Input id="email" type="email" value={form.email} onChange={set('email')} className={FIELD_INPUT_CLASS} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug" className={FIELD_LABEL_CLASS}>Login code</Label>
              <div className="relative">
                <Input
                  id="slug"
                  placeholder="your-name"
                  value={form.slug}
                  onChange={setSlug}
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={cn(FIELD_INPUT_CLASS, 'pr-10 font-mono')}
                  required
                />
                {slugStatus === 'checking' && <Loader2 className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 animate-spin text-slate-400" aria-hidden="true" />}
                {slugStatus === 'available' && <Check className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-teal-600" aria-hidden="true" />}
                {slugStatus === 'taken' && <X className="absolute right-3.5 top-1/2 size-5 -translate-y-1/2 text-red-500" aria-hidden="true" />}
              </div>
              <p className={cn('text-sm', slugStatus === 'taken' ? 'font-medium text-red-600' : 'text-slate-500')}>
                {slugStatus === 'taken'
                  ? 'This login code is already taken — try another.'
                  : slugStatus === 'available'
                    ? 'This login code is available.'
                    : "Lowercase letters, numbers, and hyphens only, this is what you'll type to sign in."}
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="space-y-2">
              <Label className={FIELD_LABEL_CLASS}>Disciplines</Label>
              <p className="text-sm text-slate-500">Select every discipline you provide services under — you can pick more than one.</p>
              <DisciplinePicker selected={form.disciplines} onToggle={toggleDiscipline} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payRate" className={FIELD_LABEL_CLASS}>Hourly rate ($)</Label>
              <Input id="payRate" type="number" min="0" step="0.01" value={form.payRate} onChange={set('payRate')} className={FIELD_INPUT_CLASS} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address" className={FIELD_LABEL_CLASS}>Address</Label>
              <Input id="address" value={form.address} onChange={set('address')} className={FIELD_INPUT_CLASS} required />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-base text-slate-600">
              Your account starts with the standard NJEIS service type, status, location, and group size options
              already set up. Add anything extra you want on day one, you can always manage this later too.
            </p>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold text-slate-700">Category</Label>
                  <Select value={newOptionCategory} onValueChange={setNewOptionCategory}>
                    <SelectTrigger className="h-12 w-full rounded-lg border-slate-300 bg-white text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CUSTOM_OPTION_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold text-slate-700">Option name</Label>
                  <Input
                    value={newOptionLabel}
                    onChange={(e) => setNewOptionLabel(e.target.value)}
                    placeholder="e.g. Bilingual Session"
                    className="h-12 rounded-lg border-slate-300 bg-white text-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomOption(); } }}
                  />
                </div>
                <Button type="button" onClick={addCustomOption} variant="outline" className="h-12 rounded-lg border-slate-300 font-semibold">
                  <Plus className="size-4" aria-hidden="true" />
                  Add
                </Button>
              </div>
            </div>
            {customOptions.length > 0 && (
              <ul className="space-y-2">
                {customOptions.map((opt, i) => (
                  <li key={`${opt.category}-${opt.label}-${i}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <span className="min-w-0 truncate text-base text-slate-700">
                      <span className="font-semibold text-slate-900">{opt.label}</span>
                      {' '}&middot;{' '}
                      <span className="text-slate-500">{CUSTOM_OPTION_CATEGORIES.find((c) => c.value === opt.category)?.label}</span>
                    </span>
                    <button type="button" onClick={() => removeCustomOption(i)} aria-label={`Remove ${opt.label}`} className="shrink-0 text-slate-400 hover:text-red-500">
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-5 text-base leading-relaxed text-slate-600">
              Izaya EIS ("Izaya") acts as a Business Associate under HIPAA for any Protected Health Information
              (PHI) you store on this platform. By accepting this agreement, you authorize Izaya to store and
              process PHI on your behalf, subject to a full Business Associate Agreement to be executed between
              the parties. Izaya will safeguard PHI per HIPAA's Security and Privacy Rules, including encryption
              at rest and in transit, access controls, and audit logging.
            </div>
            <div className="space-y-2">
              <Label htmlFor="baaAcceptedByName" className={FIELD_LABEL_CLASS}>Your full name</Label>
              <Input id="baaAcceptedByName" value={form.baaAcceptedByName} onChange={set('baaAcceptedByName')} className={FIELD_INPUT_CLASS} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baaAcceptedByEmail" className={FIELD_LABEL_CLASS}>Your email</Label>
              <Input id="baaAcceptedByEmail" type="email" value={form.baaAcceptedByEmail} onChange={set('baaAcceptedByEmail')} className={FIELD_INPUT_CLASS} required />
            </div>
            <label
              htmlFor="baaAccepted"
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-base text-slate-700 transition-colors hover:border-teal-300"
            >
              <input
                id="baaAccepted"
                type="checkbox"
                checked={form.baaAccepted}
                onChange={set('baaAccepted')}
                className="mt-0.5 size-5 shrink-0 cursor-pointer accent-teal-600"
              />
              I accept this agreement on my own behalf as an independent practitioner.
            </label>
          </>
        )}

        {step === 4 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="password" className={FIELD_LABEL_CLASS}>Password</Label>
              <PasswordInput
                id="password"
                value={form.password}
                onChange={set('password')}
                placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
                autoComplete="new-password"
                className={FIELD_INPUT_CLASS}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className={FIELD_LABEL_CLASS}>Confirm password</Label>
              <PasswordInput
                id="confirmPassword"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                autoComplete="new-password"
                className={FIELD_INPUT_CLASS}
                required
              />
            </div>
          </>
        )}

        <div className="flex gap-3 pt-3">
          {step > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              className="h-14 flex-1 rounded-xl border-slate-300 text-base font-semibold"
              disabled={isSubmitting}
            >
              <ChevronLeft className="size-5" aria-hidden="true" />
              Back
            </Button>
          )}
          <Button
            type="submit"
            disabled={isSubmitting}
            className="h-14 flex-1 rounded-xl bg-teal-700 text-base font-semibold text-white hover:bg-teal-800"
          >
            {isSubmitting ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : null}
            {step === 4 ? (isSubmitting ? 'Signing up...' : 'Sign up') : 'Continue'}
          </Button>
        </div>
      </form>

      <div className="mt-7 border-t border-slate-100 pt-5 text-center">
        <Link to="/" className="text-base font-semibold text-slate-500 transition-colors hover:text-teal-700">
          Back to Sign In
        </Link>
      </div>
    </SignupShell>
  );
};

// Page-local shell, wider than AuthLayout's shared 420px card (AuthLayout
// is reused by 9 other pages - Login, password reset, telepractice
// signing, etc. - widening it there would ripple everywhere). With a
// sidebar present, the two-column layout mirrors the referenced design's
// left-rail-plus-panel structure; without one (the success screen), it
// falls back to a single centered column.
function SignupShell({ children, sidebar }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className={cn('w-full', sidebar ? 'max-w-[920px]' : 'max-w-[560px]')}>
        <div className="mb-7 flex justify-center">
          <BrandLockup size="lg" align="center" />
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-8px_rgba(15,23,42,0.14)]">
          <div className="h-1.5 bg-gradient-to-r from-teal-600 to-cyan-600" />
          {sidebar ? (
            <div className="grid grid-cols-1 lg:grid-cols-[260px_1px_1fr]">
              <div className="p-7 sm:p-8">{sidebar}</div>
              <div className="hidden bg-slate-100 lg:block" aria-hidden="true" />
              <div className="border-t border-slate-100 p-7 sm:p-10 lg:border-t-0">{children}</div>
            </div>
          ) : (
            <div className="p-7 sm:p-10">{children}</div>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-1">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/60 px-3 py-1.5 backdrop-blur-sm">
          <Lock className="size-3 text-slate-600" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">Secured by Izaya</span>
          <span className="text-slate-600" aria-hidden="true">&middot;</span>
          <ShieldCheck className="size-3 text-slate-600" aria-hidden="true" />
          <span className="text-[11px] font-medium tracking-[0.14em] text-slate-600 uppercase">HIPAA Compliant</span>
        </div>
        <p className="text-[11px] text-slate-600">Izaya Consulting LLC</p>
      </div>
    </div>
  );
}

export default IndependentSignupWizard;
