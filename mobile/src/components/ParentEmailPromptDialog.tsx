import * as React from "react";
import api from "@/api/axiosInstance";
import { useAppData } from "@/contexts/AppDataContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Patient, ApiErrorBody } from "@/types";

interface ParentEmailPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: Patient;
  onSaved: () => void;
}

// Shown the moment a practitioner checks "Telepractice" on Log Session for a
// patient with no parent email on file — a telepractice session can't be
// sent for signature without one. Saves right here (the same full
// PUT /api/patients/:id EditPatient.tsx uses, with every other field carried
// over unchanged) instead of sending the practitioner away to a separate
// screen and losing their in-progress log.
export function ParentEmailPromptDialog({ open, onOpenChange, patient, onSaved }: ParentEmailPromptDialogProps) {
  const { fetchPatients } = useAppData();
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail(patient.parent_email || "");
      setError(null);
    }
  }, [open, patient.parent_email]);

  const handleSave = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter the parent's email address.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await api.put(`/api/patients/${patient.id}`, {
        firstName: patient.first_name,
        middleName: patient.middle_name || "",
        lastName: patient.last_name,
        dob: patient.dob ? patient.dob.split("T")[0] : "",
        county: patient.county,
        childId: patient.child_id,
        parentName: patient.parent_name || "",
        parentEmail: trimmed,
      });
      await fetchPatients();
      // Deliberately not calling onOpenChange(false) here — the caller's
      // onSaved is responsible for closing on success. onOpenChange is
      // reserved for the user declining (Cancel / outside-click / Escape),
      // which the caller uses to un-check telepractice again; conflating
      // the two would risk the caller reading a stale patient.parent_email
      // from before this save if it ever inspected that value to decide.
      onSaved();
    } catch (err) {
      const body = (err as { response?: { data?: ApiErrorBody | { error: unknown } } }).response?.data as
        | ApiErrorBody
        | undefined;
      setError((typeof body?.error === "string" && body.error) || "Failed to save the email. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent aria-labelledby="parent-email-prompt-title">
        <DialogHeader>
          <DialogTitle id="parent-email-prompt-title">Add a parent email to continue</DialogTitle>
          <DialogDescription>
            A telepractice session needs somewhere to send the signing link. Add {patient.first_name}&apos;s
            parent/caregiver email — it&apos;s saved to their patient record.
          </DialogDescription>
        </DialogHeader>
        <Field id="parent-email-prompt-input" label="Parent/caregiver email" error={error}>
          <Input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="parent@example.com"
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={saving}>
            Save &amp; Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
