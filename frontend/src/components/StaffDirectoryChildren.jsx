import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Download, FileEdit, Loader2, X } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AddPatientModal } from '@/components/AddPatientModal';
import { showAlert, showConfirm } from '@/utils/dialogStore';

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

// Practitioner rosters run long enough (dozens of names) that scanning a
// plain <select> is slow — this swaps in a type-to-filter list instead.
// Renders its panel through a portal at position: fixed (measured from the
// trigger button) rather than absolute, since the table's overflow-x-auto
// wrapper would otherwise clip a dropdown that opens near its edge.
function PractitionerCombobox({ options, valueId, onSelect, disabled }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [panelStyle, setPanelStyle] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);

  const current = options.find((o) => o.id === valueId);
  const filtered = options.filter((o) => norm(`${o.first_name} ${o.last_name}`).includes(norm(search)));

  const openPanel = () => {
    if (disabled) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPanelStyle({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200) });
    setSearch('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPanel}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold border rounded-md px-2 py-1 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 ${disabled ? 'opacity-50 cursor-wait' : ''}`}
      >
        {current ? `${current.first_name} ${current.last_name}` : 'Unassigned'}
        <ChevronDown className="size-3.5 text-slate-400" />
      </button>

      {open && panelStyle && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
          className="z-50 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden"
        >
          <div className="p-1.5 border-b border-slate-100">
            <Input
              autoFocus
              type="text"
              placeholder="Search practitioners..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No practitioners match.</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { setOpen(false); onSelect(o.id); }}
                  className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer hover:bg-blue-50 ${o.id === valueId ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700'}`}
                >
                  {o.first_name} {o.last_name}
                </button>
              ))
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// IDEA Part C (34 CFR 303.410-413) correction-request review flow — see
// backend/src/controllers/correctionRequestController.js for the full
// compliance rationale. A child's history of requests (pending and
// decided), plus a form to log a new one. There's no unauthenticated
// parent-facing form for this; staff record what a parent/guardian asked
// for on their behalf, same as every other parent-rights flow in this app.
function CorrectionRequestsDialog({ child, onClose }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [decidingId, setDecidingId] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState({});

  const load = () => {
    setLoading(true);
    api.get(`/api/patients/${child.id}/correction-requests`)
      .then((res) => setRequests(res.data.requests || []))
      .catch(() => showAlert('Failed to load correction requests.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [child.id]);

  const handleCreate = async () => {
    if (!newNote.trim()) {
      showAlert('Describe what the parent/guardian asked to have corrected.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/api/patients/${child.id}/correction-requests`, { requestNote: newNote.trim() });
      setNewNote('');
      load();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to create correction request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async (requestId, decision) => {
    const note = decisionNotes[requestId] || '';
    if (decision === 'denied' && !note.trim()) {
      showAlert('A reason is required to deny a correction request.');
      return;
    }
    setDecidingId(requestId);
    try {
      await api.post(`/api/patients/correction-requests/${requestId}/decide`, { decision, decisionNote: note.trim() || null });
      load();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to record decision.');
    } finally {
      setDecidingId(null);
    }
  };

  const statusBadge = (status) => {
    const styles = {
      pending: 'bg-amber-50 text-amber-700 border-amber-200',
      accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      denied: 'bg-rose-50 text-rose-700 border-rose-200',
    };
    return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${styles[status] || ''}`}>{status}</span>;
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">Correction requests</h3>
            <p className="text-xs text-slate-500 mt-0.5">{child.first_name} {child.last_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100 space-y-2">
          <label className="text-xs font-semibold text-slate-600">Log a new request</label>
          <Textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="What did the parent/guardian ask to have corrected?"
            rows={3}
          />
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={submitting} size="sm">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : 'Log request'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="text-center text-sm text-slate-400 py-6">Loading...</div>
          ) : requests.length === 0 ? (
            <div className="text-center text-sm text-slate-400 py-6">No correction requests for this child yet.</div>
          ) : (
            requests.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">
                    Requested {new Date(r.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {r.requested_by_first_name ? ` by ${r.requested_by_first_name} ${r.requested_by_last_name}` : ''}
                  </span>
                  {statusBadge(r.status)}
                </div>
                <p className="text-sm text-slate-700">{r.request_note}</p>
                {r.status === 'pending' ? (
                  <div className="space-y-2 pt-1">
                    <Textarea
                      value={decisionNotes[r.id] || ''}
                      onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      placeholder="Decision note (required if denying)"
                      rows={2}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={decidingId === r.id}
                        onClick={() => handleDecide(r.id, 'denied')}
                      >
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        disabled={decidingId === r.id}
                        onClick={() => handleDecide(r.id, 'accepted')}
                      >
                        Accept
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-500 pt-1">
                    {r.status === 'accepted' ? 'Accepted' : 'Denied'} {r.reviewed_at ? `on ${new Date(r.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
                    {r.reviewed_by_first_name ? ` by ${r.reviewed_by_first_name} ${r.reviewed_by_last_name}` : ''}
                    {r.decision_note ? ` — "${r.decision_note}"` : ''}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function StaffDirectoryChildren() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    api.get('/api/auth/me')
      .then((res) => setMe(res.data))
      .catch(() => setMe({ isAdmin: false, permissions: [] }));
  }, []);
  const canEdit = !!me && (me.isAdmin || (me.permissions || []).includes('staff_directory_edit'));
  const canManageRecordRights = !!me && (me.isAdmin || (me.permissions || []).includes('patient_record_rights'));

  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [practitionerOptions, setPractitionerOptions] = useState([]);
  const [childSearch, setChildSearch] = useState('');
  const [practitionerSearch, setPractitionerSearch] = useState('');
  const [editingChild, setEditingChild] = useState(null);
  const [reassigningId, setReassigningId] = useState(null);
  const [correctionsChild, setCorrectionsChild] = useState(null);
  const [exportingId, setExportingId] = useState(null);

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

    const child = children.find((c) => c.id === childId);
    const current = child ? activePractitioner(child) : null;
    const target = practitionerOptions.find((p) => p.id === Number(practitionerId));
    const childName = child ? `${child.first_name} ${child.last_name}` : 'this child';
    const currentName = current ? `${current.first_name} ${current.last_name}` : 'no one currently assigned';
    const targetName = target ? `${target.first_name} ${target.last_name}` : 'the selected practitioner';

    const confirmed = await showConfirm(
      `Reassign ${childName} from ${currentName} to ${targetName}?\n\nThis only changes who services this child going forward. Every past session log, SEVF form, and invoice stays attributed to the practitioner who actually performed it and will not be changed or moved.`,
      { title: 'Reassign practitioner', confirmLabel: 'Reassign' }
    );
    if (!confirmed) return;

    setReassigningId(childId);
    try {
      await api.patch(`/api/patients/directory/${childId}/practitioner`, { practitionerId: Number(practitionerId) });
      setChildren((prev) => prev.map((c) => {
        if (c.id !== childId) return c;
        const others = (c.practitioners || []).filter((p) => p.id !== Number(practitionerId)).map((p) => ({ ...p, status: 'inactive' }));
        return { ...c, practitioners: [...others, { id: Number(practitionerId), first_name: target?.first_name, last_name: target?.last_name, status: 'active' }] };
      }));
    } catch {
      showAlert('Failed to reassign practitioner.');
    } finally {
      setReassigningId(null);
    }
  };

  // IDEA Part C 34 CFR 303.405(a) — a child's full early intervention
  // record, generated fresh (not the stored multi-child billing batch
  // files) so an office can respond to a parent/guardian access request.
  // Same blob-download pattern used elsewhere (MasterReports.jsx,
  // CompanySettings.jsx, SubscriptionBilling.jsx).
  const handleExportRecord = async (child) => {
    setExportingId(child.id);
    try {
      const response = await api.get(`/api/patients/${child.id}/record-export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `record-export-${(child.last_name || 'child').replace(/\s+/g, '_')}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      showAlert('Failed to export this child\'s record.');
    } finally {
      setExportingId(null);
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
                        <PractitionerCombobox
                          options={practitionerOptions}
                          valueId={active?.id}
                          onSelect={(id) => handleReassign(child.id, id)}
                          disabled={reassigningId === child.id}
                        />
                      ) : (
                        <span className="text-slate-600">{active ? `${active.first_name} ${active.last_name}` : '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDob(child.created_at)}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {canManageRecordRights && (
                        <>
                          <button
                            onClick={() => handleExportRecord(child)}
                            disabled={exportingId === child.id}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait"
                            title="Export full record (parent/guardian record request)"
                          >
                            {exportingId === child.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setCorrectionsChild(child)}
                            className="p-1.5 rounded-lg text-slate-700 hover:text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer"
                            title="Correction requests"
                          >
                            <FileEdit className="w-4 h-4" />
                          </button>
                        </>
                      )}
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

      {correctionsChild && (
        <CorrectionRequestsDialog
          child={correctionsChild}
          onClose={() => setCorrectionsChild(null)}
        />
      )}
    </div>
  );
}
