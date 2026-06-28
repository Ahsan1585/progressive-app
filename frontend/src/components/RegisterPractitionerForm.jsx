import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const formatPhone = (val) => {
  const d = val.replace(/\D/g, '').slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0,3)}-${d.slice(3)}`;
  return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
};

const ROLE_LABELS = {
  ceo:            'CEO',
  staff_director: 'Staff Director',
  billing:        'Billing',
  practitioner:   'Practitioner',
};

const ROLE_BADGE_COLORS = {
  ceo:            'bg-blue-100 text-blue-700 border-blue-200',
  staff_director: 'bg-purple-100 text-purple-700 border-purple-200',
  billing:        'bg-green-100 text-green-700 border-green-200',
  practitioner:   'bg-slate-100 text-slate-600 border-slate-200',
};

export const RegisterPractitionerForm = () => {
  const currentUserRole = localStorage.getItem('role');

  // --- Staff Roster State ---
  const [staffList, setStaffList] = useState([]);
  const [loadingStaff, setLoadingStaff] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null); // member object to confirm

  // --- Registration Form State ---
  const [regForm, setRegForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    payRate: '',
    positionTitle: '',
    address: '',
    phoneNumber: '',
    ssn: '',
    role: 'practitioner'
  });
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    api.get('/api/auth/staff')
      .then(res => setStaffList(res.data.staff || []))
      .catch(() => {})
      .finally(() => setLoadingStaff(false));
  }, []);

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await api.delete(`/api/auth/staff/${confirmDelete.id}`);
      setStaffList(prev => prev.filter(s => s.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch {
      alert('Failed to delete user. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRoleChange = async (id, newRole) => {
    setUpdatingId(id);
    try {
      await api.patch(`/api/auth/staff/${id}/role`, { role: newRole });
      setStaffList(prev => prev.map(s => s.id === id ? { ...s, role: newRole } : s));
    } catch {
      alert('Failed to update role.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleRegisterPractitioner = async (e) => {
    e.preventDefault();
    setIsRegistering(true);

    try {
      const payload = {
        firstName: regForm.firstName.trim(),
        lastName: regForm.lastName.trim(),
        email: regForm.email.trim(),
        tempPassword: regForm.password,
        payRate: regForm.payRate,
        position_title: regForm.positionTitle,
        address: regForm.address.trim(),
        phone_number: regForm.phoneNumber.trim(),
        ssn: regForm.ssn.trim(),
        role: currentUserRole === 'ceo' ? regForm.role : 'practitioner'
      };

      const response = await api.post('/api/auth/register-practitioner', payload);

      if (response.data.success || response.status === 201) {
        alert('Account successfully created!');
        setRegForm({
          firstName: '', lastName: '', email: '', password: '',
          payRate: '', positionTitle: '', address: '', phoneNumber: '', ssn: '',
          role: 'practitioner'
        });
        // Refresh roster
        api.get('/api/auth/staff').then(res => setStaffList(res.data.staff || []));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create account.');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="space-y-8">

      {/* ── SECTION 1: STAFF ROSTER ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h2 className="text-base font-bold text-slate-800">Staff Roster</h2>
          <span className="ml-auto text-xs text-slate-400 font-medium">{staffList.length} member{staffList.length !== 1 ? 's' : ''}</span>
        </div>

        {loadingStaff ? (
          <div className="p-8 text-center text-sm text-slate-400">Loading staff...</div>
        ) : staffList.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No staff registered yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Name</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Email</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Position</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Role</th>
                  {currentUserRole === 'ceo' && (
                    <th className="px-4 py-3"></th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffList.map(member => (
                  <tr key={member.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {member.first_name?.[0]}{member.last_name?.[0]}
                          </span>
                        </div>
                        {member.first_name} {member.last_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{member.email}</td>
                    <td className="px-4 py-3 text-slate-500">{member.position_title || '—'}</td>
                    <td className="px-4 py-3">
                      {currentUserRole === 'ceo' ? (
                        <select
                          value={member.role}
                          onChange={(e) => handleRoleChange(member.id, e.target.value)}
                          disabled={updatingId === member.id}
                          className={`text-xs font-semibold border rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_BADGE_COLORS[member.role] || 'bg-slate-100 text-slate-600 border-slate-200'} ${updatingId === member.id ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <option value="practitioner">Practitioner</option>
                          <option value="staff_director">Staff Director</option>
                          <option value="billing">Billing</option>
                          <option value="ceo">CEO</option>
                        </select>
                      ) : (
                        <span className={`inline-block text-xs font-semibold border rounded-md px-2 py-1 ${ROLE_BADGE_COLORS[member.role] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                          {ROLE_LABELS[member.role] || member.role}
                        </span>
                      )}
                    </td>
                    {currentUserRole === 'ceo' && (
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setConfirmDelete(member)}
                          disabled={deletingId === member.id}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 cursor-pointer"
                          title="Delete user"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── SECTION 2: REGISTER NEW ACCOUNT ── */}
      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Register New Account
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
              onChange={(e) => setRegForm({...regForm, positionTitle: e.target.value})}
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
            </select>
          </div>

          {/* Role selector — CEO only */}
          {currentUserRole === 'ceo' && (
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Account Role</Label>
              <select
                value={regForm.role}
                onChange={(e) => setRegForm({...regForm, role: e.target.value})}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="practitioner">Practitioner</option>
                <option value="staff_director">Staff Director</option>
                <option value="billing">Billing</option>
                <option value="ceo">CEO</option>
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
              <Label className="text-sm font-semibold text-slate-700">SSN / EIN</Label>
              <Input
                type="password"
                value={regForm.ssn}
                onChange={(e) => setRegForm({...regForm, ssn: e.target.value})}
                placeholder="XXX-XX-XXXX"
                required={regForm.role === 'practitioner'}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Temporary Password</Label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={regForm.password}
                onChange={(e) => setRegForm({...regForm, password: e.target.value})}
              />
            </div>
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

          <div className="pt-4">
            <Button
              type="submit"
              disabled={isRegistering}
              className="w-full bg-blue-600 text-white hover:bg-blue-700 py-6"
            >
              {isRegistering ? 'Creating Account...' : 'Create Account'}
            </Button>
          </div>
        </form>
      </div>

      {/* ── DELETE CONFIRM DIALOG ── */}
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
                <h3 className="text-base font-bold text-slate-800">Delete User Account</h3>
                <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Are you sure you want to permanently delete{' '}
              <span className="font-semibold text-slate-800">{confirmDelete.first_name} {confirmDelete.last_name}</span>?
              Their account and all associated data will be removed.
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
                {deletingId === confirmDelete.id ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
