import { useState } from 'react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { showAlert, showConfirm } from '@/utils/dialogStore';
import { useDropdownOptions } from '@/hooks/useDropdownOptions';

const SECTIONS = [
  { category: 'service_type', title: 'Service Type', hint: 'Shown in the Service Type dropdown when a practitioner logs a session.' },
  { category: 'service_status', title: 'Service Status', hint: 'Shown in the Service Status dropdown when a practitioner logs a session.' },
  { category: 'location', title: 'Location', hint: 'Shown in the Service Location dropdown when a practitioner logs a session.' },
  { category: 'group_size', title: 'Group Size Category', hint: 'Shown in the Group Size Category dropdown when a practitioner logs a session.' },
];

const TrashIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
);

const OptionRow = ({ option, onSaved, onDeleted }) => {
  const [code, setCode] = useState(option.code);
  const [label, setLabel] = useState(option.label);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const commit = async () => {
    if (code === option.code && label === option.label) return;
    setIsSaving(true);
    try {
      const response = await api.put(`/api/dropdown-options/${option.id}`, { code, label });
      onSaved(response.data.option);
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to save option.');
      setCode(option.code);
      setLabel(option.label);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!(await showConfirm(`Remove "${option.label}"? It will no longer appear in the dropdown for new logs, but existing logs that used it will keep showing this name.`))) {
      return;
    }
    setIsDeleting(true);
    try {
      const response = await api.delete(`/api/dropdown-options/${option.id}`);
      onDeleted(response.data.option);
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to remove option.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleReactivate = async () => {
    setIsSaving(true);
    try {
      const response = await api.put(`/api/dropdown-options/${option.id}/reactivate`);
      onSaved(response.data.option);
    } catch (error) {
      showAlert(error.response?.data?.error || 'Failed to reactivate option.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <tr className={`border-t border-slate-200 ${option.is_active ? 'bg-white' : 'bg-slate-50 opacity-60'}`}>
      <td className="px-3 py-2">
        <Input value={code} disabled={!option.is_active || isSaving} onChange={(e) => setCode(e.target.value)} onBlur={commit} className="h-9 w-24" />
      </td>
      <td className="px-3 py-2">
        <Input value={label} disabled={!option.is_active || isSaving} onChange={(e) => setLabel(e.target.value)} onBlur={commit} className="h-9 min-w-[14rem]" />
      </td>
      <td className="px-3 py-2 text-center">
        {option.is_active ? (
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            title="Remove this option"
            aria-label={`Remove ${option.label}`}
            className="w-9 h-9 rounded-md border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center justify-center cursor-pointer transition-colors mx-auto"
          >
            <TrashIcon />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleReactivate}
            disabled={isSaving}
            className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer"
          >
            Reactivate
          </button>
        )}
      </td>
    </tr>
  );
};

const NewOptionRow = ({ category, onCreated, onCancel }) => {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!code.trim() || !label.trim()) {
      setError('Both a code and a name are required.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const response = await api.post('/api/dropdown-options', { category, code: code.trim(), label: label.trim() });
      onCreated(response.data.option);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add option.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <tr className="border-t border-slate-200 bg-teal-50/40">
      <td className="px-3 py-2">
        <Input placeholder="Code" value={code} disabled={isSaving} onChange={(e) => setCode(e.target.value)} className="h-9 w-24" />
      </td>
      <td className="px-3 py-2">
        <Input placeholder="Name" value={label} disabled={isSaving} onChange={(e) => setLabel(e.target.value)} className="h-9 min-w-[14rem]" />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </td>
      <td className="px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={handleSave} disabled={isSaving} className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer">
            {isSaving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onClick={onCancel} disabled={isSaving} className="text-xs font-semibold text-slate-400 hover:text-slate-600 cursor-pointer">
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
};

const OptionSection = ({ title, hint, category, rows, onSaved, onDeleted, onCreated }) => {
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <p className="text-xs text-slate-500 mt-0.5">{hint}</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <th className="text-left px-3 py-2 w-28">Code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="px-3 py-2 w-24"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((option) => (
              <OptionRow key={option.id} option={option} onSaved={onSaved} onDeleted={onDeleted} />
            ))}
            {isAdding && (
              <NewOptionRow
                category={category}
                onCreated={(option) => { onCreated(option); setIsAdding(false); }}
                onCancel={() => setIsAdding(false)}
              />
            )}
          </tbody>
        </table>
      </div>
      {!isAdding && (
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-teal-700 border border-dashed border-teal-200 rounded-lg py-2 hover:bg-teal-50/40 cursor-pointer transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add option
        </button>
      )}
    </div>
  );
};

// Lets an admin add/rename/deactivate the codes offered in the Service Type,
// Service Status, Location, and Group Size dropdowns when a practitioner
// logs a session. Every add/edit/delete/reactivate saves immediately (no
// batch "Save" step) since these changes should reflect app-wide right away.
export const DropdownOptionsManager = () => {
  const { options, isLoading, refetch } = useDropdownOptions();

  if (isLoading) {
    return <div className="py-10 text-center text-slate-500">Loading options...</div>;
  }

  const patchRow = (category, updated) => {
    // Simplest correct approach: just refetch from the server so the cache
    // (and every other open tab/component) stays authoritative.
    refetch();
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-slate-800">Dropdown Options</h2>
        <p className="text-sm text-slate-500 mt-1">
          Add, rename, or remove the codes practitioners choose from when logging a session. Renaming a code updates how it displays everywhere immediately — including past logs that used it. Removing a code hides it from new logs but keeps past logs showing its name.
        </p>
      </div>
      {SECTIONS.map((section) => (
        <OptionSection
          key={section.category}
          title={section.title}
          hint={section.hint}
          category={section.category}
          rows={options[section.category] || []}
          onSaved={() => patchRow(section.category)}
          onDeleted={() => patchRow(section.category)}
          onCreated={() => patchRow(section.category)}
        />
      ))}
    </div>
  );
};
