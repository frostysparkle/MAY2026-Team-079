/**
 * Single entry point for the API. The app imports `api` from here and always
 * talks to the real FastAPI backend through the typed `ApiClient` interface.
 */
import type { ApiClient } from './ApiClient';
import { realApi } from './realApi';

export const api: ApiClient = realApi;

export { ApiClientError } from './ApiClient';
export type { ApiClient } from './ApiClient';
