export interface PlayerStatColumn<Row> {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  align?: 'start' | 'center' | 'end';
  cellClass?: string;
  totalClass?: string;
  headClass?: string;
  hideBelow?: 'sm' | 'md';
}

export interface PlayerStatsTotals<Row> {
  label?: string;
  value: (column: PlayerStatColumn<Row>) => string | number;
}
