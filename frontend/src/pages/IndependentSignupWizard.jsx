import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, Loader2, Lock, ShieldCheck } from 'lucide-react';
import api from '@/api/axiosInstance';
import { BrandLockup } from '@/components/BrandLockup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Reading this as: redesign-preserve of an existing 3-step signup wizard
// (not a landing page - multi-step forms are explicitly out of scope for
// the landing-page taste skill, Section 13). The structure was already
// sound (clear steps, real validation); the actual complaint was pure
// execution density - shadcn's default Input/Select ship at h-8/text-xs
// (see input.tsx/select.tsx), which reads as "small fields, small text"
// on any screen. Fixed by sizing up every field in THIS flow via
// className overrides (never touching the shared Input/Select/AuthLayout
// primitives other pages depend on), widening the card beyond
// AuthLayout's 420px cap with a page-local shell, and splitting the
// original step 1's 7 fields into two shorter, less overwhelming steps.
// Same brand tokens (navy #132A3E / teal #0E6E67 / mint #2FBF9F), same
// field names/payload shape/validation rules as before - Section 11.F:
// form field names and API contract never change silently.

// Same rule as backend/src/utils/passwordValidation.js's isPasswordStrong —
// duplicated client-side for instant feedback, same convention as
// SignupWizard.jsx.
const isPasswordStrong = (pw) =>
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(pw);

// Mirrors backend/src/constants/signup.js's SLUG_REGEX.
const SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

// Suggests a starting point for the login code from the practitioner's own
// name (e.g. "Jamie Rivera" -> "jamie-rivera") — auto-filled once both name
// fields are set, but always editable; never silently substituted like the
// old auto-generated-slug approach was.
const slugSuggestion = (firstName, lastName) => {
  const raw = `${firstName} ${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return raw.slice(0, 30);
};

// Mirrors backend/src/utils/disciplineCodes.js's DISCIPLINE_CODE_MAP keys —
// an independent practitioner has no tenant dropdown vocabulary yet at
// signup time, so this is the same small fixed starter list the backend
// validates against.
const DISCIPLINE_OPTIONS = [
  'Developmental Interventionist',
  'Speech Language Pathologist',
  'Occupational Therapist',
  'Physical Therapist',
  'Social Worker',
  'Special Educator',
  'Family Therapist',
  'Foreign Language Interpreter',
];

// Four shorter steps instead of the original three (step 1's seven fields
// split into "You" + "Your work"), each with a one-line description so the
// step indicator does real orienting work instead of just counting.
const STEPS = [
  { label: 'You', description: 'Your name, email, and login code' },
  { label: 'Your work', description: 'Discipline, rate, and address' },
  { label: 'Agreement', description: 'Business Associate Agreement' },
  { label: 'Account', description: 'Set your password' },
];

const FIELD_LABEL_CLASS = 'text-base font-semibold text-slate-800';
const FIELD_INPUT_CLASS = 'h-14 rounded-xl border-slate-300 px-4 text-base md:text-base placeholder:text-slate-400 focus-visible:ring-4 focus-visible:ring-teal-600/15 focus-visible:border-teal-600';
const FIELD_SELECT_CLASS = 'h-14 w-full rounded-xl border-slate-300 px-4 text-base font-normal text-slate-800 data-placeholder:text-slate-400';

function StepProgress({ current }) {
  return (
    <div className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <div
            key={s.label}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-colors duration-300',
              i <= current ? 'bg-teal-600' : 'bg-slate-200'
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
          {current < STEPS.length ? current + 1 : <Check className="size-4" aria-hidden="true" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">
            Step {current + 1} of {STEPS.length}: {STEPS[current].label}
          </p>
          <p className="truncate text-sm text-slate-500">{STEPS[current].description}</p>
        </div>
      </div>
    </div>
  );
}

const IndependentSignupWizard = () => {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', discipline: '', payRate: '', address: '',
    baaAcceptedByName: '', baaAcceptedByEmail: '', baaAccepted: false,
    slug: '', slugTouched: false,
    password: '', confirmPassword: '',
  });
  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Keep the login-code suggestion in sync with name changes until the
      // practitioner has actually edited it themselves — after that, their
      // own choice always wins, name changes never overwrite it again.
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

  // Validation split to match the new 4-step layout — step indices shift
  // (0: name/email/login code, 1: discipline/rate/address, 2: agreement,
  // 3: password) but every rule and error message is identical to before.
  const validateStep = (s) => {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'Your first and last name are required.';
      if (!form.email.trim()) return 'Email is required.';
      if (!SLUG_REGEX.test(form.slug.trim())) {
        return 'Login code must be 3-40 characters, lowercase letters/numbers/hyphens only.';
      }
    }
    if (s === 1) {
      if (!form.discipline) return 'Please select your discipline.';
      const rate = Number(form.payRate);
      if (!form.payRate || Number.isNaN(rate) || rate < 0) return 'A valid hourly rate is required.';
      if (!form.address.trim()) return 'Address is required.';
    }
    if (s === 2) {
      if (!form.baaAcceptedByName.trim() || !form.baaAcceptedByEmail.trim()) {
        return 'Name and email are required to accept the agreement.';
      }
      if (!form.baaAccepted) return 'You must accept the Business Associate Agreement to continue.';
    }
    if (s === 3) {
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
    const validationError = validateStep(3);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const { slugTouched, ...payload } = form;
      await api.post('/api/independent-signup', { ...payload, slug: payload.slug.trim().toLowerCase() });
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to sign up. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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
    <SignupShell>
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-bold text-slate-900">Sign up as an independent practitioner</h2>
        <p className="mt-1.5 text-base text-slate-500">Start your 15-day free trial, no card required.</p>
      </div>

      <StepProgress current={step} />

      {error && (
        <div className="mb-5 rounded-xl border-l-4 border-red-500 bg-red-50 p-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={step === 3 ? handleSubmit : handleNext} className="space-y-5">
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
              <Input
                id="slug"
                placeholder="your-name"
                value={form.slug}
                onChange={setSlug}
                autoCapitalize="none"
                autoCorrect="off"
                className={cn(FIELD_INPUT_CLASS, 'font-mono')}
                required
              />
              <p className="text-sm text-slate-500">
                Lowercase letters, numbers, and hyphens only, this is what you'll type to sign in, so pick something you'll remember.
              </p>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="space-y-2">
              <Label className={FIELD_LABEL_CLASS}>Discipline</Label>
              <Select value={form.discipline} onValueChange={(v) => setForm((f) => ({ ...f, discipline: v }))}>
                <SelectTrigger className={FIELD_SELECT_CLASS}><SelectValue placeholder="Select your discipline" /></SelectTrigger>
                <SelectContent>
                  {DISCIPLINE_OPTIONS.map((d) => <SelectItem key={d} value={d} className="py-2.5 text-base">{d}</SelectItem>)}
                </SelectContent>
              </Select>
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

        {step === 3 && (
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
            {step === 3 ? (isSubmitting ? 'Signing up...' : 'Sign up') : 'Continue'}
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
// signing, etc. - widening it there would ripple everywhere). Same brand
// chrome conventions as AuthLayout (logo lockup, trust badge, gradient
// top bar) so this still reads as part of the same site, just given the
// room a 4-field-per-step form actually needs.
function SignupShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-[560px]">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-8px_rgba(15,23,42,0.14)]">
          <div className="h-1.5 bg-gradient-to-r from-teal-600 to-cyan-600" />
          <div className="p-7 sm:p-10">
            <div className="mb-7 flex justify-center">
              <BrandLockup size="lg" align="center" />
            </div>
            {children}
          </div>
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
