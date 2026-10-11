import React, { useRef, useState, useEffect } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLifecycle, useRuntime } from './provider';
export function Screen({ title, subtitle, children, topInset = false }: React.PropsWithChildren<{ title: string; subtitle?: string; topInset?: boolean }>) {
  const { online } = useLifecycle();
  return <SafeAreaView style={styles.safe} edges={topInset ? ['top', 'left', 'right', 'bottom'] : ['left', 'right', 'bottom']}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Text style={styles.brand}>BRIDGE TO GROWTH</Text><Text accessibilityRole="header" style={styles.title}>{title}</Text>{subtitle && <Text style={styles.body}>{subtitle}</Text>}{!online && <Notice text="Offline. Requests and progress checks are paused. Reconnect to continue." />}{children}</ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function Notice({ text }: { text: string }) { return <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.notice}>{text}</Text>; }
export function Field({ label, ...props }: TextInputProps & { label: string }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor="#586779" autoCapitalize="none" autoCorrect={false} style={[styles.input, props.multiline && styles.multiline]} {...props} /></View>; }
export function Button({ label, onPress, disabled, busy, secondary }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || busy) && styles.disabled, pressed && { opacity: 0.8 }]}>{busy && <ActivityIndicator color={secondary ? '#124e43' : '#ffffff'} />}<Text style={[styles.buttonText, secondary && styles.secondaryText]}>{label}</Text></Pressable>;
}
export function useClock() { const [now, setNow] = useState(() => Date.now()); useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []); return now; }
export function useAction() {
  const { session } = useRuntime(), lock = useRef(false), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); const version = session.version;
    try { await action(); } catch (failure) { if (mounted.current && version === session.version) setError(failure instanceof Error ? failure.message : 'The request failed. Try again manually.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  return { busy, error, setError, run };
}
export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f6f7f2' },
  content: { padding: 24, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center', paddingBottom: 40 },
  brand: { color: '#246354', fontWeight: '700', letterSpacing: 2, fontSize: 12 },
  title: { fontSize: 32, fontWeight: '700', color: '#183b35' },
  body: { fontSize: 17, lineHeight: 25, color: '#354d49' },
  label: { fontSize: 16, fontWeight: '600', color: '#243e39' },
  field: { gap: 8 }, input: { borderWidth: 1, borderColor: '#899e96', backgroundColor: '#ffffff', borderRadius: 12, padding: 14, fontSize: 18, color: '#183b35' },
  multiline: { minHeight: 140, textAlignVertical: 'top' },
  button: { minHeight: 50, padding: 14, borderRadius: 12, backgroundColor: '#175b4d', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  secondary: { backgroundColor: '#e4ece6', borderWidth: 1, borderColor: '#8ca59a' },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '600', textAlign: 'center' }, secondaryText: { color: '#124e43' }, disabled: { opacity: 0.5 },
  notice: { color: '#663916', fontSize: 16, lineHeight: 23, padding: 14, backgroundColor: '#fff0d9', borderRadius: 12 },
  card: { padding: 18, gap: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#d2ddd4', borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
});
