/**
 * Raw season-stats row consumed by rating derivation. Values are untyped at the
 * boundary and normalized with safeFloat/safeInt (Python `float(x or 0)`).
 */
export type StatsRow = Record<string, unknown>;
