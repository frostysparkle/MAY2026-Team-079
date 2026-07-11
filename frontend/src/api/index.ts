/**
 * Single entry point for the API. The app imports `api` from here and never
 * cares whether it's talking to the mock or the real backend.
 */
import type { ApiClient } from './ApiClient';
import { env } from '@/config/env';
import { mockApi } from './mock/mockApi';
import { realApi } from './realApi';

export const api: ApiClient = env.useMockApi ? mockApi : realApi;

export { ApiClientError } from './ApiClient';
export type { ApiClient } from './ApiClient';
