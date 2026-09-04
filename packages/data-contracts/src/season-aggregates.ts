import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_AGGREGATES_VERSION, SEASON_LEADER_DEPTH, SEASON_LEADER_MIN_GAME_SHARE, SEASON_LEADERS_VERSION, SEASON_TEAM_COUNT, } from './season-versions.ts';
export const seasonTeamAggregateSchema = z.object({
    franchiseId: franchiseIdSchema,
    gamesPlayed: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    fieldGoalsMade: z.number().int().nonnegative(),
    fieldGoalsAttempted: z.number().int().nonnegative(),
    threePointersMade: z.number().int().nonnegative(),
    threePointersAttempted: z.number().int().nonnegative(),
    freeThrowsMade: z.number().int().nonnegative(),
    freeThrowsAttempted: z.number().int().nonnegative(),
    offensiveRebounds: z.number().int().nonnegative(),
    defensiveRebounds: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    turnovers: z.number().int().nonnegative(),
    fouls: z.number().int().nonnegative(),
    possessions: z.number().int().nonnegative(),
});
export type SeasonTeamAggregate = z.infer<typeof seasonTeamAggregateSchema>;
export function emptySeasonTeamAggregate(franchiseId: string): SeasonTeamAggregate {
    return {
        franchiseId: franchiseIdSchema.parse(franchiseId),
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
        possessions: 0,
    };
}
export const seasonPlayerAggregateSchema = z.object({
    playerVersionId: playerVersionIdSchema,
    franchiseId: franchiseIdSchema,
    gamesPlayed: z.number().int().nonnegative(),
    appearances: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    seconds: z.number().int().nonnegative(),
    points: z.number().int().nonnegative(),
    fieldGoalsMade: z.number().int().nonnegative(),
    fieldGoalsAttempted: z.number().int().nonnegative(),
    threePointersMade: z.number().int().nonnegative(),
    threePointersAttempted: z.number().int().nonnegative(),
    freeThrowsMade: z.number().int().nonnegative(),
    freeThrowsAttempted: z.number().int().nonnegative(),
    offensiveRebounds: z.number().int().nonnegative(),
    defensiveRebounds: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    turnovers: z.number().int().nonnegative(),
    fouls: z.number().int().nonnegative(),
});
export type SeasonPlayerAggregate = z.infer<typeof seasonPlayerAggregateSchema>;
export function emptySeasonPlayerAggregate(playerVersionId: string, franchiseId: string): SeasonPlayerAggregate {
    return {
        playerVersionId,
        franchiseId: franchiseIdSchema.parse(franchiseId),
        gamesPlayed: 0,
        appearances: 0,
        started: 0,
        seconds: 0,
        points: 0,
        fieldGoalsMade: 0,
        fieldGoalsAttempted: 0,
        threePointersMade: 0,
        threePointersAttempted: 0,
        freeThrowsMade: 0,
        freeThrowsAttempted: 0,
        offensiveRebounds: 0,
        defensiveRebounds: 0,
        assists: 0,
        steals: 0,
        blocks: 0,
        turnovers: 0,
        fouls: 0,
    };
}
export const seasonLeaderCategorySchema = z.enum([
    'points',
    'rebounds',
    'assists',
    'steals',
    'blocks',
    'threePointersMade',
]);
export type SeasonLeaderCategory = z.infer<typeof seasonLeaderCategorySchema>;
export const seasonLeaderEntrySchema = z.object({
    playerVersionId: playerVersionIdSchema,
    franchiseId: franchiseIdSchema,
    gamesPlayed: z.number().int().nonnegative(),
    value: z.number().nonnegative(),
    perGame: z.number().nonnegative(),
});
export type SeasonLeaderEntry = z.infer<typeof seasonLeaderEntrySchema>;
export const seasonLeadersSchema = z.object({
    schemaVersion: z.literal(1),
    leadersVersion: z.literal(SEASON_LEADERS_VERSION),
    minimumGameShare: z.literal(SEASON_LEADER_MIN_GAME_SHARE),
    depth: z.literal(SEASON_LEADER_DEPTH),
    categories: z.object({
        points: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
        rebounds: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
        assists: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
        steals: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
        blocks: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
        threePointersMade: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    }),
});
export type SeasonLeaders = z.infer<typeof seasonLeadersSchema>;
export const seasonAggregatesSchema = z.object({
    schemaVersion: z.literal(1),
    aggregatesVersion: z.literal(SEASON_AGGREGATES_VERSION),
    teams: z.array(seasonTeamAggregateSchema).length(SEASON_TEAM_COUNT),
    players: z
        .array(seasonPlayerAggregateSchema)
        .min(300)
        .max(SEASON_TEAM_COUNT * 15),
});
export type SeasonAggregates = z.infer<typeof seasonAggregatesSchema>;
