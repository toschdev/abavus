/**
 * Abavus Persona Management
 * 
 * Personas are higher-level identities with their own strengths, history,
 * and knowledge. Built on top of Abavus identities and snapshots for
 * cryptographic provenance.
 * 
 * Approach: Shared chronicle DB with strong tagging by agent/identity.
 * Personas can be forked with full lineage via snapshots.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { Identity } from '../core/index.js';
import { Snapshot } from '../snapshot/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';

const PERSONAS_DIR = join(homedir(), '.abavus', 'personas');

export class Persona {
  constructor(data = {}) {
    this.name = data.name;
    this.identity = data.identity || data.name;
    this.description = data.description || '';
    this.strengths = data.strengths || [];
    this.knowledge = data.knowledge || []; // array of file paths or refs
    this.created = data.created || new Date().toISOString();
    this.lastSnapshot = data.lastSnapshot || null;
    this.metadata = data.metadata || {};
  }

  static ensureDir() {
    if (!existsSync(PERSONAS_DIR)) {
      mkdirSync(PERSONAS_DIR, { recursive: true });
    }
  }

  static pathFor(name) {
    return join(PERSONAS_DIR, `${name}.json`);
  }

  static exists(name) {
    Persona.ensureDir();
    return existsSync(Persona.pathFor(name));
  }

  static create(name, options = {}) {
    Persona.ensureDir();

    if (Persona.exists(name)) {
      throw new Error(`Persona '${name}' already exists.`);
    }

    const identityName = options.identity || name;

    // Ensure underlying identity exists (creates if necessary)
    if (!Identity.exists(identityName)) {
      const identity = Identity.create({ 
        name: identityName, 
        created: new Date().toISOString(),
        persona: name 
      });
      identity.save(identityName);
      console.log(`  (Created underlying identity '${identityName}')`);
    }

    const persona = new Persona({
      name,
      identity: identityName,
      description: options.description || '',
      strengths: options.strengths ? options.strengths.split(',').map(s => s.trim()) : [],
      knowledge: options.knowledge ? options.knowledge.split(',').map(k => k.trim()) : [],
      created: new Date().toISOString(),
    });

    // Optionally create initial snapshot if knowledge provided
    if (persona.knowledge.length > 0) {
      // This would require chronicle access; for now just note it
      persona.metadata.initialKnowledge = persona.knowledge;
    }

    persona.save();
    return persona;
  }

  static load(name) {
    Persona.ensureDir();
    const path = Persona.pathFor(name);
    if (!existsSync(path)) {
      throw new Error(`Persona '${name}' not found.`);
    }
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return new Persona(data);
  }

  static list() {
    Persona.ensureDir();
    try {
      return readdirSync(PERSONAS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  save() {
    Persona.ensureDir();
    const path = Persona.pathFor(this.name);
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2), 'utf8');
  }

  toJSON() {
    return {
      name: this.name,
      identity: this.identity,
      description: this.description,
      strengths: this.strengths,
      knowledge: this.knowledge,
      created: this.created,
      lastSnapshot: this.lastSnapshot,
      metadata: this.metadata,
    };
  }

  async createSnapshot(reason = 'persona state') {
    const chronicle = new SQLiteChronicle();
    await chronicle.init();

    let identity = null;
    if (Identity.exists(this.identity)) {
      identity = Identity.load(this.identity);
    }

    const snapshot = await Snapshot.capture({
      identity,
      chronicle,
      metadata: { 
        reason,
        persona: this.name 
      }
    });

    if (identity) {
      snapshot.sign(identity);
    }

    const savedPath = snapshot.save();
    this.lastSnapshot = snapshot.id;
    this.save();

    chronicle.close();
    return { snapshot, savedPath };
  }

  async fork(newName, options = {}) {
    if (Persona.exists(newName)) {
      throw new Error(`Persona '${newName}' already exists.`);
    }

    // Create new persona based on this one
    const forked = new Persona({
      name: newName,
      identity: options.identity || `${this.identity}-fork-${Date.now().toString(36)}`,
      description: options.description || `Fork of ${this.name}: ${this.description}`,
      strengths: [...this.strengths],
      knowledge: [...this.knowledge],
      created: new Date().toISOString(),
      metadata: {
        ...this.metadata,
        forkedFrom: this.name,
        forkedAt: new Date().toISOString(),
      }
    });

    // Ensure new identity if needed
    const identityName = forked.identity;
    if (!Identity.exists(identityName)) {
      const newIdentity = Identity.create({ 
        name: identityName, 
        created: new Date().toISOString(),
        persona: newName,
        forkedFrom: this.identity
      });
      newIdentity.save(identityName);
    }

    forked.save();

    // Optionally fork the last snapshot for full provenance
    if (this.lastSnapshot && options.withHistory !== false) {
      try {
        const originalSnap = Snapshot.load(this.lastSnapshot);
        // Note: full snapshot forking would require extending Snapshot class
        // For now we just link via metadata
        forked.metadata.forkedSnapshot = this.lastSnapshot;
        forked.save();
      } catch (e) {
        console.warn(`  Could not link snapshot: ${e.message}`);
      }
    }

    return forked;
  }

  info() {
    return {
      ...this.toJSON(),
      hasIdentity: Identity.exists(this.identity),
      identityId: Identity.exists(this.identity) ? Identity.load(this.identity).id : null,
    };
  }
}

export default Persona;