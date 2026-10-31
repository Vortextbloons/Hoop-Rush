import type {
  CapRushApronFact,
  CapRushMultiplayerLockedInputs,
  HavocTeamInput,
} from '@hoop-rush/data-contracts';
import { CAP_RUSH_RULES_VERSION } from '@hoop-rush/data-contracts';
import type { ApronRuntimeHooks } from '../../../sim/apron-runtime.ts';
import { capRushApronRuntimeFor, type CapRushApronRuntime } from '../apron-runtime.ts';

export interface CapRushMultiplayerApron {
  readonly hooks: ApronRuntimeHooks;
  readonly facts: () => readonly CapRushApronFact[];
}

function runtimeFor(
  locked: CapRushMultiplayerLockedInputs,
  team: HavocTeamInput,
  side: 'home' | 'away',
): CapRushApronRuntime | undefined {
  const seat =
    locked.seats.p1.franchise.franchiseId === team.teamId
      ? locked.seats.p1
      : locked.seats.p2.franchise.franchiseId === team.teamId
        ? locked.seats.p2
        : undefined;
  if (seat === undefined) return undefined;
  return capRushApronRuntimeFor(
    {
      versionSet: { rulesVersion: CAP_RUSH_RULES_VERSION },
      payrollStatus: seat.payrollStatus,
      target: seat.target,
      human: seat.team,
    },
    side,
  );
}

/**
 * Both human teams can carry apron status. The battle harness accepts one hooks object, so the
 * two side-scoped runtimes are composed here instead of changing the harness.
 */
export function capRushMultiplayerApronFor(input: {
  readonly locked: CapRushMultiplayerLockedInputs;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}): CapRushMultiplayerApron | undefined {
  const home = runtimeFor(
    input.locked,
    capRushMultiplayerTeam(input.locked, input.homeTeamId),
    'home',
  );
  const away = runtimeFor(
    input.locked,
    capRushMultiplayerTeam(input.locked, input.awayTeamId),
    'away',
  );
  if (home === undefined && away === undefined) return undefined;
  const runtimes = [home, away].filter(
    (entry): entry is CapRushApronRuntime => entry !== undefined,
  );
  return {
    hooks: {
      beginPossession(offense) {
        for (const runtime of runtimes) runtime.beginPossession(offense);
      },
      endPossession() {
        for (const runtime of runtimes) runtime.endPossession();
      },
      forcedActor(team) {
        for (const runtime of runtimes) {
          const actor = runtime.forcedActor(team);
          if (actor !== null) return actor;
        }
        return null;
      },
      struckDefender(team) {
        for (const runtime of runtimes) {
          const defender = runtime.struckDefender(team);
          if (defender !== null) return defender;
        }
        return null;
      },
      passInterceptionChance(offense) {
        let chance = 0;
        for (const runtime of runtimes) {
          chance = Math.max(chance, runtime.passInterceptionChance(offense));
        }
        return chance;
      },
      onPassIntercepted(passer, defender) {
        for (const runtime of runtimes) runtime.onPassIntercepted(passer, defender);
      },
    },
    facts: () => runtimes.flatMap((runtime) => [...runtime.recordedFacts()]),
  };
}

function capRushMultiplayerTeam(
  locked: CapRushMultiplayerLockedInputs,
  teamId: string,
): HavocTeamInput {
  if (locked.seats.p1.franchise.franchiseId === teamId) return locked.seats.p1.team;
  if (locked.seats.p2.franchise.franchiseId === teamId) return locked.seats.p2.team;
  const opponent = locked.opponents.find((entry) => entry.team.teamId === teamId);
  if (opponent === undefined) throw new Error(`cap rush multiplayer: unknown team ${teamId}`);
  return opponent.team;
}
