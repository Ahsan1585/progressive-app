import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { mfaListDevices, mfaRevokeDevice, mfaRevokeAllDevices, errMsg, type TrustedDevice } from "./mfaApi";
import { clearCurrentUserDevice, getCurrentDeviceId } from "./trustedDevice";

const fmt = (iso?: string | null) => {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};

function failMsg(err: unknown, fallback: string): string {
  const status = (err as { response?: { status?: number } }).response?.status;
  return status === 429 ? "Too many requests. Please wait a moment and try again." : errMsg(err, fallback);
}

// Settings: devices that skip the 2-step code at sign-in ("Remember this device").
export function TrustedDevices() {
  const [devices, setDevices] = React.useState<TrustedDevice[] | null>(null); // null = loading
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null); // device id | "all"
  const [confirmAll, setConfirmAll] = React.useState(false);
  const [confirmId, setConfirmId] = React.useState<string | null>(null); // this-device row awaiting confirm
  const currentId = getCurrentDeviceId();

  React.useEffect(() => {
    let live = true;
    mfaListDevices()
      .then((list) => {
        if (live) setDevices(list);
      })
      .catch((err) => {
        if (!live) return;
        setDevices([]);
        setProblem(failMsg(err, "Could not load trusted devices."));
      });
    return () => {
      live = false;
    };
  }, []);

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await mfaRevokeDevice(id);
      if (currentId && id === currentId) clearCurrentUserDevice();
      setConfirmId(null);
      setDevices((list) => (list ?? []).filter((d) => d.id !== id));
    } catch (err) {
      setProblem(failMsg(err, "Could not remove that device."));
    } finally {
      setBusyId(null);
    }
  };

  const removeAll = async () => {
    setBusyId("all");
    try {
      await mfaRevokeAllDevices();
      clearCurrentUserDevice();
      setDevices([]);
      setConfirmAll(false);
    } catch (err) {
      setProblem(failMsg(err, "Could not remove your devices."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-[15px] font-semibold text-ink">Trusted devices</h3>
      {devices === null && <p className="text-sm text-ink-muted">Loading...</p>}
      {devices && devices.length === 0 && (
        <p className="text-sm text-ink-muted">No trusted devices. You will be asked for a code at every login.</p>
      )}
      {devices && devices.length > 0 && (
        <>
          <ul className="divide-y divide-border rounded-card border border-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium text-ink">
                    {d.label || "Unnamed device"}
                    {currentId && d.id === currentId && (
                      <span className="ml-2 rounded-full bg-border/50 px-2 py-0.5 text-xs font-normal text-ink-muted">This device</span>
                    )}
                  </p>
                  <p className="text-xs text-ink-muted">
                    Added {fmt(d.createdAt)} · Last used {fmt(d.lastUsedAt)} · Expires {fmt(d.expiresAt)}
                  </p>
                  {confirmId === d.id && (
                    <p className="mt-1 text-xs text-ink-muted">Removing this device will ask for a code at your next login on it.</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  {confirmId === d.id && (
                    <Button type="button" variant="outline" size="sm" disabled={busyId !== null} onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={busyId === d.id}
                    disabled={busyId !== null}
                    onClick={() => (currentId && d.id === currentId && confirmId !== d.id ? setConfirmId(d.id) : void remove(d.id))}
                  >
                    {confirmId === d.id ? "Confirm" : "Remove"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" className="w-full" disabled={busyId !== null} onClick={() => setConfirmAll(true)}>
            Remove all devices
          </Button>
        </>
      )}

      <Dialog open={confirmAll} onOpenChange={(o) => !o && busyId === null && setConfirmAll(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove all devices?</DialogTitle>
            <DialogDescription>
              Every trusted device, including this one, will be asked for a code at the next login.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busyId !== null} onClick={() => setConfirmAll(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={busyId === "all"} onClick={() => void removeAll()}>
              Remove all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={problem !== null} onOpenChange={(o) => !o && setProblem(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trusted devices</DialogTitle>
            <DialogDescription>{problem}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setProblem(null)}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
