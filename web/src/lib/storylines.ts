/**
 * Pitcher storyline metadata comes from the small JSON endpoint, separate from
 * the Arrow pitch stream. It is deliberately not attached to every pitch:
 * stories are date-scoped editorial context, not telemetry.
 */
export interface PitcherStoryline {
  playerId: number;
  playerName: string;
  startDate: string;
  endDate: string;
  eventDate: string;
  storylineType: string;
  title: string;
  summary: string;
  sourceUrl: string;
}

interface StorylineResponse {
  player_id: unknown;
  player_name: unknown;
  start_date: unknown;
  end_date: unknown;
  event_date: unknown;
  storyline_type: unknown;
  title: unknown;
  summary: unknown;
  source_url: unknown;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Invalid storyline ${field}`);
  return value;
}

function normalizeStoryline(value: unknown): PitcherStoryline {
  if (!value || typeof value !== "object") throw new Error("Invalid storyline item");
  const item = value as StorylineResponse;
  const playerId = Number(item.player_id);
  if (!Number.isSafeInteger(playerId)) throw new Error("Invalid storyline player_id");
  return {
    playerId,
    playerName: requiredString(item.player_name, "player_name"),
    startDate: requiredString(item.start_date, "start_date"),
    endDate: requiredString(item.end_date, "end_date"),
    eventDate: requiredString(item.event_date, "event_date"),
    storylineType: requiredString(item.storyline_type, "storyline_type"),
    title: requiredString(item.title, "title"),
    summary: requiredString(item.summary, "summary"),
    sourceUrl: requiredString(item.source_url, "source_url"),
  };
}

/** Fetch and validate the date-scoped storyline feed. */
export async function fetchPitcherStorylines(date: string): Promise<PitcherStoryline[]> {
  const res = await fetch(`/pitches/storylines?date=${encodeURIComponent(date)}`);
  if (!res.ok) throw new Error(`fetch storylines: ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) throw new Error("Invalid storylines response");
  return data.map(normalizeStoryline);
}

/** Inclusive ISO-date check, kept pure for a defensive UI-side relevance gate. */
export function isStorylineActiveOn(storyline: Pick<PitcherStoryline, "startDate" | "endDate">, date: string): boolean {
  return storyline.startDate <= date && date <= storyline.endDate;
}

/** Only stories for the card's selected pitcher and partition date. */
export function storylinesForPitcher(
  storylines: readonly PitcherStoryline[],
  pitcherId: number | undefined,
  date: string | undefined,
): PitcherStoryline[] {
  if (pitcherId == null || !date) return [];
  return storylines.filter(
    (storyline) =>
      storyline.playerId === pitcherId && isStorylineActiveOn(storyline, date),
  );
}
