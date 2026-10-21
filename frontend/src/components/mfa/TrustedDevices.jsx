import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { mfaListDevices, mfaRevokeDevice, mfaRevokeAllDevices, errMsg } from './mfaApi';
import { clearCurrentUserDevice, getCurrentDeviceId } from './trustedDevice';

const fmt = (iso) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

const failMsg = (err, fallback) =>
  err?.response?.status === 429 ? 'Too many requests. Please wait a moment and try again.' : errMsg(err, fallback);

// Settings: devices that skip the 2-step code at sign-in ("Remember this device").
export function TrustedDevices() {
  const [devices, setDevices] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null); // device id | 'all'
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmId, setConfirmId] = useState(null); // this-device row awaiting confirm
  const currentId = getCurrentDeviceId();

  useEffect(() => {
    let live = true;
    mfaListDevices()
      .then((list) => { if (live) setDevices(list); })
      .catch((err) => { if (live) { setDevices([]); setError(failMsg(err, 'Could not load trusted devices.')); } });
    return () => { live = false; };
  }, []);

  const remove = async (id) => {
    setError(''); setBusyId(id);
    try {
      await mfaRevokeDevice(id);
      if (currentId && id === currentId) clearCurrentUserDevice();
      setConfirmId(null);
      setDevices((list) => (list || []).filter((d) => d.id !== id));
    } catch (err) {
      setError(failMsg(err, 'Could not remove that device.'));
    } finally { setBusyId(null); }
  };

  const removeAll = async () => {
    setError(''); setBusyId('all');
    try {
      await mfaRevokeAllDevices();
      clearCurrentUserDevice();
      setDevices([]);
      setConfirmAll(false);
    } catch (err) {
      setError(failMsg(err, 'Could not remove your devices.'));
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-3 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold text-slate-800">Trusted devices</h3>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {devices === null && <p className="text-sm text-slate-500">Loading...</p>}
      {devices && devices.length === 0 && (
        <p className="text-sm text-slate-500">No trusted devices. You will be asked for a code at every login.</p>
      )}
      {devices && devices.length > 0 && (
        <>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-slate-800">
                    {d.label || 'Unnamed device'}
                    {currentId && d.id === currentId && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-600">This device</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">
                    Added {fmt(d.createdAt)} · Last used {fmt(d.lastUsedAt)} · Expires {fmt(d.expiresAt)}
                  </p>
                  {confirmId === d.id && (
                    <p className="mt-1 text-xs text-slate-600">Removing this device will ask for a code at your next login on it.</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {confirmId === d.id && (
                    <Button type="button" variant="outline" size="sm" disabled={busyId !== null} onClick={() => setConfirmId(null)}>Cancel</Button>
                  )}
                  <Button
                    type="button" variant="outline" size="sm" disabled={busyId !== null}
                    onClick={() => (currentId && d.id === currentId && confirmId !== d.id ? setConfirmId(d.id) : remove(d.id))}
                  >
                    {busyId === d.id ? 'Removing...' : confirmId === d.id ? 'Confirm' : 'Remove'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {!confirmAll ? (
            <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => { setConfirmAll(true); setError(''); }}>
              Remove all devices
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm text-slate-700">
                Remove all trusted devices? Every device, including this one, will be asked for a code at the next login.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" disabled={busyId !== null} onClick={() => setConfirmAll(false)}>Cancel</Button>
                <Button type="button" variant="destructive" disabled={busyId !== null} onClick={removeAll}>
                  {busyId === 'all' ? 'Removing...' : 'Yes, remove all'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
