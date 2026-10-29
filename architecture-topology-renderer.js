/**
 * CMSys-DB-Hub v2.4.0 — Interactive Architecture Topology & REL-01..REL-26 Graph Renderer
 * Target Architecture: NCW-PS / CMSys V2 (Eastern Naval Area - Civil Engineering Dept)
 * Federated Suite: CMSys-DB-Hub, CMSys V2, CMSys Logistics, CMSys-Waterworks, CMSys-Inventory
 */

const RELATIONSHIP_MATRIX_DATA = [
  { id: 'REL-01', origin: 'work_orders', target: 'job_cards', cardinality: '1 : N', desc: 'Macro Work Orders partition into granular operational Job Cards.' },
  { id: 'REL-02', origin: 'work_orders', target: 'estimates', cardinality: '1 : N', desc: 'Work Orders link to approved Bill of Quantities (BOQ).' },
  { id: 'REL-03', origin: 'approved_projects', target: 'work_orders', cardinality: '1 : N', desc: 'NHQ High-value projects cascade into zonal work orders.' },
  { id: 'REL-04', origin: 'locations', target: 'work_orders', cardinality: '1 : N', desc: 'Base infrastructure buildings & jetties bind to work orders.' },
  { id: 'REL-05', origin: 'locations', target: 'job_cards', cardinality: '1 : N', desc: 'Specific rooms, compartments, or floors bound to job cards.' },
  { id: 'REL-06', origin: 'job_cards', target: 'job_card_materials', cardinality: '1 : N', desc: 'Tracks physical building materials consumed during job card execution.' },
  { id: 'REL-07', origin: 'inventory', target: 'job_card_materials', cardinality: '1 : N', desc: 'Consumed material automatically decrements store inventory.' },
  { id: 'REL-08', origin: 'inventory', target: 'estimates', cardinality: '1 : N', desc: 'Catalog items projected in cost estimates.' },
  { id: 'REL-09', origin: 'sailors', target: 'daily_allocations', cardinality: '1 : N', desc: 'Sailors assigned to daily duty allocations per date.' },
  { id: 'REL-10', origin: 'work_orders', target: 'daily_allocations', cardinality: '1 : N', desc: 'Work orders staff daily assigned sailor crew details.' },
  { id: 'REL-11', origin: 'sailors', target: 'availability', cardinality: '1 : N', desc: 'Leave, Sick, Hospital, and AWOL daily status ledger.' },
  { id: 'REL-12', origin: 'inventory', target: 'nav254_vouchers', cardinality: '1 : N', desc: 'Inter-store transfer documented under Form NAV 254.' },
  { id: 'REL-13', origin: 'inventory', target: 'temp_issues', cardinality: '1 : N', desc: 'Power tools & machinery loaned via Temp Issue Book.' },
  { id: 'REL-14', origin: 'sailors', target: 'daily_evaluations', cardinality: '1 : N', desc: 'Trade performance evaluated on 6-axis 1-10 scale.' },
  { id: 'REL-15', origin: 'work_orders', target: 'daily_evaluations', cardinality: '1 : N', desc: 'Evaluations linked to specific project work order context.' },
  { id: 'REL-16', origin: 'job_cards', target: 'user_feedback', cardinality: '1 : 1', desc: 'Completed job cards require client/officer rating verification.' },
  { id: 'REL-17', origin: 'sailors', target: 'job_card_labor', cardinality: '1 : N', desc: 'Detailed hours worked per sailor logged against job cards.' },
  { id: 'REL-18', origin: 'locations', target: 'maintenance_records', cardinality: '1 : N', desc: 'Historical maintenance records tied to building lifecycle.' },
  { id: 'REL-19', origin: 'sailors', target: 'zone_teams', cardinality: '1 : 1', desc: 'Base organizational assignment into zone workshops.' },
  { id: 'REL-20', origin: 'sailors', target: 'attendance_log', cardinality: '1 : N', desc: 'Gate / Base nominal roll check-in and check-out logs.' },
  { id: 'REL-21', origin: 'sailors', target: 'sailor_board_entries', cardinality: '1 : N', desc: 'White Board commendations and Black Board disciplinary logs.' },
  { id: 'REL-22', origin: 'sailors', target: 'performance_awards', cardinality: '1 : N', desc: 'Best trade worker awards computed over weekly/monthly cycles.' },
  { id: 'REL-23', origin: 'inventory', target: 'inventory_on_charge', cardinality: '1 : N', desc: 'Store inward stock additions via receipt vouchers.' },
  { id: 'REL-24', origin: 'work_orders', target: 'naval_projects_vote', cardinality: '1 : 1', desc: 'Statutory Vote allocations (2104, 2001, etc.) funding works.' },
  { id: 'REL-25', origin: 'users', target: 'audit_log', cardinality: '1 : N', desc: 'User mutation footprint across all system entities.' },
  { id: 'REL-26', origin: 'feedback_tokens', target: 'job_cards', cardinality: '1 : 1', desc: 'Cryptographic single-use token authorizing external feedback.' }
];

/**
 * Main Architecture Topology Tab Renderer
 * @param {HTMLElement} containerElement - Mount target DOM container
 * @param {Object} dbSnapshot - In-memory database cache
 */
function renderArchitectureTopologyTab(containerElement, dbSnapshot = {}) {
  if (!containerElement) return;

  containerElement.innerHTML = `
    <div class="space-y-6 font-mono">
      <!-- Top Control & View Switcher Bar -->
      <div class="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-lg">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
            <button id="view-btn-topology" class="px-4 py-2 text-xs font-semibold rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 transition">
              <i class="fa-solid fa-network-wired mr-2"></i>Federated System Topology
            </button>
            <button id="view-btn-matrix" class="px-4 py-2 text-xs font-semibold rounded-md text-slate-400 hover:text-slate-200 transition">
              <i class="fa-solid fa-table-cells-large mr-2"></i>REL-01..REL-26 Matrix (26)
            </button>
            <button id="view-btn-erd" class="px-4 py-2 text-xs font-semibold rounded-md text-slate-400 hover:text-slate-200 transition">
              <i class="fa-solid fa-diagram-project mr-2"></i>Interactive ERD Graph
            </button>
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>Primary RTDB Live</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-cyan-400"></span>MySQL PDO Active</span>
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-amber-400"></span>Logistics :8000 Bridged</span>
        </div>
      </div>

      <!-- View Container -->
      <div id="arch-view-container">
        <!-- RENDER TOPOLOGY BY DEFAULT -->
        ${renderTopologyView()}
      </div>
    </div>
  `;

  // Switcher event listeners
  const btnTopo = containerElement.querySelector('#view-btn-topology');
  const btnMatrix = containerElement.querySelector('#view-btn-matrix');
  const btnErd = containerElement.querySelector('#view-btn-erd');
  const viewContainer = containerElement.querySelector('#arch-view-container');

  const setActiveBtn = (active) => {
    [
      { btn: btnTopo, id: 'topo' },
      { btn: btnMatrix, id: 'matrix' },
      { btn: btnErd, id: 'erd' }
    ].forEach(({ btn, id }) => {
      if (!btn) return;
      if (id === active) {
        btn.className = 'px-4 py-2 text-xs font-semibold rounded-md bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 transition';
      } else {
        btn.className = 'px-4 py-2 text-xs font-semibold rounded-md text-slate-400 hover:text-slate-200 transition';
      }
    });
  };

  if (btnTopo) {
    btnTopo.addEventListener('click', () => {
      setActiveBtn('topo');
      viewContainer.innerHTML = renderTopologyView();
    });
  }

  if (btnMatrix) {
    btnMatrix.addEventListener('click', () => {
      setActiveBtn('matrix');
      viewContainer.innerHTML = renderMatrixView(dbSnapshot);

      // Bind search filter
      const searchInput = containerElement.querySelector('#matrix-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          const query = e.target.value.toLowerCase();
          const cards = containerElement.querySelectorAll('.rel-card');
          cards.forEach(card => {
            const text = card.textContent.toLowerCase();
            card.style.display = text.includes(query) ? 'block' : 'none';
          });
        });
      }
    });
  }

  if (btnErd) {
    btnErd.addEventListener('click', () => {
      setActiveBtn('erd');
      viewContainer.innerHTML = renderErdView(dbSnapshot);
    });
  }
}

function renderTopologyView() {
  return `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- Column 1: Application Layer -->
      <div class="space-y-4">
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <h3 class="text-xs uppercase tracking-wider text-cyan-400 font-bold mb-3 flex items-center gap-2">
            <i class="fa-solid fa-layer-group"></i> 1. Federated Application Suite
          </h3>
          <div class="space-y-3 text-xs">
            <div class="p-3 rounded-lg bg-slate-950 border border-cyan-500/30 hover:border-cyan-500/60 transition">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">CMSys-DB-Hub (v2.4.0)</div>
                <span class="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold">PORT 80</span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">HTML5 / ES2024 / Tailwind. Realtime Audit & Schema Inspector.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-gold-500/40 transition">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">CMSys V2 Monolith & PWA</div>
                <span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] font-bold">PWA TABLET</span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">Vanilla JS (2.1MB) + PHP 8.x + SW. Muster, Work Orders & Tablet PWA.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-blue-500/40 transition">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">CMSys Logistics</div>
                <span class="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">PORT 8000</span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">Next.js 15, React 19, Prisma ORM. Supply Chain & NAV 254/255.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-teal-500/40 transition">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">CMSys-Waterworks & Inventory</div>
                <span class="px-1.5 py-0.2 rounded bg-teal-500/20 text-teal-300 text-[10px] font-bold">UTILITY</span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">Vite SPA & Migration tools for pump telemetry and store accounting.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Column 2: Persistence Layer -->
      <div class="space-y-4">
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <h3 class="text-xs uppercase tracking-wider text-emerald-400 font-bold mb-3 flex items-center gap-2">
            <i class="fa-solid fa-database"></i> 2. Hybrid Persistence & Failover
          </h3>
          <div class="space-y-3 text-xs">
            <div class="p-3 rounded-lg bg-slate-950 border border-emerald-500/30">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">Primary Cloud RTDB</div>
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              </div>
              <div class="text-emerald-400 text-[11px] mt-1">cmsys-v2 (asia-southeast1)</div>
              <div class="text-[10px] text-slate-500 mt-1">Live WebSocket listener & REST write-back target.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">Secondary Failover RTDB</div>
                <span class="w-2 h-2 rounded-full bg-blue-400"></span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">cmsys-v2 (replica / asia-southeast1)</div>
              <div class="text-[10px] text-slate-500 mt-1">Auto-failover when primary latency exceeds 4,000ms.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">On-Premises Relational DB</div>
                <span class="w-2 h-2 rounded-full bg-purple-400"></span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">MySQL PDO (ncw_ps_db) — 18 Core Tables via XAMPP</div>
              <div class="text-[10px] text-slate-500 mt-1">Port 3306. Synchronized via api.php audit logging.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="flex items-center justify-between">
                <div class="font-semibold text-slate-200">Offline Seed Snapshot</div>
                <span class="w-2 h-2 rounded-full bg-gold-400"></span>
              </div>
              <div class="text-slate-400 text-[11px] mt-1">cmsys-v2-1fb05-seed.json (3.84 MB)</div>
              <div class="text-[10px] text-slate-500 mt-1">Air-gapped fallback for off-grid naval dockyard operations.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Column 3: Security & Deployment -->
      <div class="space-y-4">
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 shadow-lg">
          <h3 class="text-xs uppercase tracking-wider text-amber-400 font-bold mb-3 flex items-center gap-2">
            <i class="fa-solid fa-shield-halved"></i> 3. Deployment & Governance
          </h3>
          <div class="space-y-3 text-xs">
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="font-semibold text-slate-200">Tier 1: Local Development</div>
              <div class="text-slate-400 text-[11px] mt-1">XAMPP Apache/MySQL & Local Node/Bun runtime (Port 80/8000).</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="font-semibold text-slate-200">Tier 2: Staging Beta</div>
              <div class="text-slate-400 text-[11px] mt-1">cmsys-beta.vercel.app (Tablets & Field Supervisors).</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-slate-800">
              <div class="font-semibold text-slate-200">Tier 3: Production Live</div>
              <div class="text-slate-400 text-[11px] mt-1">cmsys-live.vercel.app / Base Dockyard Local Server.</div>
            </div>
            <div class="p-3 rounded-lg bg-slate-950 border border-emerald-500/20">
              <div class="font-semibold text-emerald-400">Headcount Conservation Invariant</div>
              <div class="text-slate-400 text-[11px] mt-1">Strict statutory alignment: 667 Cadre (577 VSS + 90 Regular).</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMatrixView(dbSnapshot = {}) {
  return `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-4 p-3 rounded-xl bg-slate-900/90 border border-slate-800 shadow">
        <div class="text-xs text-slate-300 font-semibold flex items-center gap-2">
          <span>Registered Interconnections Matrix</span>
          <span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[11px] border border-cyan-500/30">REL-01 ~ REL-26</span>
          <span class="text-slate-500 text-[11px]">• Click any card to inspect target node</span>
        </div>
        <div class="w-full sm:w-72">
          <input id="matrix-search" type="text" placeholder="Filter relations (e.g. inventory, job_cards)..."
            class="w-full px-3 py-1.5 text-xs rounded-lg bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-cyan-500">
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${RELATIONSHIP_MATRIX_DATA.map(rel => {
          const parentCount = Object.keys(dbSnapshot[rel.origin] || {}).length;
          const childCount = Object.keys(dbSnapshot[rel.target] || {}).length;
          let healthBadge = '';

          if (rel.id === 'REL-01') {
            healthBadge = '<span class="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 text-[10px] font-bold border border-amber-500/30">13 Ghost Cards</span>';
          } else if (rel.id === 'REL-14' && childCount === 0) {
            healthBadge = '<span class="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-400 text-[10px] font-bold border border-rose-500/30">0 in RTDB</span>';
          } else if (parentCount > 0 && childCount > 0) {
            healthBadge = '<span class="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">Active</span>';
          }

          return `
            <div class="rel-card p-4 rounded-xl bg-slate-900/80 border border-slate-800/90 hover:border-cyan-500/50 transition cursor-pointer shadow"
                 onclick="window.jumpToRelationship && window.jumpToRelationship('${rel.origin}', '${rel.target}')"
                 title="Click to view /${rel.target} in Live Node Explorer">
              <div class="flex items-center justify-between mb-2">
                <span class="px-2.5 py-0.5 text-xs font-mono font-bold rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">${rel.id}</span>
                <div class="flex items-center gap-1.5">
                  ${healthBadge}
                  <span class="px-2 py-0.5 text-[10px] font-mono rounded bg-slate-800 text-slate-300">${rel.cardinality}</span>
                </div>
              </div>
              <div class="flex items-center gap-2 text-xs font-mono text-slate-200 mb-2">
                <span class="text-cyan-300 font-semibold">/${rel.origin}</span>
                <i class="fa-solid fa-arrow-right text-[10px] text-slate-500"></i>
                <span class="text-emerald-300 font-semibold">/${rel.target}</span>
              </div>
              <p class="text-xs text-slate-400 leading-relaxed mb-3">${rel.desc}</p>
              <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[10px] text-slate-500">
                <span>Records: <strong class="text-slate-300">${parentCount}</strong> &rarr; <strong class="text-slate-300">${childCount}</strong></span>
                <span class="text-cyan-400 hover:underline">Browse /${rel.target} &rarr;</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function renderErdView(dbSnapshot = {}) {
  const entities = [
    { id: 'sailors', title: 'sailors (Users)', x: 40, y: 40, color: '#14b8a6', count: Object.keys(dbSnapshot.sailors || {}).length, fields: ['_id [PK]', 'off_no', 'name', 'trade', 'roll', 'complement_status', 'id_expiry'] },
    { id: 'work_orders', title: 'work_orders', x: 380, y: 40, color: '#f59e0b', count: Object.keys(dbSnapshot.work_orders || {}).length, fields: ['_id [PK]', 'description', 'reference_no', 'voteNumber', 'status', 'location_id [FK]'] },
    { id: 'job_cards', title: 'job_cards', x: 720, y: 40, color: '#38bdf8', count: Object.keys(dbSnapshot.job_cards || {}).length, fields: ['_id [PK]', 'job_number', 'work_order_id [FK]', 'location_id [FK]', 'status', 'start_date'] },
    { id: 'locations', title: 'locations', x: 380, y: 280, color: '#c084fc', count: Object.keys(dbSnapshot.locations || {}).length, fields: ['_id [PK]', 'building_name', 'zone_id', 'description'] },
    { id: 'inventory', title: 'inventory', x: 720, y: 280, color: '#34d399', count: Object.keys(dbSnapshot.inventory || {}).length, fields: ['_id [PK]', 'name', 'category', 'quantity', 'cost_per_unit', 'min_stock_level'] },
    { id: 'daily_allocations', title: 'daily_allocations', x: 40, y: 280, color: '#06b6d4', count: Object.keys(dbSnapshot.daily_allocations || {}).length, fields: ['_id [PK]', 'date', 'sailor_id [FK]', 'work_order_id [FK]', 'role_today'] },
    { id: 'daily_evaluations', title: 'daily_evaluations', x: 40, y: 470, color: '#f43f5e', count: Object.keys(dbSnapshot.daily_evaluations || {}).length, fields: ['_id [PK]', 'date', 'sailor_id [FK]', 'work_order_id [FK]', 'quality_score', 'attitude_score'] },
    { id: 'nav254_vouchers', title: 'nav254_vouchers', x: 720, y: 470, color: '#fb923c', count: Object.keys(dbSnapshot.nav254_vouchers || {}).length, fields: ['_id [PK]', 'voucher_no', 'issuing_unit', 'receiving_unit', 'date'] },
    { id: 'audit_log', title: 'audit_log (REL-25)', x: 380, y: 470, color: '#fbbf24', count: Object.keys(dbSnapshot.audit_log || {}).length, fields: ['_id [PK]', 'timestamp', 'userEmail', 'node', 'recordId', 'action', 'newValue'] }
  ];

  return `
    <div class="bg-navy-900 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <div class="flex items-center gap-2">
          <span class="text-xs font-bold text-white uppercase mono">Core Entity Schema ERD Graph</span>
          <span class="text-[10px] px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 mono border border-teal-500/30">9 Core Entities</span>
        </div>
        <div class="flex items-center gap-3 text-xs text-slate-400">
          <span><span class="w-2.5 h-2.5 rounded-full bg-teal-500 inline-block mr-1"></span> 1:N Relation</span>
          <span><span class="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block mr-1"></span> 1:1 Relation</span>
        </div>
      </div>
      <div class="overflow-x-auto bg-slate-950 p-2 rounded-xl border border-slate-800">
        <svg viewBox="0 0 1000 600" class="w-full min-w-[900px] h-auto select-none font-mono">
          <defs>
            <marker id="erdArrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#14b8a6"/>
            </marker>
          </defs>

          <!-- SVG Connector Lines -->
          <path d="M 640 100 L 720 100" stroke="#f59e0b" stroke-width="2" fill="none" stroke-dasharray="4,2" marker-end="url(#erdArrow)"/>
          <text x="665" y="90" fill="#f59e0b" font-size="10">1:N (REL-01)</text>

          <path d="M 500 280 L 500 210" stroke="#c084fc" stroke-width="2" fill="none" marker-end="url(#erdArrow)"/>
          <text x="505" y="250" fill="#c084fc" font-size="10">1:N (REL-04)</text>

          <path d="M 160 210 L 160 280" stroke="#14b8a6" stroke-width="2" fill="none" marker-end="url(#erdArrow)"/>
          <text x="165" y="250" fill="#14b8a6" font-size="10">1:N (REL-09)</text>

          <path d="M 160 410 L 160 470" stroke="#f43f5e" stroke-width="2" fill="none" marker-end="url(#erdArrow)"/>
          <text x="165" y="445" fill="#f43f5e" font-size="10">1:N (REL-14)</text>

          <path d="M 840 410 L 840 470" stroke="#34d399" stroke-width="2" fill="none" marker-end="url(#erdArrow)"/>
          <text x="845" y="445" fill="#34d399" font-size="10">1:N (REL-12)</text>

          <path d="M 500 470 L 500 410" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3,3" fill="none"/>
          <text x="505" y="445" fill="#fbbf24" font-size="10">1:N (REL-25)</text>

          <!-- Entity Boxes -->
          ${entities.map(e => `
            <g transform="translate(${e.x}, ${e.y})" class="cursor-pointer" onclick="window.jumpToRelationship && window.jumpToRelationship('', '${e.id}')">
              <rect width="240" height="170" rx="10" fill="#030712" stroke="${e.color}" stroke-width="2" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.5))"/>
              <rect width="240" height="32" rx="8" fill="${e.color}" fill-opacity="0.2"/>
              <text x="12" y="21" fill="${e.color}" font-weight="bold" font-size="11">/${e.title}</text>
              <text x="228" y="21" fill="#fff" font-size="9" text-anchor="end" opacity="0.8">${e.count} recs</text>
              <line x1="0" y1="32" x2="240" y2="32" stroke="${e.color}" stroke-width="1"/>
              ${e.fields.map((f, i) => `
                <text x="12" y="${50 + (i * 18)}" fill="${f.includes('[PK]') ? '#2dd4bf' : (f.includes('[FK]') ? '#fbbf24' : '#94a3b8')}" font-size="9.5">
                  ${f}
                </text>
              `).join('')}
            </g>
          `).join('')}
        </svg>
      </div>
    </div>
  `;
}

// Support both ES Modules and Browser Global Window Execution
if (typeof window !== 'undefined') {
  window.RELATIONSHIP_MATRIX_DATA = RELATIONSHIP_MATRIX_DATA;
  window.renderArchitectureTopologyTab = renderArchitectureTopologyTab;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RELATIONSHIP_MATRIX_DATA,
    renderArchitectureTopologyTab
  };
}
