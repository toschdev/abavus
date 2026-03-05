#!/usr/bin/env node

/**
 * Abavus CLI - Command-line interface for Abavus
 * 
 * Cryptographic identity, complete logging, snapshots & forks
 */

import { Identity } from '../core/index.js';
import { Chronicle } from '../chronicle/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { quickImport, importAllSessions, getImportStats } from '../integrations/openclaw-sqlite.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const rawArgs = process.argv.slice(2);

// Parse options
let identityName = 'default';
let verbose = false;
let force = false;
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '-i' || rawArgs[i] === '--identity') {
    identityName = rawArgs[++i];
  } else if (rawArgs[i] === '-v' || rawArgs[i] === '--verbose') {
    verbose = true;
  } else if (rawArgs[i] === '-f' || rawArgs[i] === '--force') {
    force = true;
  } else {
    positional.push(rawArgs[i]);
  }
}

const command = positional[0];
const args = positional;

const help = `
abavus - Cryptographic identity and provenance for AI agents

Identity:
  init [name]           Create a new identity (default: 'default')
  id [name]             Show identity info
  export                Export public identity (safe to share)

Chronicle (SQLite):
  log <action> [json]   Append an entry to the chronicle
  recent [n]            Show last n entries (default: 20)
  search <query>        Full-text search across all entries
  stats                 Show chronicle statistics
  verify                Verify chain integrity
  
Query:
  by-action <action>    Get entries by action type
  by-session <id>       Get entries by session
  by-time <from> <to>   Get entries in time range
  tools                 Show tool usage statistics

OpenClaw Import:
  import                Import all OpenClaw sessions (incremental)
  import --force        Re-import everything from scratch
  import:stats          Show import statistics

Options:
  --identity, -i <name>    Use a specific identity (default: 'default')
  --verbose, -v            Verbose output
  --force, -f              Force re-import
  --help, -h               Show this help

Examples:
  abavus init thomas
  abavus import
  abavus search "web_search"
  abavus tools
  abavus by-session abc123
`;

async function main() {
  switch (command) {
    // ==================== IDENTITY ====================
    case 'init': {
      const name = args[1] || 'default';
      if (Identity.exists(name)) {
        console.error(`Identity '${name}' already exists.`);
        process.exit(1);
      }
      const identity = Identity.create({ name, created: new Date().toISOString() });
      identity.save(name);
      console.log(`✓ Created identity '${name}'`);
      console.log(`  ID: ${identity.id}`);
      console.log(`  Keys saved to ~/.abavus/keys/${name}.*`);
      break;
    }

    case 'id': {
      const name = args[1] || identityName;
      if (!Identity.exists(name)) {
        console.error(`Identity '${name}' not found. Run 'abavus init ${name}' first.`);
        process.exit(1);
      }
      const identity = Identity.load(name);
      console.log(`Identity: ${name}`);
      console.log(`  ID: ${identity.id}`);
      console.log(`  Created: ${identity.metadata.created || 'unknown'}`);
      console.log(`  Public Key: ${identity.publicKey.toString('base64').slice(0, 32)}...`);
      break;
    }

    case 'export': {
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }
      const identity = Identity.load(identityName);
      console.log(JSON.stringify(identity.toPublic(), null, 2));
      break;
    }

    // ==================== CHRONICLE ====================
    case 'log': {
      const action = args[1];
      const payloadArg = args[2];
      
      if (!action) {
        console.error('Usage: abavus log <action> [payload-json]');
        process.exit(1);
      }

      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found. Run 'abavus init' first.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      let payload = {};
      if (payloadArg) {
        try {
          payload = JSON.parse(payloadArg);
        } catch (e) {
          payload = { message: payloadArg };
        }
      }

      const entry = chronicle.append(action, payload, identity);
      console.log(`✓ Logged: ${action}`);
      console.log(`  Entry ID: ${entry.id}`);
      console.log(`  Hash: ${entry.entryHash.slice(0, 16)}...`);
      chronicle.close();
      break;
    }

    case 'recent': {
      const n = parseInt(args[1]) || 20;
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const entries = chronicle.recent(n);
      
      if (entries.length === 0) {
        console.log('Chronicle is empty.');
        break;
      }

      console.log(`Last ${entries.length} entries:\n`);
      
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'search': {
      const query = args[1];
      if (!query) {
        console.error('Usage: abavus search <query>');
        process.exit(1);
      }

      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const entries = chronicle.search(query);
      
      if (entries.length === 0) {
        console.log('No results found.');
        break;
      }

      console.log(`Found ${entries.length} entries:\n`);
      
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'verify': {
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      console.log('Verifying chronicle...');
      const result = chronicle.verifyChain(identity);
      
      if (result.valid) {
        console.log(`✓ Valid chain with ${result.entries} entries`);
        console.log(`  Head: ${result.head?.slice(0, 16)}...`);
      } else {
        console.log(`✗ Invalid chain`);
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
        process.exit(1);
      }
      chronicle.close();
      break;
    }

    case 'stats': {
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      const stats = chronicle.stats();
      
      console.log('Chronicle Statistics:');
      console.log(`  Total entries: ${stats.entries}`);
      console.log(`  Database size: ${formatBytes(stats.dbSize)}`);
      
      if (stats.head) {
        console.log(`  Head hash: ${stats.head.slice(0, 16)}...`);
        console.log(`  First entry: ${stats.first}`);
        console.log(`  Last entry: ${stats.last}`);
      }
      
      if (Object.keys(stats.actions).length > 0) {
        console.log('\nActions:');
        const sorted = Object.entries(stats.actions).sort((a, b) => b[1] - a[1]);
        for (const [action, count] of sorted) {
          console.log(`  ${action}: ${count}`);
        }
      }
      chronicle.close();
      break;
    }

    // ==================== QUERIES ====================
    case 'by-action': {
      const action = args[1];
      const limit = parseInt(args[2]) || 50;
      
      if (!action) {
        console.error('Usage: abavus by-action <action> [limit]');
        process.exit(1);
      }

      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const entries = chronicle.byAction(action, limit);
      
      if (entries.length === 0) {
        console.log(`No entries found for action '${action}'.`);
        break;
      }

      console.log(`${entries.length} entries with action '${action}':\n`);
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'by-session': {
      const sessionId = args[1];
      const limit = parseInt(args[2]) || 200;
      
      if (!sessionId) {
        console.error('Usage: abavus by-session <session-id> [limit]');
        process.exit(1);
      }

      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      // Support partial session IDs
      const entries = chronicle.bySession(sessionId, limit);
      
      if (entries.length === 0) {
        console.log(`No entries found for session '${sessionId}'.`);
        break;
      }

      console.log(`${entries.length} entries in session '${sessionId.slice(0, 8)}...':\n`);
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'by-time': {
      const from = args[1];
      const to = args[2];
      
      if (!from || !to) {
        console.error('Usage: abavus by-time <from-iso> <to-iso>');
        console.error('Example: abavus by-time 2026-03-01 2026-03-05');
        process.exit(1);
      }

      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const entries = chronicle.byTimeRange(from, to);
      
      if (entries.length === 0) {
        console.log('No entries found in time range.');
        break;
      }

      console.log(`${entries.length} entries from ${from} to ${to}:\n`);
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'tools': {
      const since = args[1]; // Optional: date filter
      
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const stats = chronicle.toolStats(since);
      
      if (stats.length === 0) {
        console.log('No tool calls recorded.');
        break;
      }

      console.log('Tool Usage Statistics:');
      if (since) console.log(`  (since ${since})\n`);
      else console.log();
      
      for (const { tool_name, count } of stats) {
        const bar = '█'.repeat(Math.min(count, 50));
        console.log(`  ${tool_name.padEnd(20)} ${count.toString().padStart(5)} ${bar}`);
      }
      chronicle.close();
      break;
    }

    case 'sessions': {
      const limit = parseInt(args[1]) || 20;
      
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const sessions = chronicle.sessionStats(limit);
      
      if (sessions.length === 0) {
        console.log('No sessions recorded.');
        break;
      }

      console.log(`${sessions.length} sessions:\n`);
      for (const s of sessions) {
        console.log(`[${s.session_id.slice(0, 8)}...]`);
        console.log(`  Started: ${s.started}`);
        console.log(`  Ended:   ${s.ended}`);
        console.log(`  Entries: ${s.entries}`);
        console.log();
      }
      chronicle.close();
      break;
    }

    // ==================== IMPORT ====================
    case 'import': {
      console.log('Importing OpenClaw sessions...\n');
      const result = await quickImport({ verbose: true, force });
      break;
    }

    case 'import:stats': {
      const stats = getImportStats();
      
      console.log('Import Statistics:');
      console.log(`  Sessions tracked: ${stats.sessionsTracked}`);
      console.log(`  Total imported: ${stats.totalImported}`);
      console.log(`  Last run: ${stats.lastRun || 'never'}`);
      
      if (stats.sessionsTracked > 0 && verbose) {
        console.log('\nPer-session:');
        for (const [id, info] of Object.entries(stats.sessions)) {
          console.log(`  ${id.slice(0,8)}...: ${info.count} entries`);
        }
      }
      break;
    }

    // ==================== EXPORT ====================
    case 'export:jsonl': {
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const jsonl = chronicle.exportJSONL();
      console.log(jsonl);
      chronicle.close();
      break;
    }

    // ==================== HELP ====================
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(help);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log(help);
      process.exit(1);
  }
}

function printEntry(entry) {
  const time = new Date(entry.timestamp).toLocaleString('de-DE', { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
  const sig = entry.signature ? '✓' : ' ';
  
  console.log(`[${entry.id.slice(0, 8)}] ${time} ${sig} ${entry.action}`);
  
  // Show relevant payload info based on action type
  const p = entry.payload;
  if (entry.action === 'tool.call' && p.tool) {
    console.log(`  Tool: ${p.tool}`);
    if (p.arguments && Object.keys(p.arguments).length > 0) {
      const args = JSON.stringify(p.arguments);
      console.log(`  Args: ${args.length > 80 ? args.slice(0, 80) + '...' : args}`);
    }
  } else if (entry.action === 'llm.turn' && p.output) {
    if (p.model) console.log(`  Model: ${p.model}`);
    if (p.output.content) {
      const preview = p.output.content.slice(0, 100).replace(/\n/g, ' ');
      console.log(`  Output: ${preview}${p.output.content.length > 100 ? '...' : ''}`);
    }
    if (p.usage) {
      console.log(`  Tokens: ${p.usage.inputTokens || 0} in / ${p.usage.outputTokens || 0} out`);
    }
  } else if (entry.action.includes('message') && p.content) {
    const preview = p.content.slice(0, 100).replace(/\n/g, ' ');
    console.log(`  ${preview}${p.content.length > 100 ? '...' : ''}`);
  }
  console.log();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

main().catch(err => {
  console.error('Error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
