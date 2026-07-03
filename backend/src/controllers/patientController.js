const { patientSchema } = require('../utils/patientSchema');
const { supabase } = require('../config/db');

const registerPatient = async (req, res) => {
  try {
    console.log("Entering registerPatient..."); // Debug log

    // 1. Validate data
    const validatedData = patientSchema.parse(req.body);
    
    // 2. Check if middleware passed the practitioner
    if (!req.practitioner || !req.practitioner.practitionerId) {
      console.error("Auth Error: req.practitioner is missing");
      return res.status(401).json({ error: "Authentication required" });
    }

    const practitionerId = req.practitioner.practitionerId;

    // 3. Insert into Supabase (Correcting the SQL syntax to Supabase syntax)
    const { data, error } = await supabase
      .from('patients')
      .insert([
        {
          first_name: validatedData.firstName,
          middle_name: validatedData.middleName || null,
          last_name: validatedData.lastName,
          dob: validatedData.dob,
          county: validatedData.county,
          child_id: validatedData.childId,
          practitioner_id: practitionerId
        }
      ])
      .select();

    if (error) {
      console.error("Supabase Insert Error:", error);
      throw error;
    }

    // 4. Send success response
    res.status(201).json({ 
      message: "Patient registered successfully", 
      data: data[0] 
    });

  } catch (error) {
    console.error("Registration Error Details:", error);
    
    // Handle Zod validation errors
    if (error.errors) {
        return res.status(400).json({ error: error.errors });
    }
    
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
};

const getPatients = async (req, res) => {
  try {
    // Ensure we only fetch patients for THIS practitioner
    const practitionerId = req.practitioner.practitionerId;
    
    const { data: patients, error } = await supabase
      .from('patients')
      .select('*')
      .eq('practitioner_id', practitionerId); // Filter by practitioner

    if (error) throw error;

    res.json(patients);
  } catch (err) {
    console.error("Fetch Patients Error:", err);
    res.status(500).json({ error: 'Server error fetching patients' });
  }
};

// Fetch all assessments/interventions for a specific patient
const getPatientAssessments = async (req, res) => {
  try {
    const patientId = req.params.id;

    // Fetch from the 'assessments' table where the patient_id matches
    const { data: assessments, error } = await supabase
      .from('assessments')
      .select('*')
      .eq('patient_id', patientId) // Ensure 'patient_id' matches your exact Supabase column name
      .order('service_date', { ascending: false }); // Orders them newest to oldest

    if (error) {
      console.error("Supabase Fetch Error:", error);
      throw error;
    }

    res.status(200).json(assessments);

  } catch (error) {
    console.error("Error fetching patient assessments:", error);
    res.status(500).json({ error: "Failed to fetch interventions" });
  }
};

const getRejectedLogs = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const { data: logs, error } = await supabase
      .from('assessments')
      .select('id, patient_first_name, patient_last_name, patient_id, service_date, type, location, start_time, end_time, total_time, status, rejection_note, rejected_at, rejection_count, parent_signature, billing_status, acknowledged_at')
      .eq('practitioner_id', practitionerId)
      .in('billing_status', ['rejected', 'declined'])
      .is('acknowledged_at', null)
      .order('rejected_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Error fetching rejected logs:', error);
    res.status(500).json({ error: 'Failed to fetch rejected logs' });
  }
};

const acknowledgeLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { assessmentId, response } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('assessments')
      .select('id, billing_status')
      .eq('id', assessmentId)
      .eq('practitioner_id', practitionerId)
      .single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Log not found' });
    if (!['declined', 'rejected'].includes(existing.billing_status))
      return res.status(400).json({ error: 'Log is not in a rejected state' });

    const updateData = { acknowledged_at: new Date().toISOString() };
    if (response && response.trim()) {
      updateData.practitioner_response = response.trim();
      updateData.responded_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('assessments')
      .update(updateData)
      .eq('id', assessmentId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error acknowledging log:', error);
    res.status(500).json({ error: 'Failed to acknowledge log' });
  }
};

const resubmitLog = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { assessmentId, type, location, start_time, end_time, total_time, status } = req.body;
  if (!assessmentId) return res.status(400).json({ error: 'assessmentId is required' });

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('assessments')
      .select('id, billing_status')
      .eq('id', assessmentId)
      .eq('practitioner_id', practitionerId)
      .single();
    if (fetchError || !existing) return res.status(404).json({ error: 'Log not found' });
    if (existing.billing_status !== 'rejected') return res.status(400).json({ error: 'Log is not in rejected state' });

    const { error } = await supabase
      .from('assessments')
      .update({ billing_status: 'pending', billing_review: null, type, location, start_time, end_time, total_time, status, rejection_note: null, rejected_at: null })
      .eq('id', assessmentId);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error resubmitting log:', error);
    res.status(500).json({ error: 'Failed to resubmit log' });
  }
};

const deletePatient = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  const { id } = req.params;
  try {
    const { data: patient, error: fetchError } = await supabase
      .from('patients')
      .select('id')
      .eq('id', id)
      .eq('practitioner_id', practitionerId)
      .single();
    if (fetchError || !patient) return res.status(404).json({ error: 'Patient not found' });

    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting patient:', error);
    res.status(500).json({ error: 'Failed to delete patient' });
  }
};

const getPractitionerStats = async (req, res) => {
  const practitionerId = req.practitioner.practitionerId;
  try {
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const { data, error } = await supabase
      .from('assessments')
      .select('total_time')
      .eq('practitioner_id', practitionerId)
      .gte('service_date', monthStart);
    if (error) throw error;
    const logsThisMonth = data.length;
    const hoursThisMonth = data.reduce((sum, r) => sum + (r.total_time || 0), 0) / 60;
    res.json({ success: true, logsThisMonth, hoursThisMonth });
  } catch (error) {
    console.error('Error fetching practitioner stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

module.exports = { registerPatient, getPatients, getPatientAssessments, getRejectedLogs, resubmitLog, acknowledgeLog, deletePatient, getPractitionerStats };