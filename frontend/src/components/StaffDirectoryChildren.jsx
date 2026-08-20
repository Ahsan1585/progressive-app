import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { AddPatientModal } from '@/components/AddPatientModal';
import { showAlert } from '@/utils/dialogStore';

const norm = (s) => (s || '').toString().toLowerCase();

// "Any name configuration" — split the search box into tokens and require
// every token to appear somewhere in the child's full name or child ID, so
// "Smith John", "John Smith", "Sm Jo", or a lone middle name all match
// without the office needing to know field order.
const matchesChildSearch = (child, term) => {
  if (!term.trim()) return true;
  const tokens = term.trim().split(/[\s,]+/).filter(Boolean).map(norm);
  const haystack = norm(`${child.first_name} ${child.middle_name || ''} ${child.last_name} ${child.child_id}`);
  return tokens.every((t) => haystack.includes(t));
};

const activePractitioner = (child) =>
  (child.practitioners || []).find((p) => p.status === 'active') || null;

const matchesPractitionerSearch = (child, term) => {
  if (!term.trim()) return true;
  const t = norm(term);
  return (child.practitioners || []).some((p) => norm(`${p.first_name} ${p.last_name}`).includes(t));
};

const formatDob = (dob) => {
  if (!dob) return '—';
  const d = new Date(dob);
  return Number.isNaN(d.getTime()) ? dob : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export function StaffDirectoryChildren() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.get('/api/auth/me')
      .then((res) => setMe(res.data))
      .catch(() => setMe({ isAdmin: false, permissions: [] }));
  }, []);
  const canEdit = !!me && (me.isAdmin || (me.permissions || []).includes('staff_directory_edit'));

  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [practitionerOptions, setPractitionerOptions] = useState([]);
  const [childSearch, setChildSearch] = useState('');
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [editingChild, setEditingChild] = useState(null);
  const [reassigningId, setReassigningId] = useState(null);

  const loadChildren = () => {
    api.get('/api/patients/directory/all')
      .then((res) => setChildren(res.data.patients || []))
      .catch(() => showAlert('Failed to load children.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadChildren();
    api.get('/api/auth/staff')
      .then((res) => setPractitionerOptions((res.data.staff || []).filter((s) => s.role === 'practitioner' && s.is_active !== false)))
      .catch(() => {});
  }, []);

  const handleReassign = async (childId, practitionerId) => {
    if (!practitionerId) return;
    setReassigningId(childId);
    try {
      await api.patch(`/api/patients/directory/${childId}/practitioner`, { practitionerId: Number(practitionerId) });
      const assigned = practitionerOptions.find((p) => p.id === Number(practitionerId));
      setChildren((prev) => prev.map((c) => {
        if (c.id !== childId) return c;
        const others = (c.practitioners || []).filter((p) => p.id !== Number(practitionerId)).map((p) => ({ ...p, status: 'inactive' }));
        return { ...c, practitioners: [...others, { id: Number(practitionerId), first_name: assigned?.first_name, last_name: assigned?.last_name, status: 'active' }] };
      }));
    } catch {
      showAlert('Failed to reassign practitioner.');
    } finally {
      setReassigningId(null);
    }
  };

  const visibleChildren = children.filter(
    (c) => matchesChildSearch(c, childSearch) && matchesPractitionerSearch(c, practitionerSearch)
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h2 className="text-base font-bold text-slate-800">All Children</h2>
          <span className="text-xs text-slate-400 font-medium">{visibleChildren.length} of {children.length} registered</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search by child name or Child ID..."
              className="pl-9"
              value={childSearch}
              onChange={(e) => setChildSearch(e.target.value)}
            />
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              type="text"
              placeholder="Search by assigned practitioner..."
              className="pl-9"
              value={practitionerSearch}
              onChange={(e) => setPractitionerSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-sm text-slate-400">Loading children...</div>
      ) : visibleChildren.length === 0 ? (
        <div className="p-8 text-center text-sm text-slate-400">
          {childSearch.trim() || practitionerSearch.trim() ? 'No children match your search.' : 'No children registered yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-6 py-3">Child</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Child ID</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">DOB</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">County</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Assigned Practitioner</th>
                <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide px-4 py-3">Registered</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleChildren.map((child) => {
                const active = activePractitioner(child);
                return (
                  <tr key={child.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3 font-medium text-slate-800">
                      {child.first_name} {child.middle_name ? `${child.middle_name} ` : ''}{child.last_name}
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-xs">{child.child_id}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDob(child.dob)}</td>
                    <td className="px-4 py-3 text-slate-500">{child.county}</td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <select
                          value={active?.id || ''}
                          onChange={(e) => handleReassign(child.id, e.target.value)}
                          disabled={reassigningId === child.id}
                          className={`text-xs font-semibold border rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-100 text-slate-700 border-slate-200 ${reassigningId === child.id ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <option value="" disabled>Unassigned</option>
                          {practitionerOptions.map((p) => (
                            <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-600">{active ? `${active.first_name} ${active.last_name}` : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDob(child.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {canEdit && (
                        <button
                          onClick={() => setEditingChild(child)}
                          className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                          title="Edit child"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingChild && (
        <AddPatientModal
          open={!!editingChild}
          onOpenChange={(open) => !open && setEditingChild(null)}
          showTrigger={false}
          patient={editingChild}
          editUrl={(id) => `/api/patients/directory/${id}`}
          onPatientAdded={() => { setEditingChild(null); loadChildren(); }}
        />
      )}
    </div>
  );
}
