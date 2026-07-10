import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInstallPrompt } from "./useInstallPrompt";

// Minimal stand-in for the real (non-standard) BeforeInstallPromptEvent.
function makeBeforeInstallPromptEvent(userChoice: Promise<{ outcome: string; platform: string }> = Promise.resolve({ outcome: "accepted", platform: "web" })) {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string; platform: string }>;
  };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = userChoice;
  return event;
}

describe("useInstallPrompt", () => {
  beforeEach(() => {
    // jsdom doesn't implement matchMedia; the hook guards for it, but stub it
    // explicitly per-test so we can control "standalone" detection.
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });

  it("starts with no install available", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canPromptInstall).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it("becomes promptable once beforeinstallprompt fires, and prevents the default mini-infobar", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = makeBeforeInstallPromptEvent();
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");

    act(() => {
      window.dispatchEvent(event);
    });

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(result.current.canPromptInstall).toBe(true);
  });

  it("promptInstall() calls .prompt() on the captured event and then clears it (single use)", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = makeBeforeInstallPromptEvent();

    act(() => {
      window.dispatchEvent(event);
    });
    expect(result.current.canPromptInstall).toBe(true);

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current.canPromptInstall).toBe(false);
  });

  it("marks installed and clears the prompt when appinstalled fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent());
    });
    expect(result.current.canPromptInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canPromptInstall).toBe(false);
  });

  it("treats an already-standalone launch as installed from the start", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.isInstalled).toBe(true);
    expect(result.current.canPromptInstall).toBe(false);
  });
});
