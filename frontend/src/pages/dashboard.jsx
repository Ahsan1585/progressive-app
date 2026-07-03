import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { AddPatientModal } from '@/components/AddPatientModal';
import { LogInterventionModal } from '@/components/LogInterventionModal';
import { Button } from '@/components/ui/button';
import SignaturePad from '@/components/SignaturePad';

const Dashboard = () => {
  const [patients, setPatients] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [isInterventionModalOpen, setIsInterventionModalOpen] = useState(false);
  const [interventions, setInterventions] = useState([]);
  
  // Master Signature State
  const [savedSignature, setSavedSignature] = useState(null);
  const [isUpdatingSignature, setIsUpdatingSignature] = useState(false);
  const [practitionerProfile, setPractitionerProfile] = useState(null);

  // Rejected logs state
  const [rejectedLogs, setRejectedLogs] = useState([]);
  const [resubmitModal, setResubmitModal] = useState(null);
  const [resubmitForm, setResubmitForm] = useState({});
  const [isResubmitting, setIsResubmitting] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(null);

  const [deletingPatientId, setDeletingPatientId] = useState(null);

  // Signature dropdown
  const [sigDropdownOpen, setSigDropdownOpen] = useState(false);

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  const navigate = useNavigate();

  // Standard NJEIS Code Mappings 
  const serviceTypeMap = {
    'EV': 'Evaluation (EV)', 'AS': 'Assessment (AS)', 'IFSP': 'IFSP Meeting', 'AU': 'Audiology (AU)',
    'DI': 'Developmental Intervention (DI)', 'FT': 'Family Training (FT)', 'HS': 'Health Service (HS)',
    'MS': 'Medical Service (MS)', 'NU': 'Nursing (NU)', 'NT': 'Nutrition (NT)', 'OT': 'Occupational Therapy (OT)',
    'PT': 'Physical Therapy (PT)', 'PSY': 'Psychological (PSY)', 'SLP': 'Speech Language Therapy (SLP)',
    'SW': 'Social Work (SW)', 'VI': 'Vision (VI)', 'CC': 'Childcare/Respite (CC)', 'I/T': 'Interpreter/Translator (I/T)',
    'ES': 'Escort/Security (ES)', 'TPC': 'Transition Planning Conference (TPC)'
  };
  const statusCodeMap = { '1': 'Ongoing IFSP Service (1)', '2': 'Practitioner Missed/Cancelled (2)', '3': 'Family Missed/Cancelled (3)', '4': 'Make-up Service Provided (4)', '5': 'Compensatory Service Provided (5)' };
  const billingStatusConfig = {
    njeis_review: { label: 'In Review',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    invoiced:     { label: 'Accepted',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected:     { label: 'Returned',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    declined:     { label: 'Declined',   cls: 'bg-red-50 text-red-700 border-red-200' },
  };
  const locationCodeMap = { '1': 'Home (1)', '2': 'Residential Facility (2)', '3': 'Service Provider Clinic/Office (3)', '4': 'Hospital (Inpatient) (4)', '5': 'EC Program- Children with Disabilities (5)', '6': 'EC Program- Inclusive Community (6)', '7': 'DCP&P Office (7)', '8': 'Phone/Video Conferencing (8)' };

  const fetchPatients = async () => {
    try {
      const response = await api.get('/api/patients');
      setPatients(response.data);
    } catch (error) {
      console.error('Failed to fetch patients', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/');
      }
    }
  };

  const fetchInterventions = async () => {
    if (selectedPatient?.id) {
      try {
        const response = await api.get(`/api/patients/${selectedPatient.id}/assessments`);
        setInterventions(response.data);
      } catch (error) {
        console.error('Failed to fetch interventions', error);
      }
    } else {
      setInterventions([]);
    }
  };

  const fetchProfile = async () => {
    try {
      const response = await api.get('/api/practitioner/profile');
      if (response.data) {
        setPractitionerProfile(response.data);
        if (response.data.signature) {
          setSavedSignature(response.data.signature);
        } else {
          setSigDropdownOpen(true);
        }
      }
    } catch (err) {
      console.error("Could not load profile data", err);
    }
  };

  const fetchRejectedLogs = async () => {
    try {
      const response = await api.get('/api/patients/rejected-logs');
      if (response.data.success) setRejectedLogs(response.data.logs);
    } catch (error) {
      console.error('Failed to fetch rejected logs', error);
    }
  };

  const handleOpenResubmit = (log) => {
    setResubmitModal(log);
    setResubmitForm({
      type: log.type || '',
      location: log.location || '',
      start_time: log.start_time || '',
      end_time: log.end_time || '',
      total_time: log.total_time || '',
      status: log.status || ''
    });
  };

  const handleResubmit = async () => {
    if (!resubmitModal) return;
    setIsResubmitting(true);
    try {
      await api.post('/api/patients/resubmit-log', { assessmentId: resubmitModal.id, ...resubmitForm });
      setRejectedLogs(prev => prev.filter(l => l.id !== resubmitModal.id));
      setResubmitModal(null);
    } catch (error) {
      console.error('Failed to resubmit log', error);
      alert('Failed to resubmit. Please try again.');
    } finally {
      setIsResubmitting(false);
    }
  };

  const handleDeletePatient = async (patient) => {
    if (!window.confirm(`Remove ${patient.first_name} ${patient.last_name} from your patient list?`)) return;
    setDeletingPatientId(patient.id);
    try {
      await api.delete(`/api/patients/${patient.id}`);
      if (selectedPatient?.id === patient.id) setSelectedPatient(null);
      setPatients(prev => prev.filter(p => p.id !== patient.id));
    } catch (err) {
      alert('Failed to delete patient. Please try again.');
    } finally {
      setDeletingPatientId(null);
    }
  };

  const handleAcknowledge = async (logId) => {
    setIsAcknowledging(logId);
    try {
      await api.post('/api/patients/acknowledge-log', { assessmentId: logId });
      setRejectedLogs(prev => prev.filter(l => l.id !== logId));
    } catch (err) {
      console.error('Failed to acknowledge log', err);
      alert('Failed to acknowledge. Please try again.');
    } finally {
      setIsAcknowledging(null);
    }
  };

  const handleSaveSignature = async (base64Sig) => {
    try {
      await api.post('/api/practitioner/signature', { signature: base64Sig });
      setSavedSignature(base64Sig);
      setIsUpdatingSignature(false);
      alert("Master signature saved successfully!");
    } catch (err) {
      alert("Failed to save signature.");
    }
  };

  // 🌟 HELPER FUNCTION: Prevents Timezone Shifting 🌟
  const formatSafeDate = (dateString) => {
    if (!dateString) return "N/A";
    const [year, month, day] = dateString.split('T')[0].split('-');
    return `${parseInt(month)}/${parseInt(day)}/${year}`;
  };

  useEffect(() => {
    fetchPatients();
    fetchProfile();
    fetchRejectedLogs();
  }, [navigate]);

  useEffect(() => {
    fetchInterventions();
  }, [selectedPatient]);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden text-slate-900 font-sans">

      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* LEFT SIDEBAR: Patient Drawer */}
      <div className={`fixed inset-y-0 left-0 z-50 w-80 bg-white border-r border-slate-200 flex flex-col min-h-0 shadow-sm transform transition-transform duration-200 md:relative md:translate-x-0 md:z-10 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-5 border-b border-slate-100 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">My Patients</h2>
            <AddPatientModal onPatientAdded={fetchPatients} />
          </div>
          
          <div className="relative">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search patients..." className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50/50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" disabled />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-slate-50/30">
          {patients.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-slate-400 font-medium">No patients registered yet.</p>
            </div>
          ) : (
            patients.map((p) => {
              const isSelected = selectedPatient?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`group relative w-full text-left p-3.5 rounded-xl transition-all border cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                  }`}
                  onClick={() => { setSelectedPatient(p); setSidebarOpen(false); }}
                >
                  <div className="font-semibold text-[15px] capitalize pr-6">{p.first_name}{p.middle_name ? ` ${p.middle_name}` : ''} {p.last_name}</div>
                  <div className={`text-xs mt-1 font-medium tracking-wide ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                    ID: {p.child_id}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeletePatient(p); }}
                    disabled={deletingPatientId === p.id}
                    className={`absolute top-2.5 right-2.5 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50 cursor-pointer ${
                      isSelected ? 'hover:bg-blue-500 text-blue-100' : 'hover:bg-red-50 text-slate-400 hover:text-red-500'
                    }`}
                    title="Delete patient"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-slate-200 bg-white flex items-center justify-between px-4 md:px-8 shadow-sm z-20">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Toggle patients"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse hidden md:block"></span>
            <h1 className="text-base font-semibold text-slate-800 tracking-tight">Clinical Workspace</h1>
          </div>
          <div className="flex items-center gap-3">

            {/* Logged-in practitioner name — hidden on mobile */}
            {practitionerProfile && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">
                    {practitionerProfile.first_name?.[0]}{practitionerProfile.last_name?.[0]}
                  </span>
                </div>
                <span className="text-sm font-semibold text-slate-700">
                  {practitionerProfile.first_name} {practitionerProfile.last_name}
                </span>
              </div>
            )}

            {/* Signature Button */}
            <div className="relative">
              <button
                onClick={() => { setSigDropdownOpen(o => !o); setIsUpdatingSignature(false); }}
                className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all min-h-[44px]"
              >
                <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span className="hidden md:inline text-sm font-medium text-slate-600">My Signature</span>
                {savedSignature && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" title="Signature saved" />}
                <svg className={`hidden md:block w-3.5 h-3.5 text-slate-400 transition-transform ${sigDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {sigDropdownOpen && (
                <>
                  {/* Backdrop to close on outside click */}
                  <div className="fixed inset-0 z-10" onClick={() => setSigDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-[calc(100vw-2rem)] md:w-80 max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl z-20 p-5 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">My Digital Signature</h3>
                      <p className="text-xs text-slate-400 mt-0.5">Applied to encounters with a single click</p>
                    </div>
                    {!savedSignature && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        <p className="text-xs text-amber-700 font-medium">A signature is required to log interventions. Please draw and save yours to get started.</p>
                      </div>
                    )}
                    {savedSignature && !isUpdatingSignature ? (
                      <div className="space-y-3">
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 flex justify-center">
                          <img src={savedSignature} alt="Saved Signature" className="h-16" />
                        </div>
                        <Button
                          variant="outline"
                          className="w-full cursor-pointer text-slate-600"
                          onClick={() => setIsUpdatingSignature(true)}
                        >
                          Update Signature
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <SignaturePad
                          label="Draw your signature"
                          onSave={(sig) => { handleSaveSignature(sig); setSigDropdownOpen(false); }}
                        />
                        {savedSignature && (
                          <Button
                            variant="ghost"
                            className="w-full text-slate-500 cursor-pointer"
                            onClick={() => setIsUpdatingSignature(false)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={() => { localStorage.removeItem('token'); navigate('/'); }}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 md:px-4 py-2 rounded-lg transition-all min-h-[44px] cursor-pointer"
              title="Sign Out"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden md:inline">Sign Out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 md:p-8">

          {/* Action Required Banner */}
          {rejectedLogs.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-800">Action Required — {rejectedLogs.length} Log{rejectedLogs.length > 1 ? 's' : ''} Need Your Attention</h3>
                  <p className="text-sm text-red-600">Admin has reviewed the following logs. Acknowledge each action or revise and resubmit where applicable.</p>
                </div>
              </div>
              <div className="space-y-3">
                {rejectedLogs.map(log => (
                  <div key={log.id} className="bg-white rounded-xl border border-red-100 p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-800 capitalize">{log.patient_first_name} {log.patient_last_name}</span>
                        {log.billing_status === 'declined' ? (
                          <span className="text-xs bg-red-100 text-red-700 font-semibold px-2 py-0.5 rounded-full border border-red-200">
                            Permanently Declined
                          </span>
                        ) : (
                          <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full border border-amber-200">
                            Returned for Revision
                          </span>
                        )}
                        {log.rejection_count > 1 && (
                          <span className="text-xs bg-slate-100 text-slate-600 font-semibold px-2 py-0.5 rounded-full border border-slate-200">
                            {log.rejection_count}x
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 lg:grid-cols-5 gap-x-4 gap-y-2 mt-1">
                        <div>
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Date</span>
                          <span className="text-sm text-slate-700 font-medium">
                            {log.service_date ? new Date(log.service_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Time</span>
                          <span className="text-sm text-slate-700 font-medium">{log.start_time || '-'} – {log.end_time || '-'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Service Type</span>
                          <span className="text-sm text-slate-700 font-medium">{serviceTypeMap[log.type] || log.type || '-'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Service Status</span>
                          <span className="text-sm text-slate-700 font-medium">{statusCodeMap[log.status] || log.status || '-'}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Service Location</span>
                          <span className="text-sm text-slate-700 font-medium">{locationCodeMap[log.location] || log.location || '-'}</span>
                        </div>
                      </div>
                      {log.rejection_note && (
                        <div className="flex items-start gap-2 mt-2 bg-red-50 border border-red-100 rounded-lg p-2.5">
                          <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                          <p className="text-sm text-red-800 font-medium">{log.rejection_note}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {log.billing_status === 'declined' ? (
                        <button
                          onClick={() => handleAcknowledge(log.id)}
                          disabled={isAcknowledging === log.id}
                          className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isAcknowledging === log.id ? 'Saving…' : 'Acknowledge'}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleOpenResubmit(log)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
                        >
                          Revise & Resubmit
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!selectedPatient ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="p-5 bg-white rounded-full border border-slate-200 shadow-sm mb-4">
                <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-slate-800">Select a Patient</h2>
              <p className="text-sm text-slate-400 mt-1 md:hidden">Tap the menu icon to open your patient list</p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              
              {/* Detailed Patient Info Card */}
              <div className="bg-white p-4 md:p-7 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <div className="space-y-4">
                  <h2 className="text-xl md:text-3xl font-bold text-slate-900 tracking-tight capitalize">
                    {selectedPatient.first_name}{selectedPatient.middle_name ? ` ${selectedPatient.middle_name}` : ''} {selectedPatient.last_name}
                  </h2>

                  <div className="grid grid-cols-2 gap-x-6 md:gap-x-8 gap-y-3 mt-4">
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Child ID</span>
                      <span className="text-sm font-medium text-slate-900">{selectedPatient.child_id}</span>
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Date of Birth</span>
                      <span className="text-sm font-medium text-slate-900">
                        {/* 🌟 FIXED: Patient DOB Timezone Shift 🌟 */}
                        {selectedPatient.dob ? formatSafeDate(selectedPatient.dob) : 'N/A'}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">County</span>
                      <span className="text-sm font-medium text-slate-900 capitalize">
                        {selectedPatient.county || 'N/A'}
                      </span>
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-500 uppercase font-semibold tracking-wider">Status</span>
                      <span className="text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md w-max">
                        Active
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3 md:flex-shrink-0">
                  <Button
                    onClick={() => setIsInterventionModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md px-5 py-6 rounded-xl transition-all flex items-center justify-center gap-2 w-full md:w-auto cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Log Intervention
                  </Button>

                  <LogInterventionModal 
                    patient={selectedPatient} 
                    isOpen={isInterventionModalOpen} 
                    onClose={() => setIsInterventionModalOpen(false)}
                    onSuccess={fetchInterventions} 
                  />
                </div>
              </div>

              {/* Dynamic Intervention History Section */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 md:px-7 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <h3 className="text-lg font-bold text-slate-800">Recent Interventions</h3>
                  <span className="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
                    {interventions.length} Sessions
                  </span>
                </div>

                {interventions.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {interventions.map((item) => {
                      const displayType = serviceTypeMap[item.type] || item.type;
                      const displayLocation = locationCodeMap[item.location] || `Location: ${item.location}`;
                      const displayStatus = statusCodeMap[item.status] || `Status: ${item.status}`;

                      const billingBadge = billingStatusConfig[item.billing_status];
                      return (
                        <div key={item.id} className="px-4 md:px-7 py-4 hover:bg-slate-50 transition-colors">
                          <div className="flex justify-between items-start">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-slate-800">{formatSafeDate(item.service_date)}</p>
                                {billingBadge && (
                                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${billingBadge.cls}`}>
                                    {billingBadge.label}
                                  </span>
                                )}
                              </div>
                              <p className="text-sm font-medium text-slate-700">{displayType}</p>
                              <p className="text-xs text-slate-500">{displayLocation}</p>
                            </div>
                            <div className="text-right space-y-1">
                              <p className="text-sm font-semibold text-slate-700">
                                {item.total_time ? (item.total_time / 60).toFixed(2) : "0.00"} hrs
                              </p>
                              <p className="text-xs text-slate-500">
                                {item.start_time} - {item.end_time}
                              </p>
                              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
                                {displayStatus}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16 bg-white">
                    <p className="text-base text-slate-500 font-medium">No clinical interventions recorded yet.</p>
                  </div>
                )}
              </div>

            </div>
          )}

        </main>
      </div>
      {/* Resubmit Modal */}
      {resubmitModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Revise & Resubmit Log</h3>
              <p className="text-sm text-slate-500 mt-1">
                Correct the details below. Your parent signature will be preserved automatically.
              </p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <span className="font-semibold">Admin note:</span> {resubmitModal.rejection_note}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Service Type</label>
                <select
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                  value={resubmitForm.type}
                  onChange={e => setResubmitForm(f => ({ ...f, type: e.target.value }))}
                >
                  {Object.entries(serviceTypeMap).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Service Location</label>
                <select
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                  value={resubmitForm.location}
                  onChange={e => setResubmitForm(f => ({ ...f, location: e.target.value }))}
                >
                  {Object.entries(locationCodeMap).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Start Time</label>
                <input
                  type="time"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                  value={resubmitForm.start_time}
                  onChange={e => setResubmitForm(f => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">End Time</label>
                <input
                  type="time"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                  value={resubmitForm.end_time}
                  onChange={e => setResubmitForm(f => ({ ...f, end_time: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Time (minutes)</label>
                <input
                  type="number"
                  min="0"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                  value={resubmitForm.total_time}
                  onChange={e => setResubmitForm(f => ({ ...f, total_time: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Service Status</label>
                <select
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 bg-white"
                  value={resubmitForm.status}
                  onChange={e => setResubmitForm(f => ({ ...f, status: e.target.value }))}
                >
                  {Object.entries(statusCodeMap).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button
                variant="outline"
                className="flex-1 cursor-pointer"
                onClick={() => setResubmitModal(null)}
                disabled={isResubmitting}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50"
                onClick={handleResubmit}
                disabled={isResubmitting}
              >
                {isResubmitting ? 'Resubmitting...' : 'Resubmit for Review'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;