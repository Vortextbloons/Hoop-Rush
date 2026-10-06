import type { SeasonLeagueGenerationResult } from '@hoop-rush/data-contracts';
import { matchGuaranteedAnchors, rollExtraEliteAnchors } from './anchors.ts';
import { prepareGenerationState } from './candidates.ts';
import { attachAiProjectionSummaries, finalizeResult } from './finalize.ts';
import { fillPoolsWithRepair } from './pool.ts';
import { selectRosters } from './selection.ts';
import { reportProgress } from './state.ts';
import type { SeasonAiGenerationInput } from './types.ts';

export function generateAiLeague(input: SeasonAiGenerationInput): SeasonLeagueGenerationResult {
  const { state, league } = prepareGenerationState(input);
  reportProgress(state, { phase: 'scouting', completed: 1, total: 1 });
  matchGuaranteedAnchors(state);
  rollExtraEliteAnchors(state);
  reportProgress(state, { phase: 'anchors', completed: 1, total: 1 });
  state.phase = 'pool-fill';
  fillPoolsWithRepair(state);
  state.phase = 'selection';
  selectRosters(state);
  const generation = finalizeResult(state, league, input.humanRosters);
  reportProgress(state, {
    phase: 'done',
    completed: 1,
    total: 1,
    teamsCompleted: [...state.teamOrder],
  });
  if (input.projection !== undefined) {
    return attachAiProjectionSummaries({
      generation,
      catalog: state.catalog,
      eraProfile: input.projection.eraProfile,
      model: input.projection.model,
      seed: input.seed,
    });
  }
  return generation;
}
