import React, { useState, useEffect } from 'react';
import { Search, MessageCircle, Mail, Loader2, Upload } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StaffChatPopover } from '@/components/StaffChatPopover';
import { ActionRequired } from '@/components/ActionRequired';
import { StaffDirectoryChildren } from '@/components/StaffDirectoryChildren';
import { showAlert } from '@/utils/dialogStore';
import { useDropdownOptions, activeOnly } from '@/hooks/useDropdownOptions';

const MESSAGE_THREADS_POLL_MS = 5000;

const formatPhone = (val) => {
  const d = val.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
};

const formatSSN = (val) => {
  const d = val.replace(/\D/g, '').slice(0, 9);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,5)}-${d.slice(5)}`;
};

// The 3 fine-grained office-staff role strings this used to enumerate
// (staff_director/billing/account_specialist) were collapsed by the roles
// migration into a single generic 'staff' tier — practitioners.role can now
// only ever be 'practitioner' | 'ceo' | 'staff'. Specific role names for
// 'staff'-tier accounts now live in the `roles` table (see the `roles`
// state below, fetched from GET /api/roles) rather than as fixed strings.
const ROLE_LABELS = {
  ceo:          'Admin',
  staff:        'Staff',
  practitioner: 'Practitioner',
};

const ROLE_BADGE_COLORS = {
  ceo:          'bg-blue-100 text-blue-700 border-blue-200',
  staff:        'bg-purple-100 text-purple-700 border-purple-200',
  practitioner: 'bg-slate-100 text-slate-600 border-slate-200',
};

export const RegisterPractitionerForm = () => {
  // What this screen offers is decided by the caller's live permission set
  // (same GET /api/auth/me AdminDashboard.jsx uses), not the localStorage role
  // string — since Phase 2 that string is only 'ceo' | 'staff' | 'practitioner'
  // and says nothing about what a 'staff' account is actually allowed to do.
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.get('/api/auth/me')
      .then(res => setMe(res.data))
      .catch(() => setMe({ isAdmin: false, permissions: [] }));
  }, []);
  const hasPermission = (key) => !!me && (me.isAdmin || (me.permissions || []).includes(key));
  const canManageRoles = hasPermission('staff_directory_edit_role');  // change role / deactivate / reactivate
  const canEditStaff = hasPermission('staff_directory_edit');
  const canApproveActions = hasPermission('action_required_approve');

  const { options: dropdownOptions } = useDropdownOptions();
  const SERVICE_TYPE_OPTIONS = activeOnly(dropdownOptions.service_type);

  // --- Staff Roster State ---
  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [reactivatingId, setReactivatingId] = useState(null);
  const [resendingId, setResendingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // member object to confirm
  const [viewingPhoto, setViewingPhoto] = useState(null); // { url, name } or null
  const [reviewingContact, setReviewingContact] = useState(null); // member object with a pending contact change
  const [reviewingAction, setReviewingAction] = useState(null); // 'accept' | 'reject' — which button is in flight
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'deactivated' | 'all'
  const [roleFilter, setRoleFilter] = useState('all'); // 'all' | one of ROLE_LABELS keys
  const [staffSearch, setStaffSearch] = useState('');

  // --- Roles (fetched from the API, replacing the old hardcoded 5-string
  // role list) — used both by the "Account Role" dropdown when registering
  // an office-staff account and by the CEO's per-row role reassignment. ---
  const [roles, setRoles] = useState([]);

  // --- Messaging (integrated into the roster row, not a separate tab) ---
  const [unreadByPractitioner, setUnreadByPractitioner] = useState({}); // { [practitionerId]: count }
  const [openChatMember, setOpenChatMember] = useState(null); // member object or null

  // --- Edit Profile State ---
  const [editingMember, setEditingMember] = useState(null); // member object being edited, or null
  const [editForm, setEditForm] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // --- Tab State: 'roster' | 'register' ---
  const [activeTab, setActiveTab] = useState('roster');

  // --- Registration Form State ---
  const [regForm, setRegForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    payRate: '',
    positionTitle: '',
    serviceTypes: [],
    address: '',
    phoneNumber: '',
    ssn: '',
    role: 'practitioner',
    roleId: ''
  });
  const [isRegistering, setIsRegistering] = useState(false);

  // --- Bulk Register (Excel upload) State ---
  // step: 'upload' -> 'mapping' -> 'results'. mappingInfo/mapping/disabledFields
  // mirror CompanySettings.jsx's compliance-doc "Match columns" screen so the
  // two Excel-upload features in this app behave identically.
  const [bulkStep, setBulkStep] = useState('upload');
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkFileDataUrl, setBulkFileDataUrl] = useState(''); // kept so Confirm can resend the same file without re-prompting
  const [bulkMappingInfo, setBulkMappingInfo] = useState(null); // { headers, targetFields, suggestedMapping, rowCount } | null
  const [bulkMapping, setBulkMapping] = useState({});
  const [bulkDisabledFields, setBulkDisabledFields] = useState(new Set());
  const [bulkIsUploading, setBulkIsUploading] = useState(false);
  const [bulkIsSubmitting, setBulkIsSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState('');
  const [bulkResults, setBulkResults] = useState(null); // { created, skipped } | null

  useEffect(() => {
    api.get('/api/auth/staff')
      .then(res => setStaffList(res.data.staff || []))
      .catch(() => {})
      .finally(() => setLoadingStaff(false));
  }, []);

  useEffect(() => {
    api.get('/api/roles')
      .then(res => setRoles(Array.isArray(res.data) ? res.data : []))
      .catch(() => {});
  }, []);

  const fetchMessageThreads = async () => {
    try {
      const res = await api.get('/api/messages/threads');
      const next = {};
      for (const t of res.data) next[t.practitioner_id] = t.unread_count;
      setUnreadByPractitioner(next);
    } catch {
      // Non-critical — the blinking indicator just won't update this tick.
    }
  };

  // Only poll while this tab is actually visible — leaving Staff Directory
  // open in a background tab all day shouldn't keep hitting the backend.
  // Refetches immediately on refocus so the indicator is caught up right away.
  useEffect(() => {
    let interval = null;

    const startPolling = () => {
      if (interval) return;
      fetchMessageThreads();
      interval = setInterval(fetchMessageThreads, MESSAGE_THREADS_POLL_MS);
    };
    const stopPolling = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') startPolling();
      else stopPolling();
    };

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleOpenChat = (member) => {
    setOpenChatMember((prev) => (prev?.id === member.id ? null : member));
    // Opening the thread marks the office's unread messages read server-side
    // (GET /api/messages/:id) — clear the blink immediately rather than
    // waiting for the next poll tick.
    setUnreadByPractitioner((prev) => ({ ...prev, [member.id]: 0 }));
  };

  const handleOpenEdit = (member) => {
    setEditingMember(member);
    setEditForm({
      firstName: member.first_name || '',
      lastName: member.last_name || '',
      email: member.email || '',
      positionTitle: member.position_title || '',
      serviceTypes: member.service_types || [],
      payRate: member.pay_rate != null ? String(member.pay_rate) : '',
      address: member.address || '',
      phoneNumber: member.phone_number || '',
      // Write-only — the staff list never returns the existing SSN/EIN
      // (security), so this always starts blank. Left blank on save, the
      // stored value is untouched; typing a new one replaces it.
      ssn: ''
    });
  };

  const toggleEditServiceType = (code) => {
    setEditForm(prev => ({
      ...prev,
      serviceTypes: prev.serviceTypes.includes(code)
        ? prev.serviceTypes.filter(c => c !== code)
        : [...prev.serviceTypes, code]
    }));
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingMember) return;

    if (editingMember.role === 'practitioner' && editForm.positionTitle !== 'Office Staff' && editForm.serviceTypes.length === 0) {
      showAlert('Select at least one service type.');
      return;
    }

    setIsSavingEdit(true);
    try {
      const payload = {
        firstName: editForm.firstName.trim(),
        lastName: editForm.lastName.trim(),
        email: editForm.email.trim(),
        position_title: editForm.positionTitle,
        service_types: editForm.serviceTypes,
        payRate: editForm.payRate,
        address: editForm.address.trim(),
        phone_number: editForm.phoneNumber.trim()
      };
      // Only send ssn if the admin actually typed a new one — an empty
      // field must leave the existing stored value untouched, not wipe it.
      if (editForm.ssn.trim()) payload.ssn = editForm.ssn.trim();
      const response = await api.patch(`/api/auth/staff/${editingMember.id}`, payload);
      const updated = response.data.staff;
      setStaffList(prev => prev.map(s => s.id === editingMember.id ? { ...s, ...updated } : s));
      setEditingMember(null);
      setEditForm(null);
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to update profile.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await api.delete(`/api/auth/staff/${confirmDelete.id}`);
      setStaffList(prev => prev.map(s => s.id === confirmDelete.id ? { ...s, is_active: false } : s));
      setConfirmDelete(null);
    } catch {
      showAlert('Failed to deactivate user. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleResendInvite = async (id) => {
    setResendingId(id);
    try {
      await api.post(`/api/auth/staff/${id}/resend-invite`);
      showAlert('A new activation link has been sent.');
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to resend the activation link.');
    } finally {
      setResendingId(null);
    }
  };

  const handleReactivate = async (id) => {
    setReactivatingId(id);
    try {
      await api.patch(`/api/auth/staff/${id}/reactivate`);
      setStaffList(prev => prev.map(s => s.id === id ? { ...s, is_active: true } : s));
    } catch {
      showAlert('Failed to reactivate user. Please try again.');
    } finally {
      setReactivatingId(null);
    }
  };

  const handleRoleChange = async (id, newRoleId) => {
    setUpdatingId(id);
    try {
      await api.patch(`/api/auth/staff/${id}/role`, { roleId: newRoleId });
      // The server derives the legacy 'ceo' | 'staff' tier from the
      // selected role's is_system flag — mirror that here for the
      // optimistic local update.
      const selectedRole = roles.find(r => r.id === newRoleId);
      const legacyRole = selectedRole?.is_system ? 'ceo' : 'staff';
      setStaffList(prev => prev.map(s => s.id === id ? { ...s, role: legacyRole, role_id: newRoleId, role_name: selectedRole?.name } : s));
    } catch {
      showAlert('Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleReviewContact = async (action) => {
    if (!reviewingContact) return;
    setReviewingAction(action);
    try {
      await api.post(`/api/auth/staff/${reviewingContact.id}/contact-request`, { action });
      setStaffList(prev => prev.map(s => s.id === reviewingContact.id
        ? {
            ...s,
            address: action === 'accept' ? reviewingContact.pending_address : s.address,
            phone_number: action === 'accept' ? reviewingContact.pending_phone_number : s.phone_number,
            pending_address: null,
            pending_phone_number: null,
            pending_submitted_at: null,
          }
        : s
      ));
      setReviewingContact(null);
    } catch {
      showAlert('Failed to process the contact change. Please try again.');
    } finally {
      setReviewingAction(null);
    }
  };

  const toggleServiceType = (code) => {
    setRegForm(prev => ({
      ...prev,
      serviceTypes: prev.serviceTypes.includes(code)
        ? prev.serviceTypes.filter(c => c !== code)
        : [...prev.serviceTypes, code]
    }));
  };

  const handleRegisterPractitioner = async (e) => {
    e.preventDefault();

    // Only someone who can manage staff roles sees the Account Role selector at
    // all — anyone else registering an account can only ever create a Practitioner
    // (which is exactly what the backend enforces in provisionPractitioner).
    const isPractitionerReg = canManageRoles ? regForm.role === 'practitioner' : true;
    if (isPractitionerReg && regForm.positionTitle !== 'Office Staff' && regForm.serviceTypes.length === 0) {
      showAlert('Select at least one service type.');
      return;
    }
    if (!isPractitionerReg && !regForm.roleId) {
      showAlert('Select an account role.');
      return;
    }

    setIsRegistering(true);

    try {
      const payload = {
        firstName: regForm.firstName.trim(),
        lastName: regForm.lastName.trim(),
        email: regForm.email.trim(),
        payRate: regForm.payRate,
        position_title: regForm.positionTitle,
        service_types: regForm.serviceTypes,
        address: regForm.address.trim(),
        phone_number: regForm.phoneNumber.trim(),
        ssn: regForm.ssn.trim(),
      };
      // Practitioner registrations are unchanged — still `role: 'practitioner'`.
      // Office-staff registrations now send the selected role's id instead
      // of a free-string role, matching provisionPractitioner's rewritten
      // contract (it looks `roleId` up against the `roles` table).
      if (isPractitionerReg) {
        payload.role = 'practitioner';
      } else {
        payload.roleId = regForm.roleId;
      }

      const response = await api.post('/api/auth/register-practitioner', payload);

      if (response.data.success || response.status === 201) {
        showAlert('Account successfully created!');
        setRegForm({
          firstName: '', lastName: '', email: '',
          payRate: '', positionTitle: '', serviceTypes: [], address: '', phoneNumber: '', ssn: '',
          role: 'practitioner', roleId: ''
        });
        // Refresh roster and switch to it so the new member is visible
        api.get('/api/auth/staff').then(res => setStaffList(res.data.staff || []));
        setActiveTab('roster');
      }
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to create account.');
    } finally {
      setIsRegistering(false);
    }
  };

  const handleCancelRegister = () => {
    setRegForm({
      firstName: '', lastName: '', email: '', password: '',
      payRate: '', positionTitle: '', serviceTypes: [], address: '', phoneNumber: '', ssn: '',
      role: 'practitioner', roleId: ''
    });
    setActiveTab('roster');
  };

  const resetBulkImport = () => {
    setBulkStep('upload');
    setBulkFileName('');
    setBulkFileDataUrl('');
    setBulkMappingInfo(null);
    setBulkMapping({});
    setBulkDisabledFields(new Set());
    setBulkError('');
    setBulkResults(null);
  };

  const handleBulkFileSelect = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setBulkError('Please select an Excel file (.xlsx or .xls).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setBulkError('File is too large — please use a file under 10MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setBulkIsUploading(true);
      setBulkError('');
      try {
        const { data } = await api.post('/api/auth/staff/bulk-import/preview', { fileBase64: dataUrl });
        setBulkFileName(file.name);
        setBulkFileDataUrl(dataUrl);
        setBulkMappingInfo(data);
        // Every target field is required for this import, so all start
        // enabled with whatever this file auto-detected (or blank, if the
        // admin needs to point it at a column manually).
        const initial = {};
        for (const field of data.targetFields) {
          initial[field.key] = data.suggestedMapping[field.key] || '';
        }
        setBulkMapping(initial);
        setBulkDisabledFields(new Set());
        setBulkStep('mapping');
      } catch (error) {
        setBulkError(error.response?.data?.error || 'Failed to read this file.');
      } finally {
        setBulkIsUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleBulkConfirm = async () => {
    setBulkIsSubmitting(true);
    setBulkError('');
    try {
      const effectiveMapping = { ...bulkMapping };
      for (const key of bulkDisabledFields) effectiveMapping[key] = '';
      const { data } = await api.post('/api/auth/staff/bulk-import/confirm', {
        fileBase64: bulkFileDataUrl,
        mapping: effectiveMapping,
      });
      setBulkResults(data);
      setBulkStep('results');
      setStaffList((prev) => {
        // Newly created rows only carry the fields the roster list needs to
        // render a Pending Activation row correctly — merge them in without
        // waiting on a full refetch.
        const existingIds = new Set(prev.map((s) => s.id));
        const additions = data.created.filter((c) => !existingIds.has(c.id)).map((c) => ({ ...c, role: 'practitioner', is_active: true, is_pending_activation: true }));
        return [...additions, ...prev];
      });
    } catch (error) {
      setBulkError(error.response?.data?.error || 'Failed to process this file.');
    } finally {
      setBulkIsSubmitting(false);
    }
  };

  const handleBulkDone = () => {
    resetBulkImport();
    setActiveTab('roster');
  };

  const visibleStaff = staffList.filter(s => {
    const matchesStatus = statusFilter === 'all' ? true : statusFilter === 'active' ? s.is_active !== false : s.is_active === false;
    const matchesRole = roleFilter === 'all' ? true : s.role === roleFilter;
    const term = staffSearch.trim().toLowerCase();
    const matchesSearch = !term || [s.first_name, s.last_name, s.email, s.position_title]
      .filter(Boolean)
      .some(field => field.toLowerCase().includes(term));
    return matchesStatus && matchesRole && matchesSearch;
  });

  return (
    <div className="space-y-6">

      {/* ── TAB SWITCHER ── */}
      <div className="inline-flex items-center gap-1 p-1 bg-slate-200 rounded-xl shadow-inner">
        <button
          onClick={() => setActiveTab('roster')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'roster'
              ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-3px_rgba(15,23,42,0.25)] ring-1 ring-blue-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <svg className={`w-4 h-4 ${activeTab === 'roster' ? 'text-blue-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Staff Roster
        </button>
        <button
          onClick={() => setActiveTab('register')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'register'
              ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-3px_rgba(15,23,42,0.25)] ring-1 ring-emerald-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <svg className={`w-4 h-4 ${activeTab === 'register' ? 'text-emerald-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Register New User
        </button>
        <button
          onClick={() => { resetBulkImport(); setActiveTab('bulkRegister'); }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'bulkRegister'
              ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-3px_rgba(15,23,42,0.25)] ring-1 ring-violet-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <Upload className={`w-4 h-4 ${activeTab === 'bulkRegister' ? 'text-violet-600' : ''}`} />
          Bulk Register
        </button>
        <button
          onClick={() => setActiveTab('children')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
            activeTab === 'children'
              ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-3px_rgba(15,23,42,0.25)] ring-1 ring-blue-500/20'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
          }`}
        >
          <svg className={`w-4 h-4 ${activeTab === 'children' ? 'text-blue-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          All Children
        </button>
        {canApproveActions && (
          <button
            onClick={() => setActiveTab('actionRequired')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
              activeTab === 'actionRequired'
                ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_4px_10px_-3px_rgba(15,23,42,0.25)] ring-1 ring-orange-500/20'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            <svg className={`w-4 h-4 ${activeTab === 'actionRequired' ? 'text-orange-600' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Action Required
          </button>
        )}
      </div>

      {/* ── SECTION 1: STAFF ROSTER ── */}
      {activeTab === 'roster' && (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h2 className="text-base font-bold text-slate-800">Staff Roster</h2>

            <div className="ml-auto flex items-center gap-1 bg-slate-200 rounded-lg p-1 shadow-inner">
              {[
                { key: 'active', label: 'Active', dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-500/25' },
                { key: 'deactivated', label: 'Deactivated', dot: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-500/25' },
                { key: 'all', label: 'All', dot: 'bg-blue-500', text: 'text-blue-700', ring: 'ring-blue-500/25' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    statusFilter === opt.key
                      ? `bg-white ${opt.text} shadow-[0_1px_2px_rgba(15,23,42,0.06),0_3px_8px_-2px_rgba(15,23,42,0.25)] ring-1 ${opt.ring}`
                      : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${statusFilter === opt.key ? opt.dot : 'bg-slate-400'}`} />
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-400 font-medium">{visibleStaff.length} member{visibleStaff.length !== 1 ? 's' : ''}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="text"
                placeholder="Search by name, email, or position..."
                className="pl-9"
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loadingStaff ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading staff...</div>
        ) : visibleStaff.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            {staffSearch.trim() || roleFilter !== 'all'
              ? 'No staff match your search or filters.'
              : statusFilter === 'deactivated' ? 'No deactivated accounts.' : statusFilter === 'active' ? 'No active staff.' : 'No staff registered yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Email</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Position</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Role</th>
                  {/* Actions column — anyone who can reach this screen is office
                      staff (it needs staff_directory_view), so the column always
                      renders; each button inside is permission-gated on its own. */}
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleStaff.map(member => {
                  const isDeactivated = member.is_active === false;
                  return (
                  <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                    <td className={`px-6 py-3 font-medium text-slate-800 ${isDeactivated ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-2">
                        {member.profile_picture ? (
                          <button
                            type="button"
                            onClick={() => setViewingPhoto({ url: member.profile_picture, name: `${member.first_name} ${member.last_name}` })}
                            className="w-7 h-7 rounded-full flex-shrink-0 cursor-pointer ring-offset-1 hover:ring-2 hover:ring-blue-400 transition-all"
                            title="View photo"
                          >
                            <img
                              src={member.profile_picture}
                              alt=""
                              className="w-7 h-7 rounded-full object-cover"
                            />
                          </button>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-bold">
                              {member.first_name?.[0]}{member.last_name?.[0]}
                            </span>
                          </div>
                        )}
                        {member.first_name} {member.last_name}
                        {isDeactivated && (
                          <span className="inline-block text-[10px] font-semibold border rounded-md px-1.5 py-0.5 bg-slate-100 text-slate-500 border-slate-200 uppercase tracking-wide">
                            Deactivated
                          </span>
                        )}
                        {(member.pending_address || member.pending_phone_number) && (
                          <button
                            type="button"
                            onClick={() => setReviewingContact(member)}
                            className="inline-flex items-center gap-1 text-[10px] font-semibold border rounded-md px-1.5 py-0.5 bg-amber-50 text-amber-700 border-amber-200 uppercase tracking-wide cursor-pointer hover:bg-amber-100 transition-colors"
                            title="Review contact info change"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                            Pending Update
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`px-4 py-3 text-slate-500 ${isDeactivated ? 'opacity-60' : ''}`}>{member.email}</td>
                    <td className={`px-4 py-3 text-slate-500 ${isDeactivated ? 'opacity-60' : ''}`}>{member.position_title || '—'}</td>
                    <td className={`px-4 py-3 ${isDeactivated ? 'opacity-60' : ''}`}>
                      {canManageRoles && member.role !== 'practitioner' ? (
                        <select
                          value={member.role_id || ''}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                          disabled={updatingId === member.id}
                          className={`text-xs font-semibold border rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_BADGE_COLORS[member.role] || 'bg-slate-100 text-slate-600 border-slate-200'} ${updatingId === member.id ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <option value="" disabled>Select a role...</option>
                          {roles.map(r => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`inline-block text-xs font-semibold border rounded-md px-2 py-1 ${ROLE_BADGE_COLORS[member.role] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {member.role_name || ROLE_LABELS[member.role] || member.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {member.role === 'practitioner' && (
                            <button
                              onClick={() => handleOpenChat(member)}
                              className={`relative p-1.5 rounded-lg transition-colors cursor-pointer ${
                                openChatMember?.id === member.id
                                  ? 'text-blue-600 bg-blue-50'
                                  : 'text-slate-700 hover:text-blue-600 hover:bg-blue-50'
                              }`}
                              title="Message practitioner"
                            >
                              <MessageCircle className="w-4 h-4" />
                              {unreadByPractitioner[member.id] > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                                </span>
                              )}
                            </button>
                          )}
                          {member.is_pending_activation && (canManageRoles || hasPermission('register_new_user')) && (
                            <button
                              onClick={() => handleResendInvite(member.id)}
                              disabled={resendingId === member.id}
                              className="p-1.5 rounded-lg text-slate-700 hover:text-amber-600 hover:bg-amber-50 transition-colors disabled:opacity-40 cursor-pointer"
                              title="Resend activation link"
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                          )}
                          {/* Mirrors updateStaffProfile's backend rule: editing
                              needs staff_directory_edit, and without
                              staff_directory_edit_role only Practitioner
                              accounts may be edited. */}
                          {canEditStaff && (canManageRoles || member.role === 'practitioner') && (
                            <button
                              onClick={() => handleOpenEdit(member)}
                              className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                              title="Edit profile"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                          )}
                          {canManageRoles && (
                            isDeactivated ? (
                              <button
                                onClick={() => handleReactivate(member.id)}
                                disabled={reactivatingId === member.id}
                                className="p-1.5 rounded-lg text-slate-700 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-40 cursor-pointer"
                                title="Reactivate user"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12a7.5 7.5 0 0113-5.1M19.5 12a7.5 7.5 0 01-13 5.1M4.5 5v3h3M19.5 19v-3h-3" />
                                </svg>
                              </button>
                            ) : (
                              <button
                                onClick={() => setConfirmDelete(member)}
                                disabled={deletingId === member.id}
                                className="p-1.5 rounded-lg text-slate-700 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 cursor-pointer"
                                title="Deactivate user"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.6 5.6l12.8 12.8" />
                                </svg>
                              </button>
                            )
                          )}
                        </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* ── SECTION 2: REGISTER NEW ACCOUNT ── */}
      {activeTab === 'register' && (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Register New User
        </h2>

        <form onSubmit={handleRegisterPractitioner} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">First Name</Label>
              <Input
                type="text"
                required
                placeholder="e.g. Jane"
                value={regForm.firstName}
                onChange={(e) => setRegForm({...regForm, firstName: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Last Name</Label>
              <Input
                type="text"
                required
                placeholder="e.g. Doe"
                value={regForm.lastName}
                onChange={(e) => setRegForm({...regForm, lastName: e.target.value})}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Email Address</Label>
            <Input
              type="email"
              required
              placeholder="user@agency.com"
              value={regForm.email}
              onChange={(e) => setRegForm({...regForm, email: e.target.value})}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Discipline / Position Title</Label>
            <select
              value={regForm.positionTitle}
              onChange={(e) => {
                const nextPositionTitle = e.target.value;
                // Selecting Office Staff hides the "Practitioner" option
                // from the Account Role selector below. If that selector's
                // value was still the default 'practitioner', the <select>
                // would end up showing no matching <option> — the browser
                // silently falls back to visually highlighting whichever
                // option renders first (Admin, since it sorts first), while
                // regForm.role/roleId never actually update. That let an
                // admin appear to select "Admin" and unknowingly submit a
                // Practitioner registration instead. Force an explicit
                // re-selection instead of leaving a stale, now-invalid value.
                if (canManageRoles && nextPositionTitle === 'Office Staff' && regForm.role === 'practitioner') {
                  setRegForm({...regForm, positionTitle: nextPositionTitle, role: 'staff', roleId: ''});
                } else {
                  setRegForm({...regForm, positionTitle: nextPositionTitle});
                }
              }}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              required={regForm.role === 'practitioner'}
            >
              <option value="" disabled>Select a discipline...</option>
              <option value="Developmental Interventionist">Developmental Interventionist</option>
              <option value="Speech Language Pathologist">Speech Language Pathologist</option>
              <option value="Occupational Therapist">Occupational Therapist</option>
              <option value="Physical Therapist">Physical Therapist</option>
              <option value="Social Worker">Social Worker</option>
              <option value="Special Educator">Special Educator</option>
              <option value="Family Therapist">Family Therapist</option>
              <option value="Foreign Language Interpreter">Foreign Language Interpreter</option>
              <option value="Office Staff">Office Staff</option>
            </select>
          </div>

          {regForm.positionTitle !== 'Office Staff' && (
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">
              Service Types {(canManageRoles ? regForm.role : 'practitioner') === 'practitioner' && '*'}
            </Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border border-slate-200 rounded-md bg-slate-50">
              {SERVICE_TYPE_OPTIONS.map(opt => (
                <label key={opt.code} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={regForm.serviceTypes.includes(opt.code)}
                    onChange={() => toggleServiceType(opt.code)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          )}

          {/* Role selector — shown to anyone holding staff_directory_edit_role
              (Admin included). Options are fetched from GET /api/roles
              (Admin + any office-staff roles the CEO has defined) instead of a
              hardcoded 5-string list. Selecting a fetched role submits its id
              as `roleId`; selecting Practitioner still submits `role: 'practitioner'`
              unchanged, since that path doesn't go through the roles table. */}
          {canManageRoles && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Account Role</Label>
              <select
                value={regForm.role === 'practitioner' ? 'practitioner' : regForm.roleId}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'practitioner') {
                    setRegForm({...regForm, role: 'practitioner', roleId: ''});
                  } else {
                    setRegForm({...regForm, role: 'staff', roleId: val});
                  }
                }}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                {/* An empty-value option is always present so the <select>'s
                    value can never end up matching zero options — that
                    mismatch is what let the browser silently auto-highlight
                    an option (Admin, since it sorts first) without regForm
                    actually changing. */}
                <option value="" disabled>{roles.length === 0 ? 'Loading roles...' : 'Select a role...'}</option>
                {regForm.positionTitle !== 'Office Staff' && <option value="practitioner">Practitioner</option>}
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-semibold text-slate-700">Full Address</Label>
            <Input
              type="text"
              value={regForm.address}
              onChange={(e) => setRegForm({...regForm, address: e.target.value})}
              placeholder="123 Main St, Apt 4B, City, NJ 08000"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Phone Number</Label>
              <Input
                type="tel"
                value={regForm.phoneNumber}
                onChange={(e) => setRegForm({...regForm, phoneNumber: formatPhone(e.target.value)})}
                placeholder="(555) 123-4567"
                required
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">SSN / EIN (optional)</Label>
              <PasswordInput
                inputMode="numeric"
                value={regForm.ssn}
                onChange={(e) => setRegForm({...regForm, ssn: formatSSN(e.target.value)})}
                placeholder="XXX-XX-XXXX"
                maxLength={11}
              />
            </div>
          </div>

          {regForm.positionTitle !== 'Office Staff' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Hourly Pay Rate ($)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                required={regForm.role === 'practitioner'}
                placeholder="e.g. 75.00"
                value={regForm.payRate}
                onChange={(e) => setRegForm({...regForm, payRate: e.target.value})}
              />
            </div>
          </div>
          )}

          <div className="pt-4 flex gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={isRegistering}
              onClick={handleCancelRegister}
              className="flex-1 py-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isRegistering}
              className="flex-1 bg-blue-600 text-white hover:bg-blue-700 py-6"
            >
              {isRegistering ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        </form>
      </div>
      )}

      {/* ── SECTION 2b: BULK REGISTER (Excel upload) ── */}
      {activeTab === 'bulkRegister' && (
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Upload className="w-5 h-5 text-slate-400" />
          Bulk Register Practitioners
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          Upload an Excel roster to invite several practitioners at once. Each row gets a normal invite-link email — same as registering one at a time.
        </p>

        {bulkError && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-medium">{bulkError}</div>
        )}

        {bulkStep === 'upload' && (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl px-4 py-12 cursor-pointer hover:border-violet-300 hover:bg-violet-50/40 transition-colors">
            {bulkIsUploading ? <Loader2 className="w-8 h-8 text-violet-400 animate-spin" /> : <Upload className="w-8 h-8 text-slate-300" />}
            <span className="text-sm font-semibold text-violet-700">{bulkIsUploading ? 'Reading file...' : 'Click to attach an Excel roster'}</span>
            <span className="text-xs text-slate-400">.xlsx or .xls, up to 10MB — needs First Name, Last Name, Email, Pay Rate, Position Title, and Service Type(s) columns</span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleBulkFileSelect} disabled={bulkIsUploading} />
          </label>
        )}

        {bulkStep === 'mapping' && bulkMappingInfo && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-800">Match columns</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {bulkFileName} &middot; {bulkMappingInfo.rowCount} row{bulkMappingInfo.rowCount === 1 ? '' : 's'} found. Confirm which column in the file feeds each field below.
                </p>
              </div>
              <button type="button" onClick={resetBulkImport} className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
                Choose a different file
              </button>
            </div>

            <div className="space-y-2.5">
              {bulkMappingInfo.targetFields.map((field) => {
                const suggested = bulkMappingInfo.suggestedMapping[field.key];
                const current = bulkMapping[field.key] || '';
                const isDisabled = bulkDisabledFields.has(field.key);
                const enabled = !isDisabled;
                const requiredMissing = field.required && !current;
                const status = isDisabled
                  ? { text: 'Off — not matched', className: 'text-slate-500 bg-slate-50 border-slate-200' }
                  : requiredMissing
                  ? { text: 'Required — pick a column', className: 'text-red-600 bg-red-50 border-red-200' }
                  : current === suggested
                  ? { text: 'Auto-detected', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
                  : { text: 'Matched', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' };

                return (
                  <div key={field.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${requiredMissing ? 'border-red-200 bg-red-50/40' : isDisabled ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200 bg-white'}`}>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${field.label}`}
                      disabled={field.required}
                      onClick={() => setBulkDisabledFields((prev) => {
                        const next = new Set(prev);
                        next.has(field.key) ? next.delete(field.key) : next.add(field.key);
                        return next;
                      })}
                      title={field.required ? `${field.label} is required and can't be turned off` : enabled ? 'Turn this field off' : 'Turn this field on'}
                      className={`flex-shrink-0 relative w-9 h-5 rounded-full transition-colors ${field.required ? 'bg-emerald-300 cursor-not-allowed' : enabled ? 'bg-emerald-500 cursor-pointer' : 'bg-slate-300 cursor-pointer'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                    </button>
                    <div className="w-44 flex-shrink-0">
                      <p className={`text-sm font-semibold ${isDisabled ? 'text-slate-400' : 'text-slate-800'}`}>{field.label}{field.required && <span className="text-red-500"> *</span>}</p>
                      <span className={`inline-block mt-0.5 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${status.className}`}>{status.text}</span>
                    </div>
                    <select
                      className={`flex-1 h-9 rounded-md border border-slate-300 px-2.5 text-sm ${isDisabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-white'}`}
                      value={current}
                      disabled={isDisabled}
                      onChange={(e) => setBulkMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    >
                      <option value="" disabled={field.required}>{field.required ? '— Select a column —' : '— No column —'}</option>
                      {bulkMappingInfo.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={resetBulkImport} className="flex-1 py-6">
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleBulkConfirm}
                disabled={bulkIsSubmitting || bulkMappingInfo.targetFields.some((f) => f.required && !bulkMapping[f.key])}
                className="flex-1 bg-violet-600 text-white hover:bg-violet-700 py-6"
              >
                {bulkIsSubmitting ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin inline" /> Registering...</> : `Register ${bulkMappingInfo.rowCount} Practitioner${bulkMappingInfo.rowCount === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}

        {bulkStep === 'results' && bulkResults && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200">
                <div className="text-2xl font-bold text-emerald-700">{bulkResults.created.length}</div>
                <div className="text-xs font-semibold text-emerald-700">Registered &amp; invited</div>
              </div>
              {bulkResults.skipped.length > 0 && (
                <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="text-2xl font-bold text-amber-700">{bulkResults.skipped.length}</div>
                  <div className="text-xs font-semibold text-amber-700">Skipped</div>
                </div>
              )}
            </div>

            {bulkResults.skipped.length > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">Skipped rows</div>
                <div className="divide-y divide-slate-100">
                  {bulkResults.skipped.map((s, i) => (
                    <div key={i} className="px-4 py-2.5 text-sm">
                      <span className="font-semibold text-slate-700">{s.row}</span>
                      <span className="text-slate-500"> — {s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="button" onClick={handleBulkDone} className="w-full bg-violet-600 text-white hover:bg-violet-700 py-6">
              Done — back to Staff Roster
            </Button>
          </div>
        )}
      </div>
      )}

      {/* ── SECTION 3: ALL CHILDREN ── */}
      {activeTab === 'children' && (
        <StaffDirectoryChildren />
      )}

      {/* ── SECTION 4: ACTION REQUIRED (ceo-only) ── */}
      {activeTab === 'actionRequired' && canApproveActions && (
        <ActionRequired />
      )}

      {/* ── DEACTIVATE CONFIRM DIALOG ── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-sm mx-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Deactivate User Account</h3>
                <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to deactivate{' '}
              <span className="font-semibold text-slate-800">{confirmDelete.first_name} {confirmDelete.last_name}</span>?
              They will no longer be able to log in. All of their historical logs, billing records, and invoices will remain fully intact.
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirmed}
                disabled={deletingId === confirmDelete.id}
                className="flex-1 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60"
              >
                {deletingId === confirmDelete.id ? 'Deactivating...' : 'Yes, Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── PHOTO LIGHTBOX ── */}
      <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>{viewingPhoto?.name}</DialogTitle>
          </DialogHeader>
          {viewingPhoto && (
            <img
              src={viewingPhoto.url}
              alt={viewingPhoto.name}
              className="w-full aspect-square rounded-xl object-cover border border-slate-200"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── PENDING CONTACT INFO CHANGE REVIEW ── */}
      <Dialog open={!!reviewingContact} onOpenChange={(open) => !open && setReviewingContact(null)}>
        <DialogContent className="sm:max-w-md bg-white">
          <DialogHeader>
            <DialogTitle>Contact Info Change — {reviewingContact?.first_name} {reviewingContact?.last_name}</DialogTitle>
          </DialogHeader>
          {reviewingContact && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Submitted by the practitioner{reviewingContact.pending_submitted_at ? ` on ${new Date(reviewingContact.pending_submitted_at).toLocaleDateString()}` : ''}. Review and accept to apply it to their record, or reject to discard.
              </p>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Current</p>
                  <p className="text-slate-700">{reviewingContact.phone_number || '—'}</p>
                  <p className="text-slate-700">{reviewingContact.address || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">Requested</p>
                  <p className="text-slate-900 font-medium">{reviewingContact.pending_phone_number || '—'}</p>
                  <p className="text-slate-900 font-medium">{reviewingContact.pending_address || '—'}</p>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
                  disabled={!!reviewingAction}
                  onClick={() => handleReviewContact('reject')}
                >
                  {reviewingAction === 'reject' ? 'Rejecting…' : 'Reject'}
                </Button>
                <Button
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!!reviewingAction}
                  onClick={() => handleReviewContact('accept')}
                >
                  {reviewingAction === 'accept' ? 'Accepting…' : 'Accept'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── EDIT PROFILE DIALOG ── */}
      {editingMember && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSaveEdit} className="p-6 space-y-4">
              <h3 className="text-base font-bold text-slate-800">
                Edit Profile — {editingMember.first_name} {editingMember.last_name}
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">First Name</Label>
                  <Input
                    type="text"
                    required
                    value={editForm.firstName}
                    onChange={(e) => setEditForm({...editForm, firstName: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Last Name</Label>
                  <Input
                    type="text"
                    required
                    value={editForm.lastName}
                    onChange={(e) => setEditForm({...editForm, lastName: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Email Address</Label>
                <Input
                  type="email"
                  required
                  value={editForm.email}
                  onChange={(e) => setEditForm({...editForm, email: e.target.value})}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Discipline / Position Title</Label>
                <select
                  value={editForm.positionTitle}
                  onChange={(e) => setEditForm({...editForm, positionTitle: e.target.value})}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required={editingMember.role === 'practitioner'}
                >
                  <option value="" disabled>Select a discipline...</option>
                  <option value="Developmental Interventionist">Developmental Interventionist</option>
                  <option value="Speech Language Pathologist">Speech Language Pathologist</option>
                  <option value="Occupational Therapist">Occupational Therapist</option>
                  <option value="Physical Therapist">Physical Therapist</option>
                  <option value="Social Worker">Social Worker</option>
                  <option value="Special Educator">Special Educator</option>
                  <option value="Family Therapist">Family Therapist</option>
                  <option value="Office Staff">Office Staff</option>
                </select>
              </div>

              {editForm.positionTitle !== 'Office Staff' && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">
                  Service Types {editingMember.role === 'practitioner' && '*'}
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 border border-slate-200 rounded-md bg-slate-50">
                  {SERVICE_TYPE_OPTIONS.map(opt => (
                    <label key={opt.code} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.serviceTypes.includes(opt.code)}
                        onChange={() => toggleEditServiceType(opt.code)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              )}

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Full Address</Label>
                <Input
                  type="text"
                  value={editForm.address}
                  onChange={(e) => setEditForm({...editForm, address: e.target.value})}
                  placeholder="123 Main St, Apt 4B, City, NJ 08000"
                />
              </div>

              <div className={`grid gap-4 ${editForm.positionTitle === 'Office Staff' ? 'grid-cols-1' : 'grid-cols-2'}`}>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Phone Number</Label>
                  <Input
                    type="tel"
                    value={editForm.phoneNumber}
                    onChange={(e) => setEditForm({...editForm, phoneNumber: formatPhone(e.target.value)})}
                    placeholder="(555) 123-4567"
                  />
                </div>
                {editForm.positionTitle !== 'Office Staff' && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Hourly Pay Rate ($)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    required={editingMember.role === 'practitioner'}
                    placeholder="e.g. 75.00"
                    value={editForm.payRate}
                    onChange={(e) => setEditForm({...editForm, payRate: e.target.value})}
                  />
                </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">SSN / EIN (optional)</Label>
                <PasswordInput
                  inputMode="numeric"
                  value={editForm.ssn}
                  onChange={(e) => setEditForm({...editForm, ssn: formatSSN(e.target.value)})}
                  placeholder="Leave blank to keep the current value"
                  maxLength={11}
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditingMember(null); setEditForm(null); }}
                  className="flex-1 px-4 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <Button
                  type="submit"
                  disabled={isSavingEdit}
                  className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {openChatMember && (
        <StaffChatPopover practitioner={openChatMember} onClose={() => setOpenChatMember(null)} />
      )}

    </div>
  );
};
