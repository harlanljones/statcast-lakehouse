import { For, Show, type JSX } from "solid-js";
import type { PitchDatum } from "../lib/deck-layers";
import { pitchColor } from "../lib/deck-layers";
import {
  breakToSvgCoords,
  breakGridTicks,
  DEFAULT_BREAK_RANGE_INCHES,
} from "../lib/break-chart-math";

export interface BreakChartProps {
  pitches: PitchDatum[];
  picked?: PitchDatum | null;
  onPick?: (pitch: PitchDatum | null) => void;
  width?: number;
  height?: number;
  range?: number;
}

/**
 * 2D Aerodynamic Movement Profile (Break Chart: IVB vs HB).
 * Plots Induced Vertical Break vs Horizontal Break in inches.
 * Center (0, 0) represents the ghost pitch trajectory without Magnus acceleration.
 */
export default function BreakChart(props: BreakChartProps): JSX.Element {
  const width = () => props.width ?? 210;
  const height = () => props.height ?? 210;
  const range = () => props.range ?? DEFAULT_BREAK_RANGE_INCHES;
  const padding = 22;

  const ticks = () => breakGridTicks(range(), 10);
  const origin = () => breakToSvgCoords(0, 0, width(), height(), range(), padding);

  const pickedCoord = () => {
    if (!props.picked?.breakVector) return null;
    const bv = props.picked.breakVector;
    return breakToSvgCoords(bv.hBreakInches, bv.vBreakInches, width(), height(), range(), padding);
  };

  return (
    <div
      role="region"
      aria-label="pitch movement profile break chart"
      style={{
        position: "absolute",
        top: "14px",
        right: "14px",
        background: "rgba(15, 15, 22, 0.92)",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        "border-radius": "8px",
        padding: "8px",
        "box-shadow": "0 6px 18px rgba(0, 0, 0, 0.6)",
        "backdrop-filter": "blur(4px)",
        color: "#ccc",
        "font-family": "monospace",
        "font-size": "11px",
        "user-select": "none",
        "z-index": "10",
      }}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "4px" }}>
        <span style={{ "font-weight": "bold", color: "#eee" }}>Movement Profile</span>
        <span style={{ "font-size": "10px", color: "#888" }}>IVB vs HB (in)</span>
      </div>

      <svg
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        style={{ display: "block", overflow: "visible" }}
      >
        {/* Background plot area */}
        <rect
          x={padding}
          y={padding}
          width={width() - 2 * padding}
          height={height() - 2 * padding}
          fill="rgba(0, 0, 0, 0.35)"
          stroke="rgba(255, 255, 255, 0.1)"
          rx="4"
        />

        {/* Grid lines */}
        <For each={ticks()}>
          {(tick) => {
            if (tick === 0) return null;
            const c = breakToSvgCoords(tick, tick, width(), height(), range(), padding);
            return (
              <>
                {/* Vertical grid line */}
                <line
                  x1={c.x}
                  y1={padding}
                  x2={c.x}
                  y2={height() - padding}
                  stroke="rgba(255, 255, 255, 0.08)"
                  stroke-dasharray="2,2"
                />
                {/* Horizontal grid line */}
                <line
                  x1={padding}
                  y1={c.y}
                  x2={width() - padding}
                  y2={c.y}
                  stroke="rgba(255, 255, 255, 0.08)"
                  stroke-dasharray="2,2"
                />
              </>
            );
          }}
        </For>

        {/* Major Axis Lines (0, 0) */}
        <line
          x1={origin().x}
          y1={padding}
          x2={origin().x}
          y2={height() - padding}
          stroke="rgba(255, 255, 255, 0.3)"
          stroke-width="1.2"
        />
        <line
          x1={padding}
          y1={origin().y}
          x2={width() - padding}
          y2={origin().y}
          stroke="rgba(255, 255, 255, 0.3)"
          stroke-width="1.2"
        />

        {/* Origin zero marker */}
        <circle
          cx={origin().x}
          cy={origin().y}
          r="2.5"
          fill="rgba(255, 255, 255, 0.5)"
        />

        {/* Axis Labels */}
        <text
          x={width() - padding + 2}
          y={origin().y + 3}
          fill="#888"
          font-size="9"
          text-anchor="start"
        >
          +HB
        </text>
        <text
          x={padding - 2}
          y={origin().y + 3}
          fill="#888"
          font-size="9"
          text-anchor="end"
        >
          -HB
        </text>
        <text
          x={origin().x}
          y={padding - 4}
          fill="#888"
          font-size="9"
          text-anchor="middle"
        >
          +IVB
        </text>
        <text
          x={origin().x}
          y={height() - padding + 12}
          fill="#888"
          font-size="9"
          text-anchor="middle"
        >
          -IVB
        </text>

        {/* Pitch Break Dots */}
        <For each={props.pitches}>
          {(p) => {
            if (!p.breakVector) return null;
            const coord = breakToSvgCoords(
              p.breakVector.hBreakInches,
              p.breakVector.vBreakInches,
              width(),
              height(),
              range(),
              padding,
            );
            const isPicked = p === props.picked;
            const [r, g, b] = pitchColor(p.pitchType);

            return (
              <circle
                cx={coord.x}
                cy={coord.y}
                r={isPicked ? 4.5 : 3}
                fill={`rgb(${r}, ${g}, ${b})`}
                opacity={isPicked ? 1 : 0.75}
                stroke={isPicked ? "#fff" : "rgba(0,0,0,0.4)"}
                stroke-width={isPicked ? 1.5 : 0.8}
                style={{ cursor: "pointer", transition: "r 0.15s, opacity 0.15s" }}
                onMouseEnter={() => props.onPick?.(p)}
                onClick={() => props.onPick?.(p)}
              >
                <title>{`${p.pitchType}: IVB ${p.breakVector.vBreakInches.toFixed(1)}" HB ${p.breakVector.hBreakInches.toFixed(1)}"`}</title>
              </circle>
            );
          }}
        </For>

        {/* Emphasized Picked Pitch Ring */}
        <Show when={pickedCoord()}>
          {(coord) => (
            <circle
              cx={coord().x}
              cy={coord().y}
              r="7"
              fill="none"
              stroke="#ffd700"
              stroke-width="2"
              stroke-dasharray="3,2"
              pointer-events="none"
            />
          )}
        </Show>
      </svg>
    </div>
  );
}
