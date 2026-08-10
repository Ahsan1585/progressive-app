import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { showAlert } from '@/utils/dialogStore';
import { formatTime12h } from '@/utils/formatTime';
import { useDropdownOptions, buildCodeLabelMap } from '@/hooks/useDropdownOptions';

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTime = (iso) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const formatMinutes = (minutes) => {
  if (minutes == null) return '-';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Ceo-only queue of "Missing in EIMS" logs billing has sent up for review —
// the second half of the send-to-admin workflow (billing sends it from
// Compliance Analysis; this is where it gets decided). A comment is
// required either way, so every decision leaves a record on the log's
// notes thread (visible in Master Reports the same way any other log note is).
export function ActionRequired() {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [comment, setComment] = useState('');
  const [decidingId, setDecidingId] = useState(null);
  const { options: dropdownOptions, categories } = useDropdownOptions();
  const customCategories = categories.filter((c) => c.is_custom && c.is_active);

  const fetchLogs = () => {
    setIsLoading(true);
    setError(null);
    api.get('/api/billing/action-required')
      .then((res) => setLogs(res.data.logs || []))
      .catch((err) => setError(err.response?.data?.error || 'Failed to load action-required logs.'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => { fetchLogs(); }, []);

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setComment('');
  };

  const handleDecide = async (assessmentId, decision) => {
    if (!comment.trim()) {
      showAlert('A comment is required to approve or reject this log.');
      return;
    }
    setDecidingId(assessmentId);
    try {
      await api.post('/api/billing/action-required/decide', { assessmentId, decision, comment: comment.trim() });
      setLogs((prev) => prev.filter((l) => l.id !== assessmentId));
      setExpandedId(null);
      setComment('');
    } catch (err) {
      showAlert(err.response?.data?.error || 'Failed to record your decision.');
    } finally {
      setDecidingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold tracking-wide uppercase text-orange-600 mb-1.5">Admin</p>
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">Action Required</h1>
        <p className="text-base text-slate-600 max-w-2xl leading-relaxed">
          Logs with no matching record in EIMS that billing has sent up for your review. Approving or rejecting requires a comment — it's recorded on the log's notes thread either way.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-slate-500">Loading...</div>
      ) : error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">Nothing needs your attention right now.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="bg-white border border-orange-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-900">{log.patient_first_name} {log.patient_last_name}</span>
                    <span className="text-sm text-slate-500">{formatDate(log.service_date)}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5">
                    {log.practitioner_first_name} {log.practitioner_last_name} &middot; {log.type || '-'} &middot; {log.location || '-'}
                  </div>
                  <div className="text-xs text-orange-600 font-semibold mt-1.5">
                    Sent by {log.sent_by_first_name} {log.sent_by_last_name} on {formatDateTime(log.eims_missing_sent_at)}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => toggleExpand(log.id)} className="cursor-pointer flex-shrink-0">
                  {expandedId === log.id ? 'Cancel' : 'Review'}
                </Button>
              </div>

              {expandedId === log.id && (
                <div className="border-t border-orange-100 bg-orange-50/50 px-5 py-4 space-y-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Patient</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Child ID</div>
                        <div className="text-sm font-bold font-mono text-slate-900">{log.child_id || '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Date of Birth</div>
                        <div className="text-sm font-bold text-slate-900">{formatDate(log.patient_dob)}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">County</div>
                        <div className="text-sm font-bold text-slate-900">{log.patient_county || '-'}</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Service Codes</div>
                    <div className="grid grid-cols-4 gap-3">
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Status</div>
                        <div className="text-sm font-bold font-mono text-slate-900">{log.status || '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Type</div>
                        <div className="text-sm font-bold font-mono text-slate-900">{log.type || '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Location</div>
                        <div className="text-sm font-bold font-mono text-slate-900">{log.location || '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Group Size</div>
                        <div className="text-sm font-bold font-mono text-slate-900">{log.group_size_category || '-'}</div>
                      </div>
                    </div>
                  </div>

                  {customCategories.length > 0 && (
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Additional Fields</div>
                      <div className="grid grid-cols-4 gap-3">
                        {customCategories.map((cat) => {
                          const codeLabelMap = buildCodeLabelMap(dropdownOptions[cat.key] || []);
                          const code = log.form_data?.custom_fields?.[cat.key];
                          return (
                            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2" key={cat.key}>
                              <div className="text-[11px] font-bold uppercase text-slate-500">{cat.display_name}</div>
                              <div className="text-sm font-bold text-slate-900">{code ? (codeLabelMap[code] || code) : '-'}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Session Time</div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Start</div>
                        <div className="text-sm font-bold text-slate-900">{log.start_time ? formatTime12h(log.start_time) : '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">End</div>
                        <div className="text-sm font-bold text-slate-900">{log.end_time ? formatTime12h(log.end_time) : '-'}</div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
                        <div className="text-[11px] font-bold uppercase text-slate-500">Total</div>
                        <div className="text-sm font-bold text-slate-900">{formatMinutes(log.total_time)}</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">Practitioner</div>
                    <div className="text-sm font-semibold text-slate-800">
                      {log.practitioner_first_name} {log.practitioner_last_name}
                      {log.practitioner_discipline ? ` — ${log.practitioner_discipline}` : ''}
                    </div>
                  </div>

                  <Textarea
                    autoFocus
                    placeholder="Explain your decision — this is required and will be added to the log's notes."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="bg-white min-h-[90px]"
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleDecide(log.id, 'rejected')}
                      disabled={decidingId === log.id}
                      className="cursor-pointer text-white bg-red-600 hover:bg-red-700"
                    >
                      <X className="size-4" /> Reject
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleDecide(log.id, 'approved')}
                      disabled={decidingId === log.id}
                      className="cursor-pointer text-white bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Check className="size-4" /> Approve
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
