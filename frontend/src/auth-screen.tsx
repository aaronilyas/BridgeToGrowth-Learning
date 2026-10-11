import React, { useState } from 'react';
import { Text } from 'react-native';
import { router } from 'expo-router';
import { Challenge, Tokens, codeValid, passwordValid, phoneValid } from './contracts';
import { ApiError } from './http';
import { useLifecycle, useRuntime, useSession } from './provider';
import { Button, Field, Notice, Screen, styles, useAction, useClock } from './ui';
type Mode = 'login' | 'signup' | 'recovery' | 'phone';
export function AuthScreen({ mode, initialPhone = '' }: { mode: Mode; initialPhone?: string }) {
  const { session, http } = useRuntime(), state = useSession(), { online } = useLifecycle();
  const [phone, setPhone] = useState(initialPhone), [password, setPassword] = useState(''), [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<(Challenge & { expiresAt: number; resendAt: number; attempts: number }) | null>(null);
  const [message, setMessage] = useState('');
  const action = useAction(), now = useClock();
  const expired = !!challenge && now >= challenge.expiresAt;
  const exhausted = !!challenge && challenge.attempts >= 5;
  const waiting = now < http.blockedUntil;
  const disabled = action.busy || !online || waiting;
  const start = async () => {
    if (!phoneValid(phone.trim())) throw new Error('Use an international phone number such as +15551234567 (8–15 digits).');
    if (mode !== 'recovery' && !passwordValid(password)) throw new Error('Password must contain 12–128 characters. Spaces are preserved.');
    const version = session.version, requestStartedAt = Date.now();
    try {
      if (mode === 'login') {
        const tokens = await http.request<Tokens>('/auth/login', { phone_number: phone.trim(), password });
        session.assert(version); await session.install(tokens, version, requestStartedAt); return;
      }
      const payload = { phone_number: phone.trim(), ...(mode !== 'recovery' ? { password } : {}) };
      const result = mode === 'phone' ? await session.request<Challenge>('/account/phone', payload) : await http.request<Challenge>(mode === 'signup' ? '/auth/signup' : '/auth/recovery', payload);
      session.assert(version);
      setChallenge({ ...result, expiresAt: requestStartedAt + result.expires_in * 1000, resendAt: Date.now() + result.resend_after * 1000, attempts: 0 });
      setCode(''); setMessage('If eligible, a verification message will be sent. This response does not confirm that a message was sent.');
    } finally { setPassword(''); }
  };
  const verify = async () => {
    if (!challenge || expired || exhausted) throw new Error('This challenge expired or has no attempts left. Start a new request.');
    if (!codeValid(code)) throw new Error('Enter the six-digit code, including any leading zeroes.');
    if (mode === 'recovery' && !passwordValid(password)) throw new Error('New password must contain 12–128 characters.');
    const version = session.version, requestStartedAt = Date.now(), payload = { challenge_id: challenge.challenge_id, code };
    setChallenge({ ...challenge, attempts: challenge.attempts + 1 });
    try {
      if (mode === 'signup') {
        const tokens = await http.request<Tokens>('/auth/verify', payload); session.assert(version); await session.install(tokens, version, requestStartedAt);
      } else {
        if (mode === 'phone') await session.request('/account/phone/verify', payload);
        else await http.request('/auth/reset', { ...payload, new_password: password });
        session.assert(version);
        await session.end(mode === 'phone' ? 'Phone updated. Log in with your new number.' : 'Password reset. Log in with your new password.');
        router.replace({ pathname: '/auth', params: { mode: 'login', phone: phone.trim() } });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) setChallenge({ ...challenge });
      throw error;
    } finally { setPassword(''); setCode(''); }
  };
  const resend = async () => {
    if (!challenge || expired || Date.now() < challenge.resendAt) return;
    const version = session.version;
    const result = await http.request<{ resend_after: number }>('/auth/resend', { challenge_id: challenge.challenge_id });
    session.assert(version);
    setChallenge({ ...challenge, resendAt: Date.now() + result.resend_after * 1000 }); setCode('');
    setMessage('If eligible, another verification message will be sent. Delivery is not confirmed.');
  };
  const title = challenge ? (mode === 'recovery' ? 'Reset password' : 'Verify your phone') : ({ login: 'Welcome back', signup: 'Create your account', recovery: 'Recover your account', phone: 'Change your number' })[mode];
  return <Screen title={title} subtitle="Short lessons, one idea at a time.">
    {state.message && <Notice text={state.message} />}
    {mode === 'phone' && <Notice text="Changing your number signs you out everywhere. A message already in progress may still reach your old number; it cannot be retracted." />}
    {!challenge ? <>
      <Field label={mode === 'phone' ? 'New phone number' : 'Phone number'} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" editable={!action.busy} />
      {mode !== 'recovery' && <Field label={mode === 'phone' ? 'Current password' : 'Password'} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} editable={!action.busy} />}
      <Button label={mode === 'login' ? 'Log in' : 'Request verification'} onPress={() => void action.run(start)} disabled={disabled} busy={action.busy} />
    </> : <>
      <Text style={styles.body}>Verification for {phone.trim()}. Codes have at most five attempts; resending does not extend expiry.</Text>
      {message && <Notice text={message} />}
      <Text style={styles.body}>{expired ? 'Challenge expired. Start again.' : exhausted ? 'No verification attempts left. Start again.' : `Expires in ${Math.ceil((challenge.expiresAt - now) / 1000)} seconds. ${5 - challenge.attempts} attempts left.`}</Text>
      <Field label="Six-digit verification code" value={code} onChangeText={setCode} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" maxLength={6} editable={!disabled && !expired} />
      {mode === 'recovery' && <Field label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" editable={!disabled && !expired} />}
      <Button label={mode === 'recovery' ? 'Reset password' : 'Verify phone'} onPress={() => void action.run(verify)} disabled={disabled || expired || exhausted} busy={action.busy} />
      <Button label={now < challenge.resendAt ? `Resend available in ${Math.ceil((challenge.resendAt - now) / 1000)}s` : 'Resend code'} onPress={() => void action.run(resend)} disabled={disabled || expired || exhausted || now < challenge.resendAt} secondary />
      <Button label="Start again" onPress={() => { setChallenge(null); setCode(''); setPassword(''); action.setError(''); }} disabled={action.busy || (!expired && now < challenge.resendAt)} secondary />
    </>}
    {waiting && <Notice text={`Try again in ${Math.ceil((http.blockedUntil - now) / 1000)} seconds.`} />}
    {action.error && <Notice text={action.error} />}
    {mode !== 'phone' && <>
      {mode !== 'login' && <Button label="Back to login" onPress={() => router.replace('/auth')} disabled={action.busy} secondary />}
      {mode === 'login' && <><Button label="Create account" onPress={() => router.push('/auth?mode=signup')} disabled={action.busy} secondary /><Button label="Forgot password" onPress={() => router.push('/auth?mode=recovery')} disabled={action.busy} secondary /></>}
      <Text style={styles.body}>Messages use the server’s iMessage provider. Compatibility and recipient eligibility vary; Android recipients are not universally supported.</Text>
    </>}
  </Screen>;
}
