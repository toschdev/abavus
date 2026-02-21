#!/usr/bin/env node

/**
 * Siegel CLI - Command-line interface for Siegel
 * 
 * Cryptographic identity, complete logging, snapshots & forks
 */

import { Identity } from '../core/index.js';
import { Chronicle } from '../chronicle/index.js';
import { CompleteChronicle } from '../chronicle/complete.js';
import { Snapshot, Fork, diffSnapshots } from '../snapshot/index.js';
import { importSession, importAllSessions, watchSessions, getImportStats } from '../integrations/openclaw.js';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const rawArgs = process.argv.slice(2);

// Parse options
let identityName = 'default';
let chronicleName = 'default';
let workspaceDir = join(homedir(), '.openclaw', 'workspace');
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '-i' || rawArgs[i] === '--identity') {
    identityName = rawArgs[++i];
  } else if (rawArgs[i] === '-c' || rawArgs[i] === '--chronicle') {
    chronicleName = rawArgs[++i];
  } else if (rawArgs[i] === '-w' || rawArgs[i] === '--workspace') {
    workspaceDir = rawArgs[++i];
  } else {
    positional.push(rawArgs[i]);
  }
}

const command = positional[0];
const args = positional;

const help = `
siegel - Cryptographic identity and provenance for AI agents

Identity:
  init [name]           Create a new identity (default: 'default')
  id [name]             Show identity info
  export                Export public identity (safe to share)

Chronicle:
  log <action> [json]   Append an entry to the chronicle
  history [n]           Show last n entries (default: 10)
  verify                Verify chronicle integrity
  stats                 Show chronicle statistics (with storage info)

Snapshots:
  snapshot [reason]     Capture current agent state
  snapshots             List all snapshots
  snapshot:show <id>    Show snapshot details
  snapshot:diff <a> <b> Compare two snapshots
  snapshot:export <id>  Export snapshot as portable archive

Fork:
  fork <snapshot-id> [name]   Create new agent from snapshot
  lineage [snapshot-id]       Show lineage chain

OpenClaw Integration:
  import                      Import all OpenClaw sessions (incremental)
  import:session <id>         Import a specific session
  import:watch                Watch and import in real-time
  import:stats                Show import statistics

Options:
  --identity, -i <name>    Use a specific identity (default: 'default')
  --chronicle, -c <name>   Use a specific chronicle (default: 'default')
  --workspace, -w <path>   Workspace directory
  --help, -h               Show this help

Examples:
  siegel init thomas
  siegel snapshot "before refactor"
  siegel fork snap_abc123 experiment-agent
  siegel lineage
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
      const identity = Identity.create({ name });
      identity.save(name);
      console.log(`✓ Created identity '${name}'`);
      console.log(`  ID: ${identity.id}`);
      console.log(`  Keys saved to ~/.siegel/keys/${name}.*`);
      break;
    }

    case 'id': {
      const name = args[1] || identityName;
      if (!Identity.exists(name)) {
        console.error(`Identity '${name}' not found. Run 'siegel init ${name}' first.`);
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
        console.error('Usage: siegel log <action> [payload-json]');
        process.exit(1);
      }

      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found. Run 'siegel init' first.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new Chronicle(chronicleName).init();
      
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
      console.log(`  Hash: ${entry.hash().slice(0, 16)}...`);
      break;
    }

    case 'history': {
      const n = parseInt(args[1]) || 10;
      const chronicle = new Chronicle(chronicleName).init();
      
      if (chronicle.entries.length === 0) {
        console.log('Chronicle is empty.');
        break;
      }

      const entries = chronicle.entries.slice(-n);
      console.log(`Last ${entries.length} entries:\n`);
      
      for (const entry of entries) {
        const time = new Date(entry.timestamp).toLocaleString();
        const sig = entry.signature ? '✓' : '✗';
        console.log(`[${entry.id}] ${time} ${sig}`);
        console.log(`  ${entry.action}`);
        if (Object.keys(entry.payload).length > 0) {
          const payload = JSON.stringify(entry.payload);
          console.log(`  ${payload.length > 100 ? payload.slice(0, 100) + '...' : payload}`);
        }
        console.log();
      }
      break;
    }

    case 'verify': {
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new Chronicle(chronicleName).init();
      
      if (chronicle.entries.length === 0) {
        console.log('Chronicle is empty.');
        break;
      }

      console.log(`Verifying chronicle '${chronicleName}'...`);
      const result = chronicle.verify(identity);
      
      if (result.valid) {
        console.log(`✓ Valid chain with ${result.entries} entries`);
        console.log(`  Head: ${result.head.slice(0, 16)}...`);
      } else {
        console.log(`✗ Invalid chain`);
        for (const error of result.errors) {
          console.log(`  - ${error}`);
        }
        process.exit(1);
      }
      break;
    }

    case 'stats': {
      // Try CompleteChronicle first for storage stats
      let chronicle;
      try {
        chronicle = new CompleteChronicle(chronicleName).init();
        const stats = chronicle.storageStats();
        
        console.log(`Chronicle: ${stats.name}`);
        console.log(`  Entries: ${stats.entries}`);
        if (stats.head) {
          console.log(`  Head: ${stats.head.slice(0, 16)}...`);
          console.log(`  First: ${stats.first}`);
          console.log(`  Last: ${stats.last}`);
          console.log(`\nActions:`);
          for (const [action, count] of Object.entries(stats.actions)) {
            console.log(`  ${action}: ${count}`);
          }
          console.log(`\nStorage:`);
          console.log(`  Chronicle file: ${formatBytes(stats.storage.chronicleFile)}`);
          console.log(`  Content store: ${stats.storage.contentStore.uniqueBlobs} blobs`);
          console.log(`  Dedup savings: ${formatBytes(stats.storage.contentStore.savedBytes)}`);
          console.log(`  Total: ${stats.storage.totalBytesHuman}`);
        }
      } catch (e) {
        // Fallback to basic chronicle
        chronicle = new Chronicle(chronicleName).init();
        const stats = chronicle.stats();
        console.log(`Chronicle: ${stats.name}`);
        console.log(`  Entries: ${stats.entries}`);
        if (stats.head) {
          console.log(`  Head: ${stats.head.slice(0, 16)}...`);
        }
      }
      break;
    }

    // ==================== SNAPSHOTS ====================
    case 'snapshot': {
      const reason = args[1] || 'manual';
      
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      
      let chronicle = null;
      try {
        chronicle = new Chronicle(chronicleName).init();
      } catch (e) {
        // Chronicle doesn't exist yet, that's ok
      }

      console.log('Capturing snapshot...');
      const snapshot = await Snapshot.capture({
        identity,
        chronicle,
        memoryDir: workspaceDir,
        metadata: { reason }
      });

      snapshot.sign(identity);
      const path = snapshot.save();

      console.log(`✓ Snapshot created: ${snapshot.id}`);
      console.log(`  Agent: ${snapshot.agent?.name || snapshot.agent?.id}`);
      console.log(`  Files: ${Object.keys(snapshot.files).length}`);
      if (snapshot.chronicle) {
        console.log(`  Chronicle head: ${snapshot.chronicle.head?.slice(0, 16)}...`);
        console.log(`  Chronicle entries: ${snapshot.chronicle.entries}`);
      }
      console.log(`  Saved to: ${path}`);
      break;
    }

    case 'snapshots': {
      const snapshots = Snapshot.list();
      
      if (snapshots.length === 0) {
        console.log('No snapshots found.');
        break;
      }

      console.log(`${snapshots.length} snapshot(s):\n`);
      for (const s of snapshots) {
        const gen = s.generation > 0 ? ` (gen ${s.generation})` : '';
        console.log(`[${s.id}]${gen}`);
        console.log(`  Created: ${s.created}`);
        console.log(`  Agent: ${s.agent}`);
        console.log(`  Files: ${s.files}, Entries: ${s.entries || 0}`);
        console.log();
      }
      break;
    }

    case 'snapshot:show': {
      const snapshotId = args[1];
      if (!snapshotId) {
        console.error('Usage: siegel snapshot:show <snapshot-id>');
        process.exit(1);
      }

      try {
        const snapshot = Snapshot.load(snapshotId);
        
        console.log(`Snapshot: ${snapshot.id}`);
        console.log(`  Version: ${snapshot.version}`);
        console.log(`  Created: ${snapshot.created}`);
        console.log(`  Signed: ${snapshot.signature ? '✓' : '✗'}`);
        console.log(`  Hash: ${snapshot.hash().slice(0, 32)}...`);
        
        console.log(`\nAgent:`);
        console.log(`  ID: ${snapshot.agent?.id}`);
        console.log(`  Name: ${snapshot.agent?.name}`);
        
        if (snapshot.chronicle) {
          console.log(`\nChronicle:`);
          console.log(`  Name: ${snapshot.chronicle.name}`);
          console.log(`  Head: ${snapshot.chronicle.head?.slice(0, 16)}...`);
          console.log(`  Entries: ${snapshot.chronicle.entries}`);
        }

        console.log(`\nFiles:`);
        for (const [path, info] of Object.entries(snapshot.files)) {
          console.log(`  ${path} (${formatBytes(info.size)})`);
        }

        if (snapshot.lineage?.generation > 0) {
          console.log(`\nLineage:`);
          console.log(`  Generation: ${snapshot.lineage.generation}`);
          console.log(`  Parent: ${snapshot.lineage.parent}`);
          console.log(`  Root: ${snapshot.lineage.root}`);
        }

        if (snapshot.metadata?.reason) {
          console.log(`\nReason: ${snapshot.metadata.reason}`);
        }
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'snapshot:diff': {
      const idA = args[1];
      const idB = args[2];
      
      if (!idA || !idB) {
        console.error('Usage: siegel snapshot:diff <snapshot-a> <snapshot-b>');
        process.exit(1);
      }

      try {
        const a = Snapshot.load(idA);
        const b = Snapshot.load(idB);
        const diff = diffSnapshots(a, b);

        console.log(`Diff: ${idA} → ${idB}\n`);
        
        console.log(`Chronicle:`);
        if (diff.chronicle.diverged) {
          console.log(`  Diverged: ${diff.chronicle.aEntries} → ${diff.chronicle.bEntries} entries`);
        } else {
          console.log(`  Identical`);
        }

        console.log(`\nFiles:`);
        if (diff.files.added.length) {
          console.log(`  Added: ${diff.files.added.join(', ')}`);
        }
        if (diff.files.removed.length) {
          console.log(`  Removed: ${diff.files.removed.join(', ')}`);
        }
        if (diff.files.modified.length) {
          console.log(`  Modified: ${diff.files.modified.join(', ')}`);
        }
        console.log(`  Unchanged: ${diff.files.unchanged.length} files`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'snapshot:export': {
      const snapshotId = args[1];
      if (!snapshotId) {
        console.error('Usage: siegel snapshot:export <snapshot-id>');
        process.exit(1);
      }

      try {
        const snapshot = Snapshot.load(snapshotId);
        const archive = snapshot.export();
        const outPath = `${snapshotId}.siegel`;
        require('fs').writeFileSync(outPath, archive);
        console.log(`✓ Exported to ${outPath} (${formatBytes(archive.length)})`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    // ==================== FORK ====================
    case 'fork': {
      const snapshotId = args[1];
      const newName = args[2];

      if (!snapshotId) {
        console.error('Usage: siegel fork <snapshot-id> [name]');
        process.exit(1);
      }

      try {
        const snapshot = Snapshot.load(snapshotId);
        
        console.log(`Forking from snapshot ${snapshotId}...`);
        
        const result = Fork.create(snapshot, {
          name: newName,
          metadata: {
            forkedBy: identityName,
            forkedAt: new Date().toISOString()
          }
        });

        // Save new identity
        result.identity.save(result.identity.metadata.name);

        console.log(`✓ Fork created`);
        console.log(`\nNew Agent:`);
        console.log(`  Name: ${result.identity.metadata.name}`);
        console.log(`  ID: ${result.identity.id}`);
        console.log(`  Generation: ${result.forkRecord.generation}`);
        console.log(`\nTo restore files:`);
        console.log(`  siegel snapshot:restore ${snapshotId} --target <dir>`);
        console.log(`\nTo use this identity:`);
        console.log(`  siegel -i ${result.identity.metadata.name} <command>`);
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    case 'lineage': {
      const snapshotId = args[1];
      
      try {
        let snapshot;
        if (snapshotId) {
          snapshot = Snapshot.load(snapshotId);
        } else {
          // Show lineage from latest snapshot
          const snapshots = Snapshot.list();
          if (snapshots.length === 0) {
            console.log('No snapshots found.');
            break;
          }
          snapshot = Snapshot.load(snapshots[0].id);
        }

        const lineage = Fork.getLineage(snapshot);
        
        console.log(`Lineage for ${snapshot.id}:\n`);
        console.log(`  Current: ${lineage.current}`);
        console.log(`  Generation: ${lineage.generation}`);
        
        if (lineage.generation > 0) {
          console.log(`  Parent: ${lineage.parent}`);
          console.log(`  Root: ${lineage.root}`);
          if (lineage.chain.length > 0) {
            console.log(`\nAncestry:`);
            for (let i = 0; i < lineage.chain.length; i++) {
              console.log(`  ${'  '.repeat(i)}└─ ${lineage.chain[i]}`);
            }
          }
        } else {
          console.log(`  (Genesis - no ancestors)`);
        }
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    // ==================== OPENCLAW INTEGRATION ====================
    case 'import': {
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new CompleteChronicle(chronicleName).init();
      
      console.log('Importing OpenClaw sessions...\n');
      const result = importAllSessions(chronicle, identity, { verbose: true });
      
      console.log(`\n✓ Done`);
      console.log(`  Sessions processed: ${result.sessionsProcessed}`);
      console.log(`  Sessions updated: ${result.sessionsUpdated}`);
      console.log(`  Entries imported: ${result.totalEntriesImported}`);
      break;
    }

    case 'import:session': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: siegel import:session <session-id>');
        process.exit(1);
      }

      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new CompleteChronicle(chronicleName).init();
      
      console.log(`Importing session ${sessionId}...`);
      const result = importSession(sessionId, chronicle, identity, { verbose: true });
      
      console.log(`\n✓ Imported ${result.entriesImported} entries`);
      break;
    }

    case 'import:watch': {
      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new CompleteChronicle(chronicleName).init();
      
      const interval = parseInt(args[1]) || 30;
      console.log(`Starting watch mode (${interval}s interval)...`);
      console.log('Press Ctrl+C to stop.\n');
      
      watchSessions(chronicle, identity, { interval: interval * 1000, verbose: true });
      
      // Keep running
      process.on('SIGINT', () => {
        console.log('\nStopping...');
        process.exit(0);
      });
      break;
    }

    case 'import:stats': {
      const stats = getImportStats();
      
      console.log('Import Statistics:');
      console.log(`  Sessions tracked: ${stats.sessionsTracked}`);
      console.log(`  Total imported: ${stats.totalImported}`);
      console.log(`  Last run: ${stats.lastRun || 'never'}`);
      
      if (stats.sessionsTracked > 0) {
        console.log('\nPer-session:');
        for (const [id, info] of Object.entries(stats.sessions)) {
          console.log(`  ${id.slice(0,8)}...: ${info.count} entries, offset ${info.lastOffset}`);
        }
      }
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
