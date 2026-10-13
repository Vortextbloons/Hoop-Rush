export interface GameScoreboardTeam {
  key: string;
  label: string;
  score: number | string;
  align?: 'start' | 'center' | 'end';
  winner?: boolean;
}
