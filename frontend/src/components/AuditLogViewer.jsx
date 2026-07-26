import React, { useState, useEffect } from 'react';
import api from '@/api/axiosInstance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ACTION_LABELS = {
  login_success: 'Login',
  login_failed: 'Login failed',
  login_blocked_deactivated: 'Login blocked (deactivated)',
  patient_create: 'Patient created',
  patient_update: 'Patient updated',
  patient_status_update: 'Patient status changed',
  patient_delete: 'Patient deleted',
  patient_assessments_view: 'Patient records viewed',
  patients_bulk_view: 'Patient roster viewed',
  log_delete: 'Session log deleted',
  compliance_doc_upload: 'Compliance doc uploaded',
  compliance_doc_apply_mapping: 'Compliance doc mapping confirmed',
  compliance_doc_remove: 'Compliance doc removed',
  compliance_doc_download: 'Compliance doc downloaded',
  njeis_pdf_generate: 'NJEIS form generated',
  invoice_pdf_generate: 'Invoice generated',
  master_report_generate: 'Master report generated',
  audit_njeis_pdf_generate: 'Audit NJEIS PDF generated',
  audit_report_pdf_download: 'Audit report PDF downloaded',
  audit_report_excel_download: 'Audit report Excel downloaded',
  invoice_override_issue: 'Invoice override issued',
};

// Read-only admin view over /api/audit-log (backend/src/controllers/auditLogController.js)
// — a HIPAA audit-controls trail (45 CFR 164.312(b)) of who touched PHI and
// when. ceo-only, same as the endpoint itself.
export const AuditLogViewer = () => {
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ action: '', resourceType: '', startDate: '', endDate: '' });

  const fetchLogs = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = {};
      if (filters.action) params.action = filters.action;
      if (filters.resourceType) params.resourceType = filters.resourceType;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;
      const response = await api.get('/api/audit-log', { params });
      setLogs(response.data.logs || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load audit log.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  const setFilter = (field, value) => setFilters((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Audit Log</h1>
        <p className="text-sm text-slate-500 mt-1">
          A record of who accessed or changed patient data, the state compliance document, and generated NJEIS/invoice/audit files — newest first.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Action</Label>
            <select
              className="w-full h-9 rounded-md border border-slate-300 bg-white px-2.5 text-sm"
              value={filters.action}
              onChange={(e) => setFilter('action', e.target.value)}
            >
              <option value="">All actions</option>
              {Object.entries(ACTION_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Resource type</Label>
            <Input value={filters.resourceType} onChange={(e) => setFilter('resourceType', e.target.value)} placeholder="e.g. patient" className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From</Label>
            <Input type="date" value={filters.startDate} onChange={(e) => setFilter('startDate', e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">To</Label>
            <Input type="date" value={filters.endDate} onChange={(e) => setFilter('endDate', e.target.value)} className="h-9" />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={fetchLogs} disabled={isLoading} className="cursor-pointer bg-slate-800 hover:bg-slate-900 text-white">
            {isLoading ? 'Loading...' : 'Apply filters'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
              <th className="px-4 py-2.5">When</th>
              <th className="px-4 py-2.5">Who</th>
              <th className="px-4 py-2.5">Action</th>
              <th className="px-4 py-2.5">Resource</th>
              <th className="px-4 py-2.5">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No audit entries match these filters.</td></tr>
            ) : logs.map((log) => (
              <tr key={log.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-slate-800 font-medium">{log.actor_email || 'Unknown'}<span className="text-slate-400 font-normal"> {log.actor_role ? `(${log.actor_role})` : ''}</span></td>
                <td className="px-4 py-2.5 text-slate-700">{ACTION_LABELS[log.action] || log.action}</td>
                <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{log.resource_type}{log.resource_id ? `#${log.resource_id}` : ''}</td>
                <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{log.ip_address || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
