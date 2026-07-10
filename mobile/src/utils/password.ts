// Mirrors backend/src/controllers/authController.js's isPasswordStrong exactly,
// so client-side blocking matches the server's rule verbatim.
const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

export const isPasswordStrong = (password: string): boolean => STRONG_PASSWORD_REGEX.test(password);

export const PASSWORD_RULE_TEXT =
  "Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character (@$!%*?&).";

export interface PasswordRule {
  id: "length" | "lowercase" | "uppercase" | "digit" | "special";
  label: string;
  met: boolean;
}

// Live checklist for the Forced/Change Password screens — each rule evaluated
// independently so the practitioner sees exactly what's still missing.
export const getPasswordRules = (password: string): PasswordRule[] => [
  { id: "length", label: "At least 8 characters", met: password.length >= 8 },
  { id: "lowercase", label: "One lowercase letter", met: /[a-z]/.test(password) },
  { id: "uppercase", label: "One uppercase letter", met: /[A-Z]/.test(password) },
  { id: "digit", label: "One number", met: /\d/.test(password) },
  { id: "special", label: "One special character (@$!%*?&)", met: /[@$!%*?&]/.test(password) },
];
