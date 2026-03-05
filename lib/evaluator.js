/**
 * Abavus Evaluator
 * 
 * Automatic quality assessment of AI interactions:
 * - Answer relevance: How well does the answer address the question?
 * - Question clarity: Was the question specific enough?
 */

/**
 * LLM-based evaluator using Ollama
 */
export class Evaluator {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'http://localhost:11434';
    this.model = options.model || 'llama3.2:3b'; // Small & fast for evaluation
  }

  /**
   * Evaluate a question-answer pair
   */
  async evaluate(question, answer) {
    const prompt = `You are an AI interaction quality evaluator. Analyze this conversation and provide scores.

QUESTION:
${question}

ANSWER:
${answer}

Rate the following on a scale of 0-100:

1. ANSWER_RELEVANCE: How well does the answer address the question?
   - 100 = Perfect, directly answers everything asked
   - 70 = Good, answers most of it
   - 50 = Partial, misses key points
   - 30 = Weak, tangentially related
   - 0 = Completely off-topic

2. QUESTION_CLARITY: How clear and specific was the question?
   - 100 = Crystal clear, specific, actionable
   - 70 = Clear enough, minor ambiguity
   - 50 = Somewhat vague, could be interpreted multiple ways
   - 30 = Unclear, missing important context
   - 0 = Incomprehensible

3. BRIEF_FEEDBACK: One sentence suggestion for improvement (if any).

Respond in this exact JSON format only:
{"answer_relevance": <number>, "question_clarity": <number>, "feedback": "<string>"}`;

    try {
      const response = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.1, // Low temp for consistent scoring
            num_predict: 150
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.status}`);
      }

      const data = await response.json();
      const text = data.response.trim();
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse evaluation response');
      }

      const result = JSON.parse(jsonMatch[0]);
      
      return {
        answerRelevance: Math.min(100, Math.max(0, result.answer_relevance || 0)),
        questionClarity: Math.min(100, Math.max(0, result.question_clarity || 0)),
        feedback: result.feedback || null,
        model: this.model,
        evaluatedAt: new Date().toISOString()
      };
    } catch (e) {
      // Return null scores on error, don't block
      return {
        answerRelevance: null,
        questionClarity: null,
        feedback: null,
        error: e.message,
        evaluatedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Quick relevance check (faster, less accurate)
   */
  async quickScore(question, answer) {
    // Use embeddings for quick semantic similarity
    // This is faster but less nuanced than LLM evaluation
    
    const embedResponse = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: question
      })
    });
    
    const answerResponse = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: answer.slice(0, 2000) // Truncate long answers
      })
    });

    if (!embedResponse.ok || !answerResponse.ok) {
      throw new Error('Embedding failed');
    }

    const qEmbed = (await embedResponse.json()).embedding;
    const aEmbed = (await answerResponse.json()).embedding;
    
    // Cosine similarity as rough relevance proxy
    const similarity = cosineSimilarity(qEmbed, aEmbed);
    
    return {
      answerRelevance: Math.round(similarity * 100),
      method: 'embedding-similarity'
    };
  }
}

/**
 * Cosine similarity
 */
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Batch evaluate conversation turns
 */
export async function evaluateConversation(turns, evaluator) {
  const results = [];
  
  for (let i = 0; i < turns.length - 1; i++) {
    const current = turns[i];
    const next = turns[i + 1];
    
    // Look for question -> answer pairs
    if (current.role === 'user' && next.role === 'assistant') {
      const question = extractText(current);
      const answer = extractText(next);
      
      if (question && answer) {
        const evaluation = await evaluator.evaluate(question, answer);
        results.push({
          questionId: current.id,
          answerId: next.id,
          question: question.slice(0, 200),
          answer: answer.slice(0, 200),
          ...evaluation
        });
      }
    }
  }
  
  return results;
}

function extractText(message) {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }
  return message.payload?.content || message.payload?.output?.content || '';
}

export default { Evaluator, evaluateConversation };
