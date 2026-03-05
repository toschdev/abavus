/**
 * Abavus Live Watcher
 * 
 * Watches OpenClaw session files and imports new entries in real-time.
 * Uses fs.watch for instant detection.
 */

import { watch, existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { EventEmitter } from 'events';

const SESSIONS_DIR = join(homedir(), '.openclaw', 'agents', 'main', 'sessions');

/**
 * Session file state tracker
 */
class SessionTracker {
  constructor() {
    this.sessions = new Map(); // sessionId → { size, lines }
  }

  getState(sessionId) {
    return this.sessions.get(sessionId) || { size: 0, lines: 0 };
  }

  setState(sessionId, state) {
    this.sessions.set(sessionId, state);
  }
}

/**
 * Live watcher for OpenClaw sessions
 */
export class LiveWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sessionsDir = options.sessionsDir || SESSIONS_DIR;
    this.tracker = new SessionTracker();
    this.watchers = new Map();
    this.pollInterval = options.pollInterval || 1000;
    this._pollTimer = null;
  }

  /**
   * Start watching
   */
  start() {
    if (!existsSync(this.sessionsDir)) {
      throw new Error(`Sessions directory not found: ${this.sessionsDir}`);
    }

    // Initial scan
    this._scanExisting();

    // Watch directory for new files
    this._watchDirectory();

    // Fallback polling (some systems don't fire fs.watch reliably)
    this._startPolling();

    this.emit('started', { sessionsDir: this.sessionsDir });
    return this;
  }

  /**
   * Stop watching
   */
  stop() {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Scan existing sessions
   */
  _scanExisting() {
    const files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.jsonl'));
    
    for (const file of files) {
      const sessionId = basename(file, '.jsonl');
      const filepath = join(this.sessionsDir, file);
      const stat = statSync(filepath);
      
      // Count lines
      const content = readFileSync(filepath, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean).length;
      
      this.tracker.setState(sessionId, { size: stat.size, lines });
      this._watchFile(sessionId, filepath);
    }
  }

  /**
   * Watch directory for new session files
   */
  _watchDirectory() {
    const dirWatcher = watch(this.sessionsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith('.jsonl')) return;
      
      const sessionId = basename(filename, '.jsonl');
      const filepath = join(this.sessionsDir, filename);
      
      if (existsSync(filepath) && !this.watchers.has(sessionId)) {
        this._watchFile(sessionId, filepath);
        this.emit('session:new', { sessionId });
      }
    });

    this.watchers.set('__dir__', dirWatcher);
  }

  /**
   * Watch a specific session file
   */
  _watchFile(sessionId, filepath) {
    if (this.watchers.has(sessionId)) return;

    const fileWatcher = watch(filepath, (eventType) => {
      if (eventType === 'change') {
        this._checkForNewLines(sessionId, filepath);
      }
    });

    this.watchers.set(sessionId, fileWatcher);
  }

  /**
   * Check file for new lines
   */
  _checkForNewLines(sessionId, filepath) {
    try {
      const stat = statSync(filepath);
      const prevState = this.tracker.getState(sessionId);

      if (stat.size <= prevState.size) return;

      // Read file and get new lines
      const content = readFileSync(filepath, 'utf8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const newLines = allLines.slice(prevState.lines);

      if (newLines.length > 0) {
        // Parse and emit each new line
        for (const line of newLines) {
          try {
            const record = JSON.parse(line);
            this.emit('record', { sessionId, record });
          } catch (e) {
            // Skip malformed lines
          }
        }

        this.tracker.setState(sessionId, { size: stat.size, lines: allLines.length });
        this.emit('session:updated', { sessionId, newRecords: newLines.length });
      }
    } catch (e) {
      // File might be temporarily locked
    }
  }

  /**
   * Fallback polling for systems where fs.watch is unreliable
   */
  _startPolling() {
    this._pollTimer = setInterval(() => {
      const files = readdirSync(this.sessionsDir).filter(f => f.endsWith('.jsonl'));
      
      for (const file of files) {
        const sessionId = basename(file, '.jsonl');
        const filepath = join(this.sessionsDir, file);
        this._checkForNewLines(sessionId, filepath);
      }
    }, this.pollInterval);
  }
}

export default { LiveWatcher };
