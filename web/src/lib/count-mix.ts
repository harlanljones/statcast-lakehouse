/**
 * What a pitcher does in each count bucket — the numbers behind the count chips.
 *
 * Scoped to one pitcher by default: a count breakdown only means something for a
 * single arm, and pooling every pitcher in view would average unrelated plans.
 * Buckets are disjoint and complete, so the rows add up to the pitches shown.
 */
import { COUNT_BUCKETS, countBucket, type CountBucket, type PitchDatum } from "./deck-layers";

export interface CountRow {
  bucket: CountBucket;
  label: string;
  pitches: number;
  swings: number;
  /** Swings per pitch; null when the bucket is empty. */
  swingRate: number | null;
  /** Whiffs per swing; null when nothing in the bucket drew a swing. */
  whiffRate: number | null;
  /** Mean release speed (mph); 0 for an empty bucket. */
  avgSpeed: number;
  /** The three most-thrown types in the bucket. */
  topTypes: { type: string; count: number; share: number }[];
}

/**
 * One row per bucket, in display order, for one pitcher (or every pitcher when
 * no id is given). Rows are never dropped: an empty bucket is information.
 */
export function countMix(pitches: readonly PitchDatum[], pitcherId?: number): CountRow[] {
  const acc = new Map<CountBucket, { pitches: number; swings: number; whiffs: number; speed: number; types: Map<string, number> }>();
  for (const { bucket } of COUNT_BUCKETS) {
    acc.set(bucket, { pitches: 0, swings: 0, whiffs: 0, speed: 0, types: new Map() });
  }
  for (const p of pitches) {
    if (pitcherId != null && p.pitcherId !== pitcherId) continue;
    const bucket = countBucket(p.balls, p.strikes);
    if (bucket === null) continue;
    const row = acc.get(bucket)!;
    row.pitches++;
    row.speed += p.releaseSpeed;
    if (p.isSwing) {
      row.swings++;
      if (p.isWhiff) row.whiffs++;
    }
    row.types.set(p.pitchType, (row.types.get(p.pitchType) ?? 0) + 1);
  }
  return COUNT_BUCKETS.map(({ bucket, label }) => {
    const row = acc.get(bucket)!;
    const topTypes = [...row.types.entries()]
      .map(([type, count]) => ({ type, count, share: row.pitches ? count / row.pitches : 0 }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
      .slice(0, 3);
    return {
      bucket,
      label,
      pitches: row.pitches,
      swings: row.swings,
      swingRate: row.pitches ? row.swings / row.pitches : null,
      whiffRate: row.swings ? row.whiffs / row.swings : null,
      avgSpeed: row.pitches ? row.speed / row.pitches : 0,
      topTypes,
    };
  });
}
