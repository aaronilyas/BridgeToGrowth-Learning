import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { AuthScreen } from '../src/auth-screen';
import { LessonScreen } from '../src/lesson-screen';
import { JobCard } from '../src/job-card';
import { AccountScreen } from '../src/account-screen';
import { Lessons } from '../src/lessons';
import { OrderedStorage } from '../src/storage';
import { deferred, harness, job, response, tokens } from './fixtures';
import { Runtime } from '../src/runtime';
let mockRuntime: Runtime;
let mockLifecycle = { online: true, active: true };
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../src/provider', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useRuntime: () => mockRuntime,
    useSession: () => React.useSyncExternalStore(mockRuntime.session.subscribe, mockRuntime.session.snapshot),
    useLifecycle: () => mockLifecycle,
    usePending: () => { React.useSyncExternalStore(mockRuntime.lessons.subscribe, mockRuntime.lessons.snapshot); return mockRuntime.lessons; },
  };
});
async function fixture(signedIn = false) {
  const h = harness(), queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, networkMode: 'always' } } });
  const lessons = new Lessons(h.session, new OrderedStorage(h.storage), () => 'key-for-screen');
  h.clear.mockImplementation(() => { void queryClient.cancelQueries(); queryClient.clear(); lessons.clear(); });
  mockRuntime = { http: h.http, session: h.session, lessons, queryClient }; mockLifecycle = { online: true, active: true };
  if (signedIn) await h.session.install(tokens(), h.session.version); else await h.session.restore();
  return { ...h, queryClient, lessons };
}
async function draw(element: React.ReactElement) { return render(<QueryClientProvider client={mockRuntime.queryClient}>{element}</QueryClientProvider>); }
const challenge = { challenge_id: '44444444-4444-4444-8444-444444444444', expires_in: 600, resend_after: 60, message: 'If eligible' };
it('preserves login passwords exactly, blocks double taps, and installs the session', async () => {
  const h = await fixture(), pending = deferred<Response>(); h.fetcher.mockReturnValueOnce(pending.promise);
  await draw(<AuthScreen mode="login" />);
  await fireEvent.changeText(screen.getByLabelText('Phone number'), ' +15551234567 ');
  await fireEvent.changeText(screen.getByLabelText('Password'), '  password with spaces  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Log in' })); await fireEvent.press(screen.getByRole('button', { name: 'Log in' }));
  expect(h.fetcher).toHaveBeenCalledTimes(1); expect(JSON.parse(h.fetcher.mock.calls[0]?.[1]?.body as string).password).toBe('  password with spaces  ');
  await act(async () => { pending.resolve(response(tokens())); });
  expect(h.session.state.phase).toBe('signedIn'); expect(screen.getByLabelText('Password')).toHaveProp('value', '');
});
it('uses neutral signup messaging, leading-zero string codes, cooldown and expired-challenge controls', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response(challenge, 202)).mockResolvedValueOnce(response(tokens()));
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'performance'] });
  await draw(<AuthScreen mode="signup" />);
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '+15551234567');
  await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough password');
  await fireEvent.press(screen.getByRole('button', { name: 'Request verification' }));
  expect(await screen.findByText(/does not confirm that a message was sent/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Resend available/ })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Six-digit verification code'), '012345');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify phone' }));
  await waitFor(() => expect(h.session.state.phase).toBe('signedIn'));
  expect(JSON.parse(h.fetcher.mock.calls[1]?.[1]?.body as string).code).toBe('012345');
  jest.useRealTimers();
});
it('resends without extending absolute challenge expiry and honors Retry-After', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response(challenge, 202)).mockResolvedValueOnce(response({ resend_after: 60 }, 202));
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'performance'] }); await draw(<AuthScreen mode="recovery" />);
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '+15551234567'); await fireEvent.press(screen.getByRole('button', { name: 'Request verification' }));
  await act(async () => { jest.advanceTimersByTime(61000); });
  await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
  await act(async () => { jest.advanceTimersByTime(540000); });
  expect(screen.getByText('Challenge expired. Start again.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset password' })).toBeDisabled();
  expect(h.fetcher).toHaveBeenCalledTimes(2); jest.useRealTimers();
});
it('requires login after password reset and never installs returned credentials', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response(challenge, 202)).mockResolvedValueOnce(response({ message: 'Account updated; log in again' }));
  await draw(<AuthScreen mode="recovery" />);
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '+15551234567'); await fireEvent.press(screen.getByRole('button', { name: 'Request verification' }));
  await screen.findByLabelText('New password');
  await fireEvent.changeText(screen.getByLabelText('Six-digit verification code'), '000001');
  await fireEvent.changeText(screen.getByLabelText('New password'), '  new password exact  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Reset password' }));
  await waitFor(() => expect(h.session.state.message).toContain('Password reset'));
  expect(h.session.state.phase).toBe('signedOut'); expect(JSON.parse(h.fetcher.mock.calls[1]?.[1]?.body as string).new_password).toBe('  new password exact  ');
});
it('phone changes require the current password and verification, then clear sessions and account data', async () => {
  const h = await fixture(true); h.fetcher.mockResolvedValueOnce(response(challenge, 202)).mockResolvedValueOnce(response({ message: 'Account updated' }));
  await draw(<AuthScreen mode="phone" />);
  expect(screen.getByText(/may still reach your old number/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('New phone number'), '+15557654321'); await fireEvent.changeText(screen.getByLabelText('Current password'), 'current password');
  await fireEvent.press(screen.getByRole('button', { name: 'Request verification' }));
  await screen.findByLabelText('Six-digit verification code'); await fireEvent.changeText(screen.getByLabelText('Six-digit verification code'), '012345'); await fireEvent.press(screen.getByRole('button', { name: 'Verify phone' }));
  await waitFor(() => expect(h.session.state.phase).toBe('signedOut')); expect(h.session.state.message).toContain('new number'); expect(h.session.state.account).toBeNull();
});
it('the composer starts with voiceover off, displays server recipient, validates and submits once', async () => {
  const h = await fixture(true); h.fetcher.mockResolvedValue(response(job({ status: 'failed', failure_reason: 'Render failed' })));
  await draw(<LessonScreen />);
  expect(screen.getByText('+15551234567')).toBeTruthy(); expect(screen.getByLabelText('Include voiceover')).toHaveProp('value', false);
  expect(screen.getByRole('button', { name: 'Request lesson' })).toBeDisabled();
  await fireEvent.changeText(screen.getByLabelText('Lesson topic'), '  phases of the moon  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Request lesson' }));
  await screen.findByText('Status: failed');
  expect(JSON.parse(h.fetcher.mock.calls[0]?.[1]?.body as string)).toEqual({ topic: 'phases of the moon', voiceover: false });
  expect(h.fetcher.mock.calls.filter(call => call[0].endsWith('/lessons'))).toHaveLength(1);
});
it('lost submission responses expose explicit same-key retry and never replay on reconnect', async () => {
  const h = await fixture(true); h.fetcher.mockRejectedValueOnce(new Error('lost'));
  const tree = await draw(<LessonScreen />);
  await fireEvent.changeText(screen.getByLabelText('Lesson topic'), 'moon'); await fireEvent.press(screen.getByRole('button', { name: 'Request lesson' }));
  await screen.findByRole('button', { name: 'Retry the same request' }); expect(h.fetcher).toHaveBeenCalledTimes(1);
  mockLifecycle = { online: false, active: true }; await tree.rerender(<QueryClientProvider client={h.queryClient}><LessonScreen /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: 'Retry the same request' })).toBeDisabled();
  mockLifecycle = { online: true, active: true }; await tree.rerender(<QueryClientProvider client={h.queryClient}><LessonScreen /></QueryClientProvider>);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
});
it('job polling pauses in background and offline, reconciles on return, and stops after terminal cleanup', async () => {
  const h = await fixture(true); h.fetcher.mockResolvedValue(response(job({ status: 'rendering', cleanup_pending: true })));
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'performance'] }); const tree = await draw(<JobCard id={job().id} onEdit={jest.fn()} />);
  await screen.findByText('Status: rendering'); const baseline = h.fetcher.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(4100); }); expect(h.fetcher.mock.calls.length).toBeGreaterThan(baseline);
  mockLifecycle = { online: true, active: false }; await tree.rerender(<QueryClientProvider client={h.queryClient}><JobCard id={job().id} onEdit={jest.fn()} /></QueryClientProvider>);
  const background = h.fetcher.mock.calls.length; await act(async () => { jest.advanceTimersByTime(12000); }); expect(h.fetcher).toHaveBeenCalledTimes(background);
  mockLifecycle = { online: false, active: true }; await tree.rerender(<QueryClientProvider client={h.queryClient}><JobCard id={job().id} onEdit={jest.fn()} /></QueryClientProvider>);
  await act(async () => { jest.advanceTimersByTime(12000); }); expect(h.fetcher).toHaveBeenCalledTimes(background);
  h.fetcher.mockResolvedValue(response(job({ status: 'cancelled', cleanup_pending: false })));
  mockLifecycle = { online: true, active: true }; await tree.rerender(<QueryClientProvider client={h.queryClient}><JobCard id={job().id} onEdit={jest.fn()} /></QueryClientProvider>);
  await screen.findByText('Status: cancelled'); const terminal = h.fetcher.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(60000); }); expect(h.fetcher).toHaveBeenCalledTimes(terminal); jest.useRealTimers();
});
it('briefly checks acceptance receipts then offers manual refresh, never resends ambiguous delivery', async () => {
  const h = await fixture(true); h.fetcher.mockResolvedValue(response(job({ status: 'accepted', photon_accepted: true, provider_message_id: 'message' })));
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'performance'] }); await draw(<JobCard id={job().id} onEdit={jest.fn()} />); await screen.findByText(/Photon accepted/);
  for (let i = 0; i < 12; i++) await act(async () => { jest.advanceTimersByTime(4100); });
  const count = h.fetcher.mock.calls.length; expect(count).toBeLessThanOrEqual(9);
  await act(async () => { jest.advanceTimersByTime(60000); }); expect(h.fetcher).toHaveBeenCalledTimes(count);
  await fireEvent.press(screen.getByRole('button', { name: 'Refresh status' })); await waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(count + 1));
  expect(h.fetcher.mock.calls.every(call => call[1]?.method === 'GET')).toBe(true); jest.useRealTimers();
});
it('shows the account verification state and performs logout-all', async () => {
  const h = await fixture(true); h.fetcher.mockImplementation(async url => response(url.endsWith('logout-all') ? null : tokens().account, url.endsWith('logout-all') ? 204 : 200));
  await draw(<AccountScreen />); expect(screen.getByText('Phone verified')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Log out everywhere' }));
  await waitFor(() => expect(h.session.state.phase).toBe('signedOut')); expect(h.fetcher.mock.calls.some(call => call[0].endsWith('logout-all'))).toBe(true);
});
afterEach(() => { mockRuntime.queryClient.clear(); jest.useRealTimers(); });

it('bounds verification attempts and does not reset them on resend', async () => {
  const h = await fixture(); h.fetcher.mockResolvedValueOnce(response(challenge, 202)).mockResolvedValue(response({}, 400));
  await draw(<AuthScreen mode="signup" />);
  await fireEvent.changeText(screen.getByLabelText('Phone number'), '+15551234567'); await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough password');
  await fireEvent.press(screen.getByRole('button', { name: 'Request verification' })); await screen.findByLabelText('Six-digit verification code');
  for (let i = 0; i < 5; i++) { await fireEvent.changeText(screen.getByLabelText('Six-digit verification code'), '000000'); await fireEvent.press(screen.getByRole('button', { name: 'Verify phone' })); await waitFor(() => expect(screen.getByLabelText('Six-digit verification code')).toHaveProp('value', '')); }
  expect(screen.getByText('No verification attempts left. Start again.')).toBeTruthy(); expect(screen.getByRole('button', { name: 'Verify phone' })).toBeDisabled(); expect(h.fetcher).toHaveBeenCalledTimes(6);
});
it('backs off progress errors and eventually leaves an unavailable job to manual refresh', async () => {
  const h = await fixture(true); h.fetcher.mockResolvedValue(response({}, 404));
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'performance'] });
  await draw(<JobCard id={job().id} onEdit={jest.fn()} />); await screen.findByText('This lesson is unavailable for this account.');
  const count = h.fetcher.mock.calls.length; await act(async () => { jest.advanceTimersByTime(60000); }); expect(h.fetcher).toHaveBeenCalledTimes(count);
});
