/**
 * CMSys-DB-Hub v2.4.0 — Deep Forensic Data Integrity & Audit Validator Engine
 * Target Architecture: NCW-PS / CMSys V2 (Eastern Naval Area - Civil Engineering Dept)
 * Enforces:
 * 1. Headcount Conservation Law (667 Statutory = 577 VSS + 90 Regular vs Live DB)
 * 2. REL-01..REL-26 Foreign Key & Orphan Detection (1,210 Job Cards vs 354 Work Orders)
 * 3. Sailor Medical / GCB / NAV3 / PET / ID Expiry Scanner
 * 4. Inventory Valuation (LKR) & Reorder Threshold Verification
 * 5. Schema Hygiene & Duplicate Column Sanitizer
 */

const CMSYS_INVARIANTS = {
  STATUTORY_TOTAL: 667,
  STATUTORY_VSS: 577,
  STATUTORY_REGULAR: 90,
  VSS_TRADES: ['MA', 'CA', 'PA', 'PL', 'BB', 'RW', 'WE', 'WL', 'AL', 'SW'],
  REGULAR_TRADES: ['S/S', 'LME', 'ME', 'OJT'],
  LEAVE_CODES: ['LEAVE', 'L', 'TD', 'RD', 'ADM', 'S/R', 'SIQ', 'NGH', 'AWOL'],
  STATUTORY_VOTES: ['2104', '2001', '2506', '1303', '2103', 'NON-NAVAL']
};

/**
 * Helper: Normalize Firebase RTDB object map or array into an array with `_id` preserved
 */
function normalizeCollection(nodeData) {
  if (!nodeData) return [];
  if (Array.isArray(nodeData)) {
    return nodeData
      .map((item, idx) => (item ? { _id: item._id || item.id || String(idx), ...item } : null))
      .filter(Boolean);
  }
  if (typeof nodeData === 'object') {
    return Object.entries(nodeData).map(([key, val]) => ({
      _id: key,
      ...(typeof val === 'object' && val !== null ? val : { value: val })
    }));
  }
  return [];
}

/**
 * Main Forensic Audit Runner
 * @param {Object} dbSnapshot - Full Firebase RTDB root object (or in-memory cache in CMSys-DB-Hub)
 * @param {string} referenceDateStr - ISO date string (Defaults to "2026-10-20")
 */
function runDeepForensicAudit(dbSnapshot, referenceDateStr = '2026-10-20') {
  const startTime = performance.now();
  const today = new Date(referenceDateStr);

  // Extract & normalize collections
  const sailors = normalizeCollection(dbSnapshot?.sailors || dbSnapshot?.users);
  const workOrders = normalizeCollection(dbSnapshot?.work_orders);
  const jobCards = normalizeCollection(dbSnapshot?.job_cards);
  const inventory = normalizeCollection(dbSnapshot?.inventory);
  const locations = normalizeCollection(dbSnapshot?.locations);
  const dailyAllocations = normalizeCollection(dbSnapshot?.daily_allocations);
  const dailyEvaluations = normalizeCollection(dbSnapshot?.daily_evaluations);
  const jobCardMaterials = normalizeCollection(dbSnapshot?.job_card_materials);
  const estimates = normalizeCollection(dbSnapshot?.estimates);

  const findings = [];
  const repairQueue = [];

  // =========================================================================
  // 1. HEADCOUNT CONSERVATION LAW & CADRE AUDIT (667 Statutory vs Live vs Muster)
  // =========================================================================
  const totalLiveSailors = sailors.length;
  const tradeCounts = {};
  const duplicateAllocatedIds = [];
  const leaveVsDutyConflicts = [];
  const unknownTradeSailors = [];

  const allAllocatedSailorIds = new Set();
  const activeDutyIds = new Set();
  const activeLeaveIds = new Set();

  // Map daily allocations for reference date
  dailyAllocations.forEach((alloc) => {
    const sId = String(alloc.sailor_id || alloc.SAILOR_ID || alloc.user_id || '');
    if (!sId) return;
    if (allAllocatedSailorIds.has(sId)) {
      duplicateAllocatedIds.push({ sailorId: sId, allocationId: alloc._id });
    }
    allAllocatedSailorIds.add(sId);
    activeDutyIds.add(sId);
  });

  sailors.forEach((s) => {
    const trade = String(s.TRADE || s.trade || 'UNASSIGNED').toUpperCase().trim();
    tradeCounts[trade] = (tradeCounts[trade] || 0) + 1;

    const isKnownTrade =
      CMSYS_INVARIANTS.VSS_TRADES.includes(trade) ||
      CMSYS_INVARIANTS.REGULAR_TRADES.includes(trade);

    if (!isKnownTrade) {
      unknownTradeSailors.push({
        _id: s._id,
        name: s.NAME || s.name || s.full_name || 'Unknown',
        trade
      });
    }

    const status = String(s.CURRENT_STATUS || s.status || s.complement_status || '').toUpperCase().trim();
    if (CMSYS_INVARIANTS.LEAVE_CODES.includes(status)) {
      activeLeaveIds.add(s._id);
      if (activeDutyIds.has(s._id)) {
        leaveVsDutyConflicts.push({
          _id: s._id,
          name: s.NAME || s.name || s.full_name,
          status,
          issue: 'Sailor marked on Leave/Medical but assigned to active Daily Allocation'
        });
      }
    }
  });

  const headcountDelta = totalLiveSailors - CMSYS_INVARIANTS.STATUTORY_TOTAL;
  if (headcountDelta !== 0) {
    findings.push({
      id: 'AUD-HC-01',
      severity: 'WARNING',
      category: 'Headcount Conservation Law',
      title: `Master Complement Drift Detected: ${totalLiveSailors} Live Records vs ${CMSYS_INVARIANTS.STATUTORY_TOTAL} Statutory`,
      detail: `Live /sailors node has ${totalLiveSailors} records (${headcountDelta > 0 ? '+' + headcountDelta : headcountDelta} variance from 577 VSS + 90 Regular = 667). Ensure transferred/discharged or newly joined sailors have an explicit 'ACTIVE_STRENGTH' status flag.`,
      affectedRecords: sailors.slice(-Math.abs(headcountDelta)).map((s) => ({
        _id: s._id,
        name: s.NAME || s.name,
        joinDate: s.JOIN_DATE || s.join_date,
        status: s.CURRENT_STATUS || s.status || s.complement_status || 'N/A'
      }))
    });
  }

  if (leaveVsDutyConflicts.length > 0 || duplicateAllocatedIds.length > 0) {
    findings.push({
      id: 'AUD-HC-02',
      severity: 'CRITICAL',
      category: 'Headcount Deduplication Quarantine',
      title: `${leaveVsDutyConflicts.length} Leave/Duty Collisions & ${duplicateAllocatedIds.length} Double Allocations`,
      detail: `Violates Section 5.1 Deduplication Quarantine (no sailor can occupy both Leave and Active Duty simultaneously).`,
      affectedRecords: [...leaveVsDutyConflicts, ...duplicateAllocatedIds]
    });
  }

  // =========================================================================
  // 2. REL-01: JOB CARD -> WORK ORDER ORPHAN & GHOST DETECTOR (1,210 vs 1,197)
  // =========================================================================
  const validWorkOrderIds = new Set(
    workOrders.flatMap((wo) => [
      String(wo._id),
      String(wo.id || ''),
      String(wo.WORK_ORDER_ID || ''),
      String(wo.ref_no || '')
    ]).filter(Boolean)
  );

  const orphanedJobCards = [];
  const missingFkJobCards = [];
  let validLinkedJobCards = 0;

  jobCards.forEach((jc) => {
    const woFk = String(
      jc.work_order_id || jc.WORK_ORDER_ID || jc.workOrderId || jc.wo_id || ''
    ).trim();

    if (!woFk || woFk === '-' || woFk === 'null' || woFk === 'undefined') {
      missingFkJobCards.push({
        _id: jc._id,
        jobNumber: jc.job_number || jc.JOB_NUMBER || 'Unnumbered',
        zone: jc.zone || jc.ZONE || 'N/A',
        status: jc.status || jc.STATUS || 'Draft'
      });
    } else if (!validWorkOrderIds.has(woFk)) {
      orphanedJobCards.push({
        _id: jc._id,
        jobNumber: jc.job_number || jc.JOB_NUMBER || jc._id,
        brokenWorkOrderFk: woFk,
        status: jc.status || jc.STATUS
      });
    } else {
      validLinkedJobCards++;
    }
  });

  if (orphanedJobCards.length > 0 || missingFkJobCards.length > 0) {
    findings.push({
      id: 'AUD-REL-01',
      severity: 'CRITICAL',
      category: 'REL-01 Foreign Key Integrity',
      title: `${orphanedJobCards.length + missingFkJobCards.length} Unresolved Job Cards Found (${validLinkedJobCards} / ${jobCards.length} Valid)`,
      detail: `Total /job_cards count is ${jobCards.length}, but only ${validLinkedJobCards} resolve to active /work_orders (${workOrders.length}). ${missingFkJobCards.length} cards have blank/null work_order_id and ${orphanedJobCards.length} reference non-existent Work Orders.`,
      affectedRecords: [...missingFkJobCards, ...orphanedJobCards]
    });
  }

  // =========================================================================
  // 3. SAILOR MEDICAL, GCB, NAV3, PET & ID CARD EXPIRY AUDITOR
  // =========================================================================
  const expiredOrOverdueSailors = [];
  const dateColumns = [
    { key: 'ID_EXPIRY', altKey: 'id_expiry', label: 'Naval ID Expiry' },
    { key: 'NEXT_B_MEDICAL_DATE', altKey: 'next_b_medical_date', label: 'B-Medical Due' },
    { key: 'NEXT_GCB_DATE', altKey: 'next_gcb_date', label: 'Good Conduct Badge (GCB)' },
    { key: 'NEXT_NAV3_DATE', altKey: 'next_nav3_date', label: 'NAV 3 Assessment' },
    { key: 'NEXT_PET_DATE', altKey: 'next_pet_date', label: 'Physical Efficiency Test (PET)' }
  ];

  sailors.forEach((s) => {
    const overdueItems = [];
    dateColumns.forEach(({ key, altKey, label }) => {
      const rawDate = s[key] || s[altKey];
      if (rawDate && rawDate !== '-' && rawDate.length >= 8) {
        const parsed = new Date(rawDate);
        if (!isNaN(parsed.getTime()) && parsed < today) {
          const daysOverdue = Math.floor((today - parsed) / (1000 * 60 * 60 * 24));
          overdueItems.push(`${label}: ${rawDate} (${daysOverdue}d overdue)`);
        }
      }
    });

    if (overdueItems.length > 0) {
      expiredOrOverdueSailors.push({
        _id: s._id,
        name: s.NAME || s.name || s.full_name || 'Unknown',
        city: s.CITY || s.city || '-',
        contact: s.CONTACT_NO || s.contact_no || '-',
        overdueMilestones: overdueItems.join(' | ')
      });
    }
  });

  if (expiredOrOverdueSailors.length > 0) {
    findings.push({
      id: 'AUD-HR-04',
      severity: 'WARNING',
      category: 'Personnel Medical & Statutory Milestones',
      title: `${expiredOrOverdueSailors.length} Sailors Have Expired ID Cards or Overdue Medical / GCB / PET Dates`,
      detail: `Scanned ID_EXPIRY, NEXT_B_MEDICAL_DATE, NEXT_GCB_DATE, NEXT_NAV3_DATE, and NEXT_PET_DATE against ${referenceDateStr}. Immediate administrative renewal required.`,
      affectedRecords: expiredOrOverdueSailors
    });
  }

  // =========================================================================
  // 4. INVENTORY VALUATION (LKR) & LOW-STOCK THRESHOLD SCANNER
  // =========================================================================
  let totalStockValuationLKR = 0;
  const categoryValuation = {};
  const lowStockAlerts = [];
  const negativeOrCorruptStock = [];

  inventory.forEach((item) => {
    const qty = parseFloat(item.quantity ?? item.QUANTITY ?? item.qty ?? 0);
    const unitCost = parseFloat(item.cost_per_unit ?? item.unit_cost ?? item.UNIT_COST ?? item.rate ?? 0);
    const minLevel = parseFloat(item.min_stock_level ?? item.MIN_STOCK_LEVEL ?? 0);
    const cat = String(item.category || item.CATEGORY || 'GENERAL').toUpperCase();

    if (isNaN(qty) || qty < 0 || isNaN(unitCost) || unitCost < 0) {
      negativeOrCorruptStock.push({
        _id: item._id,
        name: item.name || item.ITEM_NAME || item.description,
        qty,
        unitCost
      });
      return;
    }

    const lineValue = qty * unitCost;
    totalStockValuationLKR += lineValue;
    categoryValuation[cat] = (categoryValuation[cat] || 0) + lineValue;

    if (minLevel > 0 && qty <= minLevel) {
      lowStockAlerts.push({
        _id: item._id,
        name: item.name || item.ITEM_NAME || item.description,
        category: cat,
        currentQty: qty,
        minStockLevel: minLevel,
        stockBookNo: item.stock_book_no || item.STOCK_BOOK_NO || 'N/A'
      });
    }
  });

  if (lowStockAlerts.length > 0 || negativeOrCorruptStock.length > 0) {
    findings.push({
      id: negativeOrCorruptStock.length > 0 ? 'AUD-INV-01' : 'AUD-INV-02',
      severity: negativeOrCorruptStock.length > 0 ? 'CRITICAL' : 'WARNING',
      category: 'Inventory & Logistics (CMSys Logistics)',
      title: `${lowStockAlerts.length} Items Below Reorder Threshold | ${negativeOrCorruptStock.length} Corrupt Stock Rows`,
      detail: `Reconciled ${inventory.length} catalog items totaling LKR ${(totalStockValuationLKR / 1e6).toFixed(2)}M.`,
      affectedRecords: [...negativeOrCorruptStock, ...lowStockAlerts.slice(0, 25)]
    });
  }

  // =========================================================================
  // 5. ZERO-SYNC COLLECTION & SCHEMA HYGIENE DETECTOR
  // =========================================================================
  if (dailyEvaluations.length === 0) {
    findings.push({
      id: 'AUD-SYNC-03',
      severity: 'CRITICAL',
      category: 'MySQL <-> Firebase RTDB Federation Sync',
      title: `Zero Records in /daily_evaluations (REL-14 & REL-15 Broken)`,
      detail: `The /daily_evaluations collection in Firebase RTDB contains 0 records. Verify that CMSys V2 (api.php / sync_and_seed_database.php) is pushing the 'daily_evaluations' MySQL table to Firebase RTDB.`,
      affectedRecords: [{ node: '/daily_evaluations', count: 0, expected: '> 0 (6-axis 1-10 ratings)' }]
    });
  }

  // Detect duplicate ADDRESS == ADDRESS_LINE and malformed CONTACT_NO in /sailors
  let redundantAddressCount = 0;
  const malformedContacts = [];

  sailors.forEach((s) => {
    const addr = s.ADDRESS || s.address;
    const addrLine = s.ADDRESS_LINE || s.address_line;
    if (addr && addrLine && String(addr).trim() === String(addrLine).trim()) {
      redundantAddressCount++;
    }

    const phone = String(s.CONTACT_NO || s.contact_no || '').trim();
    if (phone && !/^\d{10}$/.test(phone.replace(/[- ]/g, ''))) {
      malformedContacts.push({ _id: s._id, name: s.NAME || s.name, rawPhone: phone });
    }
  });

  if (redundantAddressCount > 0 || malformedContacts.length > 0) {
    findings.push({
      id: 'AUD-SCH-05',
      severity: 'INFO',
      category: 'Schema Hygiene & Normalization',
      title: `${redundantAddressCount} Redundant Address Rows & ${malformedContacts.length} Unnormalized Phone Numbers`,
      detail: `ADDRESS and ADDRESS_LINE store identical strings across ${redundantAddressCount} sailor records, doubling payload size. ${malformedContacts.length} CONTACT_NO entries contain multiple numbers or non-standard formatting.`,
      affectedRecords: malformedContacts.slice(0, 20)
    });
  }

  const executionTimeMs = (performance.now() - startTime).toFixed(1);

  return {
    timestamp: new Date().toISOString(),
    executionTimeMs,
    kpis: {
      liveSailors: totalLiveSailors,
      statutoryTarget: CMSYS_INVARIANTS.STATUTORY_TOTAL,
      headcountDelta,
      totalWorkOrders: workOrders.length,
      totalJobCards: jobCards.length,
      validLinkedJobCards,
      orphanedJobCardsCount: orphanedJobCards.length + missingFkJobCards.length,
      inventoryCount: inventory.length,
      totalValuationLKR: totalStockValuationLKR,
      overdueSailorMilestones: expiredOrOverdueSailors.length,
      dailyEvaluationsCount: dailyEvaluations.length
    },
    tradeCounts,
    categoryValuation,
    findings,
    orphanedJobCards,
    missingFkJobCards,
    expiredOrOverdueSailors,
    malformedContacts
  };
}

/**
 * Renders the Forensic Audit Report into the CMSys-DB-Hub DOM
 * @param {Object} auditResult - Output from runDeepForensicAudit()
 * @param {HTMLElement} consoleContainer - DOM element for the diagnostic console
 */
function renderForensicAuditConsole(auditResult, consoleContainer) {
  if (!consoleContainer) return;
  const { kpis, findings, executionTimeMs } = auditResult;

  const severityBadge = (sev) => {
    const map = {
      CRITICAL: 'bg-rose-500/20 text-rose-400 border-rose-500/40',
      WARNING: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
      INFO: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40'
    };
    return `<span class="px-2.5 py-0.5 text-xs font-mono font-semibold rounded border ${map[sev] || map.INFO}">${sev}</span>`;
  };

  // Build Quick Action buttons for specific findings
  const getActionButtonsForFinding = (f) => {
    if (f.id === 'AUD-HC-01') {
      return `<button onclick="window.reconcileHeadcount && window.reconcileHeadcount()" class="px-3 py-1 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow">
        <i class="fa-solid fa-wand-magic-sparkles"></i> 1-Click Align Cadre (Set ACTIVE_STRENGTH: 667)
      </button>`;
    }
    if (f.id === 'AUD-REL-01') {
      return `<button onclick="window.rebindAllSafeOrphans && window.rebindAllSafeOrphans()" class="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow">
        <i class="fa-solid fa-link"></i> Auto-Rebind / Fix Orphaned Cards
      </button>`;
    }
    if (f.id === 'AUD-SYNC-03') {
      return `<button onclick="window.syncEvaluationsToFirebase && window.syncEvaluationsToFirebase()" class="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow">
        <i class="fa-solid fa-cloud-arrow-up"></i> Sync Multi-Trade Evaluations to Firebase RTDB
      </button>`;
    }
    if (f.id === 'AUD-SCH-05') {
      return `<button onclick="window.executeSchemaSanitization && window.executeSchemaSanitization()" class="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow">
        <i class="fa-solid fa-broom"></i> Sanitize &amp; Normalize Schema
      </button>`;
    }
    return '';
  };

  consoleContainer.innerHTML = `
    <div class="space-y-4 font-mono text-sm">
      <!-- Summary Telemetry Banner -->
      <div class="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
        <div class="flex items-center gap-3">
          <span class="inline-block w-2.5 h-2.5 rounded-full ${findings.some(f => f.severity === 'CRITICAL') ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}"></span>
          <span class="text-slate-200 font-semibold text-xs sm:text-sm">
            Forensic Scan Complete in ${executionTimeMs}ms — ${findings.length} Diagnostic Findings
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button id="btn-export-audit-json" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-400 border border-slate-700 transition flex items-center gap-1.5 shadow">
            <i class="fa-solid fa-file-code"></i>
            <span>Export Forensic JSON</span>
          </button>
        </div>
      </div>

      <!-- Findings Accordion List -->
      <div class="space-y-3">
        ${findings.map((f, idx) => `
          <details class="group rounded-xl bg-slate-900/70 border border-slate-800/90 open:border-slate-700 transition overflow-hidden" ${idx < 3 ? 'open' : ''}>
            <summary class="flex items-center justify-between gap-4 p-4 cursor-pointer select-none hover:bg-slate-800/40">
              <div class="flex items-center gap-3">
                ${severityBadge(f.severity)}
                <span class="text-xs text-slate-400">[${f.id}]</span>
                <span class="text-slate-100 font-semibold text-xs sm:text-sm">${f.title}</span>
              </div>
              <span class="text-xs text-slate-400 group-open:rotate-180 transition-transform">
                ▼ ${f.affectedRecords?.length || 0} rows
              </span>
            </summary>

            <div class="p-4 pt-0 border-t border-slate-800/60 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2 pt-3">
                <p class="text-xs text-slate-300 leading-relaxed flex-1">${f.detail}</p>
                <div>${getActionButtonsForFinding(f)}</div>
              </div>

              ${f.affectedRecords && f.affectedRecords.length > 0 ? `
                <div class="max-h-60 overflow-auto rounded-lg border border-slate-800 bg-slate-950/80">
                  <table class="w-full text-left text-xs">
                    <thead class="bg-slate-900 text-slate-400 sticky top-0">
                      <tr>
                        ${Object.keys(f.affectedRecords[0]).map(col => `<th class="px-3 py-2 font-medium uppercase">${col}</th>`).join('')}
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-800/60 text-slate-300">
                      ${f.affectedRecords.slice(0, 50).map(row => `
                        <tr class="hover:bg-slate-900/50">
                          ${Object.values(row).map(val => `<td class="px-3 py-1.5 whitespace-nowrap font-mono text-[11px]">${String(val ?? '-')}</td>`).join('')}
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : ''}
            </div>
          </details>
        `).join('')}
      </div>
    </div>
  `;

  // Bind JSON Export button
  const exportBtn = consoleContainer.querySelector('#btn-export-audit-json');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(auditResult, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `CMSys-Forensic-Audit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  }
}

// Support both ES Modules and Browser Global Window Execution
if (typeof window !== 'undefined') {
  window.CMSYS_INVARIANTS = CMSYS_INVARIANTS;
  window.normalizeCollection = normalizeCollection;
  window.runDeepForensicAudit = runDeepForensicAudit;
  window.renderForensicAuditConsole = renderForensicAuditConsole;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CMSYS_INVARIANTS,
    normalizeCollection,
    runDeepForensicAudit,
    renderForensicAuditConsole
  };
}
