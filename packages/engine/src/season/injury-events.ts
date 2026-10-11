import type {
  SeasonCompactInjuryEvent,
  SeasonGameSimulationResult,
  SeasonInjuryRecord,
  SeasonRoster,
} from '@hoop-rush/data-contracts';
export interface SeasonInjurySeamEvents {
  removals: readonly {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury';
  }[];
  returns: readonly {
    playerVersionId: string;
    clock: {
      period: number;
      seconds: number;
    };
    reason: 'injury-return';
  }[];
  newInjuries: readonly SeasonInjuryRecord[];
}
export function seasonSideOfPlayer(
  homeRoster: SeasonRoster,
  awayRoster: SeasonRoster,
  playerVersionId: string,
  missing: (playerVersionId: string) => Error,
): 'home' | 'away' {
  if (homeRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'home';
  }
  if (awayRoster.players.some((player) => player.playerVersionId === playerVersionId)) {
    return 'away';
  }
  throw missing(playerVersionId);
}
export function sameGameReturnResolutionsOf(
  newInjuries: readonly SeasonInjuryRecord[],
  result: SeasonGameSimulationResult,
): {
  injuryId: string;
  returned: boolean;
}[] {
  const candidates = newInjuries.filter((record) => record.sameGameReturn);
  if (candidates.length === 0) return [];
  const returnedIds = new Set<string>();
  if (result.outcome === 'completed') {
    for (const side of [result.home, result.away]) {
      for (const ret of side.returns) returnedIds.add(ret.playerVersionId);
    }
  }
  return candidates.map((record) => ({
    injuryId: record.injuryId,
    returned: returnedIds.has(record.playerVersionId),
  }));
}
export function compactSeasonInjuryEvents(input: {
  homeRoster: SeasonRoster;
  awayRoster: SeasonRoster;
  seam: SeasonInjurySeamEvents;
  result: SeasonGameSimulationResult;
  missing: (playerVersionId: string) => Error;
}): SeasonCompactInjuryEvent[] {
  if (input.seam.newInjuries.length === 0) return [];
  const appliedRemovalByPlayer = new Map<string, { period: number; seconds: number }>();
  const appliedReturnByPlayer = new Map<string, { period: number; seconds: number }>();
  if (input.result.outcome === 'completed') {
    for (const event of input.result.removals) {
      appliedRemovalByPlayer.set(event.playerVersionId, {
        period: event.period,
        seconds: event.secondsRemaining,
      });
    }
    for (const side of [input.result.home, input.result.away]) {
      for (const event of side.returns) {
        appliedReturnByPlayer.set(event.playerVersionId, {
          period: event.period,
          seconds: event.secondsRemaining,
        });
      }
    }
  }
  const rolledRemovalByPlayer = new Map(
    input.seam.removals.map((removal) => [removal.playerVersionId, removal.clock]),
  );
  return input.seam.newInjuries.map((record) => {
    const appliedRemoval = appliedRemovalByPlayer.get(record.playerVersionId);
    const rolledRemoval = rolledRemovalByPlayer.get(record.playerVersionId);
    const removedClock = appliedRemoval ?? rolledRemoval ?? { period: 1, seconds: 720 };
    const appliedReturn = appliedReturnByPlayer.get(record.playerVersionId);
    return {
      playerVersionId: record.playerVersionId,
      side: seasonSideOfPlayer(
        input.homeRoster,
        input.awayRoster,
        record.playerVersionId,
        input.missing,
      ),
      type: record.type,
      severity: record.severity,
      removedClock,
      returned: appliedReturn !== undefined,
      returnClock: appliedReturn ?? null,
    };
  });
}
