import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AuthScreen } from '../src/auth-screen';
export default function Auth() {
  const { mode, phone } = useLocalSearchParams<{ mode?: string; phone?: string }>();
  const selected = mode === 'signup' || mode === 'recovery' ? mode : 'login';
  return <AuthScreen key={`${selected}-${phone ?? ''}`} mode={selected} initialPhone={typeof phone === 'string' ? phone : ''} />;
}
