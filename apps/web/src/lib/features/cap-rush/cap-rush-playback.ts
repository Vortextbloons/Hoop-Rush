import type { HavocBattleTape } from '@hoop-rush/data-contracts';
import { gamecastBattlePlaybackItems } from '#lib/gamecast/gamecast-battle-playback.js';

export function capRushPlaybackItems(tape: HavocBattleTape) {
  return gamecastBattlePlaybackItems(tape).sort((a, b) => {
    const clock = a.period - b.period || b.clockSeconds - a.clockSeconds;
    if (clock !== 0) return clock;
    const terminal = (item: typeof a) =>
      item.event?.kind === 'game-end' ? 2 : item.event?.kind === 'period-end' ? 1 : 0;
    return terminal(a) - terminal(b);
  });
}
