/** Game-date availability: GET /pitches/dates -> validated sorted date list. */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Fetch available game dates from `${baseUrl}/dates`.
 *
 * Error behavior (deliberate): a non-200 response resolves to [] rather than
 * throwing — the date list is a convenience affordance, and an unavailable
 * index should degrade to "no selectable dates", not crash the app shell.
 * Entries not matching YYYY-MM-DD are dropped; result is sorted and unique.
 */
export async function fetchAvailableDates(baseUrl = "/pitches"): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/dates`);
  } catch {
    return []; // network failure — same degradation as non-200
  }
  if (!res.ok) return [];
  // A 200 with a malformed body must also degrade to [] (same contract as
  // network failure / non-200), never throw.
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  if (!Array.isArray(body)) return [];
  // Serving returns objects: [{game_date: "2026-09-14", rows: 5000}, ...].
  // Map to the game_date string; plain strings are accepted for backwards
  // compatibility with the original contract.
  const normalized = body.map((d) =>
    d !== null && typeof d === "object" && typeof (d as { game_date?: unknown }).game_date === "string"
      ? (d as { game_date: string }).game_date
      : d,
  );
  const dates = normalized.filter((d): d is string => {
    if (typeof d !== "string" || !DATE_RE.test(d)) return false;
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
  });
  return [...new Set(dates)].sort();
}
