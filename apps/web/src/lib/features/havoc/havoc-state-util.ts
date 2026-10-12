import { HavocServiceError } from '@hoop-rush/application/havoc';

export function errorMessageOf(error: unknown): string {
  if (error instanceof HavocServiceError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
