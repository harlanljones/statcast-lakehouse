import { For, Show, createEffect, createMemo, type JSX } from "solid-js";
import type { PitchDatum } from "../lib/deck-layers";
import { pitchColor } from "../lib/deck-layers";
import {
  breakToSvgCoords,
  breakGridTicks,
  nearestDot,
  DEFAULT_BREAK_RANGE_INCHES,
  type BreakDot,
} from "../lib/break-chart-math";
import { Panel, PanelHeader, THEME } from "./ui";

export interface BreakChartProps {
  pitches: PitchDatum[];
  picked?: PitchDatum | null;
  onPick?: (pitch: PitchDatum | null) => void;
  width?: number;
  height?: number;
  range?: number;
}

const AXIS_LABEL_PX = "11";

/**
 * 2D Aerodynamic Movement Profile (Break Chart: IVB vs HB).
 * Plots Induced Vertical Break vs Horizontal Break in inches.
 * Center (0, 0) represents the ghost pitch trajectory without Magnus acceleration.
 *
 * The dots are drawn on a HiDPI canvas (a few thousand dots stay cheap, and
 * hover is a nearest-dot scan on mousemove); the grid, axes, labels and the
 * picked ring are SVG on top.
 */
export default function BreakChart(props: BreakChartProps): JSX.Element {
  const width = () => props.width ?? 210;
  const height = () => props.height ?? 210;
  const range = () => props.range ?? DEFAULT_BREAK_RANGE_INCHES;
  const padding = 22;

  let wrap!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;

  const ticks = () => breakGridTicks(range(), 10);
  const origin = () => breakToSvgCoords(0, 0, width(), height(), range(), padding);

  const dots = createMemo<BreakDot<PitchDatum>[]>(() => {
    const out: BreakDot<PitchDatum>[] = [];
    for (const p of props.pitches) {
      if (!p.breakVector) continue;
      const c = breakToSvgCoords(p.breakVector.hBreakInches, p.breakVector.vBreakInches, width(), height(), range(), padding);
      out.push({ x: c.x, y: c.y, item: p });
    }
    return out;
  });

  const pickedCoord = () => {
    if (!props.picked?.breakVector) return null;
    const bv = props.picked.breakVector;
    return breakToSvgCoords(bv.hBreakInches, bv.vBreakInches, width(), height(), range(), padding);
  };

  createEffect(() => {
    const w = width();
    const h = height();
    const all = dots();
    const picked = props.picked;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    let pickedDot: BreakDot<PitchDatum> | null = null;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.globalAlpha = 0.75;
    for (const d of all) {
      if (d.item === picked) {
        pickedDot = d;
        continue;
      }
      const [r, g, b] = pitchColor(d.item.pitchType);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (pickedDot) {
      const [r, g, b] = pitchColor(pickedDot.item.pitchType);
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pickedDot.x, pickedDot.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  const hit = (e: MouseEvent) => {
    const r = wrap.getBoundingClientRect();
    return nearestDot(dots(), e.clientX - r.left, e.clientY - r.top);
  };
  const onMove = (e: MouseEvent) => {
    const h = hit(e);
    wrap.style.cursor = h ? "pointer" : "default";
    const bv = h?.item.breakVector;
    wrap.title = h && bv ? `${h.item.pitchType}: IVB ${bv.vBreakInches.toFixed(1)}" HB ${bv.hBreakInches.toFixed(1)}"` : "";
    if (h && h.item !== props.picked) props.onPick?.(h.item);
  };
  const onClick = (e: MouseEvent) => {
    const h = hit(e);
    if (h) props.onPick?.(h.item);
  };

  return (
    <Panel label="pitch movement profile break chart" width={width() + 30}>
      <PanelHeader title="Movement Profile" subtitle="IVB vs HB (in)" />
      <div
        ref={wrap}
        style={{ position: "relative", width: `${width()}px`, height: `${height()}px` }}
        onMouseMove={onMove}
        onClick={onClick}
      >
        <canvas
          ref={canvas}
          aria-hidden="true"
          style={{ position: "absolute", left: "0", top: "0", width: `${width()}px`, height: `${height()}px` }}
        />
        <svg
          role="img"
          aria-label={`Break chart: induced vertical break against horizontal break for ${dots().length} pitches`}
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          style={{ position: "absolute", left: "0", top: "0", overflow: "visible", "pointer-events": "none" }}
        >
          {/* Background plot area */}
          <rect
            x={padding}
            y={padding}
            width={width() - 2 * padding}
            height={height() - 2 * padding}
            fill="none"
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
                  <line x1={c.x} y1={padding} x2={c.x} y2={height() - padding} stroke="rgba(255, 255, 255, 0.08)" stroke-dasharray="2,2" />
                  <line x1={padding} y1={c.y} x2={width() - padding} y2={c.y} stroke="rgba(255, 255, 255, 0.08)" stroke-dasharray="2,2" />
                </>
              );
            }}
          </For>

          {/* Major axis lines (0, 0) */}
          <line x1={origin().x} y1={padding} x2={origin().x} y2={height() - padding} stroke="rgba(255, 255, 255, 0.3)" stroke-width="1.2" />
          <line x1={padding} y1={origin().y} x2={width() - padding} y2={origin().y} stroke="rgba(255, 255, 255, 0.3)" stroke-width="1.2" />
          <circle cx={origin().x} cy={origin().y} r="2.5" fill="rgba(255, 255, 255, 0.5)" />

          {/* Axis labels */}
          <text x={width() - padding + 2} y={origin().y + 4} fill={THEME.muted} font-size={AXIS_LABEL_PX} text-anchor="start">+HB</text>
          <text x={padding - 2} y={origin().y + 4} fill={THEME.muted} font-size={AXIS_LABEL_PX} text-anchor="end">-HB</text>
          <text x={origin().x} y={padding - 5} fill={THEME.muted} font-size={AXIS_LABEL_PX} text-anchor="middle">+IVB</text>
          <text x={origin().x} y={height() - padding + 13} fill={THEME.muted} font-size={AXIS_LABEL_PX} text-anchor="middle">-IVB</text>

          {/* Emphasized picked pitch ring */}
          <Show when={pickedCoord()}>
            {(coord) => (
              <circle cx={coord().x} cy={coord().y} r="7" fill="none" stroke={THEME.gold} stroke-width="2" stroke-dasharray="3,2" />
            )}
          </Show>
        </svg>
      </div>
    </Panel>
  );
}
