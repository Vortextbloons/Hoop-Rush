import type { FullCourtTactics } from '@hoop-rush/data-contracts';

export const FULL_COURT_HISTORICAL_PRESETS = [
  {
    id: '2016-warriors',
    name: '2016 Warriors',
    description: 'Push the pace and favor perimeter shots.',
    tactics: { pace: 'fast', offense: 'perimeter', defense: 'balanced' },
  },
  {
    id: '2014-spurs',
    name: '2014 Spurs',
    description: 'Move the ball to create more assisted baskets, with extra turnover risk.',
    tactics: { pace: 'balanced', offense: 'ball-movement', defense: 'balanced' },
  },
  {
    id: '2004-pistons',
    name: '2004 Pistons',
    description: 'Slow the game and protect the paint, conceding more perimeter attempts.',
    tactics: { pace: 'slow', offense: 'balanced', defense: 'protect-paint' },
  },
  {
    id: '1996-bulls',
    name: '1996 Bulls',
    description: 'Favor shots inside and pressure the ball at an added energy cost.',
    tactics: { pace: 'balanced', offense: 'interior', defense: 'pressure' },
  },
  {
    id: '2018-rockets',
    name: '2018 Rockets',
    description: 'Favor perimeter shots at a balanced pace.',
    tactics: { pace: 'balanced', offense: 'perimeter', defense: 'balanced' },
  },
] as const satisfies readonly {
  id: string;
  name: string;
  description: string;
  tactics: FullCourtTactics;
}[];
