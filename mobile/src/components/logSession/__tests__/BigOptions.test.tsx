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
