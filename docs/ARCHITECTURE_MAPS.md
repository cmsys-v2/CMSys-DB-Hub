# CMSys-DB-Hub — Architecture Maps
**Companion documentation for the interactive System Maps inside `index.html` → "Architecture & Maps"**

| Map | In-app location | Purpose |
|-----|-----------------|---------|
| **DB Connection Concept Map** | Tab 2 → DB Connection Maps → *Concept Map* | The entities and propositions behind every database connection |
| **Connection Flowcharts (×4)** | Tab 2 → DB Connection Maps → *Flowcharts* | Failover ladder, read path, write-back path, sync bridges |
| **Network Map** | Tab 2 → DB Connection Maps → *Network Map* | Physical/logical topology: LAN → firewall → Firebase cloud |
| **System Integration Concept Map** | Tab 2 → *Integration Map* | All 5 federated applications + shared data fabric + invariants |

> All in-app maps support **scroll-zoom, drag-pan, hover tooltips and one-click SVG export** (toolbar buttons).

---

## 1. Database Connection — Concept Map

Concept maps state *propositions* (labeled edges), not just wires. Four conceptual clusters:

```mermaid
graph LR
  subgraph CLIENT["Presentation Tier"]
    HUB["CMSys-DB-Hub<br/>governance SPA"]
    V2["CMSys V2 Desktop<br/>tactical works"]
    PWA["Mobile PWA<br/>field supervisors"]
    LOG["CMSys Logistics :8000<br/>NAV 254 / 255"]
    UTIL["Waterworks / Inventory<br/>utility subsystems"]
  end

  subgraph TRANSPORT["API & Transport Tier"]
    REST["Firebase REST / SSE<br/>HTTPS · TLS 1.3"]
    PHP["api.php engine<br/>PDO prepared"]
    PRISMA["Prisma ORM bridge"]
    WORKER["Sync workers"]
  end

  subgraph STRATEGY["Connection Strategy"]
    FAIL["Cascading Failover<br/>4s / tier"]
    PATCH["Two-Way Live PATCH"]
    AUDIT["Dual-Write Audit · REL-25"]
    SEEDC["Offline Seed Fallback"]
  end

  subgraph DATA["Data Tier"]
    RTDB1[("Primary RTDB<br/>cmsys-v2-1fb05")]
    RTDB2[("Secondary RTDB<br/>ncw-ps-operations")]
    MYSQL[("MySQL ncw_ps_db<br/>18 tables")]
    SEEDF[("seed.json · 3.84MB")]
  end

  HUB -->|"GET /.json · live read"| REST
  V2 -->|"Web SDK v9 · realtime"| REST
  PWA -->|"field sync / SSE"| REST
  LOG -->|"server actions"| PRISMA
  UTIL -->|"migrate.php REST"| PHP

  REST -->|"4s timeout ladder"| FAIL
  PHP -.->|"local mirror"| PATCH
  PRISMA -->|"store deltas"| WORKER

  FAIL -->|"tier-1 · preferred"| RTDB1
  FAIL -->|"tier-2 · on fail"| RTDB2
  FAIL -.->|"tier-3 · offline"| SEEDC
  PATCH -->|"PATCH /{node}/{id}"| RTDB1
  AUDIT -->|"PUT /audit_log/{id}"| RTDB1
  AUDIT -->|"POST api.php audit_log"| MYSQL
  PHP -->|"PDO prepared :3306"| MYSQL
  WORKER -.->|"syncToFirebase()"| RTDB2
```

**Connection invariants** (bottom band of the in-app map):
1. **Zero-trust failover** — every client resolves data through the ladder; no silent single-tier dependency.
2. **Single source of truth** — `cmsys-v2-1fb05` is authoritative; mirrors reconcile, never mix in one query.
3. **Immutable mutation trail (REL-25)** — every write emits an audit entity, dual-written cloud + SQL.
4. **Field continuity** — seed fallback + PWA service worker survive total link loss.

---

## 2. Connection Flowcharts

### 2.1 Cascading Failover (Boot / "Sync Live")

```mermaid
flowchart TD
  S([START · App boot / Sync Live]) --> P1["① GET PRIMARY cmsys-v2-1fb05/.json<br/>AbortController 4s"]
  P1 --> D1{"HTTP 200<br/>and JSON?"}
  D1 -->|YES| A1["Active Tier = PRIMARY<br/>writes enabled"]
  D1 -->|NO| P2["② GET SECONDARY ncw-ps-operations/.json<br/>AbortController 4s"]
  P2 --> D2{"HTTP 200<br/>and JSON?"}
  D2 -->|YES| A2["Active Tier = SECONDARY<br/>writes enabled · parity flagged"]
  D2 -->|NO| P3["③ FETCH LOCAL SEED<br/>cmsys-v2-1fb05-seed.json"]
  P3 --> D3{"Seed<br/>parsed?"}
  D3 -->|YES| A3["Active Tier = SEED<br/>READ-ONLY · writes queued"]
  D3 -->|NO| X["STATE · OFFLINE / ERROR"]
  A1 --> W{"Write<br/>requested?"}
  A2 --> W
  A3 --> W
  W -->|YES| DO["Dispatch PATCH/PUT<br/>+ REL-25 dual audit + toast"]
  W -->|NO| R(["Serve cached reads"])
  X -.->|operator retry| P1
```

### 2.2 Read Path (`fetchAllData`)

```mermaid
flowchart TD
  S([START · fetchAllData]) --> L["Resolve tier via failover ladder"]
  L --> F["GET {ACTIVE_TIER}/.json"]
  F --> D{"res.ok?"}
  D -->|NO| OFF(["OFFLINE pill · keep cache"])
  D -->|YES| J["res.json → databaseCache"]
  J --> E["Ensure /audit_log + /daily_evaluations"]
  E --> M["Merge MySQL audit rows<br/>api.php?action=audit_log"]
  M --> K["updateStatCounters → KPI strip"]
  K --> R["Render table · REL matrix · 8-rule audit"]
  R --> EN([UI live])
```

### 2.3 Write Path (Two-Way Live Write-Back)

```mermaid
flowchart TD
  S([START · cell edit / New / batch]) --> B["Build updates payload"]
  B --> C["Apply to databaseCache (optimistic)"]
  C --> AU["Create REL-25 audit entry<br/>{ts, user, node, id, old, new}"]
  AU --> D{"Active tier<br/>is HTTP?"}
  D -->|NO seed/offline| Q([Queue locally · toast queued])
  D -->|YES| P["PATCH|PUT|DELETE {base}/{node}/{id}.json"]
  P --> D2{"res.ok?"}
  D2 -->|NO| W([Warn · queue for retry])
  D2 -->|YES| A1["PUT /audit_log/{auditId}.json"]
  A1 --> A2["POST api.php?action=audit_log<br/>MySQL mirror"]
  A2 --> T([Toast ✓ synced])
```

### 2.4 Cross-System Sync Bridges

```mermaid
flowchart LR
  subgraph A["Bridge A · Logistics ledger"]
    A1["Prisma commit<br/>NAV 254/255"] --> A2["sync-logistics-to-firebase.js"] --> A3["/nav254_vouchers +<br/>inventory_on_charge"]
  end
  subgraph B["Bridge B · Evaluations"]
    B1["Rule-3 zero-sync<br/>detector"] --> B2["1-click MySQL→RTDB"] --> B3["PUT /daily_evaluations"]
  end
  subgraph C["Bridge C · Legacy mirror"]
    C1["api.php syncToFirebase()"] --> C2["Normalize legacy rows"] --> C3["PUT operational nodes"]
  end
  A3 --> I["Cross-System Sync & Security Inspector<br/>parity matrix · latency badges · secret exposure alerts"]
  B3 --> I
  C3 --> I
  I --> E([END · Verified parity & audit trail])
```

---

## 3. Network Map

```mermaid
flowchart LR
  subgraph LAN["ZONE A · Naval Dockyard LAN (XAMPP host)"]
    WS["DBA Workstation<br/>localhost/CMSys-DB-Hub"]
    TABS["Naval Tablets / PWA<br/>offline service worker"]
    V2H["CMSys V2 Monolith :80"]
    UTILH["Waterworks / Inventory"]
    SEEDH[("seed.json 3.84MB")]
    PRN["Print routing · get_printers.php"]
    HUB["CMSys-DB-Hub :80"]
    API["api.php · PDO"]
    LOGH["Logistics :8000 · Prisma"]
    SQLH[("MySQL ncw_ps_db :3306")]
  end

  subgraph EDGE["EDGE"]
    FW["Base firewall<br/>TLS 1.3 egress :443"]
    CORS["CORS allowlist<br/>localhost · 127.0.0.1 · :8000"]
  end

  subgraph CLOUD["ZONE B · Firebase Cloud (asia-southeast1 · Singapore)"]
    R1[("TIER-1 cmsys-v2-1fb05")]
    R2[("TIER-2 ncw-ps-operations")]
    SEC["RTDB security rules & headers"]
    VER["Vercel: cmsys-beta → cmsys-live"]
    USR["Remote command clients / NHQ"]
  end

  WS -->|HTTP :80| HUB
  TABS -.->|HTTPS PWA sync| API
  V2H -->|same-host REST| API
  UTILH -.->|migrate.php| API
  HUB -.->|audit mirror| API
  API -->|PDO :3306| SQLH
  LOGH -->|Prisma :3306| SQLH
  HUB -.->|tier-3 read| SEEDH
  API -.->|certificates| PRN

  HUB -->|REST/SSE :443| FW
  API -.-> FW
  LOGH -->|worker push| FW
  FW -->|TLS 1.3 tunnel| R1
  FW -.->|failover| R2
  FW -.->|git deploy| VER
  R1 -.-> SEC
  R2 -.-> SEC
  FW -.->|edge enforcement| SEC
  SEC -.-> USR
```

**Latency classes:** loopback `< 1 ms` on LAN · `≈ 150–220 ms` RTT to the Singapore cluster (live-pingable in-app via *Ping All Tiers*).

---

## 4. System Integration Concept Map

```mermaid
graph TB
  V2["CMSys V2 Desktop + api.php<br/>muster · project tree · job cards · votes"]
  PWA["CMSys V2 Mobile PWA<br/>availability · leave codes · check-in"]
  LOG["CMSys Logistics :8000<br/>NAV 254 / NAV 255 · 4 store tiers"]
  WATER["Waterworks + Inventory<br/>pumps · pipelines · catalog import"]

  HUB["CMSys-DB-Hub — Data Governance Core<br/>explorer · REL matrix · 8-rule audit · parity · maps"]

  BUS["Shared Data Fabric<br/>sailors · work_orders · job_cards · inventory · locations ·
  daily_allocations · daily_evaluations · estimates · temp_issues · nav254_vouchers · audit_log"]

  T1(["Single Source of Truth<br/>Firebase RTDB"])
  T2(["Auditability<br/>REL-25 immutable trail"])
  T3(["Naval Invariants<br/>667 headcount · 6 votes · 13 trades"])
  T4(["Continuity & Failover<br/>3-tier ladder · PWA offline"])

  V2 -->|"produces work orders, job cards & muster → audited by"| HUB
  HUB -->|"reconciles headcount ↔ leave status captured by"| PWA
  V2 -.->|"writes operational nodes into"| BUS
  PWA -.->|"streams availability & allocations into"| BUS
  LOG -->|"synchronizes NAV 254/255 vouchers → store nodes"| BUS
  BUS -->|"binds facilities & maintenance lifecycle ↔"| WATER
  LOG -.->|"parity monitored by Cross-System Inspector"| HUB
  WATER -.->|"facility health feeds forensic audit rules"| HUB
  HUB --> BUS
  BUS -.-> T1
  BUS -.-> T2
  BUS -.-> T3
  BUS -.-> T4
```

---

## 5. Security Posture Shown on the Maps

| Control | Where enforced | Visible on |
|---------|----------------|------------|
| TLS 1.3 egress on :443 only | Base firewall | Network Map (EDGE zone) |
| CORS origin allowlist (`localhost`, `127.0.0.1`, `:8000`) | api.php / Apache | Network Map (EDGE zone) |
| PDO prepared statements / parameter binding | api.php → MySQL | Concept Map, Network Map |
| Immutable dual-write audit (REL-25) | PATCH pipeline | Concept Map, Write-Path flowchart |
| Response headers (`X-Frame-Options`, `nosniff`, `Referrer-Policy`) | All HTTP responses | Network Map (SEC node) |
| Client-secret exposure monitoring | Cross-System Inspector | Integration Map, Parity modal |

---

*Generated for CMSys-DB-Hub v2.5.0 — Naval Civil Works Productivity Suite (NCW-PS / CMSys V2).*
