import { describe, expect, test } from 'bun:test';
import { havocBattleInputSchema, havocGameInputSchema } from '@hoop-rush/data-contracts';
import { buildHavocGameInput } from '@hoop-rush/test-fixtures';
import { soloToBattleInputValidated } from './battle-adapters.ts';

describe('solo to battle input relabel', () => {
  test('relabelled solo input satisfies the battle input contract', () => {
    const input = havocGameInputSchema.parse(buildHavocGameInput());
    const battle = soloToBattleInputValidated(input);
    expect(havocBattleInputSchema.safeParse(battle).success).toBe(true);
    expect(battle.home.side).toBe('home');
    expect(battle.away.side).toBe('away');
  });

  test('relabel copies every non-side field', () => {
    const input = havocGameInputSchema.parse(buildHavocGameInput());
    const battle = soloToBattleInputValidated(input);
    const { humanSide: _humanSide, ...soloRest } = input;
    void _humanSide;
    expect({ ...battle, home: undefined, away: undefined }).toEqual({
      ...soloRest,
      home: undefined,
      away: undefined,
    });
  });
});
