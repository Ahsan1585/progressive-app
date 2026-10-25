import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BigOptions } from "../BigOptions";
import { StepProgress } from "../StepProgress";

const options = [
  { code: "1", label: "Home" },
  { code: "3", label: "Service Provider Clinic/Office" },
];

describe("BigOptions", () => {
  it("shows every option as a large radio button and reports the picked code", () => {
    const onChange = vi.fn();
    render(<BigOptions label="Location" required value="" options={options} onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: /Location/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Home/ }));
    expect(onChange).toHaveBeenCalledWith("1");
  });

  it("marks the current value as checked", () => {
    render(<BigOptions label="Location" value="3" options={options} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Clinic/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Home/ })).toHaveAttribute("aria-checked", "false");
  });

  it("shows the field's error when given one", () => {
    render(<BigOptions label="Location" value="" options={options} onChange={vi.fn()} error="Pick a location." />);
    expect(screen.getByText("Pick a location.")).toBeInTheDocument();
  });
});

describe("StepProgress", () => {
  it("lets you jump to steps you have reached, not ahead of them", () => {
    const onGo = vi.fn();
    render(<StepProgress current={1} reached={1} complete={[true, false, false, false]} onGo={onGo} />);
    fireEvent.click(screen.getByRole("tab", { name: /Details/ }));
    expect(onGo).toHaveBeenCalledWith(0);
    expect(screen.getByRole("tab", { name: /Sign/ })).toBeDisabled();
    expect(screen.getByRole("tab", { name: /Codes/ })).toHaveAttribute("aria-selected", "true");
  });
});

describe("BigOptions on narrow phones", () => {
  const long = [
    { code: "individual", label: "Direct Child Service - Individual" },
    { code: "consultation", label: "Consultation/Facilitation with Others" },
    { code: "evaluation", label: "Evaluation/Assessment" },
  ];

  it("lets long labels wrap after a slash", () => {
    render(<BigOptions label="Group size" value="" options={long} onChange={vi.fn()} layout="grid" />);
    const btn = screen.getByRole("radio", { name: /Consultation/ });
    expect(btn.textContent).toContain("Consultation/​Facilitation");
  });

  it("uses full-width rows instead of two columns when labels are too long for half the screen", () => {
    render(<BigOptions label="Group size" value="" options={long} onChange={vi.fn()} layout="grid" />);
    expect(screen.getByRole("radiogroup", { name: /Group size/ }).className).not.toMatch(/grid-cols-2/);
  });

  it("keeps two columns for short labels", () => {
    render(<BigOptions label="Location" value="" options={[{ code: "1", label: "Home" }, { code: "8", label: "Telehealth" }]} onChange={vi.fn()} layout="grid" />);
    expect(screen.getByRole("radiogroup", { name: /Location/ }).className).toMatch(/grid-cols-2/);
  });
});
