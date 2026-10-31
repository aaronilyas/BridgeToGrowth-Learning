import { z } from "zod";

// SEC: the closed set of Python modules a code question may bake in; nothing that reaches the OS, the import system, introspection or the network
export const CODE_LIBRARIES = [
  "math",
  "cmath",
  "statistics",
  "fractions",
  "decimal",
  "random",
  "itertools",
  "functools",
  "collections",
  "heapq",
  "bisect",
  "re",
  "string",
  "dataclasses",
  "typing",
  "numpy",
  "sympy",
  "scipy",
  "mpmath",
] as const;
export const CodeLibrary = z.enum(CODE_LIBRARIES);
export type CodeLibrary = z.infer<typeof CodeLibrary>;

export const CODE_MAX_CHARS = 5000;
export const CODE_MAX_LIBRARIES = 4;
export const CODE_MAX_TESTS = 6;

// INV: the public part of a code question; libraries are fixed at generation and never chosen by the client
export const CodeSpec = z.strictObject({ language: z.literal("python"), starter: z.string().max(CODE_MAX_CHARS), libraries: z.array(CodeLibrary).max(CODE_MAX_LIBRARIES) });
export type CodeSpec = z.infer<typeof CodeSpec>;

export const CodeTest = z.strictObject({ name: z.string().max(80), code: z.string().max(800) });
export type CodeTest = z.infer<typeof CodeTest>;

export const CodeRunRequest = z.strictObject({ questionId: z.uuid(), code: z.string().max(CODE_MAX_CHARS) });
export type CodeRunRequest = z.infer<typeof CodeRunRequest>;

export const CodeRunResponse = z.strictObject({ stdout: z.string(), stderr: z.string(), error: z.string().nullable(), timedOut: z.boolean(), durationMs: z.int().nonnegative() });
export type CodeRunResponse = z.infer<typeof CodeRunResponse>;

export const CodeTestResult = z.strictObject({ name: z.string(), passed: z.boolean(), error: z.string().nullable() });
export type CodeTestResult = z.infer<typeof CodeTestResult>;
