import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldProps {
  id: string;
  label: string;
  optional?: boolean;
  error?: string | null;
  hint?: string;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
}

// Persistent visible label + input + field-level error, wired with
// aria-describedby/role="alert" per the design's a11y notes.
export function Field({ id, label, optional, error, hint, className, children }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  const field = React.cloneElement(children, {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": !!error,
  });

  return (
    <div className={cn("space-y-0", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-ink-faint">(optional)</span>}
      </Label>
      {field}
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
