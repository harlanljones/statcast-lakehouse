import { For, Show, createUniqueId, type JSX } from "solid-js";
import { THEME, SCENE_ACCENT } from "../lib/theme";

// Tokens live in lib/theme.ts (mirrored as CSS custom properties in app.css).
export { THEME, SCENE_ACCENT };

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <div role="group" aria-label={props.label} style={{ display: "flex", "align-items": "center", gap: "6px" }}>
      <span style={{ color: THEME.muted, "font-size": "11px", "letter-spacing": "0.02em" }}>
        {props.label}
      </span>
      <div style={{ display: "flex", gap: "2px" }}>
        <For each={props.options}>
          {(o) => (
            <button class="ui-ctl ui-seg" aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
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
      <span class="mono" style={{ "min-width": "52px" }}>
        {props.value}
        {props.unit ?? ""}
      </span>
    </label>
  );
}

export interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  title?: string;
}

/** Checkbox + visible label, used for the layer toggles. */
export function Toggle(props: ToggleProps): JSX.Element {
  return (
    <label class="ui-ctl ui-toggle" title={props.title}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
      {props.label}
    </label>
  );
}

export interface CloseButtonProps {
  label: string;
  onClick: () => void;
}

export function CloseButton(props: CloseButtonProps): JSX.Element {
  return (
    <button class="ui-ctl ui-ghost ui-close" onClick={props.onClick} aria-label={props.label}>
      ✕
    </button>
  );
}

export interface PanelProps {
  /** Accessible name of the region. */
  label: string;
  /** Preferred width in px (full width when the docks flow below the canvas on phones). */
  width?: number;
  children: JSX.Element;
}

/**
 * Overlay card. Positioning is the dock's job (Visualizer's .viz-dock-*):
 * the panel is a shrinkable, scrollable flex child so it can never leave the
 * canvas. Body text is the UI font at 12px; put numeric readouts in `.mono`.
 */
export function Panel(props: PanelProps): JSX.Element {
  return (
    <section
      role="region"
      aria-label={props.label}
      class="ui-panel"
      style={{
        "--panel-w": props.width ? `${props.width}px` : undefined,
        background: THEME.panel,
        border: `1px solid ${THEME.border}`,
        "border-radius": "8px",
        padding: "12px 14px",
        "font-size": "12px",
        "line-height": "1.4",
        color: THEME.text,
        "box-shadow": "0 6px 20px rgba(0, 0, 0, 0.65)",
        "user-select": "none",
      }}
    >
      {props.children}
    </section>
  );
}

export interface PanelHeaderProps {
  title: string;
  subtitle?: string;
  /** Renders a close button when given. */
  onClose?: () => void;
  closeLabel?: string;
  titleColor?: string;
}

export function PanelHeader(props: PanelHeaderProps): JSX.Element {
  return (
    <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", gap: "8px", "margin-bottom": "8px" }}>
      <span style={{ "font-weight": "600", color: props.titleColor ?? THEME.text }}>{props.title}</span>
      <span style={{ display: "inline-flex", "align-items": "center", gap: "8px" }}>
        <Show when={props.subtitle}>
          <span style={{ "font-size": "11px", color: THEME.muted }}>{props.subtitle}</span>
        </Show>
        <Show when={props.onClose}>
          <CloseButton label={props.closeLabel ?? `Close ${props.title}`} onClick={() => props.onClose?.()} />
        </Show>
      </span>
    </div>
  );
}

/** Stable unique id for label/for pairing. */
export const uid = (prefix: string): string => `${prefix}-${createUniqueId()}`;
