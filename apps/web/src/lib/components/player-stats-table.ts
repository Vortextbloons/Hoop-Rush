export interface PlayerStatColumn<Row> {
  key: string;
  label: string;
  value: (row: Row) => string | number;
  align?: 'start' | 'end';
  cellClass?: string;
  totalClass?: string;
  headClass?: string;
}

export interface PlayerStatsTotals<Row> {
  label?: string;
  value: (column: PlayerStatColumn<Row>) => string | number;
}
