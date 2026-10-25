// In Log Session, a signature counts as soon as the finger lifts: no "Done"
// tap. The pad stays open for more strokes (first and last name), and each
// stroke updates the saved signature.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SignatureCapture } from "../SignatureCapture";

beforeEach(() => {
  // jsdom has no drawing surface: a null context makes the component fall back to toDataURL
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement["getContext"];
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,SIG");
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
});

const stroke = (canvas: Element) => {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 30 });
  fireEvent.pointerUp(canvas, { pointerId: 1 });
};

describe("SignatureCapture autoCommit", () => {
  it("saves the signature when the finger lifts, with no Done button", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SignatureCapture autoCommit label="Parent signature" instructions="Sign here" value={null} onChange={onChange} />);
    expect(screen.queryByRole("button", { name: /Done/ })).not.toBeInTheDocument();
    stroke(screen.getByRole("img", { name: "Sign here" }));
    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,SIG");

    // the pad stays open for another stroke, and the second stroke updates the value again
    rerender(<SignatureCapture autoCommit label="Parent signature" instructions="Sign here" value="data:image/png;base64,SIG" onChange={onChange} />);
    const canvas = screen.getByRole("img", { name: "Sign here" });
    stroke(canvas);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Signed/)).toBeInTheDocument();
  });

  it("Clear starts over", () => {
    const onChange = vi.fn();
    const { rerender } = render(<SignatureCapture autoCommit label="Parent signature" instructions="Sign here" value={null} onChange={onChange} />);
    stroke(screen.getByRole("img", { name: "Sign here" }));
    rerender(<SignatureCapture autoCommit label="Parent signature" instructions="Sign here" value="data:image/png;base64,SIG" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("without autoCommit, the pad still waits for Done (Manage Signature)", () => {
    const onChange = vi.fn();
    render(<SignatureCapture label="Signature" instructions="Sign here" value={null} onChange={onChange} />);
    stroke(screen.getByRole("img", { name: "Sign here" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    expect(onChange).toHaveBeenCalledWith("data:image/png;base64,SIG");
  });
});
