/**
 * Siegel Snapshot - Agent state capture and fork protocol
 * 
 * A snapshot captures:
 * - Agent identity
 * - Chronicle state (head hash, entry count)
 * - Memory files (with content hashes)
 * - Configuration
 * - Lineage (parent snapshots)
 * 
 * Snapshots enable:
 * - Point-in-time restore
 * - Forking agents with verifiable lineage
 * - State comparison / diff
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, relative, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';
import { Identity, hash, randomId } from '../core/index.js';
import { Chronicle } from '../chronicle/index.js';

const SIEGEL_DIR = join(homedir(), '.siegel');
const SNAPSHOTS_DIR = join(SIEGEL_DIR, 'snapshots');

/**
 * File entry in a snapshot
 */
class FileEntry {
  constructor(path, content) {
    this.path = path;
    this.content = content;
    this.hash = hash(content);
    this.size = content.length;
  }

  toManifest() {
    return {
      path: this.path,
      hash: this.hash,
      size: this.size
    };
  }
}

/**
 * Snapshot - Immutable capture of agent state
 */
export class Snapshot {
  constructor(data = {}) {
    this.id = data.id || `snap_${randomId(8)}`;
    this.version = data.version || '1.0';
    this.created = data.created || new Date().toISOString();
    
    // Agent identity
    this.agent = data.agent || null;
    
    // Chronicle state
    this.chronicle = data.chronicle || null;
    
    // Files (manifest only - content stored separately)
    this.files = data.files || {};
    
    // Lineage
    this.lineage = data.lineage || {
      parent: null,        // Parent snapshot ID (if forked)
      generation: 0,       // How many forks deep
      root: null           // Original genesis snapshot
    };
    
    // Metadata
    this.metadata = data.metadata || {};
    
    // Signature (set when signed)
    this.signature = data.signature || null;
  }

  /**
   * Create a snapshot from current agent state
   */
  static async capture(options = {}) {
    const {
      identity,
      chronicle,
      memoryDir = join(homedir(), '.openclaw', 'workspace'),
      includeFiles = ['MEMORY.md', 'SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md', 'HEARTBEAT.md'],
      includeMemoryDir = true,
      metadata = {}
    } = options;

    const snapshot = new Snapshot({
      metadata: {
        capturedAt: new Date().toISOString(),
        reason: metadata.reason || 'manual',
        ...metadata
      }
    });

    // Agent identity
    if (identity) {
      snapshot.agent = {
        id: identity.id,
        name: identity.metadata?.name || 'unknown',
        publicKey: identity.publicKey.toString('base64'),
        created: identity.metadata?.created
      };
    }

    // Chronicle state
    if (chronicle) {
      const stats = chronicle.stats();
      snapshot.chronicle = {
        name: chronicle.name,
        head: chronicle.head,
        entries: stats.entries,
        first: stats.first,
        last: stats.last
      };
    }

    // Collect files
    const files = {};
    const fileContents = new Map(); // For bundling

    // Explicit files
    for (const filename of includeFiles) {
      const filepath = join(memoryDir, filename);
      if (existsSync(filepath)) {
        const content = readFileSync(filepath, 'utf8');
        const entry = new FileEntry(filename, content);
        files[filename] = entry.toManifest();
        fileContents.set(filename, content);
      }
    }

    // Memory subdirectory
    if (includeMemoryDir) {
      const memDir = join(memoryDir, 'memory');
      if (existsSync(memDir)) {
        const memFiles = walkDir(memDir);
        for (const filepath of memFiles) {
          const relPath = `memory/${relative(memDir, filepath)}`;
          const content = readFileSync(filepath, 'utf8');
          const entry = new FileEntry(relPath, content);
          files[relPath] = entry.toManifest();
          fileContents.set(relPath, content);
        }
      }
    }

    snapshot.files = files;
    snapshot._fileContents = fileContents; // Temporary, for bundling

    return snapshot;
  }

  /**
   * Sign the snapshot with agent identity
   */
  sign(identity) {
    // Create canonical representation for signing
    const canonical = this.canonical();
    this.signature = identity.sign(canonical).toString('base64');
    this.agent = this.agent || {
      id: identity.id,
      publicKey: identity.publicKey.toString('base64')
    };
  }

  /**
   * Verify snapshot signature
   */
  verify(identity) {
    if (!this.signature) return false;
    const canonical = this.canonical();
    const sig = Buffer.from(this.signature, 'base64');
    return identity.verify(canonical, sig);
  }

  /**
   * Canonical string for signing/hashing
   */
  canonical() {
    return JSON.stringify({
      id: this.id,
      version: this.version,
      created: this.created,
      agent: this.agent ? { id: this.agent.id, publicKey: this.agent.publicKey } : null,
      chronicle: this.chronicle,
      files: this.files,
      lineage: this.lineage,
      metadata: this.metadata
    }, null, 0); // No pretty printing for canonical form
  }

  /**
   * Get snapshot hash (content-addressable ID)
   */
  hash() {
    return hash(this.canonical());
  }

  /**
   * Save snapshot to disk (manifest + bundle)
   */
  save(dir = SNAPSHOTS_DIR) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const snapshotDir = join(dir, this.id);
    mkdirSync(snapshotDir, { recursive: true });

    // Save manifest
    const manifest = {
      id: this.id,
      version: this.version,
      created: this.created,
      agent: this.agent,
      chronicle: this.chronicle,
      files: this.files,
      lineage: this.lineage,
      metadata: this.metadata,
      signature: this.signature,
      hash: this.hash()
    };
    writeFileSync(join(snapshotDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Save file contents (compressed)
    if (this._fileContents) {
      const bundle = {};
      for (const [path, content] of this._fileContents) {
        bundle[path] = content;
      }
      const compressed = gzipSync(JSON.stringify(bundle));
      writeFileSync(join(snapshotDir, 'files.gz'), compressed);
      delete this._fileContents;
    }

    return snapshotDir;
  }

  /**
   * Load snapshot from disk
   */
  static load(snapshotId, dir = SNAPSHOTS_DIR) {
    const snapshotDir = join(dir, snapshotId);
    if (!existsSync(snapshotDir)) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    const manifest = JSON.parse(readFileSync(join(snapshotDir, 'manifest.json'), 'utf8'));
    const snapshot = new Snapshot(manifest);

    // Load file contents if available
    const bundlePath = join(snapshotDir, 'files.gz');
    if (existsSync(bundlePath)) {
      const compressed = readFileSync(bundlePath);
      const bundle = JSON.parse(gunzipSync(compressed).toString('utf8'));
      snapshot._fileContents = new Map(Object.entries(bundle));
    }

    return snapshot;
  }

  /**
   * List all snapshots
   */
  static list(dir = SNAPSHOTS_DIR) {
    if (!existsSync(dir)) return [];
    
    return readdirSync(dir)
      .filter(name => name.startsWith('snap_'))
      .map(name => {
        const manifestPath = join(dir, name, 'manifest.json');
        if (existsSync(manifestPath)) {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          return {
            id: manifest.id,
            created: manifest.created,
            agent: manifest.agent?.name || manifest.agent?.id,
            chronicleHead: manifest.chronicle?.head?.slice(0, 8),
            entries: manifest.chronicle?.entries,
            files: Object.keys(manifest.files).length,
            generation: manifest.lineage?.generation || 0
          };
        }
        return null;
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.created) - new Date(a.created));
  }

  /**
   * Get file content from snapshot
   */
  getFile(path) {
    if (this._fileContents?.has(path)) {
      return this._fileContents.get(path);
    }
    return null;
  }

  /**
   * Export snapshot as portable archive
   */
  export() {
    const data = {
      manifest: {
        id: this.id,
        version: this.version,
        created: this.created,
        agent: this.agent,
        chronicle: this.chronicle,
        files: this.files,
        lineage: this.lineage,
        metadata: this.metadata,
        signature: this.signature
      },
      files: this._fileContents ? Object.fromEntries(this._fileContents) : {}
    };
    return gzipSync(JSON.stringify(data));
  }

  /**
   * Import from portable archive
   */
  static import(buffer) {
    const data = JSON.parse(gunzipSync(buffer).toString('utf8'));
    const snapshot = new Snapshot(data.manifest);
    snapshot._fileContents = new Map(Object.entries(data.files));
    return snapshot;
  }
}

/**
 * Fork Protocol - Create a new agent from a snapshot
 */
export class Fork {
  /**
   * Fork an agent from a snapshot
   * Creates new identity with lineage back to original
   */
  static create(snapshot, options = {}) {
    const {
      name,
      chronicle,  // Target chronicle for new agent
      metadata = {}
    } = options;

    // Create new identity
    const newIdentity = Identity.create({
      name: name || `fork-of-${snapshot.agent?.name || 'unknown'}`,
      created: new Date().toISOString(),
      forkedFrom: snapshot.id,
      forkedAt: new Date().toISOString()
    });

    // Create fork record
    const forkRecord = {
      id: `fork_${randomId(8)}`,
      created: new Date().toISOString(),
      
      // New agent
      newAgent: {
        id: newIdentity.id,
        name: newIdentity.metadata.name,
        publicKey: newIdentity.publicKey.toString('base64')
      },
      
      // Source
      sourceSnapshot: snapshot.id,
      sourceAgent: snapshot.agent,
      sourceChronicleHead: snapshot.chronicle?.head,
      
      // Lineage
      generation: (snapshot.lineage?.generation || 0) + 1,
      lineage: [
        snapshot.id,
        ...(snapshot.lineage?.chain || [])
      ].slice(0, 100), // Keep last 100 ancestors
      
      metadata
    };

    // If chronicle provided, log the fork
    if (chronicle) {
      chronicle.append('fork', {
        ...forkRecord,
        type: 'fork.create'
      }, newIdentity);
    }

    return {
      identity: newIdentity,
      forkRecord,
      
      // Helper to restore files from snapshot
      async restore(targetDir) {
        if (!snapshot._fileContents) {
          throw new Error('Snapshot has no file contents loaded');
        }
        
        for (const [path, content] of snapshot._fileContents) {
          const fullPath = join(targetDir, path);
          const dir = join(fullPath, '..');
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(fullPath, content);
        }
        
        return targetDir;
      }
    };
  }

  /**
   * Get lineage chain for a snapshot/agent
   */
  static getLineage(snapshot) {
    return {
      current: snapshot.id,
      parent: snapshot.lineage?.parent,
      generation: snapshot.lineage?.generation || 0,
      chain: snapshot.lineage?.chain || [],
      root: snapshot.lineage?.root || snapshot.id
    };
  }
}

/**
 * Diff two snapshots
 */
export function diffSnapshots(a, b) {
  const diff = {
    files: {
      added: [],
      removed: [],
      modified: [],
      unchanged: []
    },
    chronicle: {
      aHead: a.chronicle?.head,
      bHead: b.chronicle?.head,
      aEntries: a.chronicle?.entries,
      bEntries: b.chronicle?.entries,
      diverged: a.chronicle?.head !== b.chronicle?.head
    }
  };

  // Compare files
  const aFiles = new Set(Object.keys(a.files));
  const bFiles = new Set(Object.keys(b.files));

  for (const path of bFiles) {
    if (!aFiles.has(path)) {
      diff.files.added.push(path);
    } else if (a.files[path].hash !== b.files[path].hash) {
      diff.files.modified.push(path);
    } else {
      diff.files.unchanged.push(path);
    }
  }

  for (const path of aFiles) {
    if (!bFiles.has(path)) {
      diff.files.removed.push(path);
    }
  }

  return diff;
}

// Helper: recursively walk directory
function walkDir(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, files);
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      files.push(fullPath);
    }
  }
  return files;
}

export default { Snapshot, Fork, diffSnapshots };
