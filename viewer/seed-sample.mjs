import { Identity } from '../core/index.js';
import { SQLiteChronicle } from '../chronicle/sqlite.js';

const SAMPLE_MORNING = 'chronicle-sample-morning';
const SAMPLE_AFTERNOON = 'chronicle-sample-afternoon';

function ts(h, m, s = 0) {
  return new Date(Date.UTC(2026, 7, 27, h, m, s)).toISOString();
}

async function main() {
  if (!Identity.exists('default')) {
    const identity = Identity.create({ name: 'Thomas', created: new Date().toISOString() });
    identity.save('default');
    console.log('Created identity default (' + identity.id + ')');
  }

  const identity = Identity.load('default');
  const chronicle = process.env.ABAVUS_DB
    ? new SQLiteChronicle(process.env.ABAVUS_DB)
    : new SQLiteChronicle();
  await chronicle.init();

  if (chronicle.bySession(SAMPLE_MORNING, 1).length) {
    console.log('Sample chronicle already present.');
    chronicle.close();
    return;
  }

  const A = (action, payload, time) => chronicle.append(action, payload, identity, { timestamp: time });

  chronicle.batch(() => {
    const start = A('session.start', {
      sessionId: SAMPLE_MORNING,
      agent: { name: 'Thomas', id: identity.id },
      config: { model: 'sample' },
    }, ts(8, 2));

    const asked = A('message.in', {
      sessionId: SAMPLE_MORNING,
      channel: 'user',
      kind: 'commanded',
      content: 'Turn the Abavus viewer into a pleasant chronicle of acts. Calm to scroll. Four kinds: acted, said, commanded, concluded.',
    }, ts(8, 3));

    A('llm.turn', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-map',
      parentId: asked.id,
      kind: 'inferred',
      output: {
        thinking: 'The schema already has action types. Map them onto four species; payload.kind is the extension point. Parent/cause can come from turnId, parentId, replyTo.',
      },
    }, ts(8, 3, 20));

    const spoke = A('llm.turn', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-plan',
      parentId: asked.id,
      kind: 'said',
      model: 'sample',
      output: { content: 'I will read what exists, map the four kinds, and keep raw JSON folded away.' },
    }, ts(8, 4));

    A('file.read', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-plan',
      parentId: spoke.id,
      tool: 'read',
      path: 'viewer/public/index.html',
    }, ts(8, 5));

    A('file.read', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-plan',
      parentId: spoke.id,
      tool: 'read',
      path: 'chronicle/schema.js',
    }, ts(8, 6));
    const found = A('llm.turn', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-readme',
      parentId: spoke.id,
      kind: 'said',
      output: { content: 'The README still carries unresolved conflict markers around the web viewer.' },
    }, ts(8, 8));

    A('file.write', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-readme',
      parentId: found.id,
      tool: 'write',
      path: 'README.md',
    }, ts(8, 9));
    const refine = A('message.in', {
      sessionId: SAMPLE_MORNING,
      channel: 'user',
      parentId: found.id,
      kind: 'commanded',
      content: 'Show parent and cause on the row. Verify the chain in one glance.',
    }, ts(8, 14));
    const concluded = A('llm.turn', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-seal',
      parentId: refine.id,
      kind: 'inferred',
      output: { thinking: 'A seal in the masthead: pass or fail, and name the entry where the chain broke.' },
    }, ts(8, 14, 40));
    A('tool.call', {
      sessionId: SAMPLE_MORNING,
      turnId: 'turn-seal',
      parentId: concluded.id,
      tool: 'bash',
      arguments: { command: 'ls viewer/public' },
    }, ts(8, 16));
    A('session.end', {
      sessionId: SAMPLE_MORNING,
      reason: 'morning stretch complete',
      parentId: start.id,
    }, ts(8, 18));

    A('session.start', {
      sessionId: SAMPLE_AFTERNOON,
      agent: { name: 'Thomas', id: identity.id },
      parentSession: SAMPLE_MORNING,
    }, ts(13, 5));
    const laterAsk = A('message.in', {
      sessionId: SAMPLE_AFTERNOON,
      channel: 'user',
      kind: 'commanded',
      content: 'Open the day as a whole, not only a single session.',
    }, ts(13, 6));

    A('llm.turn', {
      sessionId: SAMPLE_AFTERNOON,
      turnId: 'turn-day',
      parentId: laterAsk.id,
      kind: 'said',
      output: { content: 'A day view can sit beside sessions: one spine, chapter marks when the session changes.' },
    }, ts(13, 7));

    A('llm.turn', {
      sessionId: SAMPLE_AFTERNOON,
      turnId: 'turn-close',
      parentId: laterAsk.id,
      kind: 'inferred',
      output: { thinking: 'The four species cover the existing actions. Explicit kind remains the clean extension.' },
    }, ts(13, 8));

    A('session.end', {
      sessionId: SAMPLE_AFTERNOON,
      reason: 'sample day closed',
    }, ts(13, 9));
  });

  chronicle.rebuildSessions();
  const stats = chronicle.stats();
  const verify = chronicle.verifyChain(identity);
  chronicle.close();
  console.log('Seeded sample day 2026-08-27 (' + stats.entries + ' entries).');
  console.log('Chain valid: ' + verify.valid);
}

main().catch((err) => { console.error(err); process.exit(1); });
