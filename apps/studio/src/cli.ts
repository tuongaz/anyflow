#!/usr/bin/env bun
const sub = process.argv[2];

if (!sub || sub === 'start') {
  console.log('anydemo start: not implemented (M1.A scaffold only)');
  process.exit(0);
}

if (['register', 'unregister', 'list', 'stop'].includes(sub)) {
  console.log(`anydemo ${sub}: not implemented (M1.B)`);
  process.exit(0);
}

console.error(`Unknown subcommand: ${sub}`);
process.exit(1);
