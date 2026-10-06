import { join } from 'node:path';
import { overallSeasonEvidenceSchema, type OverallSeasonEvidence } from '@hoop-rush/data-contracts';
import { fileExists, readJson } from '../json.ts';
import { NBA_ROOT } from '../config.ts';

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
