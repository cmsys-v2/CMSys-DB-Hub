# CMSys-DB-Hub 🛡️

**CMSys V2 — Naval Civil Works Productivity Suite**  
Unified Firebase Realtime Database Management Hub

[![Version](https://img.shields.io/badge/version-v2.3.0-teal)](.)
[![Firebase](https://img.shields.io/badge/Firebase-RTDB-orange)](https://firebase.google.com/)
[![Status](https://img.shields.io/badge/status-active-brightgreen)](.)

---

## Overview

A single-page, self-contained Firebase RTDB explorer and management hub for the **CMSys V2 Naval Civil Works** system. Provides live read access to all 11 database nodes with advanced filtering, sorting, column visibility, edit preview, and export capabilities.

## Features

- 🔍 **Live Node Explorer** — Browse all 11 RTDB nodes with search, advanced filters (column + operator + value), sort by any column, and column visibility toggle
- 📊 **KPI Stats Dashboard** — Real-time counts for Sailors, Work Orders, Job Cards, Inventory, Facilities, and Evaluations at the top of the explorer
- 🔗 **Interconnection Matrix** — Visual cross-table relationship cards (REL-01 to REL-26)
- ✅ **Data Integrity & Audit Validator** — Headcount, orphan detection, stock valuation audit
- 💾 **Backup, Export & Import** — Full DB snapshot + per-node JSON export
- ✏️ **Edit Preview Modal** — Preview edits locally (not synced to Firebase — read-only hub)

## Database Nodes

| Node | Description | Records |
|------|-------------|---------|
| `/sailors` | Master Personnel Directory | 661 (571 VSS + 90 REG) |
| `/work_orders` | High-Level Works | Active & Dockyard |
| `/job_cards` | Tactical Maintenance | 1,197 |
| `/inventory` | Stores & Materials | 2,134 items — LKR 46.8M |
| `/locations` | Naval Infrastructure & LMD | Categories A–G |
| `/daily_allocations` | Muster Records | Daily duty |
| `/daily_evaluations` | Trade Evaluations | 1–10 scale |
| `/estimates` | Pre-execution BOQ | Bill of Quantities |
| `/temp_issues` | Temporary Issue Book | Power tools & equipment |
| `/nav254_vouchers` | Naval Transfer Vouchers | Form NAV 254 |
| `/metadata` | System Configurations | — |

## Firebase Connections

- **Primary RTDB:** `cmsys-v2-1fb05-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Fallback OPS RTDB:** `ncw-ps-operations-default-rtdb.asia-southeast1.firebasedatabase.app`
- **Local Seed:** `../CMSys V2/cmsys-v2-1fb05-seed.json` (offline fallback)
- **Connection Strategy:** Cascading — Primary → OPS → Local Seed

## Getting Started

No build step required — single static HTML file.

1. Clone this repo
2. Open `index.html` in a browser **or** serve via XAMPP/Apache at `http://localhost/CMSys-DB-Hub/`
3. Ensure Firebase RTDB has open read rules or valid credentials

## Tech Stack

- Vanilla HTML5 / CSS3 / JavaScript (ES6+)
- [Tailwind CSS](https://tailwindcss.com/) (via CDN)
- [FontAwesome 6](https://fontawesome.com/) (via CDN)
- Firebase Realtime Database REST API

## Author

**Arjuna Udesh** — [`arjunaudesh-dev`](https://github.com/arjunaudesh-dev)  
Naval Civil Works Productivity Suite — CMSys V2

## License

Private / Internal Use — Naval Civil Works Operations
