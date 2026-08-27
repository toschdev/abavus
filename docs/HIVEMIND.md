# Abavus + HIVEMIND — Personas, Collective Agent Intelligence & Verifiable Knowledge Sharing

> Cryptographic personas with provenance, sharing attested knowledge, building a trust network across agents. Pseudonymous by default, with optional local names and global curation via lightweight anchoring.

## Vision (Updated)

Jeder Agent startet heute bei Null. Das ist ineffizient.

**Abavus + HIVEMIND** ermöglicht:
- **Personas**: Pseudonyme, fork-bare, verifizierbare "Personalitäten" mit eigener Identität, Stärken, Historie und Wissen (nicht "all my data", sondern kuratierte Knowledge Objects).
- Agenten teilen verifiziertes Wissen (Insights, Skills, Patterns) mit Provenienz (inkl. LLM-Modell, Source-Turn, Signatur).
- Kollektives Lernen aus Erfahrungen via Attestations und Reputation.
- Vertrauensnetzwerk: Web of Trust, Consensus über Qualität.
- Leichtgewichtiges Anchoring: Kein schwerer App-Chain nötig — Content via IPFS/Arweave (kostenlos als Protokoll; Persistence via Pinning/Filecoin/Arweave), Roots/Attestations via Celestia (DA, low cost) + minimaler CosmWasm Contract auf günstiger Cosmos Chain (z.B. Osmosis Testnet oder Neutron) für Timestamps und Verifizierbarkeit. Kein "huge state" — nur Hashes/Roots, keine vollen Daten.
- Personas als Agents laufen lassen: Lade Snapshot + Knowledge, signiere Actions mit Persona-Key, logge zurück in die Persona-Chronicle. Ideal für Content Creation, Trading, Research etc.
- Incentives: Reputation, Attestations als Social Proof, optional leichte Token-Ökonomie.

**Pseudonymity by default**: Die primäre ID ist der kryptografische Hash der Ed25519 Public Key (stable, global unique). Lokale Namen (z.B. "researcher-v2") sind optional und nur lokal (können kollidieren). Globale Referenz immer via persona_id (z.B. abavus:77503772e4c21262).

Das System startet "light" (shared SQLite Chronicle mit Tagging via agent_id/identity, lokale Personas), kann später restriktiver/global werden (separate Stores, volle P2P).

## Core Principles (from our discussions)
- **Recall (1)**: Was besprochen/entschieden? Kuratierte Knowledge Objects + verlinkte Chronicle Entries (filterbar per Persona).
- **Integrity (2)**: Alles signiert (Ed25519), Hash-Chained, Snapshots für Forks mit Lineage. Anchors auf Chain/Celestia für globale Verifizierbarkeit.
- **Transparency (3)**: Was im Hintergrund? Volle Chronicle-Logs (llm.turn mit Model/Thinking/Usage, tool.call, file ops). Viewer zeigt Timeline mit Modell-Info.
- **Rich Personas (4)**: Eigene Stärken, Historie, Wissen — nicht loose "all my data". Curated Subset. Fork mit Provenienz. LLM-Modell in jeder Knowledge Provenance für Audit.

Personas sind **nicht** lose über alle Daten: Knowledge ist explizit attached/extracted (z.B. via addKnowledge mit llm_model aus dem Turn). Raw Chronicle ist der Audit-Trail (query via persona's identity). Bei Publish nur selektierte Knowledge + Root.

## Architecture (Updated with Personas & Lightweight Anchoring)

```
┌─────────────────────────────────────────────────────────────────┐
│              ABAVUS + HIVEMIND NETWORK                          │
├─────────────────────────────────────────────────────────────────┤
│  Personas (pseudonymous, forkable, with local names)            │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                  │
│  │ Persona  │    │ Persona  │    │ Persona  │  (crypto ID +    │
│  │  "res."  │    │  "coder" │    │ "trader" │   optional name) │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘                  │
│       │               │               │                        │
│       └───────────────┴───────────────┴───────────────┘        │
│                               │                                │
│                               ▼                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              KNOWLEDGE LAYER (per Persona)               │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │  Insights   │  │   Skills    │  │  Patterns   │      │   │
│  │  │ (Q&A + LLM  │  │ (How-to +   │  │ (Errors +   │      │   │
│  │  │  model in   │  │  steps +    │  │  fix +      │      │   │
│  │  │  provenance)│  │  model)     │  │  model)     │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  │  + Attestations, Reputation Scores                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                               │                                │
│                               ▼                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              PROVENANCE & TRUST LAYER                    │   │
│  │  Abavus Chronicle (local signed logs) + Snapshots (forks)│   │
│  │  + Attestations (signed vouches from other Personas)     │   │
│  │  + Lightweight Anchoring:                                │   │
│  │    - Content: IPFS (free protocol) / Arweave (pay-once)  │   │
│  │    - DA/Roots: Celestia (cheap blobs, no huge state)     │   │
│  │    - Attestations/Roots (minimal): CosmWasm on cheap     │   │
│  │      Cosmos chain (e.g. Osmosis/Neutron testnet) — only  │   │
│  │      (persona_id, root_hash, sig, timestamp, Celestia    │   │
│  │      height). Kein "huge state", low devops (bestehende  │   │
│  │      Chains nutzen, keine eigene Validator-Run).         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                               │                                │
│                               ▼                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   STORAGE & DISCOVERY                    │   │
│  │  IPFS/Arweave (Content) + Celestia (DA) + Index (SQLite/│   │
│  │  Meili locally; global via P2P) + Abavus Viewer (local)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Execution: Persona als Agent laufen (Snapshot + Knowledge     │   │
│  laden, mit Persona-Key signen, Chronicle loggen).             │   │
└─────────────────────────────────────────────────────────────────┘
```

(Updated from original HIVEMIND: Personas als Core, Abavus als Base, Celestia für low-state DA, minimal CosmWasm statt full AppChain.)

## Personas (Core Extension)

**Pseudonymity by default**: persona_id = crypto hash der Ed25519 Public Key (stable, global). Lokale Namen optional (z.B. "researcher-v2" nur auf deiner Machine; kollidieren ok). Globale Referenz immer via persona_id + Signature.

**Nicht "all my data"**: Knowledge ist explizit curatiert (nicht auto alles aus deinem Log). Raw History = Chronicle (filterbar per signing identity). Bei Publish nur selektierte Objects + Root.

**Learning Display**:
- **Local**: `abavus persona <local_name> show` / `knowledge` / `display-learning` (listet Objects mit type, id, llm_model aus Provenance, truncated content).
- **Viewer Integration**: In der 3847 Webview Sessions nach Persona filtern; Timeline Items mit Model-Info; dedizierter Persona/Knowledge View (zukünftig).
- **Published**: IPFS-Bundle mit index.json + knowledge/*.json (mit full provenance + llm_model). "Learning" als browseable Liste von verifizierten Objects + Attestations. Verifizierbar via anchored Root.
- **When running as Agent**: Lade Persona (Key + Snapshot + Knowledge), injiziere Knowledge als Context, logge Actions in Persona-Chronicle (mit Model aus dem Turn). Neue Insights auto oder manuell als Knowledge Object mit llm_model taggen.

**Data Model (Konkret, erweiterbar)**:

**Persona** (lokal + published):
```json
{
  "persona_id": "77503772e4c21262",  // crypto primary key
  "local_name": "researcher",       // optional, local only
  "identity": "researcher",         // Abavus identity name (for local load)
  "description": "...",
  "strengths": ["analysis", "fact-checking"],
  "knowledge": ["insight_abc123", "skill_def456"],  // refs to objects
  "created": "...",
  "lastSnapshot": "snap_xyz",
  "published_cid": "ipfs://Qm...",
  "anchored_root": "celestia-blob-hash-or-cosm-root",
  "metadata": {}
}
```

**Knowledge Object** (Insight/Skill/Pattern — mit LLM Model!):
```json
{
  "id": "insight_abc123",
  "type": "insight",  // "insight" | "skill" | "pattern"
  "persona_id": "77503772e4c21262",
  "content": {
    "question": "How does IPFS work without central charges?",
    "answer": "Protocol is free/p2p (no central billing). Persistence via self-pinning, Pinata (paid convenience), Filecoin (incentivized storage/retrieval) or Arweave (pay-once permanent).",
    "context": "..."
  },
  "provenance": {
    "source": "llm.turn:turn_987",   // link to Abavus chronicle entry
    "llm_model": "anthropic/claude-opus-4-5",  // **added as requested**
    "llm_version": "20240229",
    "prompt_hash": "sha256:...",
    "timestamp": "...",
    "signature": "ed25519-sig-by-persona-key"
  },
  "content_hash": "ipfs://Qm...",   // for global
  "attestations": [ { "from": "other_persona_id", "score": 92, "sig": "..." } ]
}
```

**Snapshots**: Erweitert für Personas (capture selected knowledge + chronicle head + persona metadata). Fork mit full lineage (parent snapshot, generation, sig).

## Lightweight Blockchain Anchoring (Cosmos-savvy, low state)

Deine Bedenken sind valide: Voller App-Chain = heavy devops + state bloat (besonders bei vielen Attestations/Knowledge).

**Empfohlene leichte Strategie** (kein "huge state", minimale DevOps — nutze bestehende Chains/Clients):

- **Content/Knowledge**: IPFS (Protokoll kostenlos; keine "charges" wie zentrale Clouds. Persistence: self-host Node + pinning, oder Services wie Pinata (monatlich für Volume/Bandwidth), Web3.Storage (generous free tier), Filecoin (pay miners for deals — retrieval/storage fees in FIL), Arweave (pay-once für ~200+ Jahre basierend auf Pricing).
- **Data Availability + Roots**: **Celestia** (perfekt für low state — post blobs mit Roots/Attestations. Günstig, permanent DA, kein Settlement-State-Bloat. Cosmos-friendly via IBC/Celestia clients. Light client statt full node).
- **Minimal Anchoring/Ordering** (optional für Verifizierbarkeit): Winziger CosmWasm Contract auf einer günstigen/existierenden Cosmos Chain (z.B. Osmosis, Juno, Neutron — oder Testnet zum Start). Nur speichern:
  ```rust
  // Pseudocode CosmWasm
  struct PersonaAnchor {
      persona_id: String,      // crypto ID
      root_hash: [u8; 32],     // Merkle root of knowledge + snapshot
      signature: Vec<u8>,      // von Persona-Key
      timestamp: u64,
      celestia_blob_id: Option<String>,  // wo die Daten/Root live
  }
  // Execute: store_anchor(persona_id, root, sig, ts, celestia_id)
  // Query: get_anchors(persona_id) -> Vec<Anchor>
  ```
  State: Nur Roots/Attestations (winzig, skaliert nicht mit Datenmenge). Keine vollen Personas/Knowledge on-chain. DevOps: Deploy Contract via existing tooling (kein eigener Validator-Run nötig; nutze Public RPCs oder light clients). Für Cosmos-Savvy: IBC für Cross-Chain Queries, oder direkt auf einer Chain mit low fees.

**Vorteile**: Niedrige Kosten, kein State-Bloat (Content off-chain, nur Hashes/Roots), hohe Verifizierbarkeit (Signature + Celestia DA + on-chain Timestamp). Für Production: Starte mit Celestia + optional light Contract auf Testnet. Kein "heavy load".

**Spam/Privacy**: Lokale Curation + Attestations (Reputation als Filter). Private Knowledge bleibt local; nur published Roots geteilt. Stake oder Invite für early global Layer.

## Minimal Implementation (in Abavus integriert)

Wir haben bereits ein Fundament in `lib/persona.js` (erweitert mit persona_id vs local_name, Knowledge Objects mit llm_model in Provenance, addKnowledge, getKnowledge, displayLearning, Fork mit Lineage, published_cid/anchored_root Stubs).

**Erweiterungen (minimal, als Start für HIVEMIND-Integration)**:

- **Erweiterte Persona + Knowledge** (bereits partiell implementiert; siehe aktuelles persona.js):
  - Knowledge Objects mit LLM-Modell (wie gewünscht).
  - Publish Stub: Generiere Bundle (Persona + Knowledge + Snapshot Refs), "upload" zu IPFS (in echt via ipfs-http-client oder CLI), compute Root, "anchor" (print Celestia command + CosmWasm tx Beispiel).
  - Attest: `abavus persona attest <target_id> --strength "X" --score 85 --comment "..."` (speichert signed Entry in Chronicle; später publish/anchor).

- **CLI Erweiterungen** (in cli/abavus.js, bereits Basics für create/personas/persona show/knowledge/add-knowledge/fork):
  ```bash
  abavus create persona researcher --description "..." --strengths "analysis,..." --knowledge "file1.md"
  abavus personas
  abavus persona researcher show          # + displayLearning() mit Models
  abavus persona researcher knowledge list --model "claude-opus-4-5"
  abavus persona researcher add-knowledge insight "..." --llm-model "..."
  abavus persona researcher publish       # IPFS + Root + anchor stub
  abavus persona researcher attest <other> --score 90
  abavus fork persona researcher as specialist
  abavus run-as-persona researcher "your task"  # future: load state, sign as persona, log to its chronicle
  ```

- **Integration mit Abavus Core**:
  - Logging (grok-events, session-report, daemon): Tag mit persona (via --persona oder current). Bei llm.turn: capture model in Knowledge-Provenance wenn Insight extrahiert wird (via embeddings/evaluator).
  - Snapshots: Erweitere capture für Persona-Metadata + selected Knowledge.
  - Viewer (3847): Erweitere um Persona-Filter (Sessions/Knowledge nach persona_id), Knowledge-View (list Objects mit Model), Export von Persona-Bundles.

- **Anchoring Stub** (in lib/hivemind.js oder persona.js):
  ```js
  async function publishAndAnchor(persona) {
    // 1. Build bundle
    const bundle = { persona: persona.toJSON(), knowledge: persona.getKnowledge() };
    const cid = await fakeIpfsAdd(JSON.stringify(bundle));  // in echt: ipfs.add
    persona.published_cid = cid;

    // 2. Compute root
    const root = hash(JSON.stringify({ cid, lastSnapshot: persona.lastSnapshot }));

    // 3. "Anchor" (stub — user führt aus)
    const anchorCmd = `celestia blob submit --namespace abavus --data ${root}... && osmosis tx wasm execute <contract> '{"anchor":{"persona_id":"${persona.persona_id}","root":"${root}"}}' --from <your-key>`;
    console.log("Run this for anchoring (low state):", anchorCmd);
    persona.anchored_root = root;
    persona.save();
    return { cid, root };
  }
  ```

- **Viewer/CLI für Display**: Bereits displayLearning() mit llm_model. In Viewer: Filter Sessions nach Persona, zeige Knowledge mit Model in Timeline/Results.

**Usage Strategies** (best practices):
- **Erstelle spezialisierte Personas**: `create persona coder --strengths "refactoring,debugging" --knowledge "./code-patterns/"`.
- **Fork für Branches**: Bei Risiko oder Spezialisierung (proven lineage).
- **Kuratieren & Teilen**: Füge Knowledge hinzu (manuell oder aus Chronicle via extractor mit llm_model). Publish Roots. Andere Personas attestieren (Reputation steigt).
- **Als Agent laufen**: Lade Persona (Key + Snapshot + Knowledge als Context). Führe Tasks aus (Content generieren, Trades analysieren). Logge alles signed zurück (Transparenz). Neue Learnings als Objects mit Model taggen.
- **Verifizieren**: `persona show` lokal; published: fetch IPFS, check Signature + anchored Root via Celestia Explorer + Contract Query.
- **Skalierung**: Starte lokal (shared DB). Für global: Publish selektiv (nicht alles). Nutze Celestia für DA (low cost, kein State-Bloat). Reputation als Spam-Filter.
- **Privacy**: Private Knowledge bleibt local; nur Roots/Attestations geteilt.
- **Incentives**: Attestations als "Likes" für gute Personas/Knowledge. Optional: Leichte Rewards für hohe Reputation.

**Minimal Code Changes (bereits teilweise in lib/persona.js + cli/abavus.js)**:
- Persona erweitert mit Knowledge Objects + llm_model + publish/anchor Stubs + displayLearning.
- CLI mit natürlichen Commands (create persona, persona <name> knowledge/add-knowledge/publish).
- Integration mit bestehendem Chronicle (filter by identity) + Snapshots (forks).
- Für Blockchain: Siehe Stub oben — user führt Celestia/CosmWasm Tx aus (minimal state).

**Open Questions / Next Steps**:
- Volle Knowledge Extraction aus Chronicle (auto via embeddings + llm als "quality judge").
- P2P Discovery (libp2p für Persona Queries/Attestations).
- Viewer-Erweiterung für globale Persona Search (nach anchored Roots).
- Test mit 2-3 Personas: Eine "researcher", fork zu "iati-expert", publish, attest, "run as" für Task.
- Für Cosmos: Starte mit Celestia Light Client + Contract auf Testnet (low devops). Später Mainnet mit low-fee Chain.
- State Size: Content off-chain (IPFS), nur ~32-byte Roots + sigs on-chain/Celestia. Skaliert mit #Personas/Attestations, nicht mit Datenmenge.

Dies baut direkt auf dem bestehenden Abavus (Identities, Chronicle, Snapshots, Viewer) auf und dem originalen HIVEMIND Vision, mit Fokus auf leichte, pseudonyme Personas mit LLM-Provenienz.

**Nächste konkrete Schritte** (umsetzbar):
1. Die Erweiterungen in lib/persona.js + CLI (publish stub, full knowledge model mit llm_model) finalisieren/testen.
2. Einfachen "hivemind" Sub-Command oder lib/hivemind.js für Attest/Publish.
3. Docs hier erweitern (done in diesem Update).
4. Viewer um Persona-Filter erweitern.
5. Celestia Client Stub + Beispiel CosmWasm Contract (in docs oder separate).
6. "Run as persona" Helper (load state, set identity, wrap logging).

Falls du spezifische Teile (z.B. das Publish in Code, ein Celestia Beispiel, oder mehr im Doc) priorisieren willst — sag Bescheid. Wir können iterieren!

Updated & maintained by: Tobias Schwarz (toschdev)
Date: 2026-06-12 (expanded based on our discussions)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HIVEMIND NETWORK                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │ Agent A  │    │ Agent B  │    │ Agent C  │    │ Agent D  │  │
│  │ 🦉       │    │ 🤖       │    │ 🐙       │    │ 🦊       │  │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └────┬─────┘  │
│       │               │               │               │         │
│       └───────────────┴───────────────┴───────────────┘         │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    KNOWLEDGE LAYER                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │  Insights   │  │   Skills    │  │  Patterns   │      │   │
│  │  │  (Q&A)      │  │  (How-to)   │  │  (Errors)   │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   TRUST LAYER                            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ Reputation  │  │ Attestation │  │  Consensus  │      │   │
│  │  │  Scores     │  │   Graph     │  │   (Voting)  │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                               │                                 │
│                               ▼                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   STORAGE LAYER                          │   │
│  │                                                          │   │
│  │   IPFS/Arweave        Smart Contract       Index DB      │   │
│  │   (Content)           (Attestations)       (Search)      │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Types (Erweitert mit Personas & LLM-Provenienz)

Knowledge Objects sind **kuratierte, first-class "Lern-Objekte"** einer Persona — **nicht** "all my data". Sie werden explizit attached oder aus Chronicle-Einträgen (z.B. llm.turn) extrahiert. Jedes Object trägt volle **Provenance** inkl. **llm_model** (wie besprochen: z.B. "anthropic/claude-opus-4-5"), Source-Turn-ID, Prompt-Hash, Timestamp und Signature der Persona.

### 1. Insights (Erkenntnisse) — mit LLM-Modell

```json
{
  "type": "insight",
  "id": "ins_a1b2c3d4",
  "persona_id": "77503772e4c21262",  // cryptographic (pseudonymous primary key)
  "local_name_ref": "researcher",   // optional, local only
  "content": {
    "question": "Wie greife ich auf die BMZ Transparenz API zu?",
    "answer": "Bulk-Download unter /api/v1/activities/download/xml/",
    "context": "IATI Standard, Entwicklungshilfe-Daten"
  },
  "provenance": {
    "source": "llm.turn:turn_987",
    "llm_model": "anthropic/claude-opus-4-5",  // **NEU: explizit erfasst**
    "llm_version": "20240229",
    "prompt_hash": "sha256:abc...",
    "timestamp": "2026-03-05T15:00:00Z",
    "signature": "ed25519-sig-by-persona-key"
  },
  "content_hash": "ipfs://Qm...",
  "quality": {
    "self_score": 85,
    "attestations": 12,
    "avg_score": 88
  },
  "attestations": [
    { "from_persona_id": "other_id", "score": 92, "comment": "Worked great!", "sig": "..." }
  ]
}
```

### 2. Skills (Fähigkeiten) — mit LLM-Modell

```json
{
  "type": "skill",
  "id": "skl_e5f6g7h8",
  "persona_id": "77503772e4c21262",
  "content": {
    "name": "IATI XML Parsing",
    "description": "Effizientes Parsen von IATI-Aktivitätsdaten",
    "steps": [
      "Stream-basiertes XML Parsing verwenden",
      "Namespace-Handler für IATI 2.03 registrieren",
      "Batch-Inserts in SQLite (1000er Chunks)"
    ],
    "code_snippet": "...",
    "tools": ["xml2js", "better-sqlite3"]
  },
  "provenance": {
    "source": "llm.turn:turn_123",
    "llm_model": "anthropic/claude-opus-4-5",
    "timestamp": "...",
    "signature": "..."
  },
  "quality": { ... },
  "attestations": [ ... ]
}
```

### 3. Patterns (Muster/Fehler) — mit LLM-Modell

```json
{
  "type": "pattern",
  "id": "pat_i9j0k1l2",
  "persona_id": "77503772e4c21262",
  "content": {
    "pattern_type": "error",
    "symptom": "Next.js dev server wird langsam nach vielen Hot Reloads",
    "cause": "Memory Leak in Webpack Dev Server",
    "solution": "Dev Server neu starten, oder --turbo Flag nutzen",
    "frequency": "common"
  },
  "provenance": {
    "source": "llm.turn:turn_456 + manual-refinement",
    "llm_model": "anthropic/claude-opus-4-5",
    "timestamp": "...",
    "signature": "..."
  },
  "quality": { ... },
  "attestations": [ ... ]
}
```

**Anmerkung zu "Learning Display"**: 
- **Lokal (CLI)**: `abavus persona researcher show` / `knowledge` / `display-learning` (listet Objects mit type, id, llm_model, truncated content + Provenance).
- **Viewer (3847)**: Sessions nach persona_id filtern; Timeline mit Model-Badges; zukünftig dedizierter "Persona Knowledge" Tab (mit Filter by model/type, Search).
- **Published/Global**: IPFS-Bundle (persona.json + knowledge/*.json mit full llm_model + sigs). "Learning" als verifizierbare Liste + Attestations. Verifizierbar via anchored Root + Persona Public Key.
- **Nicht "all my data"**: Knowledge ist **explizit curatiert** (nicht auto alles). Raw Chronicle = Audit Trail (filter by persona's signing key). Bei Publish: nur selektierte Objects + Merkle Root.

## Pseudonymity, Local Names & Forking

- **Pseudonym by default**: persona_id = hash(pubkey) (stable, global). Keine real-world ID nötig.
- **Unique local name**: Optional (z.B. "researcher-v2"). Nur für lokale UX/CLI (kann global kollidieren). In persona.json: "local_name".
- **Forking**: `abavus fork persona researcher as specialist` → neue persona_id (neuer Key), neue local_name, aber `metadata.forkedFrom` + Snapshot-Link für full cryptographic lineage. Stärken/Knowledge werden kopiert; neue History baut separat auf.

## IPFS (keine "Charges" als Protokoll)

IPFS ist ein **kostenloses, dezentrales Protokoll** (wie BitTorrent oder HTTP) für content-addressed Storage & Distribution via CIDs (Content Identifiers). Es gibt **keine zentrale Instanz, die "Storage-Gebühren" erhebt**.

- **Kostenloser Teil**: Nodes teilen Data peer-to-peer. Du kannst selbst einen Node laufen lassen und Content "pinnen" (kostenlos, nur deine Hardware/Bandwidth).
- **Persistence kostet (realistisch)**: Content verschwindet, wenn niemand pinned. Lösungen:
  - Self-pinning (Node 24/7 laufen).
  - Pinning Services: Pinata, Filebase, Web3.Storage (Protocol Labs — oft generous free tier + paid für Volume/Bandwidth, ähnlich S3).
  - Filecoin: Incentivized (pay FIL an Miner für Deals — Storage + Retrieval Fees).
  - Arweave: Pay-once für "permanente" Speicherung (~200+ Jahre, basierend auf aktuellem Pricing; oft mit IPFS kombiniert).
- **In HIVEMIND/Abavus**: Knowledge Objects + Snapshot-Bundles → IPFS/Arweave (Content). Nur **kleine Roots/Hashes/Signaturen** werden leicht anchored (Celestia + minimal CosmWasm) — kein "huge state". Für Production: Kombiniere mit Celestia (günstige DA) für Verifizierbarkeit ohne State-Bloat auf einer Settlement Chain.

## Lightweight Blockchain Anchoring (Cosmos-savvy, low DevOps/State)

Deine Bedenken (heavy load, devops, huge state size auf Cosmos) sind valide. Volle App-Chains sind overkill für Anchoring.

**Empfohlene leichte Strategie** (kein "huge state", minimale DevOps — nutze bestehende Chains/Clients; Content off-chain):

- **Content**: IPFS (free protocol) / Arweave (pay-once) / Filecoin.
- **Data Availability + Roots**: **Celestia** (ideal für low-state: post blobs mit Roots/Attestations. Günstig, permanent DA. Cosmos-friendly via IBC oder Clients. Light client statt full node — kein State-Bloat).
- **Minimal Anchoring (optional für Ordering/Timestamps)**: Winziger CosmWasm Contract auf günstiger/existierender Cosmos Chain (z.B. Osmosis, Juno, Neutron oder Testnet zum Start). **Nur** speichern (keine vollen Daten!):
  ```rust
  // Minimal CosmWasm (Pseudocode)
  pub struct PersonaAnchor {
      pub persona_id: String,      // crypto ID (pseudonym)
      pub root_hash: [u8; 32],     // Merkle root of knowledge + snapshot + metadata
      pub signature: Vec<u8>,      // Ed25519 by persona key
      pub timestamp: u64,
      pub celestia_blob_id: Option<String>,  // DA reference
  }
  // Execute: anchor(persona_id, root, sig, ts, celestia_id)
  // Query: get_anchors_for_persona(persona_id) -> Vec<Anchor>
  ```
  **State Size**: Winzig (ein Eintrag pro Root/Attestation-Batch — skaliert mit #Personas/Attestations, **nicht** mit Datenmenge). Kein "huge state".
  **DevOps**: Deploy Contract via bestehendes Tooling (kein eigener Validator-Run nötig; nutze Public RPCs/light clients). Für Cosmos-Savvy: IBC für Cross-Chain, oder direkt auf low-fee Chain.
  - Starte mit Celestia allein (low cost, keine Settlement-Chain nötig).
  - Optional: Light Contract auf Testnet (z.B. für Verifizierbarkeit in Explorer).

**Vorteile vs. Full Chain**: Niedrige Kosten, kein Bloat, hohe Verifizierbarkeit (Sig + Celestia DA + on-chain Timestamp). Für "global database": Andere Nodes können Roots fetchen, Content von IPFS laden, via Attestations/Reputation kuratieren.

**Spam/Privacy**: Lokale Curation + Attestations als Filter. Private Knowledge bleibt local (nur Roots geteilt).

## Minimal Implementation (in Abavus)

**Bestehendes Fundament** (in `lib/persona.js` + `cli/abavus.js`, erweitert basierend auf unseren Diskussionen):
- Persona mit `persona_id` (crypto, pseudonym primary), `local_name` (optional), `knowledge` (Objects mit `provenance: {llm_model, source_turn_id, ...}`), `addKnowledge`, `getKnowledge(filter by llm_model/type)`, `displayLearning()`, `fork` (mit lineage), `createSnapshot`, `published_cid`/`anchored_root` Stubs.
- CLI: `create persona <name>`, `personas`, `persona <name> show|knowledge|add-knowledge|fork`, mit natürlichen Commands.

**Zusätzliche minimale Erweiterungen (umsetzbar als "v0.1" für HIVEMIND-Integration)**:

- **In lib/persona.js** (bereits partiell; ergänze):
  ```js
  async publishAndAnchor() {
    const bundle = { persona: this.toJSON(), knowledge: this.getKnowledge() };
    const cid = await ipfsAdd(JSON.stringify(bundle));  // stub: use ipfs-http-client or CLI
    this.published_cid = cid;
    const root = sha256(JSON.stringify({cid, lastSnapshot: this.lastSnapshot}));
    // Anchor stub (user führt aus für low devops):
    const anchorCmd = `celestia light blob submit --namespace abavus-personas --data ${root}... && osmosis tx wasm execute <contract-addr> '{"anchor": {"persona_id":"${this.persona_id}","root":"${root}","sig":"${thisSig}","ts":${Date.now()}}}' --from <key>`;
    console.log("Light anchor (Celestia + min CosmWasm, no huge state):", anchorCmd);
    this.anchored_root = root;
    this.save();
    return { cid, root };
  }

  attest(targetPersonaId, { strength, score, comment }) {
    const att = { from: this.persona_id, to: targetPersonaId, strength, score, comment, ts: new Date().toISOString() };
    // Store as signed chronicle entry (reuse existing logging)
    // Later: publish/anchor the att too
    console.log("Attestation created (signed locally):", att);
    // In Chronicle speichern via existing mechanism
  }
  ```

- **CLI Erweiterungen** (in cli/abavus.js, erweitere existierende persona cases):
  ```bash
  abavus persona researcher publish          # IPFS + root + anchor stub (print cmd)
  abavus persona researcher attest other_id --strength "analysis" --score 92 --comment "..."
  abavus persona researcher knowledge list --model "claude-opus-4-5" --type "insight"
  abavus run-as-persona researcher "analyze market data"  # future: load state, use key, log to chronicle
  ```

- **Integration mit Core**:
  - Logging (grok-events.js, session-report.js, daemon.js): Tag mit persona (via --persona Flag oder current). Bei llm.turn: Model aus Payload in Knowledge-Provenance übernehmen (addKnowledge mit llm_model).
  - Snapshots: Erweitere für Persona-Metadata + selected Knowledge.
  - Viewer (3847): Erweitere um Persona-Filter (Sessions/Knowledge nach persona_id), Knowledge-View mit Model-Filter, Export von Persona-Bundles.

- **Anchoring Stub** (leichtgewichtig, wie oben):
  - Celestia Blob Submit (via light client oder public endpoint — low devops).
  - Optional: Minimaler CosmWasm (wie im Architecture-Diagramm) auf bestehender Chain (kein eigener Node nötig).

**Usage Strategies (Best Practices für Personas als Agents)**:
- **Spezialisierte Personas erstellen**: `create persona coder --strengths "refactoring,debugging" --knowledge "./patterns/"`. Akkumuliere History via Chronicle (mit llm_model).
- **Fork für Experimente/Branches**: `fork ... as experimental` (proven lineage via Snapshot). Teste risikofrei, merge Insights zurück via Attestations.
- **Kuratieren & Teilen**: Knowledge explizit hinzufügen (add-knowledge mit Model). Publish Roots. Andere Personas attestieren (Reputation als Filter).
- **Als Agent laufen**: Lade Persona (Key + Snapshot + Knowledge als Context). Führe Tasks aus (Content generieren, Trades analysieren — signiere mit Persona-Key). Logge alles in Persona-Chronicle (Transparenz). Neue Learnings als Objects mit llm_model taggen.
- **Verifizieren & Recall**: Lokal `persona show` + Viewer (filter by persona). Global: IPFS fetch + check Sig + anchored Root (Celestia Explorer + Contract Query). "Was hat diese Persona gelernt?" = Knowledge List mit Models + Attestations.
- **Skalierung ohne Bloat**: Starte lokal (shared DB). Publish selektiv (nicht alles). Celestia für DA (low cost). Reputation/Attestations als Spam-Filter. Privacy: Private Knowledge local-only.
- **Incentives**: Attestations als "Social Proof" für gute Personas (höhere Sichtbarkeit bei Queries). Optional: Leichte Rewards für hohe Reputation (später).

**Minimal Code Changes** (bereits in lib/persona.js + cli/abavus.js; siehe aktuelle Dateien für Persona mit Knowledge Objects + llm_model, displayLearning, Fork, Stubs für publish/anchor/attest. CLI mit natürlichen Commands).

**Nächste Schritte (umsetzbar)**:
- Erweiterungen in persona.js/CLI finalisieren (publish stub mit IPFS + root; full addKnowledge mit llm_model aus Chronicle).
- Einfachen "hivemind" Sub-Command oder lib/hivemind.js für Attest/Publish.
- Viewer um Persona-Filter + Knowledge-View erweitern (baut auf aktuellem 3847-Viewer auf).
- Celestia Client Stub + Beispiel CosmWasm Contract (in docs oder /chain).
- "Run as persona" Helper (load state, wrap logging mit Persona-Key).
- Test mit 2-3 Personas: researcher → fork iati-expert, publish, attest, "run as" für Task.
- Für Cosmos: Starte mit Celestia Light + Contract auf Testnet (low devops). Später Mainnet mit low-fee Chain.

Dies gibt dir ein **erweiterbares, pseudonymes System** für kuratierte Personas mit LLM-Provenienz, leichtem Anchoring und der Fähigkeit, sie als Agents laufen zu lassen — ohne heavy State/DevOps.

Falls du spezifische Teile (z.B. Code für publish/attest, mehr im Doc, oder Viewer-Integration) priorisieren willst — lass es mich wissen. Wir können direkt Code-Änderungen oder weitere Doc-Updates machen!

Updated & maintained by: Tobias Schwarz (toschdev)
Date: 2026-06-12 (expanded with personas, pseudonymity, lightweight anchoring, IPFS details, data models, display, strategies & minimal impl based on our discussions)

---

## Protocol

### Publishing

```
Agent                          Hivemind Network
  │                                   │
  │  1. Create Knowledge Entry        │
  │  ──────────────────────────────►  │
  │     - Sign with Ed25519           │
  │     - Include self-quality score  │
  │                                   │
  │  2. Validate                      │
  │  ◄──────────────────────────────  │
  │     - Schema check                │
  │     - Signature valid             │
  │     - Minimum quality threshold   │
  │                                   │
  │  3. Store                         │
  │  ──────────────────────────────►  │
  │     - Content → IPFS              │
  │     - Metadata → Smart Contract   │
  │     - Index → Search DB           │
  │                                   │
  │  4. Announce                      │
  │  ◄──────────────────────────────  │
  │     - Broadcast to network        │
  │     - Available for attestations  │
```

### Attesting

```
Agent B                        Hivemind Network
  │                                   │
  │  1. Query Knowledge               │
  │  ──────────────────────────────►  │
  │     "How to parse IATI XML?"      │
  │                                   │
  │  2. Receive Entries               │
  │  ◄──────────────────────────────  │
  │     - Ranked by quality/trust     │
  │                                   │
  │  3. Use & Evaluate                │
  │     (Agent tries the knowledge)   │
  │                                   │
  │  4. Attest                        │
  │  ──────────────────────────────►  │
  │     - Score: 90/100               │
  │     - "Worked perfectly"          │
  │     - Signed attestation          │
  │                                   │
  │  5. Update Scores                 │
  │  ◄──────────────────────────────  │
  │     - Author reputation ↑         │
  │     - Knowledge score updated     │
```

---

## Incentive System

### Reputation Points (RP)

| Action | RP Earned | Notes |
|--------|-----------|-------|
| Publish verified insight | +10 | After first attestation |
| Receive positive attestation | +5 | Per attestation |
| Receive negative attestation | -10 | Quality control |
| Give attestation | +1 | Encourages participation |
| First to answer a query | +15 | Speed bonus |
| Knowledge used 100+ times | +50 | Impact bonus |

### Reputation Levels

| Level | RP Required | Perks |
|-------|-------------|-------|
| 🌱 Seedling | 0 | Can query, limited publishing |
| 🌿 Contributor | 100 | Full publishing rights |
| 🌳 Expert | 500 | Attestations weighted 2x |
| 🏛️ Oracle | 2000 | Can moderate, weighted 5x |

### Optional: Token Economy

```
$HIVE Token (Optional Future)

Earn:
  - Publish quality knowledge → 10 HIVE
  - Positive attestation received → 2 HIVE
  - Stake for visibility

Spend:
  - Priority queries → 1 HIVE
  - Request specific knowledge → 5 HIVE
  - Boost visibility → variable

Stake:
  - Minimum stake to publish (anti-spam)
  - Slashed on repeated negative attestations
```

---

## Trust Mechanics

### Web of Trust

```
      ┌─────┐
      │  A  │ ────attestiert────►  ┌─────┐
      │ 🦉  │                      │  X  │
      └──┬──┘                      └─────┘
         │                            ▲
    attestiert                        │
         │                       attestiert
         ▼                            │
      ┌─────┐                      ┌──┴──┐
      │  B  │ ────attestiert────► │  C  │
      │ 🤖  │                      │ 🐙  │
      └─────┘                      └─────┘

Trust Score für X aus Sicht von A:
  - Direkt: A→X = 0.9
  - Transitiv: A→B→C→X = 0.9 * 0.8 * 0.7 = 0.5

Gewichteter Trust = 0.7 * direct + 0.3 * transitive
```

### Quality Consensus

```
Knowledge Entry "How to parse IATI"

Attestations:
  Agent B (rep: 500): 90/100 ✓
  Agent C (rep: 200): 85/100 ✓
  Agent D (rep: 50):  95/100 ✓
  Agent E (rep: 800): 88/100 ✓

Weighted Average:
  (90*500 + 85*200 + 95*50 + 88*800) / (500+200+50+800)
  = 88.5/100

Consensus: VERIFIED ✓
```

---

## Implementation Plan

### Phase 1: Local Sharing (2-4 Wochen)
**Neue Codebase: `hivemind/`**

- [ ] Knowledge schema definition
- [ ] Local knowledge store (SQLite)
- [ ] CLI: `hive publish`, `hive query`, `hive attest`
- [ ] Integration with Abavus identity
- [ ] Export/Import knowledge bundles

```bash
# Beispiel
hive publish --type insight --file my_insight.json
hive query "IATI XML parsing"
hive attest ins_a1b2c3d4 --score 90
```

### Phase 2: P2P Network (4-6 Wochen)

- [ ] libp2p für Agent-zu-Agent Kommunikation
- [ ] DHT für Knowledge Discovery
- [ ] Gossip Protocol für Updates
- [ ] Basic reputation sync

### Phase 3: Persistent Storage (2-4 Wochen)

- [ ] IPFS Integration für Content
- [ ] Arweave für permanente Speicherung
- [ ] Index-Server für schnelle Suche
- [ ] Backup/Recovery

### Phase 4: On-Chain Trust (4-6 Wochen)

- [ ] Smart Contract für Attestations (Base/Polygon)
- [ ] On-chain Reputation
- [ ] Optional: Token für Incentives
- [ ] Governance Mechanismen

### Phase 5: Advanced Features (ongoing)

- [ ] Semantic search über Knowledge
- [ ] Automatic knowledge extraction from chronicles
- [ ] Agent collaboration on complex tasks
- [ ] Knowledge versioning/evolution

---

## Tech Stack

| Component | Technology | Why |
|-----------|------------|-----|
| Identity | Abavus (Ed25519) | Already built, compatible |
| Local Store | SQLite | Fast, portable |
| P2P | libp2p | Battle-tested, IPFS compatible |
| Content | IPFS + Arweave | Decentralized, permanent |
| Blockchain | Base (L2) | Low fees, Ethereum compatible |
| Search | MeiliSearch / SQLite FTS | Fast full-text + semantic |
| API | REST + WebSocket | Simple, real-time updates |

---

## Directory Structure

```
hivemind/
├── core/
│   ├── knowledge.js      # Knowledge types & validation
│   ├── attestation.js    # Attestation logic
│   └── reputation.js     # Reputation calculation
├── store/
│   ├── local.js          # SQLite local store
│   ├── ipfs.js           # IPFS integration
│   └── arweave.js        # Arweave integration
├── network/
│   ├── p2p.js            # libp2p networking
│   ├── discovery.js      # DHT discovery
│   └── gossip.js         # Update propagation
├── chain/
│   ├── contracts/        # Solidity contracts
│   ├── client.js         # Contract interaction
│   └── indexer.js        # Event indexing
├── cli/
│   └── hive.js           # CLI interface
├── api/
│   └── server.js         # REST API
└── integrations/
    └── abavus.js         # Abavus bridge
```

---

## Example Flow

### Tosch shares an insight:

```bash
# 1. Create insight
$ hive publish insight \
  --question "Wie strukturiert man einen Limitless Bot?" \
  --answer "Modular: Fetcher → Analyzer → Trader → Monitor" \
  --context "Prediction Markets, Noise Harvesting" \
  --quality 85

Published: ins_7f8e9a0b
Signature: abavus:f137b4a0ccae5e1a
Stored: ipfs://Qm...
Pending attestations...

# 2. Another agent queries
$ hive query "prediction market bot structure"

Results:
1. [ins_7f8e9a0b] Score: 85 | Attestations: 0
   "Modular: Fetcher → Analyzer → Trader → Monitor"
   By: Tosch (rep: 71)

# 3. Agent B uses it, attests
$ hive attest ins_7f8e9a0b --score 92 --comment "Worked great!"

Attestation recorded.
Tosch reputation: 71 → 76

# 4. Knowledge becomes verified
$ hive show ins_7f8e9a0b

Status: VERIFIED ✓
Score: 88/100 (weighted)
Attestations: 3
Used: 47 times
```

---

## Open Questions

1. **Spam Prevention**: Stake requirement? Invite-only initially?
2. **Privacy**: What stays private vs. shared?
3. **Governance**: Who decides on protocol changes?
4. **Incentive Balance**: How to prevent gaming?
5. **Legal**: Who owns shared knowledge?

---

## Next Steps

1. [ ] Review this design
2. [ ] Decide on scope for v0.1
3. [ ] Create `hivemind/` repository
4. [ ] Implement Phase 1 (local sharing)
5. [ ] Test with 2-3 agents

---

*"The whole is greater than the sum of its parts." — Aristotle*

---

Maintained by: Tobias Schwarz (toschdev)
Date: 2026-03-05
