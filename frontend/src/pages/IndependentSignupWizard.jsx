import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { AuthLayout } from '@/components/AuthLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

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

const STEPS = ['Your Info', 'Agreement', 'Account'];

function StepIndicator({ current }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
              i <= current ? 'bg-teal-600 text-white' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i + 1}
          </div>
          <span className={`text-xs font-semibold hidden sm:inline ${i <= current ? 'text-teal-700' : 'text-slate-400'}`}>
            {label}
          </span>
          {i < STEPS.length - 1 && <div className="w-6 h-px bg-slate-200" />}
        </div>
      ))}
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

  const validateStep = (s) => {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'Your first and last name are required.';
      if (!form.email.trim()) return 'Email is required.';
      if (!SLUG_REGEX.test(form.slug.trim())) {
        return 'Login code must be 3-40 characters, lowercase letters/numbers/hyphens only.';
      }
      if (!form.discipline) return 'Please select your discipline.';
      const rate = Number(form.payRate);
      if (!form.payRate || Number.isNaN(rate) || rate < 0) return 'A valid hourly rate is required.';
      if (!form.address.trim()) return 'Address is required.';
    }
    if (s === 1) {
      if (!form.baaAcceptedByName.trim() || !form.baaAcceptedByEmail.trim()) {
        return 'Name and email are required to accept the agreement.';
      }
      if (!form.baaAccepted) return 'You must accept the Business Associate Agreement to continue.';
    }
    if (s === 2) {
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
    const validationError = validateStep(2);
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
      <AuthLayout>
        <div className="text-center space-y-6">
          <div className="bg-teal-50 border-l-4 border-teal-600 p-4 rounded-lg text-sm text-teal-800 font-medium text-left">
            Check your email to confirm your signup and finish setting up your account. Your 15-day free trial starts once you confirm.
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 text-left">
            Your login code is <span className="font-mono font-bold text-slate-900">{form.slug}</span> — you'll need this along with your email and password to sign in.
          </div>
          <Link to="/" className="inline-block font-semibold text-cyan-700 hover:underline">
            Back to Sign In
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h2 className="text-lg font-semibold text-slate-800 mb-1 text-center">Sign up as an independent practitioner</h2>
      <p className="text-sm text-slate-500 mb-5 text-center">Start your 15-day free trial — no card required.</p>

      <StepIndicator current={step} />

      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-5 rounded-lg text-sm text-red-700 font-medium">
          {error}
        </div>
      )}

      <form onSubmit={step === 2 ? handleSubmit : handleNext} className="space-y-4">
        {step === 0 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" value={form.firstName} onChange={set('firstName')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={form.lastName} onChange={set('lastName')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={set('email')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slug">Login Code</Label>
              <Input
                id="slug"
                placeholder="your-name"
                value={form.slug}
                onChange={setSlug}
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
              <p className="text-xs text-slate-500">
                Lowercase letters, numbers, and hyphens only — this is what you'll type to sign in, so pick something you'll remember.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Discipline</Label>
              <Select value={form.discipline} onValueChange={(v) => setForm((f) => ({ ...f, discipline: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select your discipline" /></SelectTrigger>
                <SelectContent>
                  {DISCIPLINE_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="payRate">Hourly Rate ($)</Label>
              <Input id="payRate" type="number" min="0" step="0.01" value={form.payRate} onChange={set('payRate')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" value={form.address} onChange={set('address')} required />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-600 leading-relaxed max-h-48 overflow-y-auto">
              Izaya EIS ("Izaya") acts as a Business Associate under HIPAA for any Protected Health Information
              (PHI) you store on this platform. By accepting this agreement, you authorize Izaya to store and
              process PHI on your behalf, subject to a full Business Associate Agreement to be executed between
              the parties. Izaya will safeguard PHI per HIPAA's Security and Privacy Rules, including encryption
              at rest and in transit, access controls, and audit logging.
            </div>
            <div className="space-y-2">
              <Label htmlFor="baaAcceptedByName">Your Full Name</Label>
              <Input id="baaAcceptedByName" value={form.baaAcceptedByName} onChange={set('baaAcceptedByName')} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="baaAcceptedByEmail">Your Email</Label>
              <Input id="baaAcceptedByEmail" type="email" value={form.baaAcceptedByEmail} onChange={set('baaAcceptedByEmail')} required />
            </div>
            <label htmlFor="baaAccepted" className="flex items-start gap-2.5 text-sm text-slate-700 cursor-pointer">
              <input
                id="baaAccepted"
                type="checkbox"
                checked={form.baaAccepted}
                onChange={set('baaAccepted')}
                className="mt-0.5 h-4 w-4 accent-teal-600 cursor-pointer"
              />
              I accept this agreement on my own behalf as an independent practitioner.
            </label>
          </>
        )}

        {step === 2 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                value={form.password}
                onChange={set('password')}
                placeholder="Min 8 chars, 1 uppercase, 1 number, 1 special"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <PasswordInput
                id="confirmPassword"
                value={form.confirmPassword}
                onChange={set('confirmPassword')}
                autoComplete="new-password"
                required
              />
            </div>
          </>
        )}

        <div className="flex gap-3 pt-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={handleBack} className="flex-1 h-11" disabled={isSubmitting}>
              Back
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting} className="flex-1 h-11 bg-cyan-700 hover:bg-cyan-800 text-white font-semibold">
            {isSubmitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
            {step === 2 ? (isSubmitting ? 'Signing up…' : 'Sign Up') : 'Continue'}
          </Button>
        </div>
      </form>

      <div className="mt-6 text-center pt-5 border-t border-slate-100">
        <Link to="/" className="text-sm font-semibold text-slate-500 hover:text-cyan-700 transition-colors">
          Back to Sign In
        </Link>
      </div>
    </AuthLayout>
  );
};

export default IndependentSignupWizard;
