#!/usr/bin/env node

/**
 * Sigil CLI - Command-line interface for Sigil
 */

import { Identity } from '../core/index.js';
import { Chronicle, Actions } from '../chronicle/index.js';
import { readFileSync } from 'fs';

const rawArgs = process.argv.slice(2);

// Parse options first, collect remaining positional args
let identityName = 'default';
let chronicleName = 'default';
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '-i' || rawArgs[i] === '--identity') {
    identityName = rawArgs[++i];
  } else if (rawArgs[i] === '-c' || rawArgs[i] === '--chronicle') {
    chronicleName = rawArgs[++i];
  } else {
    positional.push(rawArgs[i]);
  }
}

const command = positional[0];
const args = positional;

const help = `
sigil - Cryptographic identity and provenance for AI agents

Commands:
  init [name]           Create a new identity (default: 'default')
  id [name]             Show identity info
  
  log <action> [json]   Append an entry to the chronicle
  history [n]           Show last n entries (default: 10)
  verify                Verify chronicle integrity
  stats                 Show chronicle statistics
  
  export                Export public identity (safe to share)
  
Options:
  --identity, -i <name>   Use a specific identity (default: 'default')
  --chronicle, -c <name>  Use a specific chronicle (default: 'default')
  --help, -h              Show this help

Examples:
  sigil init thomas
  sigil log tool.call '{"tool":"exec","command":"ls"}'
  sigil history 5
  sigil verify
`;

async function main() {
  switch (command) {
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
      console.log(`  Keys saved to ~/.sigil/keys/${name}.*`);
      break;
    }

    case 'id': {
      const name = args[1] || identityName;
      if (!Identity.exists(name)) {
        console.error(`Identity '${name}' not found. Run 'sigil init ${name}' first.`);
        process.exit(1);
      }
      const identity = Identity.load(name);
      console.log(`Identity: ${name}`);
      console.log(`  ID: ${identity.id}`);
      console.log(`  Created: ${identity.metadata.created || 'unknown'}`);
      console.log(`  Public Key: ${identity.publicKey.toString('base64').slice(0, 32)}...`);
      break;
    }

    case 'log': {
      const action = args[1];
      const payloadArg = args[2];
      
      if (!action) {
        console.error('Usage: sigil log <action> [payload-json]');
        process.exit(1);
      }

      if (!Identity.exists(identityName)) {
        console.error(`Identity '${identityName}' not found. Run 'sigil init' first.`);
        process.exit(1);
      }

      const identity = Identity.load(identityName);
      const chronicle = new Chronicle(chronicleName).init();
      
      let payload = {};
      if (payloadArg) {
        try {
          payload = JSON.parse(payloadArg);
        } catch (e) {
          // Treat as simple message
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
          console.log(`  ${JSON.stringify(entry.payload)}`);
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
      const chronicle = new Chronicle(chronicleName).init();
      const stats = chronicle.stats();
      
      console.log(`Chronicle: ${stats.name}`);
      console.log(`  Entries: ${stats.entries}`);
      if (stats.head) {
        console.log(`  Head: ${stats.head.slice(0, 16)}...`);
        console.log(`  First: ${stats.first}`);
        console.log(`  Last: ${stats.last}`);
        console.log(`  Actions:`);
        for (const [action, count] of Object.entries(stats.actions)) {
          console.log(`    ${action}: ${count}`);
        }
      }
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

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
