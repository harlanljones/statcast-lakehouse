import { For, type JSX } from "solid-js";

export const THEME = {
  bg: "#020617",
  panel: "rgba(10, 15, 30, 0.95)",
  border: "rgba(255, 255, 255, 0.12)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#60a5fa",
  gold: "#fbbf24",
} as const;

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <div role="group" aria-label={props.label} style={{ display: "flex", "align-items": "center", gap: "6px" }}>
      <span style={{ color: THEME.muted, "font-size": "11px", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
        {props.label}
      </span>
      <div style={{ display: "flex", gap: "2px" }}>
        <For each={props.options}>
          {(o) => (
            <button
              aria-pressed={props.value === o.value}
              onClick={() => props.onChange(o.value)}
              style={{
                padding: "3px 9px",
                "font-size": "12px",
                color: props.value === o.value ? "#0b1220" : THEME.text,
                background: props.value === o.value ? THEME.accent : "transparent",
                border: `1px solid ${props.value === o.value ? THEME.accent : THEME.border}`,
                cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

export function RangeField(props: RangeFieldProps): JSX.Element {
  return (
    <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px" }}>
      <span style={{ color: THEME.muted, "min-width": "72px" }}>{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span style={{ "font-variant-numeric": "tabular-nums", "min-width": "52px" }}>
        {props.value}
        {props.unit ?? ""}
      </span>
    </label>
  );
}
