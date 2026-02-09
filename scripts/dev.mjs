// Launch electron-vite dev with ELECTRON_RUN_AS_NODE unset.
// This is needed because Claude Code (and some other tools) set
// ELECTRON_RUN_AS_NODE=1 in the environment, which causes the
// spawned Electron process to run in Node.js mode instead of
// as a proper Electron main process.

import { execSync } from 'child_process';

delete process.env.ELECTRON_RUN_AS_NODE;

execSync('npx electron-vite dev', {
  stdio: 'inherit',
  env: process.env,
});
