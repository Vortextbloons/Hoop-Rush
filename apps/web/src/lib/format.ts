export function percentOneDecimal(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function oneDecimal(value: number): string {
  return value.toFixed(1);
}
