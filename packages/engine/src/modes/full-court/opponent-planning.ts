import type {
  EraSimulationProfile,
  FullCourtTactics,
  SimulationTeam,
} from '@hoop-rush/data-contracts';
import { projectExpectedPoints } from '../../projection/expected-ledger.ts';
import {
  meanTripSeconds,
  REGULATION_PERIOD_SECONDS as PERIOD_SECONDS,
  REGULATION_TOTAL_SECONDS,
} from '../../sim/clock.ts';
import { prepareTeam } from '../../sim/prepare.ts';
import type { FullCourtTeamGameInput } from './game.ts';
import {
  allocateSeconds,
  drainedEnergy,
  fatigueLevelOf,
  fatiguedPlayer,
  FULL_COURT_MAX_PLAYER_SECONDS,
  FULL_COURT_REGULATION_TEAM_SECONDS,
  planSubstitution,
  recoveredEnergy,
  resolveRotationPlan,
} from './rotation.ts';
import {
  applyFullCourtTacticsToPrep,
  fullCourtMakeAdjustment,
  fullCourtPaceMultiplier,
  fullCourtPressureEnergyScale,
  fullCourtProfiledPace,
  fullCourtTurnoverAdjustment,
  resolveFullCourtTactics,
} from './tactics.ts';

const STEP_SECONDS = 120;
const SAMPLE_SECONDS = [240, 1320, 2760];

function projectedLineups(
  team: FullCourtTeamGameInput,
  tactics: FullCourtTactics,
): SimulationTeam[] {
  const plan = resolveRotationPlan(team.roster, team.rotation, team.availability);
  const slots = [...plan.startingSlots];
  const energies = [...plan.startingEnergy];
  const playedSeconds = plan.roster.map(() => 0);
  const fouls = plan.roster.map(() => 0);
  const emergency = plan.roster.map(() => false);
  const stintSeconds = slots.map(() => 0);
  const samples: SimulationTeam[] = [];
  for (let seconds = 0; seconds < REGULATION_TOTAL_SECONDS; seconds += STEP_SECONDS) {
    const periodSecondsRemaining = PERIOD_SECONDS - (seconds % PERIOD_SECONDS);
    if (seconds > 0) {
      const decision = planSubstitution(
        { plan, slots, energies, fouls, emergency, playedSeconds, stintSeconds },
        {
          globalSeconds: seconds,
          period: Math.floor(seconds / PERIOD_SECONDS),
          periodSecondsRemaining,
          scoreMargin: 0,
        },
      );
      if (decision.kind === 'swap') {
        slots[decision.slot] = decision.inIndex;
        stintSeconds[decision.slot] = 0;
      }
    }
    if (SAMPLE_SECONDS.includes(seconds)) {
      samples.push({
        teamId: team.teamId,
        displayName: team.displayName,
        players: slots.map((index) => {
          const player = plan.roster[index];
          if (player === undefined)
            throw new Error('Projected lineup has an invalid rotation slot');
          return fatiguedPlayer(player, fatigueLevelOf(energies[index] ?? 1));
        }),
      });
      if (samples.length === SAMPLE_SECONDS.length) break;
    }
    for (const [index, stamina] of plan.stamina.entries()) {
      const energy = energies[index] ?? 1;
      if (slots.includes(index)) {
        energies[index] = drainedEnergy(
          energy,
          stamina,
          STEP_SECONDS * fullCourtPressureEnergyScale(tactics),
        );
        playedSeconds[index] = (playedSeconds[index] ?? 0) + STEP_SECONDS;
      } else {
        energies[index] = recoveredEnergy(energy, STEP_SECONDS);
      }
    }
    for (const [slot, secondsPlayed] of stintSeconds.entries()) {
      stintSeconds[slot] = secondsPlayed + STEP_SECONDS;
    }
  }
  return samples;
}

export function projectFullCourtMatchup(
  home: FullCourtTeamGameInput,
  away: FullCourtTeamGameInput,
  baseProfile: EraSimulationProfile,
): { readonly home: number; readonly away: number } {
  const homeTactics = resolveFullCourtTactics(home.tactics);
  const awayTactics = resolveFullCourtTactics(away.tactics);
  const profile = fullCourtProfiledPace(
    baseProfile,
    fullCourtPaceMultiplier([homeTactics, awayTactics]),
  );
  const homeLineups = projectedLineups(home, homeTactics);
  const awayLineups = projectedLineups(away, awayTactics);
  let homePoints = 0;
  let awayPoints = 0;
  for (const [index, team] of homeLineups.entries()) {
    const opponent = awayLineups[index];
    if (opponent === undefined) throw new Error('Projected matchup has missing lineup samples');
    const [projectedHome, projectedAway] = projectExpectedPoints({
      team,
      prep: applyFullCourtTacticsToPrep(
        prepareTeam(team, profile),
        team.players,
        profile,
        homeTactics,
        awayTactics.defense,
        home.hierarchy,
      ),
      opponent,
      opponentPrep: applyFullCourtTacticsToPrep(
        prepareTeam(opponent, profile),
        opponent.players,
        profile,
        awayTactics,
        homeTactics.defense,
        away.hierarchy,
      ),
      profile,
      adjustments: [
        {
          make: fullCourtMakeAdjustment(awayTactics.defense) / 1e6,
          turnover: fullCourtTurnoverAdjustment(homeTactics) / 1e6,
        },
        {
          make: fullCourtMakeAdjustment(homeTactics.defense) / 1e6,
          turnover: fullCourtTurnoverAdjustment(awayTactics) / 1e6,
        },
      ],
    });
    homePoints += projectedHome;
    awayPoints += projectedAway;
  }
  const scale =
    REGULATION_TOTAL_SECONDS / (2 * meanTripSeconds(profile) * 100 * homeLineups.length);
  return { home: homePoints * scale, away: awayPoints * scale };
}

export function planFullCourtOpponent<T extends FullCourtTeamGameInput>(
  team: T,
  references: readonly FullCourtTeamGameInput[],
  profile: EraSimulationProfile,
): T {
  const eligible = references.filter((reference) => reference.teamId !== team.teamId);
  if (eligible.length === 0) return team;
  const opponents = eligible.filter(
    (_, index) =>
      index === Math.floor(eligible.length / 4) || index === Math.floor((eligible.length * 3) / 4),
  );
  const baseline = resolveFullCourtTactics(team.tactics);
  const automatic = resolveRotationPlan(team.roster, {}, team.availability);
  const marginOf = (candidate: T): number =>
    opponents.reduce((total, opponent) => {
      const result = projectFullCourtMatchup(candidate, opponent, profile);
      return total + result.home - result.away;
    }, 0) / opponents.length;
  let best = team;
  let bestMargin = marginOf(team);
  const startingFive = automatic.startingSlots.map((index) => {
    const player = team.roster[index];
    if (player === undefined) throw new Error('Automatic lineup has an invalid rotation slot');
    return player.playerId;
  });
  const alternative = { ...team, rotation: { ...team.rotation, startingFive } };
  const alternativeMargin = marginOf(alternative);
  if (alternativeMargin > bestMargin + 0.5) {
    best = alternative;
    bestMargin = alternativeMargin;
  }
  const focusedMinutes = allocateSeconds(
    automatic.targetSeconds.map((seconds, index) =>
      automatic.startingSlots.includes(index) ? seconds * 1.35 : seconds,
    ),
    FULL_COURT_REGULATION_TEAM_SECONDS,
    FULL_COURT_MAX_PLAYER_SECONDS,
  );
  const focused = {
    ...best,
    rotation: {
      ...best.rotation,
      minuteTargets: Object.fromEntries(
        team.roster.map(({ playerId }, index) => [playerId, (focusedMinutes[index] ?? 0) / 60]),
      ),
    },
  };
  const focusedMargin = marginOf(focused);
  if (focusedMargin > bestMargin + 0.5) {
    best = focused;
    bestMargin = focusedMargin;
  }
  const tactics: FullCourtTactics[] = [
    { ...baseline, offense: 'perimeter' },
    { ...baseline, offense: 'interior' },
    { ...baseline, offense: 'ball-movement' },
    { ...baseline, defense: 'protect-paint' },
    { ...baseline, defense: 'pressure' },
  ];
  const rotationChoice = best;
  for (const tactic of tactics) {
    const candidate = { ...rotationChoice, tactics: tactic };
    const margin = marginOf(candidate);
    if (margin > bestMargin + 0.5) {
      best = candidate;
      bestMargin = margin;
    }
  }
  return best;
}
