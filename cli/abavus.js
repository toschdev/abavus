#!/usr/bin/env node

/**
 * Abavus CLI - Command-line interface for Abavus
 * 
 * Cryptographic identity, complete logging, semantic search
 */

import { Identity } from '../core/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { SemanticChronicle } from '../chronicle/semantic.js';
import { QualityChronicle } from '../chronicle/quality.js';
import { AbavusDaemon } from '../lib/daemon.js';
import { quickImport, getImportStats } from '../integrations/openclaw-sqlite.js';
import { homedir } from 'os';
import { join } from 'path';

const rawArgs = process.argv.slice(2);

// Parse options
let identityName = 'default';
let verbose = false;
let force = false;
let ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === '-i' || rawArgs[i] === '--identity') {
    identityName = rawArgs[++i];
  } else if (rawArgs[i] === '-v' || rawArgs[i] === '--verbose') {
    verbose = true;
  } else if (rawArgs[i] === '-f' || rawArgs[i] === '--force') {
    force = true;
  } else if (rawArgs[i] === '--ollama') {
    ollamaUrl = rawArgs[++i];
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

Chronicle:
  recent [n]            Show last n entries (default: 20)
  search <query>        Full-text search (LIKE)
  stats                 Show statistics
  verify                Verify chain integrity

Semantic Search:
  ask <query>           Semantic search using embeddings
  embed                 Generate embeddings for all entries
  embed:stats           Show embedding coverage
  similar <entry-id>    Find similar entries

Live:
  watch                 Watch & import in real-time (Ctrl+C to stop)
  watch --embed         Also generate embeddings for new entries

Quality:
  rate                  Evaluate Q&A quality (uses llama3.2:3b)
  rate:stats            Show quality statistics
  rate:low              Show low-quality interactions
  rate:high             Show high-quality examples

Query:
  by-action <action>    Filter by action type
  by-session <id>       Filter by session
  tools                 Tool usage statistics

Import:
  import                Import OpenClaw sessions (incremental)
  import --force        Re-import everything

Options:
  --identity, -i <name>    Use specific identity
  --ollama <url>           Ollama URL (default: localhost:11434)
  --verbose, -v            Verbose output
  --force, -f              Force re-import
  --help, -h               Show this help

Examples:
  abavus import
  abavus ask "What did we discuss about embeddings?"
  abavus watch --embed
  abavus tools
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
      break;
    }

    case 'id': {
      const name = args[1] || identityName;
      if (!Identity.exists(name)) {
        console.error(`Identity '${name}' not found. Run 'abavus init' first.`);
        process.exit(1);
      }
      const identity = Identity.load(name);
      console.log(`Identity: ${name}`);
      console.log(`  ID: ${identity.id}`);
      console.log(`  Created: ${identity.metadata.created || 'unknown'}`);
      break;
    }

    // ==================== CHRONICLE ====================
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

    case 'stats': {
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      const stats = chronicle.stats();
      
      console.log('Chronicle Statistics:');
      console.log(`  Total entries: ${stats.entries}`);
      console.log(`  Database size: ${formatBytes(stats.dbSize)}`);
      
      if (stats.head) {
        console.log(`  Head hash: ${stats.head.slice(0, 16)}...`);
        console.log(`  First: ${stats.first}`);
        console.log(`  Last: ${stats.last}`);
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
      } else {
        console.log(`✗ Invalid chain`);
        for (const error of result.errors.slice(0, 5)) {
          console.log(`  - ${error}`);
        }
        process.exit(1);
      }
      chronicle.close();
      break;
    }

    // ==================== SEMANTIC ====================
    case 'ask': {
      const query = args.slice(1).join(' ');
      if (!query) {
        console.error('Usage: abavus ask <query>');
        process.exit(1);
      }

      const chronicle = new SemanticChronicle(undefined, { ollamaUrl });
      await chronicle.init();
      
      const embStats = chronicle.embeddingStats();
      if (embStats.embeddedEntries === 0) {
        console.log('No embeddings found. Run "abavus embed" first.');
        chronicle.close();
        break;
      }

      console.log(`Searching ${embStats.embeddedEntries} embedded entries...\n`);
      
      try {
        const results = await chronicle.semanticSearch(query, { limit: 10, threshold: 0.3 });
        
        if (results.length === 0) {
          console.log('No similar entries found.');
        } else {
          for (const result of results) {
            const score = (result.score * 100).toFixed(0);
            console.log(`[${result.id.slice(0, 8)}] ${score}% match`);
            printEntry(result, true);
          }
        }
      } catch (e) {
        console.error(`Error: ${e.message}`);
        console.log('\nMake sure Ollama is running with an embedding model.');
        console.log(`Tried: ${ollamaUrl}`);
      }
      
      chronicle.close();
      break;
    }

    case 'embed': {
      const chronicle = new SemanticChronicle(undefined, { ollamaUrl });
      await chronicle.init();
      
      console.log('Generating embeddings...');
      console.log(`Using: ${ollamaUrl}\n`);

      try {
        const result = await chronicle.embedAll({
          onProgress: (done, total) => {
            process.stdout.write(`\r  Progress: ${done}/${total} (${(done/total*100).toFixed(0)}%)`);
          }
        });
        
        console.log(`\n\n✓ Embedded ${result.embedded} entries`);
        
        const stats = chronicle.embeddingStats();
        console.log(`  Coverage: ${stats.coverage}`);
      } catch (e) {
        console.error(`\nError: ${e.message}`);
        console.log('\nMake sure Ollama is running:');
        console.log('  ollama serve');
        console.log('  ollama pull nomic-embed-text');
      }
      
      chronicle.close();
      break;
    }

    case 'embed:stats': {
      const chronicle = new SemanticChronicle(undefined, { ollamaUrl });
      await chronicle.init();
      
      const stats = chronicle.embeddingStats();
      console.log('Embedding Statistics:');
      console.log(`  Total entries: ${stats.totalEntries}`);
      console.log(`  Embedded: ${stats.embeddedEntries}`);
      console.log(`  Coverage: ${stats.coverage}`);
      if (Object.keys(stats.models).length > 0) {
        console.log(`  Models: ${JSON.stringify(stats.models)}`);
      }
      
      chronicle.close();
      break;
    }

    case 'similar': {
      const entryId = args[1];
      if (!entryId) {
        console.error('Usage: abavus similar <entry-id>');
        process.exit(1);
      }

      const chronicle = new SemanticChronicle(undefined, { ollamaUrl });
      await chronicle.init();
      
      try {
        const results = await chronicle.findSimilarEntries(entryId, { limit: 10 });
        
        if (results.length === 0) {
          console.log('No similar entries found.');
        } else {
          console.log(`Entries similar to ${entryId}:\n`);
          for (const result of results) {
            const score = (result.score * 100).toFixed(0);
            console.log(`[${result.id.slice(0, 8)}] ${score}% similar`);
            printEntry(result, true);
          }
        }
      } catch (e) {
        console.error(`Error: ${e.message}`);
      }
      
      chronicle.close();
      break;
    }

    // ==================== LIVE ====================
    case 'watch': {
      const embedOnInsert = args.includes('--embed');
      
      console.log('Starting Abavus daemon...');
      if (embedOnInsert) {
        console.log('Embeddings: enabled (slower, but real-time semantic search)');
      }
      console.log('Press Ctrl+C to stop.\n');

      const daemon = new AbavusDaemon({
        ollamaUrl,
        embedOnInsert,
        verbose: true
      });

      await daemon.start();

      // Handle shutdown
      process.on('SIGINT', () => {
        daemon.stop();
        process.exit(0);
      });

      // Keep running
      await new Promise(() => {});
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
        console.log(`No entries found for '${action}'.`);
        break;
      }

      console.log(`${entries.length} entries:\n`);
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'by-session': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: abavus by-session <session-id>');
        process.exit(1);
      }

      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const entries = chronicle.bySession(sessionId, 200);
      if (entries.length === 0) {
        console.log(`No entries for session '${sessionId}'.`);
        break;
      }

      console.log(`${entries.length} entries:\n`);
      for (const entry of entries) {
        printEntry(entry);
      }
      chronicle.close();
      break;
    }

    case 'tools': {
      const since = args[1];
      const chronicle = new SQLiteChronicle();
      await chronicle.init();
      
      const stats = chronicle.toolStats(since);
      if (stats.length === 0) {
        console.log('No tool calls recorded.');
        break;
      }

      console.log('Tool Usage:\n');
      for (const { tool_name, count } of stats) {
        const bar = '█'.repeat(Math.min(count, 50));
        console.log(`  ${tool_name.padEnd(20)} ${count.toString().padStart(5)} ${bar}`);
      }
      chronicle.close();
      break;
    }

    // ==================== IMPORT ====================
    case 'import': {
      console.log('Importing OpenClaw sessions...\n');
      await quickImport({ verbose: true, force });
      break;
    }

    case 'import:stats': {
      const stats = getImportStats();
      console.log('Import Statistics:');
      console.log(`  Sessions: ${stats.sessionsTracked}`);
      console.log(`  Total imported: ${stats.totalImported}`);
      console.log(`  Last run: ${stats.lastRun || 'never'}`);
      break;
    }

    // ==================== QUALITY ====================
    case 'rate': {
      const limit = parseInt(args[1]) || 50;
      
      console.log('Evaluating Q&A quality...');
      console.log(`Using: ${ollamaUrl} (llama3.2:3b)\n`);

      const chronicle = new QualityChronicle(undefined, { ollamaUrl });
      await chronicle.init();

      try {
        const result = await chronicle.evaluateAll({
          limit,
          onProgress: (done, total) => {
            process.stdout.write(`\r  Progress: ${done}/${total}`);
          }
        });

        console.log(`\n\n✓ Evaluated ${result.evaluated} Q&A pairs`);
        
        const stats = chronicle.qualityStats();
        if (stats.avgRelevance !== null) {
          console.log(`  Avg relevance: ${stats.avgRelevance}%`);
          console.log(`  Avg clarity: ${stats.avgClarity}%`);
        }
      } catch (e) {
        console.error(`\nError: ${e.message}`);
        console.log('\nMake sure Ollama is running with llama3.2:3b');
      }

      chronicle.close();
      break;
    }

    case 'rate:stats': {
      const chronicle = new QualityChronicle(undefined, { ollamaUrl });
      await chronicle.init();

      const stats = chronicle.qualityStats();
      
      console.log('Quality Statistics:');
      console.log(`  Evaluated pairs: ${stats.evaluated}`);
      
      if (stats.avgRelevance !== null) {
        console.log(`\n  Answer Relevance:`);
        console.log(`    Average: ${stats.avgRelevance}%`);
        console.log(`    Range: ${stats.minRelevance}% - ${stats.maxRelevance}%`);
        
        console.log(`\n  Question Clarity:`);
        console.log(`    Average: ${stats.avgClarity}%`);
        console.log(`    Range: ${stats.minClarity}% - ${stats.maxClarity}%`);

        if (Object.keys(stats.distribution).length > 0) {
          console.log(`\n  Distribution:`);
          const grades = ['excellent', 'good', 'fair', 'poor'];
          for (const grade of grades) {
            const count = stats.distribution[grade] || 0;
            const bar = '█'.repeat(Math.min(count, 30));
            console.log(`    ${grade.padEnd(10)} ${count.toString().padStart(4)} ${bar}`);
          }
        }
      }

      chronicle.close();
      break;
    }

    case 'rate:low': {
      const threshold = parseInt(args[1]) || 50;
      
      const chronicle = new QualityChronicle(undefined, { ollamaUrl });
      await chronicle.init();

      const results = chronicle.getLowQuality({ threshold, limit: 15 });
      
      if (results.length === 0) {
        console.log('No low-quality interactions found (or none evaluated yet).');
        console.log('Run "abavus rate" first to evaluate Q&A pairs.');
        break;
      }

      console.log(`Low-quality interactions (relevance or clarity < ${threshold}%):\n`);
      
      for (const r of results) {
        console.log(`[${r.questionId.slice(0, 8)}] Relevance: ${r.relevance}% | Clarity: ${r.clarity}%`);
        console.log(`  Q: ${r.question}`);
        console.log(`  A: ${r.answer}`);
        if (r.feedback) console.log(`  💡 ${r.feedback}`);
        console.log();
      }

      chronicle.close();
      break;
    }

    case 'rate:high': {
      const threshold = parseInt(args[1]) || 80;
      
      const chronicle = new QualityChronicle(undefined, { ollamaUrl });
      await chronicle.init();

      const results = chronicle.getHighQuality({ threshold, limit: 10 });
      
      if (results.length === 0) {
        console.log('No high-quality interactions found (or none evaluated yet).');
        break;
      }

      console.log(`High-quality interactions (relevance & clarity >= ${threshold}%):\n`);
      
      for (const r of results) {
        console.log(`[${r.questionId.slice(0, 8)}] Relevance: ${r.relevance}% | Clarity: ${r.clarity}%`);
        console.log(`  Q: ${r.question}`);
        console.log(`  A: ${r.answer}`);
        console.log();
      }

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

function printEntry(entry, compact = false) {
  const time = new Date(entry.timestamp).toLocaleString('de-DE', { 
    dateStyle: 'short', 
    timeStyle: 'short' 
  });
  const sig = entry.signature ? '✓' : ' ';
  
  console.log(`[${entry.id.slice(0, 8)}] ${time} ${sig} ${entry.action}`);
  
  const p = entry.payload;
  if (entry.action === 'tool.call' && p.tool) {
    console.log(`  Tool: ${p.tool}`);
    if (!compact && p.arguments) {
      const args = JSON.stringify(p.arguments);
      console.log(`  Args: ${args.length > 80 ? args.slice(0, 80) + '...' : args}`);
    }
  } else if (entry.action === 'llm.turn' && p.output) {
    if (p.model) console.log(`  Model: ${p.model}`);
    if (p.output.content) {
      const preview = p.output.content.slice(0, 100).replace(/\n/g, ' ');
      console.log(`  Output: ${preview}${p.output.content.length > 100 ? '...' : ''}`);
    }
  } else if (p.content) {
    const preview = p.content.slice(0, 100).replace(/\n/g, ' ');
    console.log(`  ${preview}${p.content.length > 100 ? '...' : ''}`);
  }
  console.log();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

main().catch(err => {
  console.error('Error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
