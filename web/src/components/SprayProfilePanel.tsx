import { For, Show, type JSX } from "solid-js";
import type { SprayProfile } from "../lib/spray-profile";
import { Panel, PanelHeader, THEME } from "./ui";

export interface SprayProfilePanelProps {
  profile: SprayProfile;
  /** Whose contact the profile covers: a spray chart only means something for one arm. */
  pitcherLabel?: string;
  onClose?: () => void;
}

/**
 * Where the contact a pitcher allowed actually went. Sectors are the same five
 * the card's readout names, grounded on the feed's fielder codes; empty sectors
 * stay in the table because "nothing to the opposite field" is an answer.
 */
export default function SprayProfilePanel(props: SprayProfilePanelProps): JSX.Element {
  const th = { padding: "2px 4px", "font-weight": "500" } as const;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const bar = (share: number) => `${Math.max(share * 100, 0)}%`;

  return (
    <Panel label="spray profile" width={330}>
      <PanelHeader
        title="Spray Profile"
        titleColor={THEME.gold}
        onClose={props.onClose}
        closeLabel="Close spray profile"
      />

      <Show when={props.pitcherLabel}>
        <div style={{ color: THEME.muted, "margin-bottom": "6px" }}>{props.pitcherLabel}</div>
      </Show>

      <table style={{ width: "100%", "border-collapse": "collapse", "text-align": "left" }}>
        <thead>
          <tr style={{ "border-bottom": `1px solid ${THEME.border}`, color: THEME.muted }}>
            <th style={th}>Sector</th>
            <th style={th}>Balls</th>
            <th style={th}>Share</th>
            <th style={th}>Avg dist</th>
            <th style={th}>Hard hit</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.profile.sectors}>
            {(s) => (
              <tr
                style={{
                  "border-bottom": "1px solid rgba(255, 255, 255, 0.08)",
                  opacity: s.count === 0 ? 0.45 : 1,
                }}
              >
                <td style={{ padding: "3px 4px" }}>{s.sector}</td>
                <td class="mono" style={{ padding: "3px 4px" }}>
                  {s.count}
                </td>
                <td style={{ padding: "3px 4px" }}>
                  <span style={{ display: "inline-block", width: "46px" }}>
                    <span
                      style={{
                        display: "block",
                        height: "6px",
                        width: bar(s.share),
                        "min-width": s.count ? "2px" : "0",
                        background: THEME.gold,
                        "border-radius": "3px",
                      }}
                    />
                  </span>
                  <span class="mono">{pct(s.share)}</span>
                </td>
                <td class="mono" style={{ padding: "3px 4px" }}>
                  {s.count ? `${Math.round(s.avgDistance)} ft` : "—"}
                </td>
                <td class="mono" style={{ padding: "3px 4px" }}>
                  {s.hardHitShare == null ? "—" : pct(s.hardHitShare)}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <div style={{ color: THEME.muted, "margin-top": "6px" }}>
        {props.profile.total} measured batted balls
        <Show when={props.profile.unplaced > 0}>
          {" · "}
          {props.profile.unplaced} with chart coordinates but no measured distance
        </Show>
      </div>
    </Panel>
  );
}
