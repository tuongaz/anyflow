#!/usr/bin/env node
// Phase 1 — SCAN (deterministic).
//
// Walks the target repo, classifies files, detects manifests and frameworks,
// and collects runnability signals. Writes intermediate/scan-result.json.
//
// Usage:
//   bun scan-target.mjs --root <target-repo> [--out <path>]
//
// No LLM in this script. The semantic summary is produced by the
// `target-scanner` agent, which reads this output.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve as resolvePath } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const ROOT = args.root ? resolvePath(args.root) : process.cwd();
const OUT = args.out ?? join(ROOT, '.anydemo/intermediate/scan-result.json');

const MAX_README_CHARS = 3000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const CATEGORY_BY_EXT = {
  '.ts': 'code',
  '.tsx': 'code',
  '.mts': 'code',
  '.cts': 'code',
  '.js': 'code',
  '.jsx': 'code',
  '.mjs': 'code',
  '.cjs': 'code',
  '.py': 'code',
  '.rb': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.swift': 'code',
  '.cs': 'code',
  '.php': 'code',
  '.json': 'config',
  '.yml': 'config',
  '.yaml': 'config',
  '.toml': 'config',
  '.ini': 'config',
  '.env': 'config',
  '.md': 'docs',
  '.mdx': 'docs',
  '.rst': 'docs',
  '.txt': 'docs',
  '.dockerfile': 'infra',
  '.tf': 'infra',
  '.tfvars': 'infra',
  '.sh': 'script',
  '.bash': 'script',
  '.zsh': 'script',
  '.csv': 'data',
  '.tsv': 'data',
};

const FRAMEWORK_DEPS = {
  express: 'express',
  hono: 'hono',
  '@nestjs/core': 'nestjs',
  fastify: 'fastify',
  koa: 'koa',
  next: 'nextjs',
  remix: 'remix',
  react: 'react',
  vue: 'vue',
  svelte: 'svelte',
  '@solidjs/start': 'solid-start',
  astro: 'astro',
  fastapi: 'fastapi',
  flask: 'flask',
  django: 'django',
  starlette: 'starlette',
  celery: 'celery',
  rails: 'rails',
  sinatra: 'sinatra',
  echo: 'echo',
  gin: 'gin',
  chi: 'chi',
  'actix-web': 'actix',
  rocket: 'rocket',
  'spring-boot': 'spring',
  kafka: 'kafka',
  rabbitmq: 'rabbitmq',
  bullmq: 'bullmq',
  bull: 'bull',
  redis: 'redis',
  mongoose: 'mongoose',
  prisma: 'prisma',
  'drizzle-orm': 'drizzle',
  pg: 'postgres',
  mysql2: 'mysql',
  sqlite3: 'sqlite',
};

main();

function main() {
  if (!existsSync(ROOT)) die(`Target root not found: ${ROOT}`);
  const files = listFiles(ROOT);
  const manifests = collectManifests(ROOT, files);
  const frameworks = detectFrameworks(manifests);
  const runnability = collectRunnabilitySignals(ROOT, files, manifests);
  const readmeExcerpt = readReadme(ROOT, files);

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: ROOT,
    fileCount: files.length,
    files: files.map((f) => ({
      path: f.path,
      category: f.category,
      bytes: f.bytes,
    })),
    manifests,
    frameworks,
    runnability,
    readmeExcerpt,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  console.error(
    `scan-target: wrote ${OUT} (${files.length} files, ${frameworks.length} frameworks)`,
  );
}

function listFiles(root) {
  const tracked = tryGitLsFiles(root);
  const all = tracked ?? walkFs(root);
  return all
    .filter((rel) => !rel.startsWith('.anydemo/intermediate/'))
    .map((rel) => describe(root, rel))
    .filter((f) => f !== null);
}

function tryGitLsFiles(root) {
  const r = spawnSync(
    'git',
    ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard'],
    {
      encoding: 'utf8',
    },
  );
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean);
}

function walkFs(root) {
  const out = [];
  const stack = [''];
  const SKIP = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    '.nuxt',
    '.venv',
    'venv',
    '__pycache__',
    'target',
    'vendor',
    '.cache',
  ]);
  while (stack.length) {
    const rel = stack.pop();
    const abs = rel ? join(root, rel) : root;
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  }
  return out;
}

function describe(root, rel) {
  let st;
  try {
    st = statSync(join(root, rel));
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const ext = extname(rel).toLowerCase();
  const base = rel.split('/').pop();
  const category =
    base === 'Dockerfile' || base === 'Procfile' || base === 'Makefile'
      ? 'infra'
      : (CATEGORY_BY_EXT[ext] ?? 'other');
  return { path: rel, category, bytes: st.size };
}

function collectManifests(root, files) {
  const manifests = {};
  const lookups = [
    { key: 'packageJson', path: 'package.json' },
    { key: 'requirementsTxt', path: 'requirements.txt' },
    { key: 'pyprojectToml', path: 'pyproject.toml' },
    { key: 'gemfile', path: 'Gemfile' },
    { key: 'goMod', path: 'go.mod' },
    { key: 'cargoToml', path: 'Cargo.toml' },
    { key: 'composerJson', path: 'composer.json' },
    { key: 'pomXml', path: 'pom.xml' },
    { key: 'buildGradle', path: 'build.gradle' },
    { key: 'buildGradleKts', path: 'build.gradle.kts' },
  ];
  for (const { key, path } of lookups) {
    const abs = join(root, path);
    if (!existsSync(abs)) continue;
    try {
      const buf = readFileSync(abs, 'utf8');
      manifests[key] = { path, content: buf.slice(0, MAX_FILE_BYTES) };
    } catch {
      /* ignore */
    }
  }
  return manifests;
}

function detectFrameworks(manifests) {
  const found = new Set();

  if (manifests.packageJson) {
    let pkg;
    try {
      pkg = JSON.parse(manifests.packageJson.content);
    } catch {
      pkg = {};
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const dep of Object.keys(deps)) {
      const f = FRAMEWORK_DEPS[dep];
      if (f) found.add(f);
    }
  }

  for (const [key, src] of [
    ['requirementsTxt', manifests.requirementsTxt],
    ['pyprojectToml', manifests.pyprojectToml],
    ['gemfile', manifests.gemfile],
    ['goMod', manifests.goMod],
    ['cargoToml', manifests.cargoToml],
    ['composerJson', manifests.composerJson],
    ['pomXml', manifests.pomXml],
  ]) {
    if (!src) continue;
    const lower = src.content.toLowerCase();
    for (const [needle, name] of Object.entries(FRAMEWORK_DEPS)) {
      if (lower.includes(needle.toLowerCase())) found.add(name);
    }
  }

  return [...found].sort();
}

function collectRunnabilitySignals(root, files, manifests) {
  const signals = [];

  if (manifests.packageJson) {
    let pkg;
    try {
      pkg = JSON.parse(manifests.packageJson.content);
    } catch {
      pkg = {};
    }
    const scripts = pkg.scripts ?? {};
    for (const name of ['dev', 'start', 'serve', 'run']) {
      if (scripts[name]) {
        signals.push({
          kind: 'package-script',
          name,
          command: `${pkg.packageManager?.split('@')[0] ?? 'npm'} run ${name}`,
          rawCommand: scripts[name],
          source: 'package.json',
        });
      }
    }
  }

  const makefile = files.find((f) => f.path === 'Makefile');
  if (makefile) {
    try {
      const content = readFileSync(join(root, 'Makefile'), 'utf8');
      for (const target of ['dev', 'start', 'run', 'serve']) {
        const re = new RegExp(`^${target}:`, 'm');
        if (re.test(content)) {
          signals.push({
            kind: 'make-target',
            name: target,
            command: `make ${target}`,
            source: 'Makefile',
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (files.some((f) => f.path === 'docker-compose.yml' || f.path === 'docker-compose.yaml')) {
    signals.push({
      kind: 'docker-compose',
      command: 'docker compose up',
      source: 'docker-compose.yml',
    });
  }

  if (files.some((f) => f.path === 'Procfile')) {
    signals.push({
      kind: 'procfile',
      command: 'foreman start (or honcho start)',
      source: 'Procfile',
    });
  }

  if (manifests.pyprojectToml) {
    const m = manifests.pyprojectToml.content.match(/\[tool\.poetry\.scripts\][\s\S]*?(?=^\[|\Z)/m);
    if (m) {
      const lines = m[0].split('\n').slice(1);
      for (const line of lines) {
        const mm = line.match(/^([a-zA-Z0-9_\-]+)\s*=/);
        if (mm) {
          signals.push({
            kind: 'poetry-script',
            name: mm[1],
            command: `poetry run ${mm[1]}`,
            source: 'pyproject.toml',
          });
        }
      }
    }
  }

  if (manifests.goMod) {
    const cmds = files.filter((f) => /^cmd\/[^/]+\/main\.go$/.test(f.path));
    for (const c of cmds) {
      const name = c.path.split('/')[1];
      signals.push({ kind: 'go-main', name, command: `go run ./cmd/${name}`, source: c.path });
    }
  }

  if (manifests.cargoToml) {
    const bins = manifests.cargoToml.content.match(/\[\[bin\]\][\s\S]*?(?=^\[|\Z)/gm) ?? [];
    for (const bin of bins) {
      const name = bin.match(/name\s*=\s*"([^"]+)"/)?.[1];
      if (name)
        signals.push({
          kind: 'cargo-bin',
          name,
          command: `cargo run --bin ${name}`,
          source: 'Cargo.toml',
        });
    }
  }

  return signals;
}

function readReadme(root, files) {
  const readme = files.find((f) => /^README\.[a-z]+$/i.test(f.path) || /^README$/i.test(f.path));
  if (!readme) return null;
  try {
    const content = readFileSync(join(root, readme.path), 'utf8');
    return { path: readme.path, excerpt: content.slice(0, MAX_README_CHARS) };
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root' || a === '--out') out[a.slice(2)] = argv[++i];
    else if (a.startsWith('--root=')) out.root = a.slice('--root='.length);
    else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
  }
  return out;
}

function die(msg) {
  console.error(`scan-target: ${msg}`);
  process.exit(1);
}
