const { getDropdownOptionsCache, getDropdownCategoriesCache } = require('../constants/dropdownOptionsCache');

// Custom dropdown category values are client-submitted, so they're
// validated server-side too: only a key that's a real, currently-active
// custom category, and only a value that's a real, currently-active option
// code within that category, survives — anything else is silently dropped
// rather than rejecting the whole request over one bad field. Shared by
// every write path that can set custom_fields (create, edit, resubmit) so
// the validation rule can't drift between them.
function sanitizeCustomFields(custom_fields) {
  const sanitized = {};
  if (!custom_fields || typeof custom_fields !== 'object' || Array.isArray(custom_fields)) {
    return sanitized;
  }
  const dropdownCache = getDropdownOptionsCache();
  const activeCustomCategoryKeys = new Set(
    getDropdownCategoriesCache().filter((c) => c.is_custom && c.is_active).map((c) => c.key)
  );
  for (const [key, value] of Object.entries(custom_fields)) {
    if (!activeCustomCategoryKeys.has(key)) continue;
    const validCodes = new Set((dropdownCache[key] || []).filter((o) => o.is_active).map((o) => o.code));
    const strValue = String(value);
    if (validCodes.has(strValue)) sanitized[key] = strValue;
  }
  return sanitized;
}

module.exports = { sanitizeCustomFields };
