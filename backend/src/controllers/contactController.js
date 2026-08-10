const { sendContactRequestEmail } = require('../utils/emailClient');

// Public, unauthenticated (this is the marketing site's demo-request form —
// there's no tenant/session at this point), so validation stays basic and
// the handler never touches the database.
const submitContactRequest = async (req, res) => {
  try {
    const fullName = String(req.body.fullName || '').trim();
    const workEmail = String(req.body.workEmail || '').trim();
    const agencyName = String(req.body.agencyName || '').trim();
    const phone = String(req.body.phone || '').trim();
    const practitionerCount = String(req.body.practitionerCount || '').trim();
    const message = String(req.body.message || '').trim();

    if (!fullName || !workEmail || !agencyName) {
      return res.status(400).json({ error: 'Name, work email, and agency are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
      return res.status(400).json({ error: 'Please enter a valid work email.' });
    }

    await sendContactRequestEmail({ fullName, workEmail, agencyName, phone, practitionerCount, message });

    res.json({ success: true });
  } catch (err) {
    console.error('submitContactRequest error:', err);
    res.status(500).json({ error: 'Something went wrong sending your request. Please try again.' });
  }
};

module.exports = { submitContactRequest };
