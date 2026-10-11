import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { configuredRuntime } from '../src/runtime';
import { Provider, useRuntime, useSession } from '../src/provider';
import { Button, Notice, Screen, styles } from '../src/ui';
export function SessionRoutes() {
  const state = useSession(), { session } = useRuntime();
  if (state.phase === 'restoring') return <Screen title="Restoring your session" topInset><ActivityIndicator accessibilityLabel="Restoring session" /></Screen>;
  if (state.phase === 'restoreError') return <Screen title="Session unavailable" topInset><Notice text={state.message} /><Button label="Retry session restoration" onPress={() => void session.restore()} /><Button label="Log out locally" onPress={() => void session.end('Logged out locally; server revocation was not confirmed.')} secondary /></Screen>;
  return <Stack screenOptions={{ headerTintColor: '#183b35', headerStyle: { backgroundColor: '#f6f7f2' } }}>
    <Stack.Protected guard={state.phase === 'signedOut'}><Stack.Screen name="auth" options={{ title: 'BridgeToGrowth' }} /></Stack.Protected>
    <Stack.Protected guard={state.phase === 'signedIn'}><Stack.Screen name="(protected)" options={{ headerShown: false }} /></Stack.Protected>
  </Stack>;
}
export default function Layout() {
  const [configuration] = useState(() => { try { return { runtime: configuredRuntime(), error: '' }; } catch (error) { return { runtime: null, error: error instanceof Error ? error.message : 'Invalid API configuration.' }; } });
  return <SafeAreaProvider><StatusBar style="dark" />{configuration.runtime ? <Provider runtime={configuration.runtime}><SessionRoutes /></Provider> : <View style={[styles.safe, { padding: 24, justifyContent: 'center' }]}><Text style={styles.title}>Setup required</Text><Text style={styles.body}>{configuration.error}</Text></View>}</SafeAreaProvider>;
}
