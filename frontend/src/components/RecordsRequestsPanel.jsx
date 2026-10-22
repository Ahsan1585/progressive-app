import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { showAlert } from '@/utils/dialogStore';

// IDEA Part C 34 CFR 303.405 - a parent's request to inspect their child's
// records must be fulfilled within 10 days. Staff log the request here, and
// this panel tracks the countdown until it is marked fulfilled.
const IDENTITY_METHODS = [
  { value: 'known_parent', label: 'Known parent/guardian' },
  { value: 'photo_id', label: 'Photo ID checked' },
  { value: 'callback_verified', label: 'Verified by callback' },
  { value: 'in_person', label: 'Verified in person' },
  { value: 'other', label: 'Other' },
];

const todayStr = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

function Countdown({ request }) {
  if (request.overdue) {
    const n = Math.abs(request.daysRemaining);
    return (
      <span className="text-[14px] font-semibold px-2 py-0.5 rounded-full border bg-rose-50 text-rose-700 border-rose-200">
        Overdue by {n} day{n === 1 ? '' : 's'}
      </span>
    );
  }
  const urgent = request.daysRemaining <= 3;
  return (
    <span className={`text-[14px] font-semibold px-2 py-0.5 rounded-full border ${urgent ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
      {request.daysRemaining === 0 ? 'Due today' : `${request.daysRemaining} day${request.daysRemaining === 1 ? '' : 's'} left`}
    </span>
  );
}

export function RecordsRequestsPanel({ childList = [], initialChild = null, onClose }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState(initialChild ? String(initialChild.id) : '');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [requestedAt, setRequestedAt] = useState(todayStr());
  const [method, setMethod] = useState('');
  const [methodNote, setMethodNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [fulfillNotes, setFulfillNotes] = useState({});
  const [fulfillingId, setFulfillingId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/api/inspection-requests', { params: { status: 'open' } })
      .then((res) => setRequests(res.data.requests || []))
      .catch(() => showAlert('Failed to load records requests.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!patientId) return showAlert('Select the child the request is about.');
    if (!name.trim()) return showAlert("Enter the requester's name.");
    if (!method) return showAlert("Select how the requester's identity was verified.");
    if (method === 'other' && !methodNote.trim()) return showAlert('Describe how identity was verified.');
    setSubmitting(true);
    try {
      await api.post('/api/inspection-requests', {
        patientId: Number(patientId),
        requestedByName: name.trim(),
        requestedByRelationship: relationship.trim() || undefined,
        requestedAt,
        identityVerifiedMethod: method,
        identityVerifiedNote: methodNote.trim() || undefined,
      });
      setName(''); setRelationship(''); setMethod(''); setMethodNote('');
      if (!initialChild) setPatientId('');
      load();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to log request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFulfill = async (id) => {
    const note = fulfillNotes[id] || '';
    if (!note.trim()) return showAlert('Add a note describing how the records were provided.');
    setFulfillingId(id);
    try {
      await api.patch(`/api/inspection-requests/${id}/fulfill`, { fulfillmentNote: note.trim() });
      load();
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to mark fulfilled.');
    } finally {
      setFulfillingId(null);
    }
  };

  const selectCls = 'w-full h-9 rounded-md border border-slate-200 bg-white px-3 text-[16px] text-slate-700';

  return createPortal(
    <div className="staff-type fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[22px] font-extrabold tracking-tight leading-tight text-slate-900">Records requests</h3>
            <p className="text-[14px] text-slate-600 mt-0.5">
              Parent requests to inspect a child's records - due within 10 days (34 CFR 303.405)
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 cursor-pointer" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100 space-y-2">
          <label className="text-[14px] font-semibold text-slate-600">Log a new request</label>
          {initialChild ? (
            <p className="text-[16px] text-slate-700">{initialChild.first_name} {initialChild.last_name}</p>
          ) : (
            <select className={selectCls} value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Select child...</option>
              {childList.map((c) => (
                <option key={c.id} value={c.id}>{c.last_name}, {c.first_name} ({c.child_id})</option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="Requester name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Relationship (e.g. Mother)" value={relationship} onChange={(e) => setRelationship(e.target.value)} />
            <div>
              <label className="text-[13px] text-slate-600">Date received</label>
              <Input type="date" value={requestedAt} max={todayStr()} onChange={(e) => setRequestedAt(e.target.value)} />
            </div>
            <div>
              <label className="text-[13px] text-slate-600">Identity verified by</label>
              <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="">Select method...</option>
                {IDENTITY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          </div>
          {method === 'other' && (
            <Input placeholder="Describe how identity was verified" value={methodNote} onChange={(e) => setMethodNote(e.target.value)} />
          )}
          <div className="flex justify-end">
            <Button onClick={handleCreate} disabled={submitting} size="sm">
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : 'Log request'}
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {loading ? (
            <div className="text-center text-[16px] text-slate-500 py-6">Loading...</div>
          ) : requests.length === 0 ? (
            <div className="text-center text-[16px] text-slate-500 py-6">No open records requests.</div>
          ) : (
            requests.map((r) => (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[16px] font-semibold text-slate-800">{r.patient_last_name}, {r.patient_first_name}</span>
                  <Countdown request={r} />
                </div>
                <p className="text-[14px] text-slate-600">
                  {r.requested_by_name}{r.requested_by_relationship ? ` (${r.requested_by_relationship})` : ''} · received {fmtDate(r.requested_at)} · due {fmtDate(r.due_at)}
                </p>
                <Textarea
                  value={fulfillNotes[r.id] || ''}
                  onChange={(e) => setFulfillNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  placeholder="Fulfillment note (required) - how/when records were provided"
                  rows={2}
                />
                <div className="flex justify-end">
                  <Button size="sm" disabled={fulfillingId === r.id} onClick={() => handleFulfill(r.id)}>
                    {fulfillingId === r.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Mark fulfilled'}
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
