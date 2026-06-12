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
    // Primary key for pseudonymity: the cryptographic identity ID
    // (stable across renames and forks; used globally)
    this.persona_id = data.persona_id || data.identity_id || null;
    
    // Local human-friendly name (optional, can collide, purely for UX on this machine)
    this.local_name = data.local_name || data.name || null;
    
    // Link to the underlying Abavus Ed25519 identity (for signing)
    this.identity = data.identity || data.local_name || this.persona_id;
    
    this.description = data.description || '';
    this.strengths = data.strengths || [];
    
    // Knowledge objects (distilled learning). Each has id, type, content, provenance (incl. llm_model)
    // Not "all data" — only explicitly attached or extracted knowledge.
    this.knowledge = data.knowledge || []; // array of KnowledgeObject refs or full objects
    
    this.created = data.created || new Date().toISOString();
    this.lastSnapshot = data.lastSnapshot || null;
    this.metadata = data.metadata || {};
    
    // For global/published personas
    this.published_cid = data.published_cid || null; // IPFS/Arweave CID of the bundle
    this.anchored_root = data.anchored_root || null; // hash anchored on chain/Celestia
  }

  static ensureDir() {
    if (!existsSync(PERSONAS_DIR)) {
      mkdirSync(PERSONAS_DIR, { recursive: true });
    }
  }

  static pathFor(localName) {
    return join(PERSONAS_DIR, `${localName}.json`);
  }

  static exists(localName) {
    Persona.ensureDir();
    return existsSync(Persona.pathFor(localName));
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
      persona_id: options.persona_id || null, // will be set from identity if not provided
      local_name: name,
      identity: identityName,
      description: options.description || '',
      strengths: options.strengths ? options.strengths.split(',').map(s => s.trim()) : [],
      knowledge: options.knowledge ? options.knowledge.split(',').map(k => ({ id: k, type: 'ref', content: k, provenance: {} })) : [],
      created: new Date().toISOString(),
    });
    
    // Link cryptographic persona_id to the identity's stable ID
    if (!persona.persona_id && Identity.exists(identityName)) {
      const id = Identity.load(identityName);
      persona.persona_id = id.id;
    }

    // Optionally create initial snapshot if knowledge provided
    if (persona.knowledge.length > 0) {
      // This would require chronicle access; for now just note it
      persona.metadata.initialKnowledge = persona.knowledge;
    }

    persona.save();
    return persona;
  }

  static load(localName) {
    Persona.ensureDir();
    const path = Persona.pathFor(localName);
    if (!existsSync(path)) {
      throw new Error(`Persona '${localName}' not found.`);
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
    if (!this.local_name) {
      throw new Error('Cannot save persona without a local_name');
    }
    Persona.ensureDir();
    const path = Persona.pathFor(this.local_name);
    writeFileSync(path, JSON.stringify(this.toJSON(), null, 2), 'utf8');
  }

  toJSON() {
    return {
      persona_id: this.persona_id,
      local_name: this.local_name,
      identity: this.identity,
      description: this.description,
      strengths: this.strengths,
      knowledge: this.knowledge, // array of {id, type, content, provenance: {llm_model, ...}}
      created: this.created,
      lastSnapshot: this.lastSnapshot,
      published_cid: this.published_cid,
      anchored_root: this.anchored_root,
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
      persona_id: null, // will get new from its new identity
      local_name: newName,
      identity: options.identity || `${this.identity}-fork-${Date.now().toString(36)}`,
      description: options.description || `Fork of ${this.local_name || this.persona_id}: ${this.description}`,
      strengths: [...this.strengths],
      knowledge: [...this.knowledge],
      created: new Date().toISOString(),
      metadata: {
        ...this.metadata,
        forkedFrom: this.local_name || this.persona_id,
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

  /**
   * Add a knowledge object to this persona.
   * provenance can include: { llm_model: 'anthropic/claude-opus-4-5', source_turn_id: '...', prompt_hash: '...' }
   */
  addKnowledge(knowledgeObj) {
    if (!knowledgeObj.id) {
      knowledgeObj.id = 'know_' + Math.random().toString(36).slice(2, 10);
    }
    if (!knowledgeObj.provenance) knowledgeObj.provenance = {};
    if (!knowledgeObj.type) knowledgeObj.type = 'insight';
    
    // Ensure llm_model is captured if provided (user request)
    // Example: when extracting from an llm.turn, pass the model from the turn payload
    this.knowledge.push(knowledgeObj);
    this.save();
    return knowledgeObj;
  }

  /**
   * Get knowledge, optionally filtered by llm_model or type.
   */
  getKnowledge(filter = {}) {
    return this.knowledge.filter(k => {
      if (filter.llm_model && k.provenance?.llm_model !== filter.llm_model) return false;
      if (filter.type && k.type !== filter.type) return false;
      return true;
    });
  }

  /**
   * Display summary of the persona's learning (knowledge objects).
   * This is how "learning" is surfaced locally.
   */
  displayLearning() {
    const knowledge = this.getKnowledge();
    if (knowledge.length === 0) {
      return `Persona ${this.local_name || this.persona_id} has no explicit knowledge objects yet.`;
    }
    let out = `Learning for ${this.local_name || this.persona_id} (${knowledge.length} items):\n`;
    knowledge.forEach((k, i) => {
      const model = k.provenance?.llm_model || 'unknown';
      out += `  [${i+1}] ${k.type}: ${k.id} (model: ${model})\n`;
      if (k.content?.question || k.content?.name) {
        out += `      ${JSON.stringify(k.content).slice(0, 120)}...\n`;
      }
    });
    return out;
  }
}

export default Persona;