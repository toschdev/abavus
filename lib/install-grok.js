/**
 * Install Abavus Grok hooks into ~/.grok/hooks/
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const ABAVUS_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_SCRIPT = join(ABAVUS_ROOT, 'hooks', 'grok', 'log.mjs');
const GROK_HOOKS_DIR = join(homedir(), '.grok', 'hooks');
const OUTPUT_PATH = join(GROK_HOOKS_DIR, 'abavus-grok.json');

export function installGrokHooks({ dryRun = false } = {}) {
  const command = `node "${HOOK_SCRIPT}"`;
  const hookEntry = { type: 'command', command, timeout: 10 };

  const config = {
    hooks: {
      SessionStart: [{ hooks: [{ ...hookEntry, timeout: 10 }] }],
      PostToolUse: [{ hooks: [{ ...hookEntry, timeout: 5 }] }],
      UserPromptSubmit: [{ hooks: [{ ...hookEntry, timeout: 5 }] }],
      SessionEnd: [{ hooks: [{ ...hookEntry, timeout: 30 }] }],
      Stop: [{ hooks: [{ ...hookEntry, timeout: 30 }] }],
    },
  };

  if (dryRun) {
    return { path: OUTPUT_PATH, command, config };
  }

  if (!existsSync(GROK_HOOKS_DIR)) {
    mkdirSync(GROK_HOOKS_DIR, { recursive: true });
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(config, null, 2) + '\n', 'utf8');

  if (existsSync(HOOK_SCRIPT)) {
    chmodSync(HOOK_SCRIPT, 0o755);
  }

  return {
    path: OUTPUT_PATH,
    command,
    abavusRoot: ABAVUS_ROOT,
  };
}

export function grokHooksStatus() {
  const installed = existsSync(OUTPUT_PATH);
  let command = null;
  if (installed) {
    try {
      const config = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
      command = config.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command || null;
    } catch {
      command = null;
    }
  }

  return {
    installed,
    path: OUTPUT_PATH,
    command,
    scriptExists: existsSync(HOOK_SCRIPT),
    abavusRoot: ABAVUS_ROOT,
  };
}