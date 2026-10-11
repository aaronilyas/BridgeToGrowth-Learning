import React, { useEffect } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Account } from './contracts';
import { useLifecycle, useRuntime, useSession } from './provider';
import { Button, Notice, Screen, styles, useAction } from './ui';
export function AccountScreen() {
  const { session } = useRuntime(), state = useSession(), { online, active } = useLifecycle(), action = useAction();
  const query = useQuery({ queryKey: ['account', state.account?.id, session.version, 'profile'], queryFn: ({ signal }) => session.request<Account>('/account', undefined, undefined, signal), enabled: online && active && state.phase === 'signedIn', initialData: state.account ?? undefined });
  const refetch = query.refetch;
  useEffect(() => { if (online && active && state.phase === 'signedIn') void refetch(); }, [online, active, state.phase, refetch]);
  const account = query.data;
  return <Screen title="Your account" subtitle="Manage your verified recipient and sessions.">
    <View style={styles.card}><Text style={styles.label}>Phone number</Text><Text style={styles.body}>{account?.phone_number}</Text><Text style={styles.body}>{account?.phone_verified ? 'Phone verified' : 'Phone not verified'}</Text></View>
    {query.isError && <Notice text={query.error.message} />}
    {(!online || query.isError) && <Notice text="Account details may be stale. Refresh when connected." />}
    <Button label="Refresh account" onPress={() => void query.refetch()} disabled={!online || query.isFetching} secondary />
    <Button label="Change phone number" onPress={() => router.push('/phone')} disabled={action.busy || !online} secondary />
    <Text style={styles.body}>Logout attempts server revocation and clears this device. If revocation cannot be confirmed, other sessions may remain active.</Text>
    <Button label="Log out" onPress={() => void action.run(async () => { await session.logout(); })} busy={action.busy} />
    <Button label="Log out everywhere" onPress={() => void action.run(async () => { await session.logout(true); })} disabled={action.busy} secondary />
    {action.error && <Notice text={action.error} />}
  </Screen>;
}
