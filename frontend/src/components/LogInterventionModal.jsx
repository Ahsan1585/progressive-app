import React, { useRef, useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/api/axiosInstance';
import { showAlert } from '@/utils/dialogStore';
import { useDropdownOptions, activeOnly } from '@/hooks/useDropdownOptions';
import { localTodayIso } from '@/utils/formatTime';

// --- Custom Signature Pad Sub-Component ---
const SignaturePad = ({ label, subtext, onUpdate, onSave }) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0a0a0a';
    }
  }, []);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0a0a0a';

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
    const y = e.clientY ? e.clientY - rect.top : e.touches[0].clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.closePath();
    setIsDrawing(false);
    if (onUpdate) {
      const base64String = canvas.toDataURL('image/png');
      onUpdate(base64String);
    }
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (onUpdate) {
      onUpdate(null);
    }
  };

  const handleSave = () => {
    const canvas = canvasRef.current;
    if (onSave) {
      onSave(canvas.toDataURL('image/png'));
    }
  };

  return (
    <div className="space-y-2">
      {label && <Label className="text-neutral-700 font-semibold">{label}</Label>}
      <div className="border-2 border-dashed border-neutral-300 rounded-lg bg-neutral-50 overflow-hidden relative">
        <canvas
          ref={canvasRef}
          width={350}
          height={120}
          className="w-full h-[120px] cursor-crosshair touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
        
        <div className="absolute top-2 right-2 flex gap-2">
          <button 
            type="button" 
            onClick={clearSignature}
            className="text-xs font-medium text-neutral-500 hover:text-red-600 bg-white px-2 py-1 rounded shadow-sm border border-neutral-200 cursor-pointer"
          >
            Clear
          </button>
          
          {onSave && (
            <button
              type="button"
              onClick={handleSave}
              className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded shadow-sm border border-blue-700 cursor-pointer"
            >
              Save
            </button>
          )}
        </div>
      </div>
      {subtext && <p className="text-xs text-neutral-500">{subtext}</p>}
    </div>
  );
};

// --- Main Modal Component ---
export function LogInterventionModal({ patient, isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    date: localTodayIso(),
    startTime: '',
    endTime: '',
    status: '1',
    type: 'DI',
    location: '1',
    groupSizeCategory: 'individual'
  });

  const [zeroTime, setZeroTime] = useState(false);
  const [parentSig, setParentSig] = useState(null);
  const [practitionerSig, setPractitionerSig] = useState(null);
  const [masterSignature, setMasterSignature] = useState(null);
  const [practitionerProfile, setPractitionerProfile] = useState(null);
  const { options: dropdownOptions } = useDropdownOptions();
  const serviceTypeOptions = activeOnly(dropdownOptions.service_type);
  const statusOptions = activeOnly(dropdownOptions.service_status);
  const locationOptions = activeOnly(dropdownOptions.location);
  const groupSizeOptions = activeOnly(dropdownOptions.group_size);

  const allowedServiceTypes = (practitionerProfile?.service_types?.length > 0)
    ? serviceTypeOptions.filter(opt => practitionerProfile.service_types.includes(opt.code))
    : serviceTypeOptions;

  // Fetch Master Signature & Profile when modal opens
  useEffect(() => {
    if (isOpen) {
      api.get('/api/practitioner/profile')
        .then(res => {
          if (res.data) {
            setPractitionerProfile(res.data);
            if (res.data.signature) {
              setMasterSignature(res.data.signature);
            }
            if (res.data.service_types?.length > 0) {
              setFormData(prev => ({
                ...prev,
                type: res.data.service_types.includes(prev.type) ? prev.type : res.data.service_types[0]
              }));
            }
          }
        })
        .catch(err => console.error("Error fetching master signature", err));
    } else {
      setParentSig(null);
      setPractitionerSig(null);
      setPractitionerProfile(null);
      setZeroTime(false);
      setFormData({
        date: localTodayIso(),
        startTime: '',
        endTime: '',
        status: '1',
        type: 'DI',
        location: '1',
        groupSizeCategory: 'individual'
      });
    }
  }, [isOpen]);

  const calculateTotalMinutes = (startTime, endTime) => {
    if (!startTime || !endTime) return 0;
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const diffMs = end - start;
    const diffMins = Math.round(diffMs / 60000);
    return diffMins < 0 ? diffMins + (24 * 60) : diffMins;
  };

  const handleZeroTimeToggle = (checked) => {
    setZeroTime(checked);
    setFormData((prev) => ({ ...prev, startTime: '', endTime: '' }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!practitionerSig) {
      showAlert("Please provide the Practitioner Signature before saving.");
      return;
    }

    const calculatedMinutes = calculateTotalMinutes(formData.startTime, formData.endTime);

    const payload = {
      patientId: patient?.id || patient?.patient_id || patient?.child_id,

      patient_first_name: patient?.middle_name ? `${patient.first_name} ${patient.middle_name}` : patient?.first_name,
      patient_last_name: patient?.last_name,
      patient_dob: patient?.dob,
      patient_county: patient?.county,

      practitioner_first_name: practitionerProfile?.first_name || "Unknown",
      practitioner_last_name: practitionerProfile?.last_name || "Practitioner",
      practitioner_discipline: practitionerProfile?.position_title || practitionerProfile?.discipline || "Practitioner",

      ...formData,
      totalTime: calculatedMinutes,
      total_time: calculatedMinutes,
      parentSignatureBase64: parentSig,
      practitionerSignatureBase64: practitionerSig
    };

    try {
      await api.post('/api/interventions', payload);
      await showAlert("Success! Encounter has been securely saved to the database.");
      if (onSuccess) onSuccess();
      onClose();
    } catch (error) {
      showAlert("There was an error saving the encounter.");
    }
  };

  if (!patient) return null;

  const totalMinutes = calculateTotalMinutes(formData.startTime, formData.endTime);
  const totalTimeLabel = formData.startTime && formData.endTime
    ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-[800px] bg-white max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-neutral-100 pb-4 mb-4">
          <DialogTitle className="text-xl font-bold text-neutral-900">
            SEVF Service Encounter Verification
          </DialogTitle>
          <p className="text-sm text-neutral-500">
            Recording session for <span className="font-semibold text-neutral-700">{patient.first_name}{patient.middle_name ? ` ${patient.middle_name}` : ''} {patient.last_name}</span> (ID: {patient.child_id})
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label>Service Date</Label>
              <Input type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} required />
            </div>
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input type="time" value={formData.startTime} onChange={(e) => setFormData({...formData, startTime: e.target.value})} disabled={zeroTime} required={!zeroTime} />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input type="time" value={formData.endTime} onChange={(e) => setFormData({...formData, endTime: e.target.value})} disabled={zeroTime} required={!zeroTime} />
            </div>
          </div>

          <label className="-mt-4 flex items-center gap-2 w-fit text-sm font-medium text-neutral-700">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-neutral-300"
              checked={zeroTime}
              onChange={(e) => handleZeroTimeToggle(e.target.checked)}
            />
            Session was cancelled — log with 0 time
          </label>

          {zeroTime ? (
            <div className="-mt-4 flex items-center gap-2 w-fit px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">Total Time: 0 min (cancelled)</span>
            </div>
          ) : totalTimeLabel && (
            <div className="-mt-4 flex items-center gap-2 w-fit px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-blue-700">Total Time: {totalTimeLabel}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-4 bg-neutral-50 border border-neutral-200 rounded-xl">
            <div className="space-y-2">
              <Label>Service Status</Label>
              <select className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" value={formData.status} onChange={(e) => setFormData({...formData, status: e.target.value})}>
                {statusOptions.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.code} - {opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Service Type</Label>
              <select className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" value={formData.type} onChange={(e) => setFormData({...formData, type: e.target.value})}>
                {allowedServiceTypes.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Service Location</Label>
              <select className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" value={formData.location} onChange={(e) => setFormData({...formData, location: e.target.value})}>
                {locationOptions.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.code} - {opt.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Group Size Category</Label>
              <select className="flex h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm" value={formData.groupSizeCategory} onChange={(e) => setFormData({...formData, groupSizeCategory: e.target.value})}>
                {groupSizeOptions.map(opt => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4 border-t border-neutral-100">
            <SignaturePad 
              label="Parent/Caregiver Signature" 
              subtext="I verify that the above services were received."
              onUpdate={(base64) => setParentSig(base64)}
            />
            
            <div className="space-y-2">
              <Label className="text-neutral-700 font-semibold">Practitioner Signature</Label>
              
              {masterSignature && !practitionerSig && (
                <Button 
                  type="button" 
                  onClick={() => setPractitionerSig(masterSignature)}
                  className="w-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 mb-2 cursor-pointer"
                >
                  Insert Master Signature
                </Button>
              )}

              {practitionerSig ? (
                <div className="border border-neutral-300 rounded-lg p-2 bg-neutral-50 relative h-[120px] flex items-center justify-center">
                  <img src={practitionerSig} alt="Practitioner Signature" className="max-h-24" />
                  <button type="button" onClick={() => setPractitionerSig(null)} className="absolute top-2 right-2 text-xs text-red-500 bg-white px-2 py-1 border rounded shadow-sm cursor-pointer">Clear</button>
                </div>
              ) : (
                <SignaturePad 
                  label="" 
                  subtext={`Practitioner: ${practitionerProfile?.first_name || 'Ahsan'} ${practitionerProfile?.last_name || 'Ashfaq'}. I certify services were provided.`}
                  onUpdate={(base64) => setPractitionerSig(base64)}
                />
              )}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-6">
            <Button type="button" variant="outline" onClick={onClose} className="border-slate-300 text-slate-700 cursor-pointer">Cancel</Button>
            <Button type="submit" className="bg-blue-600 text-white hover:bg-blue-700 shadow-md cursor-pointer">
              Save Encounter Record
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}