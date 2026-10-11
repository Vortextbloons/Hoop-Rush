import { HavocServiceError } from './havoc-service-contract.ts';

export function errorMessageOf(error: unknown): string {
  if (error instanceof HavocServiceError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
