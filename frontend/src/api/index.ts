/**
 * Single entry point for the API. The app imports `api` from here; it always
 * talks to the real backend.
 */
import type { ApiClient } from './ApiClient';
import { realApi } from './realApi';

export const api: ApiClient = realApi;

export { ApiClientError } from './ApiClient';
export type { ApiClient } from './ApiClient';
