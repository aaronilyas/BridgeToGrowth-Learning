import { z } from "zod";
import { CodeSpec, CodeTestResult } from "./code.ts";

export type ErrorCode = "bad_request"|"unauthenticated"|"forbidden_origin"|"not_found"|"rate_limited"|"pro_required"|"quota_exceeded"|"email_taken"|"bad_credentials"|"wrong_password"|"turnstile_failed"|"already_subscribed"|"model_not_allowed"|"unsupported_media"|"too_large"|"upstream"|"llm_bad_output"|"source_blocked"|"source_unreadable"|"sandbox_unavailable"|"internal";

const Email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const MIN_PASSWORD = 12;

export const SignupRequest = z.strictObject({ email: Email, password: z.string().min(MIN_PASSWORD).max(256), turnstile: z.string().max(2048) });
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.strictObject({ email: Email, password: z.string().min(1).max(256), turnstile: z.string().max(2048) });
export type LoginRequest = z.infer<typeof LoginRequest>;

export const PasswordChangeRequest = z.strictObject({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(MIN_PASSWORD).max(256) });
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequest>;

export const ForgotPasswordRequest = z.strictObject({ email: Email, turnstile: z.string().max(2048) });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;

export const RESET_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const ResetPasswordRequest = z.strictObject({ token: z.string().regex(RESET_TOKEN), password: z.string().min(MIN_PASSWORD).max(256) });
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;

export const DeleteAccountRequest = z.strictObject({ password: z.string().min(1).max(256) });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const AuthUserResponse = z.strictObject({ id: z.uuid(), email: z.string() });
export type AuthUserResponse = z.infer<typeof AuthUserResponse>;

export const Plan = z.enum(["free", "pro"]);
export type Plan = z.infer<typeof Plan>;

export const PlanTerms = z.strictObject({
  free: z.strictObject({ capMicros: z.number().int().nonnegative(), lessonTtlDays: z.number().int().positive() }),
  pro: z.strictObject({ capMicros: z.number().int().nonnegative(), priceCents: z.number().int().positive() }),
});
export type PlanTerms = z.infer<typeof PlanTerms>;

export const AdsConfig = z.strictObject({ client: z.string().regex(/^ca-pub-\d+$/), slot: z.string().regex(/^\d+$/) });
export type AdsConfig = z.infer<typeof AdsConfig>;

export const ConfigResponse = z.strictObject({ turnstileSiteKey: z.string(), plans: PlanTerms, passwordReset: z.boolean(), ads: AdsConfig.nullable() });
export type ConfigResponse = z.infer<typeof ConfigResponse>;

export const BillingResponse = z.strictObject({ plan: Plan, subStatus: z.string(), periodEnd: z.iso.datetime().nullable(), cancelAtPeriodEnd: z.boolean(), hasCustomer: z.boolean() });
export type BillingResponse = z.infer<typeof BillingResponse>;

export const UrlResponse = z.strictObject({ url: z.url() });
export type UrlResponse = z.infer<typeof UrlResponse>;

export const EntitlementResponse = z.strictObject({ plan: Plan, capMicros: z.number().int().nonnegative() });
export type EntitlementResponse = z.infer<typeof EntitlementResponse>;

export const MeResponse = z.strictObject({ id: z.uuid(), email: z.string(), settings: z.record(z.string(), z.unknown()), entitlement: EntitlementResponse });
export type MeResponse = z.infer<typeof MeResponse>;

export const ModelsResponse = z.array(z.strictObject({ id: z.string(), label: z.string(), tier: z.enum(["free"]) }));
export type ModelsResponse = z.infer<typeof ModelsResponse>;

const Micros = z.number().int().nonnegative();

export const LlmCallResponse = z.strictObject({ kind: z.string(), model: z.string(), promptTokens: z.number().int().nullable(), completionTokens: z.number().int().nullable(), costMicros: Micros, createdAt: z.iso.datetime() });
export type LlmCallResponse = z.infer<typeof LlmCallResponse>;

export const UsageResponse = z.strictObject({
  plan: Plan,
  period: z.iso.date(),
  usedMicros: Micros,
  reservedMicros: Micros,
  capMicros: Micros,
  byModel: z.array(z.strictObject({ model: z.string(), costMicros: Micros })),
  recent: z.array(LlmCallResponse),
});
export type UsageResponse = z.infer<typeof UsageResponse>;

export const Citation = z.strictObject({ n: z.int().min(1), paperId: z.string(), doi: z.string().nullable(), title: z.string(), year: z.int().nullable() });
export type Citation = z.infer<typeof Citation>;

export const StreamEvent = z.discriminatedUnion("t", [z.strictObject({ t: z.literal("d"), v: z.string() }), z.strictObject({ t: z.literal("end"), citations: z.array(Citation).optional() }), z.strictObject({ t: z.literal("err"), code: z.string() })]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const Domain = z.enum(["math", "physics", "chemistry", "biology", "cs", "engineering", "statistics", "earth", "other"]);
export type Domain = z.infer<typeof Domain>;

export const EdgeKind = z.enum(["prereq", "related"]);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const QuestionKind = z.enum(["mcq", "free", "code"]);
export type QuestionKind = z.infer<typeof QuestionKind>;

export const QuestionCategory = z.enum(["terminology", "conceptual", "mcq", "free"]);
export type QuestionCategory = z.infer<typeof QuestionCategory>;
export const QUESTION_CATEGORIES: readonly QuestionCategory[] = QuestionCategory.options;
export const PRACTICE_SET_SIZE = 4;

// INV: the only shape in which a question leaves the server before it is answered; no answer, explanation or rubric
export const QuestionPublic = z.strictObject({ id: z.uuid(), topicId: z.uuid(), kind: QuestionKind, category: QuestionCategory.nullable(), stem: z.string(), choices: z.array(z.string()).nullable(), code: CodeSpec.nullable(), lessonId: z.uuid().nullable() });
export type QuestionPublic = z.infer<typeof QuestionPublic>;

export const AttemptRequest = z.strictObject({
  questionId: z.uuid(),
  choice: z.int().min(0).max(3).optional(),
  response: z.string().max(5000).optional(),
  confidence: z.int().min(0).max(100),
  latencyMs: z.int().min(0).max(3_600_000),
});
export type AttemptRequest = z.infer<typeof AttemptRequest>;

export const AttemptAnswer = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("mcq"), index: z.int() }), z.strictObject({ kind: z.literal("free"), model: z.string() }), z.strictObject({ kind: z.literal("code"), model: z.string(), tests: z.array(CodeTestResult) })]);
export type AttemptAnswer = z.infer<typeof AttemptAnswer>;

export const AttemptResponse = z.strictObject({
  score: z.number().min(0).max(1),
  correct: z.boolean(),
  feedback: z.string().nullable(),
  answer: AttemptAnswer,
  explanation: z.string(),
  citations: z.array(Citation),
  nextDueAt: z.iso.datetime().nullable(),
});
export type AttemptResponse = z.infer<typeof AttemptResponse>;

export const QueueQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(20) });
export type QueueQuery = z.infer<typeof QueueQuery>;

export const GenerateRequest = z.strictObject({
  topic: z.string().trim().min(2).max(120),
  styleId: z.uuid().optional(),
  model: z.string().min(1).max(100).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const StyleProfile = z.strictObject({
  subject: z.string().max(80),
  domain: Domain,
  level: z.enum(["intro", "undergrad", "grad"]),
  questionTypes: z.array(z.string().max(60)).max(5),
  multiPart: z.boolean(),
  notation: z.enum(["latex", "plain"]),
  usesUnits: z.boolean(),
  difficulty: z.int().min(1).max(5),
  length: z.enum(["short", "medium", "long"]),
  exemplars: z.array(z.string().max(300)).max(3),
});
export type StyleProfile = z.infer<typeof StyleProfile>;

export const LessonPlan = z.strictObject({
  title: z.string().max(120),
  topic: z.strictObject({ name: z.string().max(120), domain: Domain }),
  related: z.array(z.strictObject({ name: z.string().max(120), domain: Domain, kind: EdgeKind })),
  steps: z.array(z.strictObject({ title: z.string().max(80), summary: z.string().max(200) })),
});
export type LessonPlan = z.infer<typeof LessonPlan>;

export const MAX_LESSON_URLS = 3;
export const CreateLessonRequest = z.strictObject({ prompt: z.string().trim().min(2).max(2000), model: z.string().min(1).max(100).optional(), urls: z.array(z.url({ protocol: /^https?$/ }).max(2048)).max(MAX_LESSON_URLS).optional() });
export type CreateLessonRequest = z.infer<typeof CreateLessonRequest>;

export const ChatRequest = z.strictObject({ message: z.string().trim().min(1).max(4000) });
export type ChatRequest = z.infer<typeof ChatRequest>;

export const StepPublic = z.strictObject({ idx: z.int().min(0), title: z.string(), explanationMd: z.string(), keyIdea: z.string(), example: z.string().nullable(), check: QuestionPublic, citations: z.array(Citation) });
export type StepPublic = z.infer<typeof StepPublic>;

const Rate = z.number().min(0).nullable();
export const Metrics = z.strictObject({ attempts: z.int().nonnegative(), accuracy: Rate, retention: Rate, calibrationError: Rate, masteredShare: Rate });
export type Metrics = z.infer<typeof Metrics>;

export const MetricKey = z.enum(["attempts", "accuracy", "retention", "calibrationError", "masteredShare", "streakDays", "dueNow"]);
export type MetricKey = z.infer<typeof MetricKey>;

export const GraphNode = z.strictObject({ id: z.uuid(), name: z.string(), domain: z.string(), mastery: z.number(), attempts: z.int().nonnegative(), lastSeenAt: z.iso.datetime().nullable() });
export const GraphResponse = z.strictObject({ nodes: z.array(GraphNode), edges: z.array(z.strictObject({ src: z.uuid(), dst: z.uuid(), kind: EdgeKind })) });
export type GraphResponse = z.infer<typeof GraphResponse>;

export const StatsQuery = z.strictObject({ days: z.coerce.number().int().min(7).max(365).default(30) });
export type StatsQuery = z.infer<typeof StatsQuery>;

export const StatsResponse = z.strictObject({
  totals: Metrics.extend({ streakDays: z.int().nonnegative(), dueNow: z.int().nonnegative(), topicsStarted: z.int().nonnegative(), goalToday: z.strictObject({ done: z.int().nonnegative(), target: z.int().positive() }) }),
  daily: z.array(Metrics.extend({ day: z.iso.date() })),
  byDomain: z.array(Metrics.extend({ domain: z.string() })),
  byTopic: z.array(Metrics.extend({ id: z.uuid(), name: z.string(), domain: z.string() })),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const InsightsResponse = z.strictObject({ day: z.iso.date(), trends: z.array(z.strictObject({ text: z.string().max(200), metric: MetricKey, direction: z.enum(["up", "down", "flat"]) })).max(5) });
export type InsightsResponse = z.infer<typeof InsightsResponse>;

export const LessonCreated = z.strictObject({ lessonId: z.uuid(), plan: LessonPlan, grounded: z.boolean() });
export type LessonCreated = z.infer<typeof LessonCreated>;

export const LessonSummary = z.strictObject({ id: z.uuid(), title: z.string(), createdAt: z.iso.datetime(), expiresAt: z.iso.datetime().nullable() });
export type LessonSummary = z.infer<typeof LessonSummary>;

export const LessonDetail = z.strictObject({ id: z.uuid(), title: z.string(), expiresAt: z.iso.datetime().nullable(), plan: LessonPlan, prerequisites: z.array(z.string()), steps: z.array(StepPublic), citations: z.array(Citation) });
export type LessonDetail = z.infer<typeof LessonDetail>;

export const MessageResponse = z.strictObject({ id: z.string(), role: z.enum(["user", "assistant"]), content: z.string(), citations: z.array(Citation), createdAt: z.iso.datetime() });
export type MessageResponse = z.infer<typeof MessageResponse>;

export const GenerateResponse = z.strictObject({ topicId: z.uuid(), grounded: z.boolean(), questions: z.array(QuestionPublic) });
export type GenerateResponse = z.infer<typeof GenerateResponse>;

export const StyleSummary = z.strictObject({ id: z.uuid(), subject: z.string(), mime: z.string(), createdAt: z.iso.datetime() });
export type StyleSummary = z.infer<typeof StyleSummary>;

export const StyleUploaded = z.strictObject({ styleId: z.uuid(), profile: StyleProfile });
export type StyleUploaded = z.infer<typeof StyleUploaded>;
