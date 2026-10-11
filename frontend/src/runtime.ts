import { QueryClient } from '@tanstack/react-query';
import { apiBaseUrl, Http } from './http';
import { Session } from './session';
import { Lessons } from './lessons';
import { OrderedStorage, secureStorage } from './storage';
export function createRuntime(baseUrl: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 300000, refetchOnWindowFocus: false, refetchOnReconnect: false, networkMode: 'always' }, mutations: { retry: false, networkMode: 'always' } } });
  const storage = new OrderedStorage(secureStorage), http = new Http(baseUrl);
  const session = new Session(http, storage, () => { void queryClient.cancelQueries(); queryClient.clear(); lessons.clear(); });
  const lessons = new Lessons(session, storage);
  return { queryClient, http, session, lessons };
}
export type Runtime = ReturnType<typeof createRuntime>;
export function configuredRuntime() { return createRuntime(apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL)); }
