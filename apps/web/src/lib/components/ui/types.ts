export type ButtonTone = 'default' | 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';
export type BadgeTone = 'neutral' | 'primary' | 'accent' | 'positive' | 'negative';

export type ScheduleCellState = 'upcoming' | 'win' | 'loss' | 'neutral';

export interface ScheduleCell {
  key: string;
  label: string;
  sublabel?: string | null;
  state: ScheduleCellState;
  selectable?: boolean;
  selected?: boolean;
}

export interface ComparisonRow {
  label: string;
  left: string | number;
  right: string | number;
  note?: string | null;
  highlight?: 'left' | 'right' | null;
  bold?: boolean;
}

export interface BoxScoreTeam {
  name: string;
  score: string | number;
  periods?: readonly (string | number)[];
  isUser?: boolean;
}

export interface SeriesRecapGame {
  gameNumber: number;
  won: boolean;
  score: string;
  overtime?: boolean;
  standout?: string | null;
}
