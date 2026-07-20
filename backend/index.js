require('dotenv').config();
const { protect, requireRole } = require('./src/middleware/authMiddleware');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

// Fail fast if the JWT secret is not configured — never run auth with an undefined secret
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Refusing to start.');
}
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// --- Database Initialization ---
const { pool } = require('./src/config/db');

// --- Route Imports ---
const patientRoutes = require('./src/routes/patientRoutes');
const authRoutes = require('./src/routes/authRoutes');
const reportRoutes = require('./src/routes/reportRoutes'); 
const billingRoutes = require('./src/routes/billingRoutes'); // 🌟 NEW: Imported billing routes

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(helmet());

// Restrict CORS to known frontend origin(s). Set CORS_ORIGIN (comma-separated) in the environment.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin/non-browser requests (no Origin header) and whitelisted origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// --- Modular Routes ---
app.use('/api/patients', patientRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/billing', billingRoutes); // 🌟 NEW: Mounted billing routes to fix the 404 error!

// NOTE: Practitioner registration is handled solely by the authenticated,
// role-guarded route in src/routes/authRoutes.js (protect + requireRole).
// The previous inline unauthenticated handler here was removed (security fix).

// =========================================================================
// --- INTERVENTION ROUTES ---
// =========================================================================

app.post('/api/interventions', protect, async (req, res) => {
  try {
    const { 
      // Core IDs
      patientId, 
      practitionerId, 
      
      // Patient Demographics
      patient_first_name, 
      patient_last_name, 
      patient_dob, 
      patient_county,
      
      // Practitioner Details
      practitioner_first_name, 
      practitioner_last_name, 
      practitioner_discipline,
      
      // Encounter Details
      date, 
      startTime, 
      endTime, 
      status, 
      type, 
      location, 
      totalTime, 
      total_time,
      
      // Signatures
      parentSignatureBase64, 
      practitionerSignatureBase64 
    } = req.body;

    const finalTotalTime = total_time || totalTime || 0;

    const trustedPractitionerId = req.practitioner.practitionerId;

    // Ownership check: the patient must belong to the requesting practitioner
    const { rows: ownedRows } = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [patientId, trustedPractitionerId]
    );
    if (!ownedRows[0]) {
      return res.status(403).json({ error: 'Not authorized for this patient' });
    }

    // Service type check: the submitted type must be one the practitioner was registered to provide
    const { rows: practitionerRows } = await pool.query(
      'SELECT service_types FROM practitioners WHERE id = $1',
      [trustedPractitionerId]
    );
    const submittingPractitioner = practitionerRows[0];
    if (submittingPractitioner.service_types?.length > 0 && !submittingPractitioner.service_types.includes(type)) {
      return res.status(403).json({ error: 'You are not registered to provide this service type' });
    }

    const { rows: insertedRows } = await pool.query(
      `INSERT INTO assessments
         (patient_id, practitioner_id, patient_first_name, patient_last_name, patient_dob, patient_county,
          practitioner_first_name, practitioner_last_name, practitioner_discipline,
          service_date, start_time, end_time, total_time, status, type, location,
          parent_signature, practitioner_signature, form_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       RETURNING *`,
      [
        patientId, trustedPractitionerId, patient_first_name, patient_last_name, patient_dob, patient_county,
        practitioner_first_name, practitioner_last_name, practitioner_discipline,
        date, startTime, endTime, finalTotalTime, status, type, location,
        parentSignatureBase64, practitionerSignatureBase64, JSON.stringify({})
      ]
    );

    res.status(201).json({ success: true, message: "Encounter formally saved to Supabase", data: insertedRows });
  } catch (error) {
    console.error('Failed to save encounter:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// =========================================================================
// --- PRACTITIONER PROFILE ROUTES ---
// =========================================================================

// GET: Fetch the practitioner's saved signature
app.get('/api/practitioner/profile', protect, async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    // Explicit allow-list — never return password_hash, ssn, or pay_rate to the client
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, role, position_title, address, phone_number, saved_signature, service_types, profile_picture
       FROM practitioners WHERE id = $1`,
      [practitionerId]
    );
    const data = rows[0];

    // Map the signature so the frontend can read it easily
    if (data) data.signature = data.saved_signature;

    res.json(data || {});
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST: Save or update the practitioner's signature
app.post('/api/practitioner/signature', protect, async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { signature } = req.body;

    await pool.query('UPDATE practitioners SET saved_signature = $1 WHERE id = $2', [signature, practitionerId]);

    res.json({ success: true, message: 'Default signature securely saved.' });
  } catch (error) {
    console.error('Signature save error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// A resized/compressed JPEG data URL comfortably fits well under this — this
// mainly guards against a client sending an uncompressed original by mistake.
const MAX_PROFILE_PICTURE_BASE64_LENGTH = 2_000_000; // ~1.5MB decoded

// POST: Save or update the practitioner's own profile picture (self-service,
// separate from updateStaffProfile which is admin/office-manager editing others).
app.post('/api/practitioner/profile-picture', protect, async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { picture } = req.body;

    if (picture !== null && (typeof picture !== 'string' || !picture.startsWith('data:image/'))) {
      return res.status(400).json({ error: 'picture must be a data:image/... URL or null' });
    }
    if (picture && picture.length > MAX_PROFILE_PICTURE_BASE64_LENGTH) {
      return res.status(400).json({ error: 'Image is too large — please use a smaller photo.' });
    }

    await pool.query('UPDATE practitioners SET profile_picture = $1 WHERE id = $2', [picture, practitionerId]);

    res.json({ success: true, message: 'Profile picture saved.' });
  } catch (error) {
    console.error('Profile picture save error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// =========================================================================
// --- PRACTITIONER PDF ROUTE ---
// =========================================================================

app.get('/api/reports/practitioner/njeis-form', protect, async (req, res) => {
  try {
    if (!req.practitioner || !req.practitioner.practitionerId) {
      return res.status(401).json({ error: "Unauthorized access" });
    }
    
    const practitionerId = req.practitioner.practitionerId;

    const { rows: assessments } = await pool.query(
      'SELECT * FROM assessments WHERE practitioner_id = $1 ORDER BY service_date ASC',
      [practitionerId]
    );

    if (!assessments || assessments.length === 0) return res.status(404).send('No records found for this practitioner.');

    const groupedByPatient = assessments.reduce((acc, record) => {
      if (!acc[record.patient_id]) acc[record.patient_id] = [];
      acc[record.patient_id].push(record);
      return acc;
    }, {});

    const templatePath = path.join(__dirname, 'templates', 'NJEIS-020.pdf');
    const templateBytes = fs.readFileSync(templatePath);
    const finalPdf = await PDFDocument.create();
    const MAX_ROWS_PER_PAGE = 10; 

    for (const patientId of Object.keys(groupedByPatient)) {
      const patientRecords = groupedByPatient[patientId];
      
      for (let i = 0; i < patientRecords.length; i += MAX_ROWS_PER_PAGE) {
        const chunk = patientRecords.slice(i, i + MAX_ROWS_PER_PAGE);
        const pData = chunk[0]; 

        const tempDoc = await PDFDocument.load(templateBytes);
        const form = tempDoc.getForm();

        // Helper to force font size 10 on every field
        const setUniformText = (fieldName, text) => {
          try {
            const field = form.getTextField(fieldName);
            field.setText(text || '');
            field.setFontSize(10);
          } catch (e) {
            console.warn(`Could not find PDF field: ${fieldName}`);
          }
        };

        setUniformText('Service Provider Agency Name', 'Progressive Steps');
        setUniformText('Practitioner Last Name', pData.practitioner_last_name);
        setUniformText('Practitioner First Name', pData.practitioner_first_name);
        setUniformText('Childs Last Name', pData.patient_last_name);
        setUniformText('Childs First Name', pData.patient_first_name);
        setUniformText('DOB', pData.patient_dob ? new Date(pData.patient_dob).toLocaleDateString() : '');
        
        // THE FIX: Pull the county directly from our new dedicated database column
        setUniformText('County', pData.patient_county || '');
        
        setUniformText('Child ID', pData.patient_id?.toString()); 
        
        chunk.forEach((session, index) => {
          const rowNum = index + 1; 
          const formattedDate = new Date(session.service_date).toLocaleDateString('en-US', {
            month: 'numeric', day: 'numeric', year: '2-digit'
          });

          setUniformText(`Service date${rowNum}`, formattedDate);
          setUniformText(`Service StatusRow${rowNum}`, session.status?.toString());
          setUniformText(`Service TypeRow${rowNum}`, session.type);
          setUniformText(`Service LocationRow${rowNum}`, session.location?.toString());
          setUniformText(`Start TimeRow${rowNum}`, session.start_time);
          setUniformText(`End TimeRow${rowNum}`, session.end_time);
          setUniformText(`Total TimeRow${rowNum}`, session.total_time?.toString());
        });

        setUniformText('Date', new Date().toLocaleDateString());

        const pages = tempDoc.getPages();
        const firstPage = pages[0];

        // Cleaned up Practitioner Signature
        if (pData.practitioner_signature) {
          const practSigImage = await tempDoc.embedPng(pData.practitioner_signature); 
          const practSigDims = practSigImage.scale(0.25); 
          firstPage.drawImage(practSigImage, { x: 40, y: 302, width: practSigDims.width, height: practSigDims.height });
        }

        // Cleaned up Parent Grid Signatures (Shifted slightly left, bumped up to 600)
        for (let index = 0; index < chunk.length; index++) {
          if (chunk[index].parent_signature) {
            const parentSigImage = await tempDoc.embedPng(chunk[index].parent_signature);
            const parentSigDims = parentSigImage.scale(0.15); 
            firstPage.drawImage(parentSigImage, { x: 405, y: 600 - (index * 20), width: parentSigDims.width, height: parentSigDims.height });
          }
        }

        form.flatten();
        const [copiedPage] = await finalPdf.copyPages(tempDoc, [0]);
        finalPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await finalPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=NJEIS_Report_${practitionerId}.pdf`);
    res.end(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('PDF Generation failed:', error);
    res.status(500).send('Error generating official NJEIS PDF.');
  }
});

// =========================================================================
// --- ADMIN PDF ROUTE ---
// =========================================================================

app.get('/api/admin/reports/njeis-form', protect, requireRole(['ceo', 'staff_director']), async (req, res) => {
  try {
    const { type, value } = req.query;

    if (!type || !value) {
      return res.status(400).json({ error: "Missing search parameters" });
    }

    // Whitelist the searchable column so a client cannot filter on arbitrary fields
    const ALLOWED_SEARCH_COLUMNS = ['patient_id', 'practitioner_id'];
    if (!ALLOWED_SEARCH_COLUMNS.includes(type)) {
      return res.status(400).json({ error: "Invalid search field" });
    }

    // `type` is safe to interpolate as a column name here — it's already
    // validated against ALLOWED_SEARCH_COLUMNS above, never raw user input.
    const { rows: assessments } = await pool.query(
      `SELECT * FROM assessments WHERE ${type} = $1 ORDER BY service_date ASC`,
      [value]
    );

    if (!assessments || assessments.length === 0) {
      return res.status(404).send('No records found for this identifier.');
    }

    const groupedByPatient = assessments.reduce((acc, record) => {
      if (!acc[record.patient_id]) acc[record.patient_id] = [];
      acc[record.patient_id].push(record);
      return acc;
    }, {});

    const templatePath = path.join(__dirname, 'templates', 'NJEIS-020.pdf');
    const templateBytes = fs.readFileSync(templatePath);
    const finalPdf = await PDFDocument.create();
    const MAX_ROWS_PER_PAGE = 10; 

    for (const patientId of Object.keys(groupedByPatient)) {
      const patientRecords = groupedByPatient[patientId];
      
      for (let i = 0; i < patientRecords.length; i += MAX_ROWS_PER_PAGE) {
        const chunk = patientRecords.slice(i, i + MAX_ROWS_PER_PAGE);
        const pData = chunk[0]; 

        const tempDoc = await PDFDocument.load(templateBytes);
        const form = tempDoc.getForm();

        // Admin route now properly uses the uniform text formatter!
        const setUniformText = (fieldName, text) => {
          try {
            const field = form.getTextField(fieldName);
            field.setText(text || '');
            field.setFontSize(10);
          } catch (e) {
            console.warn(`Could not find PDF field: ${fieldName}`);
          }
        };

        setUniformText('Service Provider Agency Name', 'Progressive Steps');
        setUniformText('Practitioner Last Name', pData.practitioner_last_name);
        setUniformText('Practitioner First Name', pData.practitioner_first_name);
        setUniformText('Childs Last Name', pData.patient_last_name);
        setUniformText('Childs First Name', pData.patient_first_name);
        setUniformText('DOB', pData.patient_dob ? new Date(pData.patient_dob).toLocaleDateString() : '');
        
        // THE FIX: Aggressively check every possible location for the county data
        const actualCounty = pData.patients?.county || pData.patient?.county || pData.form_data?.county || pData.patient_county || '';
        setUniformText('County', actualCounty);
        
        setUniformText('Child ID', pData.patient_id?.toString()); 
        
        chunk.forEach((session, index) => {
          const rowNum = index + 1; 
          const formattedDate = new Date(session.service_date).toLocaleDateString('en-US', {
            month: 'numeric', day: 'numeric', year: '2-digit'
          });

          setUniformText(`Service date${rowNum}`, formattedDate);
          setUniformText(`Service StatusRow${rowNum}`, session.status?.toString());
          setUniformText(`Service TypeRow${rowNum}`, session.type);
          setUniformText(`Service LocationRow${rowNum}`, session.location?.toString());
          setUniformText(`Start TimeRow${rowNum}`, session.start_time);
          setUniformText(`End TimeRow${rowNum}`, session.end_time);
          setUniformText(`Total TimeRow${rowNum}`, session.total_time?.toString());
        });

        setUniformText('Date', new Date().toLocaleDateString());

        const pages = tempDoc.getPages();
        const firstPage = pages[0];

        // Admin route now uses the fixed signature coordinates!
        if (pData.practitioner_signature) {
          const practSigImage = await tempDoc.embedPng(pData.practitioner_signature); 
          const practSigDims = practSigImage.scale(0.25); 
          firstPage.drawImage(practSigImage, { x: 40, y: 302, width: practSigDims.width, height: practSigDims.height });
        }

        // Cleaned up Parent Grid Signatures (Shifted slightly left, bumped up to 600)
        for (let index = 0; index < chunk.length; index++) {
          if (chunk[index].parent_signature) {
            const parentSigImage = await tempDoc.embedPng(chunk[index].parent_signature);
            const parentSigDims = parentSigImage.scale(0.15); 
            firstPage.drawImage(parentSigImage, { x: 405, y: 600 - (index * 20), width: parentSigDims.width, height: parentSigDims.height });
          }
        }

        form.flatten();
        const [copiedPage] = await finalPdf.copyPages(tempDoc, [0]);
        finalPdf.addPage(copiedPage);
      }
    }

    const pdfBytes = await finalPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Admin_Report_${type}_${value}.pdf`);
    res.end(Buffer.from(pdfBytes));
  } catch (error) {
    console.error('Admin PDF Generation failed:', error);
    res.status(500).send('Error generating official NJEIS PDF.');
  }
});

// =========================================================================
// --- DATA FETCHING ---
// =========================================================================

app.get('/api/interventions/:patientId', protect, async (req, res) => {
  const { patientId } = req.params;
  const practitionerId = req.practitioner.practitionerId;
  try {
    // Ownership check: only return assessments for a patient owned by the requester
    const { rows: ownedRows } = await pool.query(
      'SELECT id FROM patients WHERE id = $1 AND practitioner_id = $2',
      [patientId, practitionerId]
    );
    if (!ownedRows[0]) return res.status(403).json({ error: 'Not authorized for this patient' });

    const { rows } = await pool.query(
      'SELECT * FROM assessments WHERE patient_id = $1 ORDER BY service_date DESC',
      [patientId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Fetch interventions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/', (req, res) => { res.send('NJEIS Encounter App Backend is Secure and Active'); });
app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});