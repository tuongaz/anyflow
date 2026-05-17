#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DemoSchema } from '../vendored/schema';

interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code: string;
}

interface ValidationResult {
  ok: boolean;
  issues?: ValidationIssue[];
}

export async function validateSchemaFile(jsonPath: string): Promise<ValidationResult> {
  const absolute = resolve(jsonPath);
  let raw: string;
  try {
    raw = await readFile(absolute, 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ path: [], message: `Failed to read ${absolute}: ${message}`, code: 'read_error' }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      issues: [{ path: [], message: `Invalid JSON: ${message}`, code: 'invalid_json' }],
    };
  }

  const result = DemoSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true };
  }

  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: [...issue.path],
      message: issue.message,
      code: issue.code,
    })),
  };
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        issues: [
          {
            path: [],
            message: 'Usage: validate-schema.ts <path-to-seeflow.json>',
            code: 'missing_argument',
          },
        ],
      })}\n`,
    );
    process.exit(1);
  }

  const result = await validateSchemaFile(arg);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
