import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { renderRouter, screen, waitFor, act } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { SessionRoutes } from '../app/_layout';
import { harness, tokens } from './fixtures';
import { Session } from '../src/session';
let mockSession: Session;
jest.mock('../src/provider', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { useRuntime: () => ({ session: mockSession }), useLifecycle: () => ({ online: true, active: true }), useSession: () => React.useSyncExternalStore(mockSession.subscribe, mockSession.snapshot) };
});
async function routes(url = '/account') {
  return renderRouter({
    _layout: () => <SafeAreaProvider><SessionRoutes /></SafeAreaProvider>,
    auth: () => <Text>Public login</Text>,
    '(protected)/_layout': () => <Stack />,
    '(protected)/index': () => <Text>Private lessons</Text>,
    '(protected)/account': () => <Text>Private account</Text>,
  }, { initialUrl: url });
}
it('does not render private deep links before restoring a session', async () => {
  const h = harness(); mockSession = h.session; await routes();
  expect(screen.queryByText('Private account')).toBeNull(); expect(screen.getByLabelText('Restoring session')).toBeTruthy();
  await act(async () => { await mockSession.restore(); });
  await screen.findByText('Public login'); expect(screen.queryByText('Private account')).toBeNull();
});
it('rejects signed-out private deep links and removes protected routes after logout', async () => {
  const h = harness(); mockSession = h.session; await mockSession.restore(); await routes();
  await screen.findByText('Public login');
  await act(async () => { await mockSession.install(tokens(), mockSession.version); });
  await screen.findByText('Private lessons');
  await act(async () => { await mockSession.end(); });
  await screen.findByText('Public login'); await waitFor(() => expect(screen.queryByText('Private lessons')).toBeNull());
});
it('allows a private account deep link only after an installed session', async () => {
  const h = harness(); mockSession = h.session; await mockSession.install(tokens(), mockSession.version); await routes();
  await screen.findByText('Private account'); expect(screen.queryByText('Public login')).toBeNull();
});
