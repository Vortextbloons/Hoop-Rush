export class SeasonPostseasonInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonPostseasonInvariantError';
  }
}
export class SeasonPostseasonContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeasonPostseasonContextError';
  }
}
