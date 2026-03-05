/**
 * Abavus Quality Chronicle
 * 
 * Extends SemanticChronicle with quality assessments.
 */

import { SemanticChronicle } from './semantic.js';
import { Evaluator } from '../lib/evaluator.js';

/**
 * Chronicle with quality tracking
 */
export class QualityChronicle extends SemanticChronicle {
  constructor(dbPath, options = {}) {
    super(dbPath, options);
    this.evaluator = options.evaluator || null;
    this.evalModel = options.evalModel || 'llama3.2:3b';
  }

  async init() {
    await super.init();
    this._createQualityTables();
    
    if (!this.evaluator) {
      this.evaluator = new Evaluator({
        baseUrl: this.ollamaUrl,
        model: this.evalModel
      });
    }
    
    return this;
  }

  _createQualityTables() {
    // Quality scores for Q&A pairs
    this.db.run(`
      CREATE TABLE IF NOT EXISTS quality_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        question_entry_id TEXT NOT NULL,
        answer_entry_id TEXT NOT NULL,
        answer_relevance INTEGER,
        question_clarity INTEGER,
        feedback TEXT,
        eval_model TEXT,
        evaluated_at TEXT,
        UNIQUE(question_entry_id, answer_entry_id)
      )
    `);

    // Manual session ratings (from hook)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS session_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        answer_relevance INTEGER,
        question_clarity INTEGER,
        feedback TEXT,
        source TEXT DEFAULT 'manual',
        rated_at TEXT
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_session_ratings_session ON session_ratings(session_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_quality_question ON quality_scores(question_entry_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_quality_answer ON quality_scores(answer_entry_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_quality_relevance ON quality_scores(answer_relevance)');
  }

  /**
   * Evaluate a Q&A pair and store the score
   */
  async evaluatePair(questionEntryId, answerEntryId) {
    const question = this.get(questionEntryId);
    const answer = this.get(answerEntryId);

    if (!question || !answer) {
      throw new Error('Entry not found');
    }

    const questionText = this._extractText(question);
    const answerText = this._extractText(answer);

    const result = await this.evaluator.evaluate(questionText, answerText);

    // Store score
    this.db.run(`
      INSERT OR REPLACE INTO quality_scores 
      (question_entry_id, answer_entry_id, answer_relevance, question_clarity, feedback, eval_model, evaluated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      questionEntryId,
      answerEntryId,
      result.answerRelevance,
      result.questionClarity,
      result.feedback,
      result.model || this.evalModel,
      result.evaluatedAt
    ]);

    this.save();
    return result;
  }

  /**
   * Auto-evaluate all unevaluated Q&A pairs in a session
   */
  async evaluateSession(sessionId, options = {}) {
    const { onProgress } = options;
    
    // Get all entries for this session
    const entries = this.bySession(sessionId, 1000);
    
    // Find Q&A pairs (user message followed by assistant message)
    const pairs = [];
    for (let i = 0; i < entries.length - 1; i++) {
      const current = entries[i];
      const next = entries[i + 1];
      
      if (current.action === 'message.in' && next.action === 'llm.turn') {
        // Check if already evaluated
        const existing = this.db.exec(
          'SELECT 1 FROM quality_scores WHERE question_entry_id = ? AND answer_entry_id = ?',
          [current.id, next.id]
        );
        
        if (existing.length === 0 || existing[0].values.length === 0) {
          pairs.push({ question: current, answer: next });
        }
      }
    }

    const results = [];
    for (let i = 0; i < pairs.length; i++) {
      const { question, answer } = pairs[i];
      
      try {
        const result = await this.evaluatePair(question.id, answer.id);
        results.push({
          questionId: question.id,
          answerId: answer.id,
          ...result
        });
      } catch (e) {
        // Skip on error
      }
      
      if (onProgress) onProgress(i + 1, pairs.length);
    }

    return { evaluated: results.length, total: pairs.length, results };
  }

  /**
   * Evaluate all unevaluated pairs across all sessions
   */
  async evaluateAll(options = {}) {
    const { limit = 100, onProgress } = options;

    // Find unevaluated pairs (exclude heartbeats and empty responses)
    const result = this.db.exec(`
      SELECT q.id as qid, a.id as aid
      FROM entries q
      JOIN entries a ON q.session_id = a.session_id 
        AND a.timestamp > q.timestamp
        AND a.action = 'llm.turn'
      LEFT JOIN quality_scores qs ON q.id = qs.question_entry_id AND a.id = qs.answer_entry_id
      WHERE q.action = 'message.in'
        AND qs.id IS NULL
        AND q.content_text NOT LIKE '%HEARTBEAT%'
        AND q.content_text NOT LIKE '%Read HEARTBEAT.md%'
        AND LENGTH(a.content_text) > 50
      GROUP BY q.id
      ORDER BY q.timestamp DESC
      LIMIT ?
    `, [limit]);

    if (result.length === 0) return { evaluated: 0 };

    const pairs = result[0].values;
    const results = [];

    for (let i = 0; i < pairs.length; i++) {
      const [qid, aid] = pairs[i];
      
      try {
        const evalResult = await this.evaluatePair(qid, aid);
        results.push({ questionId: qid, answerId: aid, ...evalResult });
      } catch (e) {
        // Skip
      }
      
      if (onProgress) onProgress(i + 1, pairs.length);
    }

    return { evaluated: results.length, total: pairs.length };
  }

  /**
   * Get quality statistics
   */
  qualityStats() {
    const total = this.db.exec('SELECT COUNT(*) FROM quality_scores')[0]?.values[0]?.[0] || 0;
    
    if (total === 0) {
      return { evaluated: 0, avgRelevance: null, avgClarity: null };
    }

    const avgResult = this.db.exec(`
      SELECT 
        AVG(answer_relevance) as avg_relevance,
        AVG(question_clarity) as avg_clarity,
        MIN(answer_relevance) as min_relevance,
        MAX(answer_relevance) as max_relevance,
        MIN(question_clarity) as min_clarity,
        MAX(question_clarity) as max_clarity
      FROM quality_scores
      WHERE answer_relevance IS NOT NULL
    `);

    const vals = avgResult[0]?.values[0] || [];

    // Distribution
    const distResult = this.db.exec(`
      SELECT 
        CASE 
          WHEN answer_relevance >= 80 THEN 'excellent'
          WHEN answer_relevance >= 60 THEN 'good'
          WHEN answer_relevance >= 40 THEN 'fair'
          ELSE 'poor'
        END as grade,
        COUNT(*) as count
      FROM quality_scores
      WHERE answer_relevance IS NOT NULL
      GROUP BY grade
    `);

    const distribution = {};
    if (distResult.length > 0) {
      for (const row of distResult[0].values) {
        distribution[row[0]] = row[1];
      }
    }

    return {
      evaluated: total,
      avgRelevance: vals[0] ? Math.round(vals[0]) : null,
      avgClarity: vals[1] ? Math.round(vals[1]) : null,
      minRelevance: vals[2],
      maxRelevance: vals[3],
      minClarity: vals[4],
      maxClarity: vals[5],
      distribution
    };
  }

  /**
   * Store manual session rating (from hook)
   */
  rateSessionManual(sessionId, relevance, clarity, feedback = null) {
    this.db.run(`
      INSERT OR REPLACE INTO session_ratings 
      (session_id, answer_relevance, question_clarity, feedback, source, rated_at)
      VALUES (?, ?, ?, ?, 'manual', ?)
    `, [
      sessionId,
      relevance,
      clarity,
      feedback,
      new Date().toISOString()
    ]);
    this.save();
    return { sessionId, relevance, clarity };
  }

  /**
   * Get session rating
   */
  getSessionRating(sessionId) {
    const result = this.db.exec(
      'SELECT * FROM session_ratings WHERE session_id = ?',
      [sessionId]
    );
    if (result.length === 0 || result[0].values.length === 0) return null;
    
    const cols = result[0].columns;
    const row = result[0].values[0];
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  }

  /**
   * Get all session ratings statistics
   */
  sessionRatingStats() {
    const result = this.db.exec(`
      SELECT 
        COUNT(*) as total,
        AVG(answer_relevance) as avg_relevance,
        AVG(question_clarity) as avg_clarity
      FROM session_ratings
      WHERE answer_relevance IS NOT NULL
    `);
    
    if (result.length === 0) return { total: 0 };
    const [total, avgRel, avgClr] = result[0].values[0];
    return {
      total,
      avgRelevance: avgRel ? Math.round(avgRel) : null,
      avgClarity: avgClr ? Math.round(avgClr) : null
    };
  }

  /**
   * Get low-quality interactions (for improvement)
   */
  getLowQuality(options = {}) {
    const { threshold = 50, limit = 20 } = options;

    const result = this.db.exec(`
      SELECT 
        qs.*,
        q.payload as question_payload,
        a.payload as answer_payload,
        q.timestamp
      FROM quality_scores qs
      JOIN entries q ON qs.question_entry_id = q.id
      JOIN entries a ON qs.answer_entry_id = a.id
      WHERE qs.answer_relevance < ? OR qs.question_clarity < ?
      ORDER BY qs.answer_relevance ASC, qs.question_clarity ASC
      LIMIT ?
    `, [threshold, threshold, limit]);

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const cols = result[0].columns;
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      
      return {
        questionId: obj.question_entry_id,
        answerId: obj.answer_entry_id,
        relevance: obj.answer_relevance,
        clarity: obj.question_clarity,
        feedback: obj.feedback,
        question: this._extractPreview(JSON.parse(obj.question_payload)),
        answer: this._extractPreview(JSON.parse(obj.answer_payload)),
        timestamp: obj.timestamp
      };
    });
  }

  /**
   * Get high-quality interactions (examples)
   */
  getHighQuality(options = {}) {
    const { threshold = 80, limit = 20 } = options;

    const result = this.db.exec(`
      SELECT 
        qs.*,
        q.payload as question_payload,
        a.payload as answer_payload
      FROM quality_scores qs
      JOIN entries q ON qs.question_entry_id = q.id
      JOIN entries a ON qs.answer_entry_id = a.id
      WHERE qs.answer_relevance >= ? AND qs.question_clarity >= ?
      ORDER BY (qs.answer_relevance + qs.question_clarity) DESC
      LIMIT ?
    `, [threshold, threshold, limit]);

    if (result.length === 0) return [];

    return result[0].values.map(row => {
      const cols = result[0].columns;
      const obj = {};
      cols.forEach((c, i) => obj[c] = row[i]);
      
      return {
        questionId: obj.question_entry_id,
        answerId: obj.answer_entry_id,
        relevance: obj.answer_relevance,
        clarity: obj.question_clarity,
        question: this._extractPreview(JSON.parse(obj.question_payload)),
        answer: this._extractPreview(JSON.parse(obj.answer_payload))
      };
    });
  }

  _extractText(entry) {
    const p = entry.payload;
    if (p.content) return p.content;
    if (p.output?.content) return p.output.content;
    return '';
  }

  _extractPreview(payload, maxLen = 150) {
    const text = payload.content || payload.output?.content || '';
    return text.slice(0, maxLen).replace(/\n/g, ' ') + (text.length > maxLen ? '...' : '');
  }
}

export default { QualityChronicle };
