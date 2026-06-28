require('dotenv').config();
const { protect } = require('./src/middleware/authMiddleware'); 
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

// --- Supabase Database Initialization ---
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;

// 👇 CHANGED BACK: It now looks for exactly "SUPABASE_KEY" in your .env file
const supabaseKey = process.env.SUPABASE_KEY; 

const supabase = createClient(supabaseUrl, supabaseKey);

// --- Route Imports ---
const patientRoutes = require('./src/routes/patientRoutes');
const authRoutes = require('./src/routes/authRoutes');
const reportRoutes = require('./src/routes/reportRoutes'); 
const billingRoutes = require('./src/routes/billingRoutes'); // 🌟 NEW: Imported billing routes

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(helmet()); 
app.use(cors());   
app.use(express.json({ limit: '10mb' })); 
app.use(express.urlencoded({ limit: '10mb', extended: true })); 

// --- Modular Routes ---
app.use('/api/patients', patientRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/billing', billingRoutes); // 🌟 NEW: Mounted billing routes to fix the 404 error!

// =========================================================================
// --- ADMIN REGISTRATION ROUTE (MOVED TO TOP!) ---
// =========================================================================

app.post('/api/auth/register-practitioner', async (req, res) => {
  // THE TRACKER: If you don't see this in your terminal, the route isn't running!
  console.log("👉 REGISTRATION ROUTE HIT! Payload:", req.body); 

  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "All fields are required." });
    }

    const { data: existingUser, error: checkError } = await supabase
      .from('practitioners')
      .select('id')
      .eq('email', email)
      .maybeSingle(); 

    if (existingUser) {
      return res.status(409).json({ error: "A practitioner with this email already exists." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const { data, error } = await supabase
      .from('practitioners')
      .insert([
        {
          first_name: firstName,
          last_name: lastName,
          email: email,
          password_hash: passwordHash
        }
      ]);

    if (error) {
      console.error("Database Insertion Error:", error);
      throw error;
    }

    res.status(201).json({ success: true, message: "Practitioner registered successfully." });
    
  } catch (error) {
    console.error("Registration failed:", error);
    res.status(500).json({ error: "Internal Server Error during registration." });
  }
});

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

    const { data, error } = await supabase
      .from('assessments')
      .insert([
        {
          patient_id: patientId,
          practitioner_id: trustedPractitionerId,
          
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
          service_date: date,
          start_time: startTime,
          end_time: endTime,
          total_time: finalTotalTime,
          status: status,
          type: type,
          location: location,
          
          // Signatures
          parent_signature: parentSignatureBase64,        
          practitioner_signature: practitionerSignatureBase64,
          
          form_data: {}
        }
      ]);

    if (error) {
      console.error("Supabase Insertion Error:", error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    res.status(201).json({ success: true, message: "Encounter formally saved to Supabase", data });
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
    const { data, error } = await supabase
      .from('practitioners')
      .select('*') 
      .eq('id', practitionerId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    
    // Map the signature so the frontend can read it easily
    if (data) data.signature = data.saved_signature; 
    
    res.json(data || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST: Save or update the practitioner's signature
app.post('/api/practitioner/signature', protect, async (req, res) => {
  try {
    const practitionerId = req.practitioner.practitionerId;
    const { signature } = req.body;

    const { error } = await supabase
      .from('practitioners')
      .update({ saved_signature: signature })
      .eq('id', practitionerId);

    if (error) throw error;
    res.json({ success: true, message: 'Default signature securely saved.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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

    const { data: assessments, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('practitioner_id', practitionerId)
      .order('service_date', { ascending: true });

    if (error) throw error;
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
    res.status(500).send('Error generating official NJEIS PDF: ' + error.message);
  }
});

// =========================================================================
// --- ADMIN PDF ROUTE ---
// =========================================================================

app.get('/api/admin/reports/njeis-form', protect, async (req, res) => {
  try {
    const { type, value } = req.query;

    if (!type || !value) {
      return res.status(400).json({ error: "Missing search parameters" });
    }

    const { data: assessments, error } = await supabase
      .from('assessments')
      .select('*')
      .eq(type, value) 
      .order('service_date', { ascending: true });

    if (error) throw error;
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
    res.status(500).send('Error generating official NJEIS PDF: ' + error.message);
  }
});

// =========================================================================
// --- DATA FETCHING ---
// =========================================================================

app.get('/api/interventions/:patientId', protect, async (req, res) => {
  const { patientId } = req.params;
  const { data, error } = await supabase.from('assessments').select('*').eq('patient_id', patientId).order('service_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/', (req, res) => { res.send('NJEIS Encounter App Backend is Secure and Active'); });
app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // Keep-alive: ping self every 10 min to prevent Render free tier from sleeping
  const pingUrl = process.env.RENDER_EXTERNAL_URL;
  if (pingUrl) {
    const https = require('https');
    setInterval(() => {
      https.get(`${pingUrl}/health`, (res) => {
        console.log(`[keep-alive] ping → ${res.statusCode}`);
      }).on('error', (err) => {
        console.warn(`[keep-alive] ping failed: ${err.message}`);
      });
    }, 10 * 60 * 1000);
    console.log(`[keep-alive] pinging ${pingUrl}/health every 10 min`);
  }
});