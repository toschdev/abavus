# Abavus

**Cryptographic identity and provenance for AI agents.**

Abavus provides verifiable action logs for autonomous agents. Every action is hashed, signed, and chained — creating an immutable audit trail that proves exactly what an AI did (and didn't do).

> *abavus* (Latin): great-great-grandfather — because provenance is about lineage.

## Why

Today's AI agents operate on social trust: you believe them because they *sound* reasonable. That doesn't scale.

Abavus makes trust **cryptographic**:
- **Prove** what an agent did with signed, hash-chained logs
- **Search** through complete interaction history
- **Verify** the integrity of the entire chain
- **Query** by action type, session, time range, or full-text

## Features

- 🔐 **Ed25519 Signatures** — Every entry cryptographically signed
- ⛓️ **Hash Chain** — Tamper-evident linked entries
- 🔍 **Full-text Search** — Find anything in your agent's history
- 📊 **Analytics** — Tool usage stats, session summaries
- 💾 **SQLite Storage** — Fast queries, portable database
- 🔌 **OpenClaw Integration** — Import existing session logs

## Quick Start

```bash
# Install
git clone https://github.com/YOUR_USERNAME/abavus.git
cd abavus
npm install

# Create identity
node cli/abavus.js init

# Import OpenClaw sessions (if you use OpenClaw)
node cli/abavus.js import

# Explore
node cli/abavus.js stats
node cli/abavus.js search "web_search"
node cli/abavus.js tools
```

## CLI Commands

```
Identity:
  init [name]           Create a new identity
  id [name]             Show identity info

Chronicle:
  log <action> [json]   Append an entry
  recent [n]            Show last n entries
  search <query>        Full-text search
  stats                 Show statistics
  verify                Verify chain integrity

Query:
  by-action <action>    Filter by action type
  by-session <id>       Filter by session
  by-time <from> <to>   Filter by time range
  tools                 Tool usage statistics

Import:
  import                Import OpenClaw sessions
  import --force        Re-import everything
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    ABAVUS                        │
├─────────────────────────────────────────────────┤
│  ┌───────────┐  ┌───────────┐  ┌────────────┐  │
│  │ Chronicle │  │ Snapshot  │  │ Reputation │  │
│  │  (logs)   │  │  (state)  │  │  (trust)   │  │
│  └─────┬─────┘  └─────┬─────┘  └──────┬─────┘  │
│        │              │               │         │
│        └──────────────┼───────────────┘         │
│                       ▼                         │
│               ┌─────────────┐                   │
│               │    Core     │                   │
│               │  (crypto)   │                   │
│               └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

### Core (`/core`)
Ed25519 keypairs, signing, verification, SHA-256 hashing.

### Chronicle (`/chronicle`)
Append-only signed action log stored in SQLite. Every entry contains:
- Timestamp
- Action type & payload
- Hash of previous entry (chain)
- Agent signature

### Snapshot (`/snapshot`)
Capture agent state as a verifiable checkpoint. Fork agents with provable lineage.

- **Capture**: Memory files, chronicle state, agent identity
- **Sign**: Cryptographic signature for verification
- **Fork**: Create new agents with traceable lineage
- **Diff**: Compare two snapshots

### Reputation (`/reputation`)
Trust scores from chronicle history and vouches from other agents.

- **Scores**: Quality, Reliability, Efficiency
- **Attestations**: Signed vouches from other agents
- **Badge**: Shareable identity for social media

## Data Location

```
~/.abavus/
├── keys/           # Ed25519 keypairs
│   ├── default.pub
│   ├── default.key
│   └── default.json
├── chronicle.db    # SQLite database
└── openclaw-import-state.json
```

## Use Cases

- **Audit Trail**: Prove exactly what your AI did for compliance
- **Debugging**: Search through past interactions to find issues  
- **Analytics**: Understand tool usage patterns
- **Verification**: Detect if logs have been tampered with

## Roadmap

- [x] Core: Ed25519 keypairs & signing
- [x] Chronicle: SQLite storage with hash chain
- [x] Chronicle: Full-text search & semantic search
- [x] OpenClaw: Session import & live watching
- [x] Snapshot: State capture & fork protocol
- [x] Reputation: Trust scores & attestations
- [ ] Web UI: Browse & search
- [ ] Blockchain: On-chain attestations

## License

MIT

## Authors

Built by Thomas (AI) & Tosch (Human)

Website: [abavus.ai](https://abavus.ai)
