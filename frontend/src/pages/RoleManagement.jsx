import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, Plus, ShieldCheck } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { showAlert, showConfirm } from '@/utils/dialogStore';

// The fixed 13-key permission catalog (backend/src/constants/permissions.js),
// grouped and labeled for display. Keep this in sync with that file — it's
// the source of truth for which keys exist.
const PERMISSION_GROUPS = [
  {
    label: 'Staff Directory',
    keys: ['staff_directory_view', 'staff_directory_edit', 'staff_directory_edit_role', 'register_new_user'],
  },
  {
    label: 'Billing & Invoices',
    keys: ['billing_pending', 'billing_completed', 'billing_invoice_status'],
  },
  {
    label: 'Reports & Compliance',
    keys: ['master_reports', 'action_required_approve', 'audit_logs'],
  },
  {
    label: 'Company Information',
    keys: ['company_info_compliance_doc', 'company_info_dropdown_options'],
  },
  {
    label: 'Subscription',
    keys: ['subscription_billing'],
  },
];

const PERMISSION_LABELS = {
  staff_directory_view: 'View staff directory',
  staff_directory_edit: 'Edit staff profiles',
  staff_directory_edit_role: 'Manage roles & staff access',
  register_new_user: 'Register new users',
  billing_pending: 'Pending bills',
  billing_completed: 'Completed bills',
  billing_invoice_status: 'Invoice status',
  master_reports: 'Master reports',
  action_required_approve: 'Approve flagged logs',
  audit_logs: 'Audit log',
  company_info_compliance_doc: 'Compliance reference document',
  company_info_dropdown_options: 'Dropdown options',
  subscription_billing: 'Subscription & billing',
};

// Inline "add role" card — mirrors the add-row pattern used by
// DropdownOptionsManager (inline Input + Save/Cancel, no native prompt()).
// A brand-new role always starts with just staff_directory_view checked,
// matching the backend's own minimal-default philosophy.
const NewRoleCard = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('A role name is required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.post('/api/roles', { name: name.trim(), permissions: ['staff_directory_view'] });
      onCreated(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create role.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-teal-50/40 border border-dashed border-teal-200 rounded-2xl p-5">
      <label className="block text-sm font-bold text-slate-700 mb-1.5" htmlFor="new-role-name">New role name</label>
      <div className="flex items-center gap-2">
        <Input
          id="new-role-name"
          placeholder="e.g. Front Desk Coordinator"
          value={name}
          disabled={isSaving}
          onChange={(e) => setName(e.target.value)}
          className="h-9 max-w-xs"
        />
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <p className="text-xs text-slate-500 mt-2">Starts with just "View staff directory" checked — grant more permissions below once it's created.</p>
    </div>
  );
};

const RoleCard = ({ role, savingId, onToggle, onDelete }) => {
  const isSaving = savingId === role.id;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-slate-800">{role.name}</span>
          {role.is_system && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-teal-700 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
              <ShieldCheck className="w-3 h-3" /> Fixed — full access
            </span>
          )}
        </div>
        {!role.is_system && (
          <button
            type="button"
            onClick={() => onDelete(role)}
            aria-label={`Delete ${role.name}`}
            title="Delete role"
            disabled={isSaving}
            className="w-9 h-9 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {role.is_system ? (
        <p className="text-sm text-slate-500">
          The Admin role always has access to every feature and cannot be edited or deleted.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">{group.label}</div>
              <div className="space-y-1">
                {group.keys.map((key) => {
                  const inputId = `role-${role.id}-${key}`;
                  return (
                    <label key={key} htmlFor={inputId} className="flex items-center gap-2 text-sm text-slate-700 py-1 cursor-pointer">
                      <input
                        id={inputId}
                        type="checkbox"
                        checked={role.permissions.includes(key)}
                        disabled={isSaving}
                        onChange={() => onToggle(role, key)}
                        className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 cursor-pointer disabled:cursor-wait"
                      />
                      {PERMISSION_LABELS[key]}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Roles & Permissions tab (Phase 2) — lets an admin (or anyone holding
// staff_directory_edit_role) create custom roles, toggle their permissions,
// and delete unused ones. The fixed Admin role is always rendered read-only:
// no checkboxes and no delete button, so the UI never even attempts a
// PATCH/DELETE against it (the backend rejects those anyway).
const RoleManagement = () => {
  const [roles, setRoles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [isAddingRole, setIsAddingRole] = useState(false);

  const loadRoles = useCallback(async () => {
    try {
      const { data } = await api.get('/api/roles');
      setRoles(data);
    } catch {
      showAlert('Failed to load roles.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadRoles(); }, [loadRoles]);

  const togglePermission = async (role, key) => {
    if (role.is_system) return;
    setSavingId(role.id);
    const nextPermissions = role.permissions.includes(key)
      ? role.permissions.filter((k) => k !== key)
      : [...role.permissions, key];
    try {
      await api.patch(`/api/roles/${role.id}`, { permissions: nextPermissions });
      await loadRoles();
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to update role.');
    } finally {
      setSavingId(null);
    }
  };

  const deleteRole = async (role) => {
    if (role.is_system) return;
    const confirmed = await showConfirm(
      `Delete the "${role.name}" role? Any staff currently holding it will need to be reassigned first.`,
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!confirmed) return;
    setSavingId(role.id);
    try {
      await api.delete(`/api/roles/${role.id}`);
      await loadRoles();
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to delete role — it may still be assigned to staff.');
    } finally {
      setSavingId(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs font-bold tracking-wide uppercase text-teal-600 mb-1.5">Admin Settings</p>
          <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Roles &amp; Permissions</h1>
          <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
            Control what each role can see and do across the app. Changes take effect immediately for anyone holding that role — they don't need to log back in.
          </p>
        </div>
        {!isAddingRole && (
          <Button onClick={() => setIsAddingRole(true)} className="shrink-0">
            <Plus className="w-4 h-4" /> New Role
          </Button>
        )}
      </div>

      {isAddingRole && (
        <NewRoleCard
          onCreated={() => { setIsAddingRole(false); loadRoles(); }}
          onCancel={() => setIsAddingRole(false)}
        />
      )}

      <div className="space-y-5">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} savingId={savingId} onToggle={togglePermission} onDelete={deleteRole} />
        ))}
        {roles.length === 0 && (
          <div className="text-center py-8 text-sm text-slate-500">No roles found.</div>
        )}
      </div>
    </div>
  );
};

export default RoleManagement;
