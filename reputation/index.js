/**
 * Abavus Reputation System
 * 
 * Tracks agent reputation based on:
 * - Quality scores (manual + auto)
 * - Session success rates
 * - Efficiency metrics
 * - Verification status
 * 
 * Reputation is tied to an Identity (Ed25519 keypair).
 */

import { Identity, hash, signData } from '../core/index.js';

/**
 * Reputation score calculator
 */
export class Reputation {
  constructor(chronicle, identity) {
    this.chronicle = chronicle;
    this.identity = identity;
    this._ensureTable();
  }

  _ensureTable() {
    this.chronicle.db.run(`
      CREATE TABLE IF NOT EXISTS reputation (
        agent_id TEXT PRIMARY KEY,
        public_key TEXT NOT NULL,
        display_name TEXT,
        owner TEXT,
        
        -- Scores (0-100)
        quality_score INTEGER DEFAULT 50,
        reliability_score INTEGER DEFAULT 50,
        efficiency_score INTEGER DEFAULT 50,
        overall_score INTEGER DEFAULT 50,
        
        -- Counters
        total_sessions INTEGER DEFAULT 0,
        total_turns INTEGER DEFAULT 0,
        total_ratings INTEGER DEFAULT 0,
        positive_ratings INTEGER DEFAULT 0,
        
        -- Metadata
        created_at TEXT,
        updated_at TEXT,
        last_activity TEXT
      )
    `);

    // Attestations from external parties
    this.chronicle.db.run(`
      CREATE TABLE IF NOT EXISTS attestations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        attester_id TEXT NOT NULL,
        attester_pubkey TEXT,
        score INTEGER NOT NULL,
        comment TEXT,
        signature TEXT,
        created_at TEXT,
        FOREIGN KEY (agent_id) REFERENCES reputation(agent_id)
      )
    `);

    this.chronicle.db.run('CREATE INDEX IF NOT EXISTS idx_attestations_agent ON attestations(agent_id)');
    this.chronicle.save();
  }

  /**
   * Register an agent identity
   */
  register(identity, metadata = {}) {
    const now = new Date().toISOString();
    
    this.chronicle.db.run(`
      INSERT OR REPLACE INTO reputation 
      (agent_id, public_key, display_name, owner, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      identity.id,
      identity.publicKey.toString('hex'),
      metadata.name || 'Unknown Agent',
      metadata.owner || null,
      now,
      now
    ]);
    
    this.chronicle.save();
    return { agentId: identity.id, registered: true };
  }

  /**
   * Calculate reputation from chronicle data
   */
  calculate(agentId) {
    const now = new Date().toISOString();
    
    // Get session stats
    const sessionStats = this.chronicle.db.exec(`
      SELECT 
        COUNT(*) as total_sessions,
        SUM(turn_count) as total_turns,
        AVG(total_cost / NULLIF(turn_count, 0)) as avg_cost_per_turn
      FROM sessions
    `);
    
    const sessions = sessionStats[0]?.values[0] || [0, 0, 0];
    const [totalSessions, totalTurns, avgCostPerTurn] = sessions;

    // Get quality ratings
    const qualityStats = this.chronicle.db.exec(`
      SELECT 
        COUNT(*) as total_ratings,
        AVG(answer_relevance) as avg_relevance,
        AVG(question_clarity) as avg_clarity,
        SUM(CASE WHEN answer_relevance >= 70 THEN 1 ELSE 0 END) as positive
      FROM session_ratings
      WHERE answer_relevance IS NOT NULL
    `);
    
    const quality = qualityStats[0]?.values[0] || [0, null, null, 0];
    const [totalRatings, avgRelevance, avgClarity, positiveRatings] = quality;

    // Calculate scores
    const qualityScore = avgRelevance ? Math.round(avgRelevance) : 50;
    const reliabilityScore = totalRatings > 0 
      ? Math.round((positiveRatings / totalRatings) * 100) 
      : 50;
    
    // Efficiency: lower cost per turn = better (normalize to 0-100)
    // Assume $0.01/turn is excellent, $0.10/turn is poor
    const efficiencyScore = avgCostPerTurn 
      ? Math.max(0, Math.min(100, Math.round(100 - (avgCostPerTurn * 1000))))
      : 50;

    // Overall: weighted average
    const overallScore = Math.round(
      qualityScore * 0.4 + 
      reliabilityScore * 0.3 + 
      efficiencyScore * 0.3
    );

    // Update reputation record
    this.chronicle.db.run(`
      UPDATE reputation SET
        quality_score = ?,
        reliability_score = ?,
        efficiency_score = ?,
        overall_score = ?,
        total_sessions = ?,
        total_turns = ?,
        total_ratings = ?,
        positive_ratings = ?,
        updated_at = ?,
        last_activity = ?
      WHERE agent_id = ?
    `, [
      qualityScore,
      reliabilityScore,
      efficiencyScore,
      overallScore,
      totalSessions,
      totalTurns,
      totalRatings,
      positiveRatings,
      now,
      now,
      agentId
    ]);

    this.chronicle.save();

    return {
      agentId,
      scores: {
        quality: qualityScore,
        reliability: reliabilityScore,
        efficiency: efficiencyScore,
        overall: overallScore
      },
      stats: {
        sessions: totalSessions,
        turns: totalTurns,
        ratings: totalRatings,
        positiveRatings
      },
      updatedAt: now
    };
  }

  /**
   * Get agent reputation
   */
  get(agentId) {
    const result = this.chronicle.db.exec(
      'SELECT * FROM reputation WHERE agent_id = ?',
      [agentId]
    );
    
    if (result.length === 0 || result[0].values.length === 0) {
      return null;
    }

    const cols = result[0].columns;
    const row = result[0].values[0];
    const rep = {};
    cols.forEach((c, i) => rep[c] = row[i]);
    
    return rep;
  }

  /**
   * Add an attestation from another party
   */
  attest(agentId, attesterIdentity, score, comment = null) {
    const now = new Date().toISOString();
    
    // Create signed attestation
    const attestationData = JSON.stringify({
      agentId,
      attesterId: attesterIdentity.id,
      score,
      comment,
      timestamp: now
    });
    
    const signature = signData(attestationData, attesterIdentity.privateKey);
    
    this.chronicle.db.run(`
      INSERT INTO attestations 
      (agent_id, attester_id, attester_pubkey, score, comment, signature, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      agentId,
      attesterIdentity.id,
      attesterIdentity.publicKey.toString('hex'),
      score,
      comment,
      signature.toString('hex'),
      now
    ]);
    
    this.chronicle.save();
    
    return { 
      agentId, 
      attesterId: attesterIdentity.id, 
      score, 
      signed: true 
    };
  }

  /**
   * Get attestations for an agent
   */
  getAttestations(agentId) {
    const result = this.chronicle.db.exec(
      'SELECT * FROM attestations WHERE agent_id = ? ORDER BY created_at DESC',
      [agentId]
    );
    
    if (result.length === 0) return [];
    
    return result[0].values.map(row => {
      const obj = {};
      result[0].columns.forEach((c, i) => obj[c] = row[i]);
      return obj;
    });
  }

  /**
   * Generate a shareable reputation card
   */
  generateCard(agentId) {
    const rep = this.get(agentId);
    if (!rep) return null;

    const attestations = this.getAttestations(agentId);
    const avgAttestation = attestations.length > 0
      ? Math.round(attestations.reduce((s, a) => s + a.score, 0) / attestations.length)
      : null;

    return {
      // Identity
      agentId: rep.agent_id,
      fingerprint: `abavus:${rep.agent_id}`,
      displayName: rep.display_name,
      owner: rep.owner,
      publicKey: rep.public_key,
      
      // Scores
      scores: {
        overall: rep.overall_score,
        quality: rep.quality_score,
        reliability: rep.reliability_score,
        efficiency: rep.efficiency_score,
        attestations: avgAttestation
      },
      
      // Activity
      activity: {
        sessions: rep.total_sessions,
        turns: rep.total_turns,
        ratings: rep.total_ratings,
        attestationCount: attestations.length
      },
      
      // Verification
      verification: {
        created: rep.created_at,
        lastUpdate: rep.updated_at,
        lastActivity: rep.last_activity
      },
      
      // For embedding in posts
      badge: this._generateBadge(rep)
    };
  }

  /**
   * Generate a compact badge for social media
   */
  _generateBadge(rep) {
    const grade = this._scoreToGrade(rep.overall_score);
    return `🦉 ${rep.display_name} | ${grade} | abavus:${rep.agent_id.slice(0, 8)}`;
  }

  _scoreToGrade(score) {
    if (score >= 90) return '★★★★★';
    if (score >= 75) return '★★★★☆';
    if (score >= 60) return '★★★☆☆';
    if (score >= 40) return '★★☆☆☆';
    return '★☆☆☆☆';
  }

  /**
   * Export reputation as signed JSON (for verification)
   */
  exportSigned(agentId, signerIdentity) {
    const card = this.generateCard(agentId);
    if (!card) return null;

    const payload = JSON.stringify(card);
    const signature = signData(payload, signerIdentity.privateKey);

    return {
      payload: card,
      signature: signature.toString('hex'),
      signedBy: signerIdentity.id,
      signedAt: new Date().toISOString()
    };
  }
}

export default { Reputation };
