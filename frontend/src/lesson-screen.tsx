import React, { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { normalizeLesson } from './contracts';
import { JobCard } from './job-card';
import { useLifecycle, usePending, useRuntime, useSession } from './provider';
import { Button, Field, Notice, Screen, styles, useAction, useClock } from './ui';
export function LessonScreen() {
  const state = useSession(), { session, http } = useRuntime(), lessons = usePending(), { online, active } = useLifecycle();
  const [topic, setTopic] = useState(''), [voiceover, setVoiceover] = useState(false), [acknowledged, setAcknowledged] = useState(false), [forgetKey, setForgetKey] = useState('');
  const action = useAction(), now = useClock();
  useEffect(() => { void action.run(() => lessons.load()); /* Account mount loads only metadata, never submits. */ }, [lessons]); // eslint-disable-line react-hooks/exhaustive-deps
  const uncertain = lessons.records.some(record => !record.jobId);
  const disabled = !online || !active || action.busy || now < http.blockedUntil;
  const edit = () => { lessons.edit(); setAcknowledged(false); };
  const submit = async (retry = false) => {
    await lessons.submit(normalizeLesson(topic, voiceover), retry);
    session.assert(session.version);
  };
  return <Screen title="What will you learn?" subtitle="Choose one focused idea for a video of at most 90 seconds.">
    <View style={styles.card}><Text style={styles.label}>Verified recipient</Text><Text style={styles.body}>{state.account?.phone_number}</Text><Text style={styles.body}>The server selects this number at send time.</Text></View>
    <Field label="Lesson topic" placeholder="For example: Why does the moon have phases?" value={topic} onChangeText={value => { edit(); setTopic(value); }} multiline editable={!action.busy} />
    <Text style={styles.body}>The topic must contain 1–10,000 characters after trimming. If it cannot fit in 90 seconds, you’ll be asked to break it into smaller topics.</Text>
    <View style={styles.row}><Switch accessibilityLabel="Include voiceover" value={voiceover} onValueChange={value => { edit(); setVoiceover(value); }} disabled={action.busy} /><Text style={styles.label}>Include voiceover</Text></View>
    {uncertain && <><Notice text="An earlier request has an unconfirmed response. It may still produce a message. Retry its original request below if available. A new request can produce another message." /><View style={styles.row}><Switch accessibilityLabel="I understand a new request may send another message" value={acknowledged} onValueChange={setAcknowledged} /><Text style={styles.body}>I understand a new request may send another message.</Text></View></>}
    <Button label="Request lesson" onPress={() => void action.run(() => submit())} disabled={disabled || !topic.trim() || (uncertain && !acknowledged) || !!lessons.attempt} busy={action.busy} />
    {lessons.attempt && !lessons.attempt.job && <Button label="Retry the same request" onPress={() => void action.run(() => submit(true))} disabled={disabled} secondary />}
    {lessons.attempt && <Button label="Prepare a new request" onPress={edit} disabled={action.busy} secondary />}
    {action.error && <Notice text={action.error} />}
    {now < http.blockedUntil && <Notice text={`Requests are paused for ${Math.ceil((http.blockedUntil - now) / 1000)} seconds.`} />}
    <Text style={styles.body}>Only requests retained on this device appear below. After a restart, known job IDs can be checked; a key without a job ID cannot be recovered by this API. Topic text is kept only in memory.</Text>
    {lessons.records.map(record => <View key={record.key} style={{ gap: 12 }}>
      {record.jobId ? <JobCard id={record.jobId} onEdit={edit} /> : <Notice text={`Request ${record.key.slice(0, 8)} has no retained job ID. Do not assume it failed. ${lessons.attempt?.key === record.key ? 'You can explicitly retry the unchanged request above.' : 'The original payload is no longer in memory; safe recovery is unavailable.'}`} />}
      <Button label={`Remove retained record ${record.key.slice(0, 8)}`} onPress={() => setForgetKey(record.key)} disabled={action.busy} secondary />
      {forgetKey === record.key && <><Notice text="Removing this record does not cancel the lesson or retract a message. If its outcome is unresolved, you will lose local tracking." /><Button label="Confirm remove local record" onPress={() => void action.run(async () => { await lessons.forget(record.key); setForgetKey(''); })} disabled={action.busy} secondary /><Button label="Keep record" onPress={() => setForgetKey('')} secondary /></>}
    </View>)}
  </Screen>;
}
