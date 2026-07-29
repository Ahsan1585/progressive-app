const { pool } = require('../config/db');
const { loadDropdownOptionsCache, getDropdownOptionsCache, CATEGORIES } = require('../constants/dropdownOptionsCache');

// Full set (active + inactive) grouped by category — the admin UI needs
// inactive rows to offer "Reactivate"; the log-form dropdowns filter to
// is_active client-side.
const getDropdownOptions = (req, res) => {
  res.json({ success: true, options: getDropdownOptionsCache() });
};

const createDropdownOption = async (req, res) => {
  const { category, code, label, sort_order } = req.body;
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!code || !String(code).trim() || !label || !String(label).trim()) {
    return res.status(400).json({ error: 'Code and name are required' });
  }
  try {
    // Re-adding a code that was previously deactivated reactivates it (and
    // updates its label) rather than erroring on the UNIQUE(category, code)
    // constraint — keeps the same row/id so history association is preserved.
    const { rows } = await pool.query(
      `INSERT INTO dropdown_options (category, code, label, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       ON CONFLICT (category, code) DO UPDATE SET
         label = EXCLUDED.label, is_active = true, updated_at = now()
       RETURNING *`,
      [category, String(code).trim(), String(label).trim(), sort_order ?? null]
    );
    await loadDropdownOptionsCache();
    res.status(201).json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error creating dropdown option:', error);
    res.status(500).json({ error: 'Failed to create option' });
  }
};

const updateDropdownOption = async (req, res) => {
  const { id } = req.params;
  const { code, label, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET
         code = COALESCE($1, code),
         label = COALESCE($2, label),
         sort_order = COALESCE($3, sort_order),
         updated_at = now()
       WHERE id = $4
       RETURNING *`,
      [code ?? null, label ?? null, sort_order ?? null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error updating dropdown option:', error);
    res.status(500).json({ error: 'Failed to update option' });
  }
};

// Soft-delete: never a real DELETE, so a code already used on historical
// logs keeps resolving to its label — only hidden from new-log dropdowns.
const deactivateDropdownOption = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error deactivating dropdown option:', error);
    res.status(500).json({ error: 'Failed to delete option' });
  }
};

const reactivateDropdownOption = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE dropdown_options SET is_active = true, updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Option not found' });
    await loadDropdownOptionsCache();
    res.json({ success: true, option: rows[0] });
  } catch (error) {
    console.error('Error reactivating dropdown option:', error);
    res.status(500).json({ error: 'Failed to reactivate option' });
  }
};

module.exports = {
  getDropdownOptions,
  createDropdownOption,
  updateDropdownOption,
  deactivateDropdownOption,
  reactivateDropdownOption,
};
