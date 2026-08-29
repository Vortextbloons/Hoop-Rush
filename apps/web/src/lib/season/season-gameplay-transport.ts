import type { SeasonMultiplayerTransport } from '@hoop-rush/data-contracts';
import type { SeasonDraftState, SeasonLeagueGenerationResult } from '@hoop-rush/data-contracts';
import { loadBootstrap, loadGameplayAssets } from './season-gameplay-bootstrap';

export interface GameplayTransport {
	loadBootstrap(
		roomId: string,
		transport: SeasonMultiplayerTransport,
		draft: SeasonDraftState,
		generation: SeasonLeagueGenerationResult
	): Promise<import('./season-gameplay-bootstrap').GameplayBootstrapResult>;
}

export function createGameplayTransport(): GameplayTransport {
	return {
		async loadBootstrap(roomId, _transport, draft, generation) {
			const { schedule, scheduleHash } = await loadGameplayAssets(fetch);
			const rootSeed = draft.rootSeed;
			const result = await loadBootstrap({
				roomId,
				rootSeed,
				league: draft.league,
				schedule,
				scheduleContentHash: scheduleHash,
				draft,
				generation
			});
			return result;
		}
	};
}
