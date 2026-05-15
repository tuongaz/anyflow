#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

interface Input {
  text?: string;
}

interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

const STATE_FILE = resolve(process.cwd(), '.seeflow/state/todos.json');

async function readStdinJson(): Promise<Input> {
  const raw = await Bun.stdin.text();
  if (raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Input) : {};
  } catch {
    return {};
  }
}

async function readTodos(): Promise<Todo[]> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

const input = await readStdinJson();
await mkdir(dirname(STATE_FILE), { recursive: true });
const todos = await readTodos();

const todo: Todo = {
  id: crypto.randomUUID(),
  text: input.text ?? 'New todo',
  done: false,
  createdAt: Date.now(),
};
todos.push(todo);

await writeFile(STATE_FILE, `${JSON.stringify(todos, null, 2)}\n`);

console.log(
  JSON.stringify({ ok: true, todoId: todo.id, demoId: process.env.SEEFLOW_DEMO_ID }),
);
