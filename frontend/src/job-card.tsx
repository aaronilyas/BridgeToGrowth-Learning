import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Job, canCancel, isTerminal, jobMessage, pollDelay } from './job-policy';
import { cancelAndReconcile } from './jobs';
import { ApiError } from './http';
import { useLifecycle, useRuntime, useSession } from './provider';
import { Button, Notice, styles, useAction, useClock } from './ui';
export function JobCard({ id, onEdit }: { id: string; onEdit: () => void }) {
  const { session, http, queryClient } = useRuntime(), state = useSession(), { online, active } = useLifecycle();
  const receiptChecks = useRef(0), errors = useRef(0), lastJob = useRef<Job | undefined>(undefined), action = useAction(), now = useClock();
  const [cancelMessage, setCancelMessage] = useState('');
  const key = ['account', state.account?.id, session.version, 'job', id];
  const query = useQuery({ queryKey: key, queryFn: async ({ signal }) => {
    if (lastJob.current?.status === 'accepted') receiptChecks.current++;
    try {
      const job = await session.request<Job>(`/lessons/${id}`, undefined, undefined, signal);
      errors.current = 0; lastJob.current = job; return job;
    } catch (error) { errors.current++; throw error; }
  }, enabled: online && active && state.phase === 'signedIn', refetchInterval: q => {
    if (errors.current >= 8 || (q.state.error instanceof ApiError && q.state.error.status === 404)) return false;
    const delay = pollDelay(q.state.data, { online, active, errors: errors.current, receiptChecks: receiptChecks.current });
    return delay === false ? false : Math.max(delay, http.blockedUntil - Date.now());
  }, refetchIntervalInBackground: false });
  const refetch = query.refetch;
  useEffect(() => {
    if (online && active && (!lastJob.current || !isTerminal(lastJob.current) || lastJob.current.cleanup_pending || pollDelay(lastJob.current, { online, active, errors: 0, receiptChecks: receiptChecks.current }) !== false)) void refetch();
  }, [online, active, refetch]);
  const job = query.data;
  const cancel = async () => {
    setCancelMessage('Cancellation requested. Checking the authoritative outcome.');
    try { const current = await cancelAndReconcile(session, id); queryClient.setQueryData(key, current); lastJob.current = current; }
    finally { await query.refetch(); }
  };
  const paused = !online || !active || now < http.blockedUntil;
  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.label}>Lesson {id.slice(0, 8)}</Text>
    {job ? <>
      <Text style={styles.label}>Status: {job.status.replaceAll('_', ' ')}</Text>
      <Text accessibilityLiveRegion="polite" style={styles.body}>{jobMessage(job)}</Text>
      {(!isTerminal(job) || job.cleanup_pending) && <ActivityIndicator accessibilityLabel="Lesson work or cleanup is in progress" />}
      {job.cleanup_pending && <Notice text="Cleanup is still pending. The final outcome does not yet mean temporary processing resources are released." />}
      {job.evaluation?.findings && <Text style={styles.body}>Review feedback: {job.evaluation.findings}</Text>}
      {(job.status === 'needs_breakdown' || job.status === 'failed' || job.status === 'interrupted') && <Button label="Edit topic for a new request" onPress={onEdit} secondary />}
      {canCancel(job) && <Button label="Request cancellation" onPress={() => void action.run(cancel)} disabled={paused} busy={action.busy} secondary />}
      {(job.status === 'delivering' || job.status === 'accepted' || job.status === 'delivery_unknown') && <Text style={styles.body}>A message already sent cannot be retracted.</Text>}
    </> : <Text style={styles.body}>{query.isFetching ? 'Checking lesson status…' : 'Status has not been checked.'}</Text>}
    {cancelMessage && <Text style={styles.body}>{cancelMessage}</Text>}
    {(!online || query.isError) && <Notice text="Progress may be stale. The displayed outcome is the last confirmed snapshot." />}
    {query.error && <Notice text={query.error.message} />}{action.error && <Notice text={action.error} />}
    {query.dataUpdatedAt > 0 && <Text style={styles.body}>Last checked: {new Date(query.dataUpdatedAt).toLocaleTimeString()}</Text>}
    <Button label="Refresh status" onPress={() => { errors.current = 0; void query.refetch(); }} disabled={paused || query.isFetching || action.busy} secondary />
  </View>;
}
