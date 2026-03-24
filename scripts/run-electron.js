/**
 * Script to run Electron app
 * Builds the project and starts Electron
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Start Electron using npx
const electron = spawn('npx', ['electron', '.'], {
  cwd: rootDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
});

electron.on('close', (code) => {
  process.exit(code);
});
