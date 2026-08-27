#!/usr/bin/env node
/**
 * Abavus Chronicle Viewer — local web UI for a day or session.
 */

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';
import { SQLiteChronicle } from '../chronicle/sqlite.js';
import { Identity } from '../core/index.js';
import { buildSessionReport, buildDayReport, resolveSessionQuery } from '../lib/session-report.js';
import { spoolStats } from '../lib/spool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = Number(process.env.ABAVUS_VIEWER_PORT || 3847);
const DB_PATH = process.env.ABAVUS_DB || undefined;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json; charset=utf-8');
}

async function withChronicle(fn) {
  const chronicle = DB_PATH ? new SQLiteChronicle(DB_PATH) : new SQLiteChronicle();
  await chronicle.init();
  try {
    return await fn(chronicle);
  } finally {
    chronicle.close();
  }
}

function isDayQuery(q) {
  return /^\d{4}-\d{2}-\d{2}$/.test(q || '');
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, service: 'abavus-viewer' });
  }

  if (url.pathname === '/api/stats') {
    const data = await withChronicle(async (chronicle) => {
      const stats = chronicle.stats();
      const sessions = chronicle.sessionStats(40);
      const days = chronicle.dayStats(60);
      const spool = spoolStats();
      return { stats, sessions, days, spool };
    });
    return sendJson(res, 200, data);
  }

  if (url.pathname === '/api/verify') {
    const data = await withChronicle(async (chronicle) => {
      if (!Identity.exists('default')) {
        return { valid: null, message: 'No default identity', brokeAt: null, errors: [] };
      }
      const identity = Identity.load('default');
      return chronicle.verifyChain(identity);
    });
    return sendJson(res, 200, data);
  }

  if (url.pathname === '/api/days') {
    const data = await withChronicle(async (chronicle) => ({ days: chronicle.dayStats(60) }));
    return sendJson(res, 200, data);
  }

  if (url.pathname === '/api/day') {
    const day = url.searchParams.get('date') || '';
    if (!isDayQuery(day)) {
      return sendJson(res, 400, { error: 'bad_date', hint: 'Use YYYY-MM-DD' });
    }
    const data = await withChronicle(async (chronicle) => {
      const report = buildDayReport(chronicle, day);
      return { day, report };
    });
    return sendJson(res, 200, data);
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/(.+)$/);
  if (sessionMatch) {
    const query = decodeURIComponent(sessionMatch[1]);
    if (isDayQuery(query)) {
      const data = await withChronicle(async (chronicle) => {
        const report = buildDayReport(chronicle, query);
        return { day: query, report };
      });
      return sendJson(res, 200, data);
    }
    const data = await withChronicle(async (chronicle) => {
      const resolved = resolveSessionQuery(chronicle, query);
      if (resolved.error || resolved.ambiguous) return resolved;
      const report = buildSessionReport(chronicle, resolved.sessionId);
      return { sessionId: resolved.sessionId, report };
    });
    if (data.error || data.ambiguous) {
      return sendJson(res, data.ambiguous ? 409 : 404, data);
    }
    if (!data.report) {
      return sendJson(res, 404, { error: 'not_found', query });
    }
    return sendJson(res, 200, data);
  }

  if (url.pathname === '/api/search') {
    const q = url.searchParams.get('q') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100);
    if (!q.trim()) return sendJson(res, 200, { results: [], query: q });
    const data = await withChronicle(async (chronicle) => {
      const entries = chronicle.search(q, limit);
      const results = entries.map((e) => ({
        id: e.id,
        timestamp: e.timestamp,
        action: e.action,
        session_id: e.payload?.sessionId || e.payload?._sourceSession || null,
        summary: (e.payload?.content || e.payload?.output?.content || e.payload?.message || '').toString().slice(0, 160) || e.action,
      }));
      return { results, query: q, count: results.length };
    });
    return sendJson(res, 200, data);
  }

  return sendJson(res, 404, { error: 'not_found' });
}

function serveStatic(req, res, url) {
  const filePath = join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return send(res, 404, 'Not found');
  }

  const ext = extname(filePath);
  const type = MIME[ext] || 'application/octet-stream';
  return send(res, 200, readFileSync(filePath), type);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Abavus chronicle at http://127.0.0.1:${PORT}`);
});
