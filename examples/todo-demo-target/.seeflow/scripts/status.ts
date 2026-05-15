#!/usr/bin/env bun
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

type StatusState = 'ok' | 'warn' | 'error' | 'pending';

interface StatusReport {
  state: StatusState;
  summary?: string;
  detail?: string;
  data?: Record<string, unknown>;
  ts?: number;
}

const STATE_FILE = resolve(process.cwd(), '.seeflow/state/todos.json');
const TICK_MS = 1000;

async function readTodos(): Promise<Todo[]> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    if (raw.trim().length === 0) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

function buildReport(todos: Todo[]): StatusReport {
  const total = todos.length;
  const completed = todos.filter((t) => t.done).length;
  const pending = total - completed;
  let state: StatusState;
  if (total === 0) state = 'warn';
  else if (pending === 0) state = 'ok';
  else state = 'pending';

  const detail = todos
    .slice(0, 5)
    .map((t) => `${t.done ? '- [x]' : '- [ ]'} ${t.text}`)
    .join('\n');

  return {
    state,
    summary: `${pending} pending / ${total} total`,
    detail: detail.length > 0 ? detail : undefined,
    data: { pending, total, completed },
    ts: Date.now(),
  };
}

while (true) {
  const todos = await readTodos();
  const report = buildReport(todos);
  console.log(JSON.stringify(report));
  await Bun.sleep(TICK_MS);
}
