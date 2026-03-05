/**
 * Abavus Logger Hook
 * 
 * Logs conversations to Abavus chronicle when /new is issued.
 * Optionally prompts for quality rating.
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join } from 'path';

interface HookEvent {
  type: string;
  action?: string;
  sessionKey?: string;
  timestamp?: string;
  [key: string]: any;
}

interface HookOptions {
  askRating?: boolean;
  autoEmbed?: boolean;
  ollamaUrl?: string;
}

const ABAVUS_DIR = join(homedir(), 'abavus');
const CLI_PATH = join(ABAVUS_DIR, 'cli', 'abavus.js');

/**
 * Run Abavus CLI command
 */
async function runAbavus(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [CLI_PATH, ...args], {
      cwd: ABAVUS_DIR,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code || 0 });
    });

    proc.on('error', () => {
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

/**
 * Ask user for rating in terminal
 */
async function askForRating(): Promise<{ relevance: number | null; clarity: number | null }> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  console.log('\n📊 Quick session rating (press Enter to skip):\n');

  try {
    const relevanceStr = await ask('  Answer relevance (0-100): ');
    const clarityStr = await ask('  Question clarity (0-100): ');
    
    rl.close();

    const relevance = relevanceStr ? parseInt(relevanceStr, 10) : null;
    const clarity = clarityStr ? parseInt(clarityStr, 10) : null;

    return {
      relevance: (relevance !== null && !isNaN(relevance)) ? Math.min(100, Math.max(0, relevance)) : null,
      clarity: (clarity !== null && !isNaN(clarity)) ? Math.min(100, Math.max(0, clarity)) : null
    };
  } catch (e) {
    rl.close();
    return { relevance: null, clarity: null };
  }
}

/**
 * Main hook handler
 */
const handler = async (event: HookEvent, options: HookOptions = {}) => {
  // Only trigger on 'new' command
  if (event.type !== 'command' || event.action !== 'new') {
    return;
  }

  const {
    askRating = true,
    autoEmbed = true,
    ollamaUrl = 'http://192.168.178.88:11434'
  } = options;

  console.log('\n📜 Abavus: Saving session to chronicle...');

  try {
    // Import the session
    const importResult = await runAbavus(['import']);
    
    if (importResult.code === 0) {
      // Extract stats from output
      const match = importResult.stdout.match(/(\d+) new entries/);
      const entriesAdded = match ? match[1] : '?';
      console.log(`   ✓ Logged ${entriesAdded} entries`);
    } else {
      console.log('   ⚠ Import had issues (session may already be logged)');
    }

    // Auto-embed if enabled
    if (autoEmbed) {
      console.log('   Generating embeddings...');
      const embedArgs = ['embed'];
      if (ollamaUrl !== 'http://localhost:11434') {
        embedArgs.push('--ollama', ollamaUrl);
      }
      await runAbavus(embedArgs);
      console.log('   ✓ Embeddings updated');
    }

    // Ask for rating if enabled and in interactive mode
    if (askRating && process.stdin.isTTY) {
      const rating = await askForRating();
      
      if (rating.relevance !== null || rating.clarity !== null) {
        // Store manual rating in Abavus
        const sessionId = event.sessionKey || 'unknown';
        const rateArgs = [
          'rate-manual',
          sessionId,
          String(rating.relevance ?? ''),
          String(rating.clarity ?? '')
        ];
        
        const rateResult = await runAbavus(rateArgs);
        
        if (rateResult.code === 0) {
          console.log(`\n   ✓ Rating saved: relevance=${rating.relevance ?? '-'}, clarity=${rating.clarity ?? '-'}`);
        } else {
          console.log(`\n   ⚠ Rating save failed: ${rateResult.stderr || 'unknown error'}`);
        }
      } else {
        console.log('   (no rating provided)');
      }
    }

    console.log('');
  } catch (e) {
    console.error('   ✗ Abavus error:', (e as Error).message);
  }
};

export default handler;
