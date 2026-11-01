import { errorMessageOf } from './errors.js';

export type ServiceOpenResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Construct a route's service-backed state without repeating the try/catch.
 * The page still owns the instance and its load call.
 */
export function openService<T>(create: () => T): ServiceOpenResult<T> {
  try {
    return { ok: true, value: create() };
  } catch (error) {
    return { ok: false, error: errorMessageOf(error) };
  }
}
