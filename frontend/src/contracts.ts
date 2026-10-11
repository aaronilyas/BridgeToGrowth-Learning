export interface Account { id: string; phone_number: string; phone_verified: boolean }
export interface Tokens { token_type: 'Bearer'; access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; account?: Account }
export interface Challenge { challenge_id: string; expires_in: number; resend_after: number; message: string }
export interface LessonPayload { topic: string; voiceover: boolean }
export const phoneValid = (value: string) => /^\+[1-9][0-9]{7,14}$/.test(value);
export const passwordValid = (value: string) => [...value].length >= 12 && [...value].length <= 128;
export const codeValid = (value: string) => /^[0-9]{6}$/.test(value);
export function normalizeLesson(topic: string, voiceover: boolean): LessonPayload {
  const normalized = topic.trim();
  if ([...normalized].length < 1 || [...normalized].length > 10000) throw new Error('Enter a topic between 1 and 10,000 characters.');
  return { topic: normalized, voiceover };
}
