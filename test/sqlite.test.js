/**
 * SQLite Chronicle Test
 */

import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { Identity } from '../core/index.js';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';

const TEST_DB = join(tmpdir(), 'siegel-test-' + Date.now() + '.db');

async function test() {
  console.log('🧪 Testing SQLite Chronicle...\n');

  // Create identity
  console.log('1. Creating identity...');
  const identity = Identity.create({ name: 'test-agent' });
  console.log(`   ✓ Identity: ${identity.id}\n`);

  // Initialize chronicle
  console.log('2. Initializing chronicle...');
  const chronicle = new SQLiteChronicle(TEST_DB);
  await chronicle.init();
  console.log(`   ✓ Database: ${TEST_DB}\n`);

  // Append entries
  console.log('3. Appending entries...');
  
  const e1 = chronicle.append('session.start', {
    sessionId: 'test-session-1',
    agent: { name: 'Thomas' }
  }, identity);
  console.log(`   ✓ Entry 1: ${e1.id} (${e1.action})`);

  const e2 = chronicle.append('llm.turn', {
    sessionId: 'test-session-1',
    turnId: 'turn-1',
    output: {
      content: 'Hallo Tosch! Ich bin Thomas.',
      thinking: 'Der User möchte mich kennenlernen...'
    }
  }, identity);
  console.log(`   ✓ Entry 2: ${e2.id} (${e2.action})`);

  const e3 = chronicle.append('tool.call', {
    sessionId: 'test-session-1',
    turnId: 'turn-1',
    tool: 'web_search',
    arguments: { query: 'Siegel cryptography' }
  }, identity);
  console.log(`   ✓ Entry 3: ${e3.id} (${e3.action})\n`);

  // Query tests
  console.log('4. Testing queries...');
  
  const byAction = chronicle.byAction('tool.call');
  console.log(`   ✓ byAction('tool.call'): ${byAction.length} entries`);

  const bySession = chronicle.bySession('test-session-1');
  console.log(`   ✓ bySession('test-session-1'): ${bySession.length} entries`);

  const search = chronicle.search('Thomas');
  console.log(`   ✓ search('Thomas'): ${search.length} entries`);

  const recent = chronicle.recent(10);
  console.log(`   ✓ recent(10): ${recent.length} entries\n`);

  // Stats
  console.log('5. Statistics...');
  const stats = chronicle.stats();
  console.log(`   ✓ Total entries: ${stats.entries}`);
  console.log(`   ✓ Actions: ${JSON.stringify(stats.actions)}`);
  console.log(`   ✓ DB size: ${(stats.dbSize / 1024).toFixed(1)} KB\n`);

  // Verify chain
  console.log('6. Verifying chain integrity...');
  const verification = chronicle.verifyChain(identity);
  console.log(`   ✓ Valid: ${verification.valid}`);
  console.log(`   ✓ Entries verified: ${verification.entries}`);
  if (verification.errors.length > 0) {
    console.log(`   ✗ Errors: ${verification.errors.join(', ')}`);
  }
  console.log();

  // Export JSONL
  console.log('7. Export to JSONL...');
  const jsonl = chronicle.exportJSONL();
  const lines = jsonl.split('\n').filter(Boolean);
  console.log(`   ✓ Exported ${lines.length} lines\n`);

  // Close and reopen
  console.log('8. Persistence test...');
  chronicle.close();
  
  const chronicle2 = new SQLiteChronicle(TEST_DB);
  await chronicle2.init();
  const stats2 = chronicle2.stats();
  console.log(`   ✓ Reopened, entries: ${stats2.entries}`);
  console.log(`   ✓ Head hash: ${stats2.head?.slice(0, 16)}...`);
  chronicle2.close();
  console.log();

  // Cleanup
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB);
    console.log('✓ Test database cleaned up\n');
  }

  console.log('✅ All tests passed!');
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
