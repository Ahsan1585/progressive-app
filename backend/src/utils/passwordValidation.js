// Shared between authController.js (staff/practitioner accounts, invite
// activation) and signupController.js (a new company's own admin account)
// so both paths enforce the exact same password strength rule.
const isPasswordStrong = (password) => {
  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  return strongPasswordRegex.test(password || '');
};

module.exports = { isPasswordStrong };
