import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ChipPickerOption {
  code: string;
  label: string;
}

interface ChipPickerProps {
  id: string;
  label: string;
  value: string;
  options: ChipPickerOption[];
  onChange: (code: string) => void;
  error?: string | null;
}

// Inline chip row — same (code, label) shape as Picker.tsx so it's a
// drop-in swap, but for small, fixed vocabularies (Service Status, Location,
// Group Size: all <= 8 options in practice) where opening a whole bottom
// sheet for a single tap is unnecessary round-tripping. Picker.tsx's sheet
// stays reserved for Service Type, which can be long/tenant-customized and
// doesn't fit a chip row. See Log Session's "fewer taps" pass.
export function ChipPicker({ id, label, value, options, onChange, error }: ChipPickerProps) {
  return (
    <div>
      <Label id={`${id}-label`}>{label}</Label>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-invalid={!!error}
        className="mt-1.5 flex flex-wrap gap-2"
      >
        {options.map((opt) => {
          const isSelected = opt.code === value;
          return (
            <button
              key={opt.code}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(opt.code)}
              className={cn(
                "press-scale min-h-[44px] rounded-full border px-4 text-sm font-semibold",
                isSelected ? "border-primary bg-primary text-primary-fg" : "border-border-strong bg-surface text-ink"
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
