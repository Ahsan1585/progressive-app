// The child's page lists notes waiting for a parent's signature, with
// Resend, and for a date change, Undo.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AwaitingSignatureRow } from "../AwaitingSignatureRow";
import type { TelepracticeSignatureRequest } from "@/types";

const req = (o: Partial<TelepracticeSignatureRequest> = {}): TelepracticeSignatureRequest => ({
  id: "r1", kind: "date_change", assessment_id: 42, patient_id: "7", patient_first_name: "Luz", patient_last_name: "Q",
  service_date: "2026-10-23", previous_service_date: "2026-10-21", type: "SLP", status: "awaiting_signature",
  parent_email: "luz.parent@example.com", sent_at: new Date().toISOString(), resent_at: null, resend_count: 0,
  signed_at: null, token_expires: new Date(Date.now() + 1e8).toISOString(), ...o,
});

describe("AwaitingSignatureRow", () => {
  it("a date change shows old and new date, with Resend and Undo", () => {
    const onResend = vi.fn(); const onUndo = vi.fn();
    render(<AwaitingSignatureRow request={req()} onResend={onResend} onUndo={onUndo} resending={false} />);
    expect(screen.getByText("Date change")).toBeInTheDocument();
    expect(screen.getByText(/Oct 21/)).toBeInTheDocument();
    expect(screen.getByText(/Oct 23/)).toBeInTheDocument();
    expect(screen.getByText(/luz\.parent@example\.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resend" }));
    expect(onResend).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo date change" }));
    expect(onUndo).toHaveBeenCalled();
  });

  it("a telepractice session has Resend only", () => {
    render(<AwaitingSignatureRow request={req({ kind: "telepractice", previous_service_date: null })} onResend={vi.fn()} onUndo={vi.fn()} resending={false} />);
    expect(screen.queryByText("Date change")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo date change" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resend" })).toBeInTheDocument();
  });
});
