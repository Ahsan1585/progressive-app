import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '@/api/axiosInstance';
import { AddPatientModal } from '@/components/AddPatientModal';
import { LogInterventionModal } from '@/components/LogInterventionModal';
import { MessagesPanel } from '@/components/MessagesPanel';
import { Button } from '@/components/ui/button';
import SignaturePad from '@/components/SignaturePad';
import { formatTime12h } from '@/utils/formatTime';

const Dashboard = () => {
  const [patients, setPatients] = useState([]);
  const [patientSearchTerm, setPatientSearchTerm] = useState('');
  const [patientStatusFilter, setPatientStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive'
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [editingPatient, setEditingPatient] = useState(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
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
  const [responseDrafts, setResponseDrafts] = useState({});

  const [deletingPatientId, setDeletingPatientId] = useState(null);

  // Signature dropdown
  const [sigDropdownOpen, setSigDropdownOpen] = useState(false);

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Empty-state: registration modal + quick stats
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [practitionerStats, setPractitionerStats] = useState(null); // { logsThisMonth, hoursThisMonth }
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);

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
      return response.data;
    } catch (error) {
      console.error('Failed to fetch patients', error);
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        navigate('/');
      }
      return [];
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

  const fetchStats = async () => {
    try {
      const response = await api.get('/api/patients/practitioner-stats');
      if (response.data.success) setPractitionerStats(response.data);
    } catch (error) {
      console.error('Failed to fetch practitioner stats', error);
    }
  };

  const fetchUnreadMessageCount = async () => {
    try {
      const response = await api.get('/api/messages/unread-count');
      setUnreadMessageCount(response.data.unreadCount || 0);
    } catch (error) {
      console.error('Failed to fetch unread message count', error);
    }
  };

  const handleBackToDashboard = () => {
    setSelectedPatient(null);
    fetchStats();
    fetchRejectedLogs();
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

  const handleTogglePatientStatus = async (patient) => {
    const nextStatus = patient.status === 'inactive' ? 'active' : 'inactive';
    setIsUpdatingStatus(true);
    try {
      const response = await api.patch(`/api/patients/${patient.id}/status`, { status: nextStatus });
      const updated = response.data.data;
      setPatients(prev => prev.map(p => p.id === patient.id ? updated : p));
      setSelectedPatient(prev => (prev?.id === patient.id ? updated : prev));
    } catch (err) {
      console.error('Failed to update patient status', err);
      alert('Failed to update patient status. Please try again.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handlePatientUpdated = async () => {
    const updatedList = await fetchPatients();
    setEditingPatient(null);
    setSelectedPatient(prev => {
      if (!prev) return prev;
      return updatedList.find(p => p.id === prev.id) || prev;
    });
  };

  const handleAcknowledge = async (logId) => {
    setIsAcknowledging(logId);
    try {
      const response = responseDrafts[logId]?.trim() || undefined;
      await api.post('/api/patients/acknowledge-log', { assessmentId: logId, response });
      setRejectedLogs(prev => prev.filter(l => l.id !== logId));
      setResponseDrafts(prev => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
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

  const calculateTotalMinutes = (startTime, endTime) => {
    if (!startTime || !endTime) return 0;
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const diffMs = end - start;
    const diffMins = Math.round(diffMs / 60000);
    return diffMins < 0 ? diffMins + (24 * 60) : diffMins;
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
    fetchStats();
    fetchUnreadMessageCount();
  }, [navigate]);

  useEffect(() => {
    fetchInterventions();
  }, [selectedPatient]);

  const filteredPatients = patients.filter(p => {
    if (patientStatusFilter !== 'all' && (p.status || 'active') !== patientStatusFilter) return false;
    const term = patientSearchTerm.trim().toLowerCase();
    if (!term) return true;
    const fullName = `${p.first_name} ${p.middle_name || ''} ${p.last_name}`.toLowerCase();
    return fullName.includes(term) || p.child_id?.toLowerCase().includes(term);
  });

  // "Jump back in" — most recently serviced patients first (never-serviced
  // patients sort last), not just whatever order the roster happens to load in.
  const recentPatients = [...patients].sort((a, b) => {
    if (!a.last_service_date && !b.last_service_date) return 0;
    if (!a.last_service_date) return 1;
    if (!b.last_service_date) return -1;
    return b.last_service_date.localeCompare(a.last_service_date);
  }).slice(0, 5);

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
            <AddPatientModal onPatientAdded={() => fetchPatients()} />
          </div>
          
          <div className="relative">
            <svg className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search patients..."
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-slate-50/50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
              value={patientSearchTerm}
              onChange={(e) => setPatientSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex gap-1.5">
            {[
              { key: 'all', label: 'All' },
              { key: 'active', label: 'Active' },
              { key: 'inactive', label: 'Inactive' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPatientStatusFilter(key)}
                className={`flex-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                  patientStatusFilter === key
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 bg-slate-50/30">
          {patients.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-slate-400 font-medium">No patients registered yet.</p>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-slate-400 font-medium">No patients match your search.</p>
            </div>
          ) : (
            filteredPatients.map((p) => {
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
                  <div className="font-semibold text-[15px] capitalize pr-12">{p.first_name}{p.middle_name ? ` ${p.middle_name}` : ''} {p.last_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs font-medium tracking-wide ${isSelected ? 'text-blue-100' : 'text-slate-400'}`}>
                      ID: {p.child_id}
                    </span>
                    {(p.status || 'active') === 'inactive' && (
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                        isSelected ? 'bg-blue-500 border-blue-400 text-blue-100' : 'bg-slate-100 border-slate-200 text-slate-500'
                      }`}>
                        Inactive
                      </span>
                    )}
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); setEditingPatient(p); }}
                    className={`absolute top-2.5 right-9 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                      isSelected ? 'hover:bg-blue-500 text-blue-100' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-700'
                    }`}
                    title="Edit patient"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
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

        <div className="p-4 border-t border-slate-100">
          <p className="text-[10px] text-slate-300 text-center font-medium tracking-wide uppercase">Early Intervention Simplified</p>
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
            {selectedPatient && (
              <button
                onClick={handleBackToDashboard}
                className="p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                aria-label="Back to dashboard"
                title="Back to dashboard"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>
            )}
            <h1
              className={`text-base font-semibold text-slate-800 tracking-tight ${selectedPatient ? 'cursor-pointer hover:text-blue-600 transition-colors' : ''}`}
              onClick={() => selectedPatient && handleBackToDashboard()}
            >
              Clinical Workspace
            </h1>
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
                  <div className="fixed inset-x-4 top-[4.5rem] md:absolute md:inset-x-auto md:top-full md:right-0 md:mt-2 md:w-80 max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl z-20 p-5 space-y-4">
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
              onClick={() => setMessagesOpen(true)}
              className="relative flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 md:px-4 py-2 rounded-lg transition-all min-h-[44px] cursor-pointer"
              title="Messages"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
              </svg>
              <span className="hidden md:inline">Messages</span>
              {unreadMessageCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
                </span>
              )}
            </button>

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

        <MessagesPanel
          open={messagesOpen}
          onOpenChange={setMessagesOpen}
          onThreadRead={() => setUnreadMessageCount(0)}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-8">

          {/* Action Required Section */}
          {rejectedLogs.length > 0 && (
            <div className="mb-10">
              <p className="text-xs font-semibold text-red-500 uppercase tracking-wide mb-2 px-1">Needs Your Attention</p>
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 shadow-sm">
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
                          <span className="text-sm text-slate-700 font-medium">{log.start_time ? formatTime12h(log.start_time) : '-'} – {log.end_time ? formatTime12h(log.end_time) : '-'}</span>
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
                      {log.billing_status === 'declined' && (
                        <div className="mt-2 space-y-1">
                          <label className="text-xs font-semibold text-slate-500">Your response (optional)</label>
                          <textarea
                            value={responseDrafts[log.id] || ''}
                            onChange={(e) => setResponseDrafts(prev => ({ ...prev, [log.id]: e.target.value }))}
                            placeholder="Add a note for the admin before acknowledging…"
                            rows={2}
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400 resize-none"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0 sm:self-start sm:pt-1">
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
            </div>
          )}

          {!selectedPatient ? (
            <div className="flex flex-col items-center text-center px-6 pt-8 md:pt-12 pb-8 overflow-y-auto">
              <button
                onClick={() => patients.length === 0 ? setRegisterModalOpen(true) : setSidebarOpen(true)}
                className="relative p-5 bg-blue-50 rounded-full border-2 border-blue-200 shadow-md mb-4 hover:border-blue-300 hover:shadow-lg active:scale-95 transition-all cursor-pointer"
                aria-label={patients.length === 0 ? 'Register a patient' : 'Open patient list'}
              >
                {patients.length === 0 ? (
                  <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                ) : (
                  <svg className="w-10 h-10 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-blue-600 border-2 border-white flex items-center justify-center shadow-sm">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </span>
              </button>
              <h2 className="text-xl font-bold text-slate-800">
                {patients.length === 0 ? 'Register a Patient' : 'Select a Patient'}
              </h2>
              <p className={`text-sm text-slate-400 mt-1 ${patients.length === 0 ? '' : 'md:hidden'}`}>
                {patients.length === 0 ? 'Tap to add your first patient' : 'Tap to open your patient list'}
              </p>

              {patients.length > 0 && (
                <>
                  {/* Quick stats */}
                  <div className="grid grid-cols-3 gap-3 w-full max-w-sm mt-8">
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <div className="text-xl font-bold text-slate-800">{patients.length}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">Patients</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <div className="text-xl font-bold text-slate-800">{practitionerStats?.logsThisMonth ?? '–'}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">Logs This Month</div>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <div className="text-xl font-bold text-slate-800">{practitionerStats?.pendingReviewCount ?? '–'}</div>
                      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">Pending Review</div>
                    </div>
                  </div>

                  {/* Jump back in */}
                  <div className="w-full max-w-lg mt-6 text-left">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 px-1">Jump back in</p>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {recentPatients.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => setSelectedPatient(p)}
                          className="flex-shrink-0 px-4 py-2 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer capitalize whitespace-nowrap"
                        >
                          {p.first_name} {p.last_name?.[0]}.
                        </button>
                      ))}
                      {patients.length > 5 && (
                        <button
                          onClick={() => setSidebarOpen(true)}
                          className="flex-shrink-0 px-4 py-2 bg-slate-100 border border-slate-200 rounded-full text-sm font-semibold text-slate-500 hover:bg-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          +{patients.length - 5} more
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {patients.length === 0 && (
                <div className="w-full max-w-sm mt-8 text-left bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Getting Started</p>
                  <div className="flex items-center gap-2.5">
                    <span className={`w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center ${savedSignature ? 'bg-emerald-500' : 'border-2 border-slate-300'}`}>
                      {savedSignature && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className={`text-sm ${savedSignature ? 'text-slate-500 line-through' : 'text-slate-700 font-medium'}`}>Set up your digital signature</span>
                  </div>
                  <div className="flex items-center justify-between gap-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                      <span className="text-sm text-slate-700 font-medium">Register your first patient</span>
                    </div>
                    <Button size="sm" onClick={() => setRegisterModalOpen(true)} className="cursor-pointer flex-shrink-0">
                      Register
                    </Button>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 h-4 rounded-full border-2 border-slate-300 flex-shrink-0" />
                    <span className="text-sm text-slate-400">Log your first intervention</span>
                  </div>
                </div>
              )}
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
                      <button
                        onClick={() => handleTogglePatientStatus(selectedPatient)}
                        disabled={isUpdatingStatus}
                        title="Click to change status"
                        className={`text-sm font-medium px-2 py-0.5 rounded-md w-max border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          (selectedPatient.status || 'active') === 'inactive'
                            ? 'text-slate-600 bg-slate-100 border-slate-200 hover:bg-slate-200'
                            : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                        }`}
                      >
                        {(selectedPatient.status || 'active') === 'inactive' ? 'Inactive' : 'Active'}
                      </button>
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
                    Log Session
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => setEditingPatient(selectedPatient)}
                    className="text-slate-600 font-semibold px-5 py-6 rounded-xl transition-all flex items-center justify-center gap-2 w-full md:w-auto cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                    Edit Patient
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
                                {formatTime12h(item.start_time)} - {formatTime12h(item.end_time)}
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

      {/* Registration modal triggered from the empty-state icon/checklist (sidebar has its own instance) */}
      <AddPatientModal
        onPatientAdded={() => fetchPatients()}
        open={registerModalOpen}
        onOpenChange={setRegisterModalOpen}
        showTrigger={false}
      />

      {/* Edit modal — triggered from the sidebar pencil icon or the patient detail card */}
      <AddPatientModal
        onPatientAdded={handlePatientUpdated}
        open={!!editingPatient}
        onOpenChange={(next) => { if (!next) setEditingPatient(null); }}
        showTrigger={false}
        patient={editingPatient}
      />

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
                  onChange={e => setResubmitForm(f => ({ ...f, start_time: e.target.value, total_time: calculateTotalMinutes(e.target.value, f.end_time) }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">End Time</label>
                <input
                  type="time"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
                  value={resubmitForm.end_time}
                  onChange={e => setResubmitForm(f => ({ ...f, end_time: e.target.value, total_time: calculateTotalMinutes(f.start_time, e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Time (minutes)</label>
                <input
                  type="number"
                  disabled
                  readOnly
                  title="Automatically calculated from Start Time and End Time"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-500 bg-slate-50 cursor-not-allowed"
                  value={resubmitForm.total_time}
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