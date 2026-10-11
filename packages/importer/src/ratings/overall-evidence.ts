import { join } from 'node:path';
import { overallSeasonEvidenceSchema, type OverallSeasonEvidence } from '@hoop-rush/data-contracts';
import { fileExists, readJson } from '../json.ts';
import { NBA_ROOT } from '../config.ts';
import { z } from 'zod';

const trackingEvidenceSchema = z.object({
  defFgPct: z.number().min(0).max(1).nullable().optional(),
  defRimFga: z.number().finite().nonnegative().nullable().optional(),
  secondaryAssists: z.number().finite().nonnegative().nullable().optional(),
  potentialAssists: z.number().finite().nonnegative().nullable().optional(),
});

type OverallTracking = z.infer<typeof trackingEvidenceSchema> & { leagueRimFgPct: number | null };

export function loadOverallTracking(season: string): Map<string, OverallTracking> {
  const path = join(NBA_ROOT, season, 'evidence.json');
  if (season < '2013-14' || !fileExists(path)) return new Map();
  const rows = z.record(z.string().min(1), trackingEvidenceSchema).parse(readJson(path));
  let attempts = 0;
  let makes = 0;
  for (const row of Object.values(rows)) {
    if (row.defFgPct == null || row.defRimFga == null) continue;
    attempts += row.defRimFga;
    makes += row.defFgPct * row.defRimFga;
  }
  const leagueRimFgPct = attempts >= 200 ? makes / attempts : null;
  return new Map(Object.entries(rows).map(([id, row]) => [id, { ...row, leagueRimFgPct }]));
}

type PlayerEvidence = OverallSeasonEvidence['players'][string] &
  Pick<OverallSeasonEvidence, 'leagueTrueShooting'>;
export function loadOverallEvidence(season: string, required = false): Map<string, PlayerEvidence> {
  const path = join(NBA_ROOT, season, 'overall-evidence.json');
  if (!fileExists(path)) {
    if (required) throw new Error(`Missing ${season} Overall evidence; run fetch_overall_evidence`);
    return new Map<string, PlayerEvidence>();
  }
  const evidence = overallSeasonEvidenceSchema.parse(readJson(path));
  if (evidence.season !== season) throw new Error('Overall evidence season mismatch');
  return new Map(
    Object.entries(evidence.players).map(([identity, player]) => [
      identity,
      { ...player, leagueTrueShooting: evidence.leagueTrueShooting },
    ]),
  );
}
