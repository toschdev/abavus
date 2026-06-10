#!/usr/bin/env node
/**
 * Grok / Cursor lifecycle hook → Abavus chronicle spool.
 *
 * PostToolUse: fast append to ~/.abavus/spool/grok.jsonl
 * SessionEnd/Stop: flush spool into signed SQLite chronicle
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { grokEventToRecords, shouldFlushSpool } from '../../lib/grok-events.js';
import { spoolAppend, spoolFlush } from '../../lib/spool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ABAVUS_ROOT = join(__dirname, '..', '..');

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return null;
  return JSON.parse(text);
}

async function main() {
  const event = await readStdin();
  if (!event) {
    process.exit(0);
  }

  const records = grokEventToRecords(event);
  for (const record of records) {
    spoolAppend(record);
  }

  if (shouldFlushSpool(event)) {
    try {
      await spoolFlush({ identityName: process.env.ABAVUS_IDENTITY || 'default' });
    } catch (err) {
      // Fail-open: Grok must not block on hook errors
      console.error(`[abavus] spool flush failed: ${err.message}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`[abavus] hook error: ${err.message}`);
  process.exit(0);
});