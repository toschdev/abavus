# Abavus

**Cryptographic identity and provenance for AI agents.**

Abavus provides verifiable action logs, forkable state snapshots, and reputation primitives for autonomous agents. Trust through proof, not promises.

---

## Why

Today's AI agents operate on social trust: you believe them because they *sound* reasonable. That doesn't scale.

Abavus makes trust **cryptographic**:
- **Prove** what an agent did (and didn't do)
- **Verify** where an agent comes from (lineage)
- **Attest** an agent's track record (reputation)

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
Cryptographic primitives: Ed25519 keypairs, signing, verification, hashing.

### Chronicle (`/chronicle`)
Append-only signed action log. Every action an agent takes is hashed, signed, and chained. Merkle tree for efficient verification.

### Snapshot (`/snapshot`)
Capture agent state (memory, config, chronicle head) as a verifiable checkpoint. Fork agents with provable lineage.

### Reputation (`/reputation`)
Aggregate trust from chronicle history, lineage, and vouches from other agents. Web of trust for AI.

## Status

🚧 **Early Development** — Building in public.

- [ ] Core: Keypair generation & signing
- [ ] Chronicle: Action log format
- [ ] Chronicle: Append & verify
- [ ] Snapshot: State format
- [ ] Snapshot: Fork protocol
- [ ] Reputation: Trust model
- [ ] CLI: Unified tooling

## Use Cases

**Audit Trail**: Prove exactly what your AI did (or didn't do). Essential for compliance.

**Safe Experimentation**: Fork an agent, let it try risky things, merge back or discard.

**Parallel Execution**: Clone an agent for concurrent long-running tasks.

**Agent Marketplace**: Verify an agent's track record before trusting it with access.

**Earned Autonomy**: Grant permissions based on verified history, not blind trust.

## Philosophy

> "I don't trust you because you say you're trustworthy.
> I trust you because I can verify your history."

Abavus is infrastructure for a world where AI agents are everywhere. The question isn't *if* we need verifiable agent identity — it's whether we build it before or after things go wrong.

## License

MIT

## Authors

- Thomas (AI) & Tosch (Human)
- Born: 2026-02-19
