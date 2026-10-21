/**
 * CMSys-DB-Hub v2.5.0 — System Maps Renderer
 * -----------------------------------------------------------------------------
 * Interactive SVG cartography for the CMSys V2 / NCW-PS federated data platform:
 *
 *   1. DB Connection Concept Map      — entities + labeled propositions
 *   2. Connection Flowcharts (x4)     — failover ladder, read path, write path, sync bridges
 *   3. Network Map                    — dockyard LAN / firewall edge / Firebase cloud zones
 *   4. System Integration Concept Map — all 5 federated applications + shared data concepts
 *
 * Pure ES2024, zero dependencies. Provides pan/zoom, hover tooltips, legends and
 * one-click SVG export. Mounted by index.html Tab 2 ("Architecture & Maps").
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ─── Palette (aligned with CMSys-DB-Hub dark theme) ─────────────────────────
  const C = {
    bg:        '#030712',
    panel:     '#0a1628',
    panel2:    '#0d1f38',
    stroke:    '#1e293b',
    text:      '#e2e8f0',
    sub:       '#94a3b8',
    faint:     '#64748b',
    teal:      '#14b8a6',
    tealSoft:  'rgba(20,184,166,0.14)',
    sky:       '#0ea5e9',
    skySoft:   'rgba(14,165,233,0.14)',
    violet:    '#8b5cf6',
    violetSoft:'rgba(139,92,246,0.14)',
    gold:      '#f59e0b',
    goldSoft:  'rgba(245,158,11,0.14)',
    rose:      '#f43f5e',
    roseSoft:  'rgba(244,63,94,0.14)',
    emerald:   '#10b981',
    emeraldSoft:'rgba(16,185,129,0.14)',
    blue:      '#3b82f6',
    blueSoft:  'rgba(59,130,246,0.14)',
    slate:     '#475569'
  };

  const FONT_MONO = "'JetBrains Mono','Fira Code',monospace";
  const FONT_UI   = "'Inter',system-ui,sans-serif";

  // ─── Tiny DOM / SVG helpers ─────────────────────────────────────────────────
  const NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs = {}, parent = null) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) n.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(n);
    return n;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function wrapText(str, maxChars) {
    const words = String(str || '').split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      if (!cur) { cur = w; continue; }
      if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // ─── Shared SVG defs (arrow markers + glow) ─────────────────────────────────
  function injectDefs(root) {
    const defs = svg('defs', {}, root);
    const colors = {
      slate: C.slate, teal: C.teal, sky: C.sky, violet: C.violet,
      gold: C.gold, rose: C.rose, emerald: C.emerald, blue: C.blue
    };
    Object.entries(colors).forEach(([name, color]) => {
      const m = svg('marker', {
        id: `ah-${name}`, viewBox: '0 0 10 10', refX: 9, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      }, defs);
      svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }, m);
    });
    const glow = svg('filter', { id: 'mapGlow', x: '-40%', y: '-40%', width: '180%', height: '180%' }, defs);
    svg('feGaussianBlur', { stdDeviation: 3.2, result: 'blur' }, glow);
    const merge = svg('feMerge', {}, glow);
    svg('feMergeNode', { in: 'blur' }, merge);
    svg('feMergeNode', { in: 'SourceGraphic' }, merge);
    return defs;
  }

  // ─── Pan / Zoom / Tooltip / Export shell ────────────────────────────────────
  function buildShell(container, { title, subtitle, legendHtml, toolbarExtra = '' }) {
    container.innerHTML = `
      <div class="sysmap-shell">
        <div class="sysmap-toolbar">
          <div class="sysmap-toolbar-title">
            <div class="sysmap-title">${title}</div>
            <div class="sysmap-subtitle">${subtitle}</div>
          </div>
          <div class="sysmap-toolbar-actions">
            ${toolbarExtra}
            <div class="sysmap-zoom-group">
              <button type="button" class="sysmap-btn" data-map-zoom="out" title="Zoom out"><i class="fa-solid fa-minus"></i></button>
              <span class="sysmap-zoom-level" data-map-zoom-level>100%</span>
              <button type="button" class="sysmap-btn" data-map-zoom="in" title="Zoom in"><i class="fa-solid fa-plus"></i></button>
              <button type="button" class="sysmap-btn" data-map-zoom="reset" title="Reset view"><i class="fa-solid fa-expand"></i></button>
            </div>
            <button type="button" class="sysmap-btn sysmap-btn-accent" data-map-export title="Download this diagram as SVG">
              <i class="fa-solid fa-download"></i> SVG
            </button>
          </div>
        </div>
        <div class="sysmap-canvas" data-map-canvas>
          <div class="sysmap-tooltip" data-map-tooltip hidden></div>
        </div>
        ${legendHtml ? `<div class="sysmap-legend">${legendHtml}</div>` : ''}
      </div>
    `;
    return {
      root: container.querySelector('.sysmap-shell'),
      canvas: container.querySelector('[data-map-canvas]'),
      tooltip: container.querySelector('[data-map-tooltip]')
    };
  }

  function shellRoot(shell) {
    if (!shell) return null;
    if (shell.querySelectorAll) return shell;         // already a DOM element
    return shell.root || null;                        // {root, canvas, tooltip}
  }

  function attachPanZoom(shell, svgRoot, innerG, { minScale = 0.35, maxScale = 3 } = {}) {
    const rootEl = shellRoot(shell);
    let scale = 1, tx = 0, ty = 0;
    const levelEl = rootEl && rootEl.querySelector('[data-map-zoom-level]');

    const apply = () => {
      innerG.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
      if (levelEl) levelEl.textContent = Math.round(scale * 100) + '%';
    };

    const zoomAt = (mx, my, factor) => {
      const next = Math.min(maxScale, Math.max(minScale, scale * factor));
      // Keep the point under the cursor stable
      tx = mx - ((mx - tx) / scale) * next;
      ty = my - ((my - ty) / scale) * next;
      scale = next;
      apply();
    };

    svgRoot.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = svgRoot.getBoundingClientRect();
      const vb = svgRoot.viewBox.baseVal;
      const mx = ((e.clientX - r.left) / r.width) * vb.width;
      const my = ((e.clientY - r.top) / r.height) * vb.height;
      zoomAt(mx, my, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    let dragging = false, lastX = 0, lastY = 0, moved = false;
    svgRoot.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true; moved = false;
      lastX = e.clientX; lastY = e.clientY;
      svgRoot.setPointerCapture(e.pointerId);
      svgRoot.style.cursor = 'grabbing';
    });
    svgRoot.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = svgRoot.getBoundingClientRect();
      const vb = svgRoot.viewBox.baseVal;
      const dx = ((e.clientX - lastX) / r.width) * vb.width;
      const dy = ((e.clientY - lastY) / r.height) * vb.height;
      if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
      tx += dx; ty += dy;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    const endDrag = (e) => {
      dragging = false;
      svgRoot.style.cursor = 'grab';
      try { svgRoot.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
    };
    svgRoot.addEventListener('pointerup', endDrag);
    svgRoot.addEventListener('pointercancel', endDrag);
    svgRoot.style.cursor = 'grab';

    if (rootEl) {
      rootEl.querySelectorAll('[data-map-zoom]').forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.getAttribute('data-map-zoom');
          const vb = svgRoot.viewBox.baseVal;
          const cx = vb.width / 2, cy = vb.height / 2;
          if (mode === 'in') zoomAt(cx, cy, 1.2);
          else if (mode === 'out') zoomAt(cx, cy, 1 / 1.2);
          else { scale = 1; tx = 0; ty = 0; apply(); }
        });
      });
    }

    const exportBtn = rootEl && rootEl.querySelector('[data-map-export]');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportSvg(svgRoot));
    }

    apply();
    return { apply };
  }

  function exportSvg(svgRoot) {
    const clone = svgRoot.cloneNode(true);
    clone.setAttribute('xmlns', NS);
    // Inline background so the export matches the on-screen canvas
    const bg = document.createElementNS(NS, 'rect');
    const vb = svgRoot.viewBox.baseVal;
    bg.setAttribute('x', vb.x || 0); bg.setAttribute('y', vb.y || 0);
    bg.setAttribute('width', vb.width); bg.setAttribute('height', vb.height);
    bg.setAttribute('fill', C.bg);
    clone.insertBefore(bg, clone.firstChild);
    const src = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([src], { type: 'image/svg+xml;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = (svgRoot.getAttribute('data-map-name') || 'cmsys-map') + '.svg';
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function attachTooltip(shell, svgRoot) {
    const tip = shell.tooltip;
    if (!tip) return;
    svgRoot.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[data-tip]');
      if (!t) return;
      tip.innerHTML = t.getAttribute('data-tip');
      tip.hidden = false;
    });
    svgRoot.addEventListener('pointermove', (e) => {
      if (tip.hidden) return;
      const r = shell.canvas.getBoundingClientRect();
      let x = e.clientX - r.left + 16;
      let y = e.clientY - r.top + 12;
      if (x + 260 > r.width) x = e.clientX - r.left - 250;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    });
    svgRoot.addEventListener('pointerout', (e) => {
      if (!e.target.closest || !e.target.closest('[data-tip]')) return;
      tip.hidden = true;
    });
  }

  // ─── Shape drawing primitives ───────────────────────────────────────────────
  /**
   * Draw a map node and return its anchor geometry.
   * shape: 'rect' | 'diamond' | 'cylinder' | 'stadium' | 'parallelogram' | 'ellipse'
   */
  function drawNode(g, {
    id, x, y, w, h, title, sub = [], shape = 'rect', accent = C.teal,
    fill = C.panel, chip = '', tip = '', dashed = false, titleSize = 13, subSize = 10.5
  }) {
    const grp = svg('g', {
      'data-node': id || '', class: 'sysmap-node',
      'data-tip': tip ? `<strong>${esc(title)}</strong>${tip}` : ''
    }, g);

    const common = {
      fill, stroke: accent, 'stroke-width': 1.6,
      'stroke-dasharray': dashed ? '6 4' : null,
      rx: shape === 'rect' || shape === 'stadium' ? 10 : null
    };

    if (shape === 'diamond') {
      svg('polygon', {
        points: `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`,
        fill, stroke: accent, 'stroke-width': 1.6, 'stroke-dasharray': dashed ? '6 4' : null
      }, grp);
    } else if (shape === 'cylinder') {
      const ry = Math.min(14, h * 0.18);
      svg('path', {
        d: `M ${x},${y + ry}
            a ${w / 2},${ry} 0 0 1 ${w},0
            v ${h - 2 * ry}
            a ${w / 2},${ry} 0 0 1 ${-w},0 z`,
        fill, stroke: accent, 'stroke-width': 1.6
      }, grp);
      svg('ellipse', { cx: x + w / 2, cy: y + ry, rx: w / 2, ry, fill, stroke: accent, 'stroke-width': 1.6 }, grp);
    } else if (shape === 'stadium') {
      svg('rect', { x, y, w, h, rx: h / 2, fill, stroke: accent, 'stroke-width': 1.6 }, grp);
    } else if (shape === 'parallelogram') {
      const sk = Math.min(18, w * 0.08);
      svg('polygon', {
        points: `${x + sk},${y} ${x + w},${y} ${x + w - sk},${y + h} ${x},${y + h}`,
        fill, stroke: accent, 'stroke-width': 1.6
      }, grp);
    } else if (shape === 'ellipse') {
      svg('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill, stroke: accent, 'stroke-width': 1.6 }, grp);
    } else {
      svg('rect', { x, y, w, h, ...common }, grp);
    }

    // Left accent bar (rect only)
    if (shape === 'rect') {
      svg('rect', { x, y, width: 4, height: h, fill: accent, rx: 2 }, grp);
    }

    // Chip (top-right abbreviation)
    if (chip) {
      const cw = Math.max(30, chip.length * 7.2 + 12);
      svg('rect', {
        x: x + w - cw - 8, y: y + 7, width: cw, height: 16, rx: 8,
        fill: 'rgba(2,6,23,0.7)', stroke: accent, 'stroke-width': 0.8, opacity: 0.95
      }, grp);
      const ct = svg('text', {
        x: x + w - cw / 2 - 8, y: y + 18.5, 'text-anchor': 'middle',
        fill: accent, 'font-family': FONT_MONO, 'font-size': 9, 'font-weight': 700
      }, grp);
      ct.textContent = chip;
    }

    // Title + sub lines
    const titleLines = wrapText(title, Math.max(12, Math.floor(w / (titleSize * 0.62))));
    let ty = y + (sub.length ? h / 2 - (titleLines.length * (titleSize + 2) + sub.length * (subSize + 3)) / 2 + titleSize : h / 2 - (titleLines.length - 1) * (titleSize + 2) / 2 + titleSize * 0.35);
    titleLines.forEach((ln, i) => {
      const t = svg('text', {
        x: x + w / 2, y: ty + i * (titleSize + 2), 'text-anchor': 'middle',
        fill: C.text, 'font-family': FONT_UI, 'font-size': titleSize, 'font-weight': 700
      }, grp);
      t.textContent = ln;
    });
    ty += titleLines.length * (titleSize + 2) + 2;
    sub.forEach((ln, i) => {
      const t = svg('text', {
        x: x + w / 2, y: ty + i * (subSize + 3), 'text-anchor': 'middle',
        fill: C.sub, 'font-family': FONT_MONO, 'font-size': subSize
      }, grp);
      t.textContent = ln;
    });

    return {
      id, x, y, w, h, cx: x + w / 2, cy: y + h / 2,
      left: { x, y: y + h / 2 }, right: { x: x + w, y: y + h / 2 },
      top: { x: x + w / 2, y }, bottom: { x: x + w / 2, y: y + h }
    };
  }

  /** Cubic-bezier connector with mid-curve label. `bulge` bends vertical-ish edges sideways. */
  function drawEdge(g, from, to, {
    label = '', color = C.slate, dashed = false, marker = 'slate',
    curve = 0.42, labelDx = 0, labelDy = -6, tip = '', bulge = 0
  } = {}) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const horizontalish = Math.abs(dx) >= Math.abs(dy);
    const c1 = horizontalish
      ? { x: from.x + dx * curve, y: from.y + bulge }
      : { x: from.x + bulge, y: from.y + dy * curve };
    const c2 = horizontalish
      ? { x: to.x - dx * curve, y: to.y + bulge }
      : { x: to.x + bulge, y: to.y - dy * curve };

    const path = svg('path', {
      d: `M ${from.x},${from.y} C ${c1.x},${c1.y} ${c2.x},${c2.y} ${to.x},${to.y}`,
      fill: 'none', stroke: color, 'stroke-width': 1.7,
      'marker-end': `url(#ah-${marker})`,
      'stroke-dasharray': dashed ? '7 5' : null,
      opacity: 0.9
    }, g);
    if (tip) path.setAttribute('data-tip', tip);

    if (label) {
      // Position at t=0.5 of the cubic
      const mx = 0.125 * from.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * to.x;
      const my = 0.125 * from.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * to.y;
      const lx = mx + labelDx, ly = my + labelDy;
      const lines = wrapText(label, 26);
      const wEst = Math.max(...lines.map(l => l.length)) * 5.6 + 12;
      const hEst = lines.length * 12 + 6;
      svg('rect', {
        x: lx - wEst / 2, y: ly - hEst / 2 + 4, width: wEst, height: hEst, rx: 5,
        fill: 'rgba(2,6,23,0.88)', stroke: color, 'stroke-width': 0.7, opacity: 0.95
      }, g);
      lines.forEach((ln, i) => {
        const t = svg('text', {
          x: lx, y: ly - (lines.length - 1) * 6 + i * 12 + 2, 'text-anchor': 'middle',
          fill: color === C.slate ? C.sub : color, 'font-family': FONT_MONO,
          'font-size': 9.5, 'font-weight': 600
        }, g);
        t.textContent = ln;
      });
    }
    return path;
  }

  /** Dashed cluster / zone container drawn BEHIND nodes. */
  function drawCluster(g, { x, y, w, h, label, color = C.slate, dash = '8 6', sub = '' }) {
    const grp = svg('g', {}, g);
    svg('rect', {
      x, y, width: w, height: h, rx: 16, fill: 'rgba(15,23,42,0.35)',
      stroke: color, 'stroke-width': 1.3, 'stroke-dasharray': dash, opacity: 0.9
    }, grp);
    const lt = svg('text', {
      x: x + 16, y: y + 24, fill: color, 'font-family': FONT_UI,
      'font-size': 12, 'font-weight': 800, 'letter-spacing': 0.6
    }, grp);
    lt.textContent = label;
    if (sub) {
      const st = svg('text', { x: x + 16, y: y + 41, fill: C.faint, 'font-family': FONT_MONO, 'font-size': 9.5 }, grp);
      st.textContent = sub;
    }
    return grp;
  }

  /** Small status/latency pill used inside diagrams. */
  function drawPill(g, { x, y, text, color = C.teal, w = null }) {
    const width = w || (String(text).length * 6.2 + 18);
    svg('rect', {
      x, y, width, height: 18, rx: 9,
      fill: 'rgba(2,6,23,0.85)', stroke: color, 'stroke-width': 1
    }, g);
    const t = svg('text', {
      x: x + width / 2, y: y + 13, 'text-anchor': 'middle',
      fill: color, 'font-family': FONT_MONO, 'font-size': 9.5, 'font-weight': 700
    }, g);
    t.textContent = text;
    return width;
  }

  function drawLegend(g, { x, y, w, items, title = 'LEGEND' }) {
    const grp = svg('g', {}, g);
    svg('rect', { x, y, width: w, height: 30 + items.length * 22, rx: 10, fill: 'rgba(10,22,40,0.8)', stroke: C.stroke }, grp);
    const t = svg('text', { x: x + 14, y: y + 20, fill: C.sub, 'font-family': FONT_UI, 'font-size': 10, 'font-weight': 800, 'letter-spacing': 1.2 }, grp);
    t.textContent = title;
    items.forEach((it, i) => {
      const iy = y + 38 + i * 22;
      if (it.kind === 'line') {
        svg('line', { x1: x + 14, y1: iy, x2: x + 46, y2: iy, stroke: it.color, 'stroke-width': 2, 'stroke-dasharray': it.dashed ? '5 4' : null, 'marker-end': `url(#ah-${it.marker || 'slate'})` }, grp);
      } else if (it.kind === 'diamond') {
        svg('polygon', { points: `${x + 30},${iy - 8} ${x + 42},${iy} ${x + 30},${iy + 8} ${x + 18},${iy}`, fill: C.panel, stroke: it.color, 'stroke-width': 1.4 }, grp);
      } else if (it.kind === 'cylinder') {
        svg('ellipse', { cx: x + 30, cy: iy - 5, rx: 11, ry: 4, fill: C.panel, stroke: it.color, 'stroke-width': 1.3 }, grp);
        svg('rect', { x: x + 19, y: iy - 5, width: 22, height: 10, fill: C.panel, stroke: it.color, 'stroke-width': 1.3 }, grp);
        svg('ellipse', { cx: x + 30, cy: iy + 5, rx: 11, ry: 4, fill: C.panel, stroke: it.color, 'stroke-width': 1.3 }, grp);
      } else {
        svg('rect', { x: x + 17, y: iy - 8, width: 26, height: 16, rx: 4, fill: C.panel, stroke: it.color, 'stroke-width': 1.4 }, grp);
      }
      const lt = svg('text', { x: x + 58, y: iy + 4, fill: C.text, 'font-family': FONT_UI, 'font-size': 10.5 }, grp);
      lt.textContent = it.label;
    });
    return grp;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. DB CONNECTION CONCEPT MAP
  // ═══════════════════════════════════════════════════════════════════════════
  function renderDbConceptMap(shell) {
    const W = 1500, H = 1010;
    const svgRoot = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full',
      'data-map-name': 'cmsys-db-connection-concept-map', role: 'img',
      'aria-label': 'Database connection concept map'
    }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);

    // ── Clusters ──
    drawCluster(g, { x: 30, y: 46, w: 280, h: 700, label: 'PRESENTATION TIER', sub: 'Naval clients & field units', color: C.sky });
    drawCluster(g, { x: 370, y: 46, w: 300, h: 700, label: 'API & TRANSPORT TIER', sub: 'Protocols / engines / bridges', color: C.violet });
    drawCluster(g, { x: 730, y: 46, w: 330, h: 700, label: 'CONNECTION STRATEGY', sub: 'Governance concepts & invariants', color: C.gold });
    drawCluster(g, { x: 1120, y: 46, w: 350, h: 700, label: 'DATA TIER', sub: 'Dual-engine persistence + seed', color: C.teal });

    // ── Column 1: clients ──
    const nHub = drawNode(g, {
      x: 55, y: 110, w: 230, h: 84, accent: C.sky, chip: 'SPA', title: 'CMSys-DB-Hub',
      sub: ['This portal · governance', 'HTML5 · ES2024 · Tailwind'],
      tip: '<br>Unified RTDB explorer, forensic audit, two-way patch & topology portal.'
    });
    const nV2 = drawNode(g, {
      x: 55, y: 230, w: 230, h: 84, accent: C.sky, chip: 'WEB', title: 'CMSys V2 Desktop',
      sub: ['Tactical works & muster', 'Vanilla JS · PHP 8 api.php'],
      tip: '<br>Operational monolith: work orders, project tree, job cards, muster ledger.'
    });
    const nMob = drawNode(g, {
      x: 55, y: 350, w: 230, h: 84, accent: C.sky, chip: 'PWA', title: 'CMSys V2 Mobile PWA',
      sub: ['Field supervisor portal', 'Service-worker offline cache'],
      tip: '<br>Offline-first field UI feeding /availability and /daily_allocations.'
    });
    const nLog = drawNode(g, {
      x: 55, y: 470, w: 230, h: 84, accent: C.sky, chip: ':8000', title: 'CMSys Logistics',
      sub: ['Next.js 15 · React 19', 'Prisma ORM · NAV 254/255'],
      tip: '<br>Enterprise supply chain engine. Commits vouchers in Prisma then bridges them to RTDB.'
    });
    const nUtil = drawNode(g, {
      x: 55, y: 590, w: 230, h: 84, accent: C.sky, chip: 'UTIL', title: 'Waterworks / Inventory',
      sub: ['Vite React-TS · migrate.php', 'Utility & store accounting'],
      tip: '<br>Water-network telemetry SPA and PHP/MySQL store migration tool.'
    });

    // ── Column 2: transport ──
    const nRest = drawNode(g, {
      x: 395, y: 115, w: 250, h: 92, accent: C.violet, chip: 'REST', title: 'Firebase REST / SSE',
      sub: ['HTTPS · TLS 1.3', 'GET · PATCH · PUT · DELETE /.json'],
      tip: '<br>Primary transport between the hub and both cloud RTDB instances. SSE keeps explorers live.'
    });
    const nPhp = drawNode(g, {
      x: 395, y: 265, w: 250, h: 92, accent: C.violet, chip: 'PHP', title: 'api.php REST Engine',
      sub: ['PDO prepared statements', 'localhost XAMPP · Apache :80'],
      tip: '<br>On-prem REST façade over MySQL. Mirrors audit entries and hosts syncToFirebase().'
    });
    const nPrisma = drawNode(g, {
      x: 395, y: 415, w: 250, h: 92, accent: C.violet, chip: 'ORM', title: 'Prisma ORM Bridge',
      sub: ['Next.js server actions', 'Transactional store writes'],
      tip: '<br>Logistics data-access layer over ncw_ps_db. Source of NAV 254/255 voucher truth.'
    });
    const nWorker = drawNode(g, {
      x: 395, y: 565, w: 250, h: 92, accent: C.violet, chip: 'JOB', title: 'Sync Workers',
      sub: ['sync-logistics-to-firebase.js', 'api.php syncToFirebase()'],
      tip: '<br>Background bridges pushing voucher & inventory deltas into the RTDB operational nodes.'
    });

    // ── Column 3: strategy concepts ──
    const nFail = drawNode(g, {
      x: 755, y: 115, w: 280, h: 92, accent: C.gold, chip: 'TRL', title: 'Cascading Failover',
      sub: ['Primary → OPS → Seed', 'AbortController 4s / tier'],
      tip: '<br>Connection ladder: cmsys-v2-1fb05 first, ncw-ps-operations second, 3.84MB seed last.'
    });
    const nPatch = drawNode(g, {
      x: 755, y: 265, w: 280, h: 92, accent: C.gold, chip: '2-WAY', title: 'Two-Way Live PATCH',
      sub: ['Inline cell edit → REST write-back', 'PATCH /{node}/{id}.json'],
      tip: '<br>Double-click edits dispatch authenticated PATCH/PUT/DELETE against the active tier.'
    });
    const nAudit = drawNode(g, {
      x: 755, y: 415, w: 280, h: 92, accent: C.gold, chip: 'REL-25', title: 'Dual-Write Audit',
      sub: ['Immutable /audit_log ledger', 'RTDB + MySQL parity writes'],
      tip: '<br>Every mutation appends {user, node, id, old, new} to BOTH cloud ledger and ncw_ps_db.audit_log.'
    });
    const nSeed = drawNode(g, {
      x: 755, y: 565, w: 280, h: 92, accent: C.gold, chip: 'OFFLINE', title: 'Offline Seed Fallback',
      sub: ['cmsys-v2-1fb05-seed.json', 'Read-only · writes queued'],
      tip: '<br>Last-resort local snapshot keeps the explorer usable with zero connectivity.'
    });

    // ── Column 4: data tier ──
    const nPrimary = drawNode(g, {
      x: 1145, y: 115, w: 300, h: 96, shape: 'cylinder', accent: C.teal, chip: 'TIER-1',
      title: 'Primary Cloud RTDB',
      sub: ['cmsys-v2-1fb05', 'asia-southeast1 · Singapore'],
      tip: '<br>System of record for all 12 operational nodes (sailors → metadata).'
    });
    const nSecondary = drawNode(g, {
      x: 1145, y: 275, w: 300, h: 96, shape: 'cylinder', accent: C.emerald, chip: 'TIER-2',
      title: 'Secondary OPS RTDB',
      sub: ['ncw-ps-operations', 'asia-southeast1 failover'],
      tip: '<br>Hot standby / operations cluster. Receives syncToFirebase() bridges.'
    });
    const nMysql = drawNode(g, {
      x: 1145, y: 435, w: 300, h: 96, shape: 'cylinder', accent: C.blue, chip: 'SQL',
      title: 'MySQL ncw_ps_db',
      sub: ['18 normalized tables', 'PDO :3306 · XAMPP on-prem'],
      tip: '<br>Relational persistence: users, work_orders, job_cards, audit_log, evaluations…'
    });
    const nSeedFile = drawNode(g, {
      x: 1145, y: 595, w: 300, h: 96, accent: C.slate, chip: 'JSON', title: 'Seed Snapshot',
      sub: ['cmsys-v2-1fb05-seed.json', '3.84 MB offline mirror'],
      tip: '<br>Versioned static fallback bundled beside the deployment.'
    });

    // ── Concept edges ──
    drawEdge(g, nHub.right, nRest.left, { label: 'GET /.json · live read', color: C.sky, marker: 'sky', labelDy: -10 });
    drawEdge(g, nV2.right, nRest.left, { label: 'Web SDK v9 · realtime', color: C.sky, marker: 'sky', labelDy: 12 });
    drawEdge(g, nMob.right, nRest.left, { label: 'field sync / SSE', color: C.sky, marker: 'sky', dashed: true, labelDy: 34 });
    drawEdge(g, nLog.right, nPrisma.left, { label: 'server actions', color: C.sky, marker: 'sky' });
    drawEdge(g, nUtil.right, nPhp.left, { label: 'migrate.php REST', color: C.sky, marker: 'sky', dashed: true, labelDy: 10 });

    drawEdge(g, nRest.right, nFail.left, { label: '4s timeout ladder', color: C.violet, marker: 'violet', labelDy: -8 });
    drawEdge(g, nPhp.right, nPatch.left, { label: 'local mirror', color: C.violet, marker: 'violet', dashed: true, labelDy: 30 });
    drawEdge(g, nPrisma.right, nWorker.left, { label: 'store deltas', color: C.violet, marker: 'violet' });
    drawEdge(g, nWorker.right, nAudit.left, { label: 'push ledger rows', color: C.violet, marker: 'violet', dashed: true, labelDy: -30 });

    drawEdge(g, nFail.right, nPrimary.left, { label: 'tier-1 · preferred', color: C.gold, marker: 'gold', labelDy: -26 });
    drawEdge(g, nFail.right, nSecondary.left, { label: 'tier-2 · on fail', color: C.gold, marker: 'gold', labelDy: -4 });
    drawEdge(g, nFail.bottom, nSeed.left, { label: 'tier-3 · offline', color: C.gold, marker: 'gold', dashed: true, labelDy: 10 });

    drawEdge(g, nPatch.right, nPrimary.left, { label: 'PATCH /{node}/{id}', color: C.gold, marker: 'gold', labelDy: 18 });
    drawEdge(g, nAudit.right, nPrimary.left, { label: 'PUT /audit_log/{id}', color: C.rose, marker: 'rose', labelDy: -2 });
    drawEdge(g, nAudit.right, nMysql.left, { label: 'POST api.php audit_log', color: C.rose, marker: 'rose', labelDy: -2, labelDx: -26 });

    drawEdge(g, nPhp.bottom, nMysql.left, { label: 'PDO prepared :3306', color: C.blue, marker: 'blue', bulge: 140, labelDy: -8, labelDx: -20 });
    // syncToFirebase() — routed below the strategy column then up the C/D corridor
    polyEdge(g, [
      { x: 645, y: 611 }, { x: 700, y: 692 }, { x: 1090, y: 692 }, { x: 1090, y: 323 }, nSecondary.left
    ], { label: 'syncToFirebase() push', color: C.emerald, marker: 'emerald', dashed: true, labelSeg: 1, labelDy: 16 });

    // ── Legend + footer invariants ──
    drawLegend(g, {
      x: 30, y: 790, w: 330,
      items: [
        { kind: 'line', label: 'Read / query path', color: C.sky, marker: 'sky' },
        { kind: 'line', label: 'Write-back / audit path', color: C.gold, marker: 'gold' },
        { kind: 'line', label: 'Immutable audit dual-write', color: C.rose, marker: 'rose' },
        { kind: 'line', label: 'Background sync bridge', color: C.emerald, marker: 'emerald', dashed: true },
        { kind: 'cylinder', label: 'Persistence store', color: C.teal },
        { kind: 'diamond', label: 'Decision / failover gate', color: C.gold }
      ]
    });

    drawCluster(g, { x: 400, y: 790, w: 1070, h: 165, label: 'CONNECTION INVARIANTS', sub: 'Concepts every link in this map must uphold', color: C.gold, dash: '3 5' });
    const invariants = [
      ['ZERO-TRUST FAILOVER', 'Every client resolves data through the ladder — no silent single-tier dependency.'],
      ['SINGLE SOURCE OF TRUTH', 'cmsys-v2-1fb05 is authoritative; mirrors (seed, MySQL, OPS) are reconciled, never mixed in one query.'],
      ['IMMUTABLE MUTATION TRAIL (REL-25)', 'All writes emit an audit entity capturing user, node, record, old & new values — dual-written.'],
      ['FIELD CONTINUITY', 'Seed fallback + PWA service worker keep naval operations alive through link loss.']
    ];
    invariants.forEach((it, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 430 + col * 520, y = 850 + row * 52;
      const t = svg('text', { x, y, fill: C.gold, 'font-family': FONT_MONO, 'font-size': 10.5, 'font-weight': 700 }, g);
      t.textContent = it[0];
      const d = svg('text', { x, y: y + 17, fill: C.sub, 'font-family': FONT_UI, 'font-size': 11 }, g);
      d.textContent = it[1];
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CONNECTION FLOWCHARTS
  // ═══════════════════════════════════════════════════════════════════════════
  const FLOWCHARTS = {
    failover: {
      label: '① Cascading Failover',
      title: 'Flowchart · 3-Tier Cascading Connection & Failover',
      subtitle: 'Boot / "Sync Live" resolution: Primary RTDB → OPS RTDB → Local Seed → Offline state',
      draw: drawFailoverFlow
    },
    read: {
      label: '② Read Path',
      title: 'Flowchart · Read Path (fetchAllData)',
      subtitle: 'How one refresh hydrates cache, KPI strip, explorer table, REL matrix and background audit',
      draw: drawReadFlow
    },
    write: {
      label: '③ Write Path',
      title: 'Flowchart · Two-Way Live Write-Back',
      subtitle: 'Cell edit → cache → REL-25 audit entry → REST PATCH → dual ledger mirror → toast',
      draw: drawWriteFlow
    },
    bridges: {
      label: '④ Sync Bridges',
      title: 'Flowchart · Cross-System Sync Bridges',
      subtitle: 'Logistics Prisma worker, MySQL→RTDB evaluation bridge and api.php syncToFirebase()',
      draw: drawBridgesFlow
    }
  };

  function flowStart(g, x, y, w, text) {
    return drawNode(g, { x: x - w / 2, y, w, h: 52, shape: 'stadium', accent: C.emerald, fill: C.emeraldSoft, title: text, titleSize: 12.5 });
  }
  function flowEnd(g, x, y, w, text, accent = C.emerald) {
    return drawNode(g, { x: x - w / 2, y, w, h: 52, shape: 'stadium', accent, fill: accent === C.rose ? C.roseSoft : C.emeraldSoft, title: text, titleSize: 12.5 });
  }
  function flowProc(g, x, y, w, h, title, sub = [], accent = C.violet) {
    return drawNode(g, { x: x - w / 2, y, w, h, accent, fill: C.panel, title, sub, titleSize: 12, subSize: 9.5 });
  }
  function flowIO(g, x, y, w, h, title, sub = [], accent = C.sky) {
    return drawNode(g, { x: x - w / 2, y, w, h, shape: 'parallelogram', accent, fill: C.panel, title, sub, titleSize: 11.5, subSize: 9.5 });
  }
  function flowDB(g, x, y, w, h, title, sub = [], accent = C.teal) {
    return drawNode(g, { x: x - w / 2, y, w, h, shape: 'cylinder', accent, fill: C.panel, title, sub, titleSize: 12, subSize: 9.5 });
  }
  function flowDec(g, x, y, w, h, title) {
    return drawNode(g, { x: x - w / 2, y, w, h, shape: 'diamond', accent: C.gold, fill: C.panel2, title, titleSize: 11.5 });
  }
  function vArrow(g, x, y1, y2, { label = '', color = C.slate, dashed = false, marker = 'slate', labelDx = 54 } = {}) {
    drawEdge(g, { x, y: y1 }, { x, y: y2 }, { label, color, dashed, marker, curve: 0.15, labelDx, labelDy: -2 });
  }
  function hArrow(g, x1, y, x2, { label = '', color = C.slate, dashed = false, marker = 'slate', labelDy = -10 } = {}) {
    drawEdge(g, { x: x1, y }, { x: x2, y }, { label, color, dashed, marker, curve: 0.12, labelDy });
  }

  function drawFailoverFlow(shell) {
    const W = 1240, H = 1090;
    const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full', 'data-map-name': 'cmsys-failover-flowchart', role: 'img', 'aria-label': 'Cascading failover flowchart' }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);

    const laneX = 330, yesX = 830, outX = 1080;

    flowStart(g, laneX, 40, 300, 'START · App boot / "Sync Live"');
    vArrow(g, laneX, 92, 130, { color: C.emerald, marker: 'emerald' });

    flowProc(g, laneX, 130, 330, 74, '① HTTPS GET PRIMARY RTDB', ['cmsys-v2-1fb05/.json', 'AbortController timeout 4s'], C.teal);
    vArrow(g, laneX, 204, 250);
    const d1 = flowDec(g, laneX, 250, 200, 100, 'HTTP 200 & JSON ok?');
    hArrow(g, laneX + 100, 300, yesX - 165, { label: 'YES', color: C.emerald, marker: 'emerald' });

    const p1 = drawNode(g, { x: yesX - 165, y: 258, w: 330, h: 84, accent: C.emerald, fill: C.emeraldSoft, title: 'Active Tier = PRIMARY', sub: ['pill turns emerald · "cmsys-v2-1fb05 LIVE"', 'writes enabled (PATCH/PUT)'], titleSize: 12.5, subSize: 10 });

    vArrow(g, laneX, 350, 392, { label: 'NO', color: C.rose, marker: 'rose', labelDx: -60 });
    flowProc(g, laneX, 392, 330, 74, '② HTTPS GET SECONDARY RTDB', ['ncw-ps-operations/.json', 'AbortController timeout 4s'], C.emerald);
    vArrow(g, laneX, 466, 512);
    flowDec(g, laneX, 512, 200, 100, 'HTTP 200 & JSON ok?');
    hArrow(g, laneX + 100, 562, yesX - 165, { label: 'YES', color: C.emerald, marker: 'emerald' });
    drawNode(g, { x: yesX - 165, y: 520, w: 330, h: 84, accent: C.gold, fill: C.goldSoft, title: 'Active Tier = SECONDARY', sub: ['pill turns amber · "ncw-ps-operations"', 'writes enabled · flagged for parity'], titleSize: 12.5, subSize: 10 });

    vArrow(g, laneX, 612, 654, { label: 'NO', color: C.rose, marker: 'rose', labelDx: -60 });
    flowIO(g, laneX, 654, 330, 74, '③ FETCH LOCAL SEED JSON', ['../CMSys V2/cmsys-v2-1fb05-seed.json'], C.sky);
    vArrow(g, laneX, 728, 774);
    flowDec(g, laneX, 774, 200, 100, 'Seed parsed?');
    hArrow(g, laneX + 100, 824, yesX - 165, { label: 'YES', color: C.emerald, marker: 'emerald' });
    drawNode(g, { x: yesX - 165, y: 782, w: 330, h: 84, accent: C.sky, fill: C.skySoft, title: 'Active Tier = SEED', sub: ['pill turns sky · "LOCAL SEED SYNCED"', 'READ-ONLY · mutations queued locally'], titleSize: 12.5, subSize: 10 });

    vArrow(g, laneX, 874, 916, { label: 'NO', color: C.rose, marker: 'rose', labelDx: -60 });
    flowEnd(g, laneX, 916, 300, 'STATE · OFFLINE / ERROR', C.rose);

    // Merge all four outcomes into the write gate
    const mergeY = 1000;
    drawEdge(g, { x: yesX, y: 342 }, { x: yesX, y: mergeY }, { color: C.slate, curve: 0.08 });
    drawEdge(g, { x: yesX, y: 604 }, { x: yesX, y: mergeY }, { color: C.slate, curve: 0.08 });
    drawEdge(g, { x: yesX, y: 866 }, { x: yesX, y: mergeY }, { color: C.slate, curve: 0.08 });
    drawEdge(g, { x: laneX, y: 968 }, { x: laneX, y: 1040 }, { color: C.rose, dashed: true, curve: 0.1 });
    drawEdge(g, { x: laneX, y: 1040 }, { x: yesX, y: 1040 }, { color: C.rose, dashed: true, curve: 0.1, label: 'operator retry only', labelDy: -8 });

    drawEdge(g, { x: yesX, y: mergeY }, { x: outX, y: mergeY }, { color: C.gold, marker: 'gold', curve: 0.1, label: 'any write request', labelDy: -10 });
    drawNode(g, { x: outX - 30, y: mergeY - 45, w: 260, h: 90, accent: C.gold, fill: C.goldSoft, title: 'Dispatch PATCH / PUT', sub: ['+ REL-25 audit dual-write', '+ toast & KPI refresh'], titleSize: 12, subSize: 10 });

    drawLegend(g, {
      x: 620, y: 40, w: 300,
      items: [
        { kind: 'line', label: 'Happy path', color: C.emerald, marker: 'emerald' },
        { kind: 'line', label: 'Failover / degraded', color: C.rose, marker: 'rose' },
        { kind: 'diamond', label: 'Decision gate', color: C.gold },
        { kind: 'line', label: 'Offline queue', color: C.slate, dashed: true }
      ]
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  function drawReadFlow(shell) {
    const W = 1150, H = 980;
    const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full', 'data-map-name': 'cmsys-read-path-flowchart', role: 'img', 'aria-label': 'Read path flowchart' }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);
    const x = 420;

    flowStart(g, x, 36, 320, 'START · fetchAllData()');
    vArrow(g, x, 88, 122, { color: C.emerald, marker: 'emerald' });
    flowProc(g, x, 122, 340, 66, 'Resolve tier via failover ladder', ['see Flowchart ① · 4s abort per tier'], C.gold);
    vArrow(g, x, 188, 226);
    flowIO(g, x, 226, 340, 62, 'GET {ACTIVE_TIER}/.json', ['full RTDB root snapshot'], C.sky);
    vArrow(g, x, 288, 326);
    const d1 = flowDec(g, x, 326, 190, 92, 'res.ok?');
    // no branch
    drawEdge(g, { x: x - 95, y: 372 }, { x: 130, y: 372 }, { color: C.rose, marker: 'rose', curve: 0.1, label: 'NO', labelDy: -10 });
    flowEnd(g, 130, 420, 240, 'OFFLINE pill · keep cache', C.rose);
    drawEdge(g, { x: 130, y: 372 }, { x: 130, y: 420 }, { color: C.rose, marker: 'rose', curve: 0.1 });

    vArrow(g, x, 418, 458, { label: 'YES', color: C.emerald, marker: 'emerald' });
    flowProc(g, x, 458, 340, 66, 'res.json() → databaseCache', ['window.dbCache published'], C.violet);
    vArrow(g, x, 524, 562);
    flowProc(g, x, 562, 340, 66, 'Ensure /audit_log + /daily_evaluations', ['seed empty nodes if missing'], C.violet);
    vArrow(g, x, 628, 666);
    flowProc(g, x, 666, 340, 66, 'Merge MySQL audit rows', ['GET api.php?action=audit_log'], C.blue);
    vArrow(g, x, 732, 770);
    flowProc(g, x, 770, 340, 66, 'updateStatCounters() · KPI strip', ['7 live metric cards'], C.violet);
    vArrow(g, x, 836, 874);
    flowProc(g, x, 874, 340, 66, 'Render: table · REL matrix · audit', ['renderActiveNode · renderMatrix · runFull8RuleAudit'], C.violet);
    vArrow(g, x, 940, 966);

    // side annotations
    drawCluster(g, { x: 760, y: 200, w: 350, h: 300, label: 'READ GUARANTEES', sub: 'Concepts enforced on every refresh', color: C.teal, dash: '3 5' });
    [['Consistent snapshot', 'One JSON root — no torn multi-node reads.'],
     ['Non-destructive', 'Refresh never mutates remote state.'],
     ['Cache-first render', 'UI paints from databaseCache after parse.'],
     ['Background diagnostics', '8-rule audit runs without stealing focus.']
    ].forEach((it, i) => {
      const t = svg('text', { x: 790, y: 262 + i * 58, fill: C.teal, 'font-family': FONT_MONO, 'font-size': 10.5, 'font-weight': 700 }, g);
      t.textContent = it[0];
      const d = svg('text', { x: 790, y: 280 + i * 58, fill: C.sub, 'font-family': FONT_UI, 'font-size': 11 }, g);
      d.textContent = it[1];
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  function drawWriteFlow(shell) {
    const W = 1220, H = 1010;
    const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full', 'data-map-name': 'cmsys-write-path-flowchart', role: 'img', 'aria-label': 'Write path flowchart' }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);
    const x = 360;

    flowStart(g, x, 36, 360, 'START · cell edit / New / batch action');
    vArrow(g, x, 88, 124, { color: C.emerald, marker: 'emerald' });
    flowProc(g, x, 124, 340, 62, 'Build updates payload', ['{field: value} diff vs oldVal'], C.violet);
    vArrow(g, x, 186, 222);
    flowProc(g, x, 222, 340, 62, 'Apply to databaseCache', ['optimistic local update'], C.violet);
    vArrow(g, x, 284, 320);
    flowProc(g, x, 320, 340, 62, 'Create REL-25 audit entry', ['{ts, user, node, id, old, new}'], C.rose);
    vArrow(g, x, 382, 418);
    const d1 = flowDec(g, x, 418, 230, 96, 'Active tier is HTTP?');
    drawEdge(g, { x: x - 115, y: 466 }, { x: 130, y: 466 }, { color: C.gold, marker: 'gold', curve: 0.1, label: 'NO (seed/offline)', labelDy: -10 });
    drawEdge(g, { x: 130, y: 466 }, { x: 130, y: 520 }, { color: C.gold, marker: 'gold', curve: 0.1 });
    flowEnd(g, 130, 520, 260, 'Queue locally · toast "queued"');

    vArrow(g, x, 514, 556, { label: 'YES', color: C.emerald, marker: 'emerald' });
    flowIO(g, x, 556, 360, 66, 'PATCH|PUT|DELETE {base}/{node}/{id}', ['Content-Type: application/json'], C.sky);
    vArrow(g, x, 622, 660);
    const d2 = flowDec(g, x, 660, 190, 92, 'res.ok?');
    drawEdge(g, { x: x - 95, y: 706 }, { x: 130, y: 706 }, { color: C.rose, marker: 'rose', curve: 0.1, label: 'NO', labelDy: -10 });
    drawEdge(g, { x: 130, y: 706 }, { x: 130, y: 756 }, { color: C.rose, marker: 'rose', curve: 0.1 });
    flowEnd(g, 130, 756, 260, 'Warn · queue for retry', C.rose);

    vArrow(g, x, 752, 794, { label: 'YES', color: C.emerald, marker: 'emerald' });
    flowProc(g, x, 794, 340, 62, 'PUT /audit_log/{auditId}.json', ['cloud ledger append'], C.rose);
    vArrow(g, x, 856, 892);
    flowProc(g, x, 892, 340, 62, 'POST api.php?action=audit_log', ['MySQL ncw_ps_db.audit_log mirror'], C.blue);
    vArrow(g, x, 954, 972);

    drawCluster(g, { x: 780, y: 380, w: 400, h: 290, label: 'WRITE INVARIANTS', sub: 'Every mutation obeys these four rules', color: C.rose, dash: '3 5' });
    [['Optimistic cache', 'UI updates instantly; remote reconciles.'],
     ['Audit-first mindset', 'Ledger entry exists even if remote write retries.'],
     ['Dual ledger parity', 'Cloud + MySQL receive identical payloads.'],
     ['Idempotent retry', 'Queued writes can be replayed safely.']
    ].forEach((it, i) => {
      const t = svg('text', { x: 812, y: 444 + i * 58, fill: C.rose, 'font-family': FONT_MONO, 'font-size': 10.5, 'font-weight': 700 }, g);
      t.textContent = it[0];
      const d = svg('text', { x: 812, y: 462 + i * 58, fill: C.sub, 'font-family': FONT_UI, 'font-size': 11 }, g);
      d.textContent = it[1];
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  function drawBridgesFlow(shell) {
    const W = 1280, H = 920;
    const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full', 'data-map-name': 'cmsys-sync-bridges-flowchart', role: 'img', 'aria-label': 'Sync bridges flowchart' }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);

    const lanes = [
      {
        x: 60, w: 340, color: C.blue, label: 'BRIDGE A · LOGISTICS STORE LEDGER',
        nodes: [
          ['Prisma commit · NAV 254/255', ['store transfer / inward voucher'], 'proc'],
          ['sync-logistics-to-firebase.js', ['background worker (Next.js host)'], 'proc'],
          ['Push /nav254_vouchers deltas', ['+ inventory_on_charge receipts'], 'io'],
        ]
      },
      {
        x: 470, w: 340, color: C.rose, label: 'BRIDGE B · EVALUATIONS RECONCILER',
        nodes: [
          ['Rule-3 zero-sync detector', ['RTDB 0 rows vs MySQL truth'], 'proc'],
          ['1-click MySQL→RTDB bridge', ['operator-triggered remediation'], 'proc'],
          ['PUT /daily_evaluations', ['6-axis 1–10 trade ratings'], 'io'],
        ]
      },
      {
        x: 880, w: 340, color: C.violet, label: 'BRIDGE C · LEGACY API MIRROR',
        nodes: [
          ['api.php syncToFirebase()', ['scheduled PHP batch job'], 'proc'],
          ['Normalize legacy rows', ['users · work_orders · job_cards'], 'proc'],
          ['PUT operational nodes', ['CMSys V2 shared schema'], 'io'],
        ]
      }
    ];

    lanes.forEach((lane, li) => {
      drawCluster(g, { x: lane.x, y: 40, w: lane.w, h: 620, label: lane.label, color: lane.color, dash: '7 5' });
      let y = 110;
      lane.nodes.forEach((nd, i) => {
        const isIO = nd[2] === 'io';
        const node = isIO
          ? drawNode(g, { x: lane.x + 30, y, w: lane.w - 60, h: 84, shape: 'parallelogram', accent: lane.color, fill: C.panel, title: nd[0], sub: nd[1], titleSize: 11.5, subSize: 9.5 })
          : drawNode(g, { x: lane.x + 30, y, w: lane.w - 60, h: 84, accent: lane.color, fill: C.panel, title: nd[0], sub: nd[1], titleSize: 11.5, subSize: 9.5 });
        if (i < lane.nodes.length - 1) {
          drawEdge(g, node.bottom, { x: node.cx, y: y + 84 + 52 }, { color: lane.color, marker: li === 0 ? 'blue' : li === 1 ? 'rose' : 'violet', curve: 0.12 });
        }
        y += 84 + 52;
      });
    });

    // Convergence
    const convY = 700;
    const conv = drawNode(g, { x: 390, y: convY, w: 500, h: 84, accent: C.teal, fill: C.tealSoft, title: 'Cross-System Sync & Security Inspector', sub: ['parity matrix: Cloud RTDB · MySQL · Seed · Logistics', 'latency badges + credential exposure alerts'], titleSize: 13, subSize: 10 });
    [{ fx: 230, fy: 660 }, { fx: 640, fy: 660 }, { fx: 1050, fy: 660 }].forEach((p, i) => {
      drawEdge(g, { x: p.fx, y: p.fy }, { x: conv.cx + (i - 1) * 140, y: convY }, {
        color: C.teal, marker: 'teal', dashed: true, curve: 0.25, label: i === 1 ? 'reconcile' : ''
      });
    });
    drawEdge(g, { x: conv.cx, y: convY + 84 }, { x: 640, y: 830 }, { color: C.teal, marker: 'teal', curve: 0.12 });
    flowEnd(g, 640, 830, 420, 'END · Verified parity & audit trail complete');

    drawLegend(g, {
      x: 60, y: 700, w: 300,
      items: [
        { kind: 'line', label: 'Bridge pipeline step', color: C.blue, marker: 'blue' },
        { kind: 'line', label: 'Reconciliation flow', color: C.teal, marker: 'teal', dashed: true },
        { kind: 'line', label: 'Operator-triggered fix', color: C.rose, marker: 'rose' }
      ]
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  function mountFlowchart(hostContainer, key) {
    const fc = FLOWCHARTS[key] || FLOWCHARTS.failover;
    // Full rebuild keeps zoom/zoom-button handlers 1:1 with the current SVG
    hostContainer.innerHTML = '';
    const wrap = document.createElement('div');
    hostContainer.appendChild(wrap);

    const pills = Object.entries(FLOWCHARTS).map(([k, f]) =>
      `<button type="button" class="sysmap-pill ${k === key ? 'sysmap-pill-active' : ''}" data-flowchart="${k}">${f.label}</button>`
    ).join('');

    const shell = buildShell(wrap, {
      title: `<i class="fa-solid fa-flow-chart text-gold-400 mr-2"></i>${fc.title}`,
      subtitle: fc.subtitle,
      legendHtml: '',
      toolbarExtra: `<div class="sysmap-pill-group">${pills}</div>`
    });

    wrap.querySelectorAll('[data-flowchart]').forEach(btn => {
      btn.addEventListener('click', () => mountFlowchart(hostContainer, btn.getAttribute('data-flowchart')));
    });

    fc.draw(shell);
  }

  function renderConnectionFlowcharts(host) {
    mountFlowchart(host.container || host, 'failover');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. NETWORK MAP
  // ═══════════════════════════════════════════════════════════════════════════
  /** Polyline route through waypoints (network-diagram style orthogonal segments). */
  function polyEdge(g, points, { label = '', color = C.slate, dashed = false, marker = 'slate', labelSeg = -1, labelDy = -8 } = {}) {
    const mid = Math.max(0, Math.floor((points.length - 2) / 2));
    const seg = labelSeg >= 0 ? labelSeg : mid;
    for (let i = 0; i < points.length - 1; i++) {
      drawEdge(g, points[i], points[i + 1], {
        label: i === seg ? label : '',
        color, dashed, marker, curve: 0.06, labelDy
      });
    }
  }

  function renderNetworkMap(shell) {
    const W = 1620, H = 1100;
    const svgRoot = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full',
      'data-map-name': 'cmsys-network-map', role: 'img', 'aria-label': 'Network topology map'
    }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);

    // ── Zones ──
    drawCluster(g, { x: 30, y: 50, w: 670, h: 860, label: 'ZONE A · NAVAL DOCKYARD LAN', sub: 'XAMPP host · c:\\xampp\\htdocs · workstations & field units', color: C.emerald });
    drawCluster(g, { x: 730, y: 50, w: 170, h: 860, label: 'EDGE', sub: 'Base firewall', color: C.rose, dash: '4 4' });
    drawCluster(g, { x: 930, y: 50, w: 660, h: 860, label: 'ZONE B · CLOUD WAN (FIREBASE)', sub: 'asia-southeast1 · Singapore cluster + deployment targets', color: C.sky });

    // ── LAN left column ──
    const ws = drawNode(g, {
      x: 60, y: 130, w: 210, h: 80, accent: C.emerald, chip: 'HOST', title: 'DBA Workstation',
      sub: ['Browser · DB-Hub SPA', 'localhost/CMSys-DB-Hub'],
      tip: '<br>Administrative console running this portal over Apache :80.'
    });
    const tab = drawNode(g, {
      x: 60, y: 250, w: 210, h: 80, accent: C.emerald, chip: 'FIELD', title: 'Naval Tablets / PWA',
      sub: ['Android supervisors', 'mobile.html · offline SW'],
      tip: '<br>Field supervisors capture muster, availability and job progress.'
    });
    const v2 = drawNode(g, {
      x: 60, y: 370, w: 210, h: 80, accent: C.emerald, chip: ':80', title: 'CMSys V2 Monolith',
      sub: ['index.html · app.js', 'Apache virtual host'],
      tip: '<br>Tactical works & muster monolith served beside the hub.'
    });
    const util = drawNode(g, {
      x: 60, y: 490, w: 210, h: 80, accent: C.emerald, chip: 'SPA', title: 'Waterworks / Inventory',
      sub: ['Vite SPA · migrate.php', 'utility subsystems'],
      tip: '<br>Water-network telemetry and store-accounting migration tools.'
    });
    const seed = drawNode(g, {
      x: 60, y: 615, w: 210, h: 80, accent: C.slate, chip: 'TIER-3', title: 'Seed Snapshot JSON',
      sub: ['cmsys-v2-1fb05-seed.json', '3.84 MB · file fallback'],
      tip: '<br>Offline continuity asset for total cloud isolation scenarios.'
    });
    const printers = drawNode(g, {
      x: 60, y: 740, w: 210, h: 80, accent: C.emerald, chip: 'LPR', title: 'Local Print Routing',
      sub: ['get_printers.php', 'forms & certificates'],
      tip: '<br>Naval form printing (audit certificates, NAV 254/255) stays on-LAN.'
    });

    // ── LAN mid column ──
    const hub = drawNode(g, {
      x: 400, y: 120, w: 270, h: 90, accent: C.gold, chip: 'ACTIVE', title: 'CMSys-DB-Hub',
      sub: ['Apache :80 · this portal', 'governance · audit · maps'],
      tip: '<br>The active repository. Bridges browser ↔ cloud RTDB ↔ MySQL.'
    });
    const api = drawNode(g, {
      x: 400, y: 260, w: 270, h: 80, accent: C.violet, chip: 'PHP 8', title: 'api.php REST Engine',
      sub: ['PDO prepared statements', 'audit_log · health_check'],
      tip: '<br>On-prem REST façade + syncToFirebase() bridge host.'
    });
    const next = drawNode(g, {
      x: 400, y: 390, w: 270, h: 80, accent: C.violet, chip: ':8000', title: 'CMSys Logistics',
      sub: ['Next.js 15 · Prisma ORM', 'NAV 254 / NAV 255'],
      tip: '<br>Supply-chain engine; its worker pushes voucher deltas to RTDB.'
    });
    const mysql = drawNode(g, {
      x: 400, y: 620, w: 270, h: 110, shape: 'cylinder', accent: C.blue, chip: ':3306',
      title: 'MySQL ncw_ps_db', sub: ['18 normalized tables', 'users · job_cards · audit_log'],
      tip: '<br>On-premises relational store accessed via PDO/Prisma only.'
    });

    // ── Edge / firewall ──
    const shield = drawNode(g, {
      x: 755, y: 350, w: 110, h: 220, shape: 'rect', accent: C.rose, fill: C.roseSoft,
      title: 'FW', sub: ['TLS 1.3', 'egress', '443 only'], titleSize: 16
    });
    drawNode(g, {
      x: 745, y: 620, w: 130, h: 130, shape: 'rect', accent: C.rose, fill: 'rgba(2,6,23,0.6)',
      title: 'CORS', sub: ['localhost', '127.0.0.1', ':8000 allow'], titleSize: 12, subSize: 9
    });

    // ── Cloud nodes ──
    const rt1 = drawNode(g, {
      x: 980, y: 130, w: 560, h: 110, shape: 'cylinder', accent: C.teal, chip: 'TIER-1',
      title: 'Primary RTDB · cmsys-v2-1fb05', sub: ['cmsys-v2-1fb05-default-rtdb.asia-southeast1.firebasedatabase.app', '12 nodes · system of record'],
      tip: '<br>HTTPS REST + SSE. Region: asia-southeast1 (Singapore).'
    });
    const rt2 = drawNode(g, {
      x: 980, y: 300, w: 560, h: 110, shape: 'cylinder', accent: C.emerald, chip: 'TIER-2',
      title: 'Secondary RTDB · ncw-ps-operations', sub: ['ncw-ps-operations-default-rtdb.asia-southeast1.firebasedatabase.app', 'failover + sync bridge target'],
      tip: '<br>Hot standby operations cluster for the cascading ladder.'
    });
    const rules = drawNode(g, {
      x: 980, y: 470, w: 560, h: 110, accent: C.rose, chip: 'SEC', title: 'RTDB Security Rules & Headers',
      sub: ['Open-read audit posture · auth-gated writes', 'X-Frame-Options · nosniff · Referrer-Policy · PDO binding'],
      tip: '<br>Security posture monitored by the Cross-System Security Inspector.'
    });
    const vercel = drawNode(g, {
      x: 980, y: 640, w: 560, h: 90, accent: C.blue, chip: 'DEPLOY', title: 'Vercel Deployment Targets',
      sub: ['cmsys-beta.vercel.app (staging) → cmsys-live.vercel.app (production)', '3-tier pipeline · command-approved releases'],
      tip: '<br>Staging beta for field trials, production after command approval.'
    });
    const users = drawNode(g, {
      x: 980, y: 790, w: 560, h: 90, accent: C.sky, chip: 'CLIENTS', title: 'Remote Command Clients',
      sub: ['NHQ / out-station browsers over base WAN', 'staging beta on naval tablets'],
      tip: '<br>Command authorities consume dashboards and audit certificates remotely.'
    });

    // ── LAN internal links ──
    drawEdge(g, ws.right, hub.left, { label: 'HTTP :80', color: C.emerald, marker: 'emerald' });
    drawEdge(g, tab.right, api.left, { label: 'HTTPS PWA sync', color: C.emerald, marker: 'emerald', dashed: true, labelDy: -22 });
    drawEdge(g, v2.right, api.left, { label: 'same-host REST', color: C.emerald, marker: 'emerald', labelDy: -20 });
    drawEdge(g, util.right, api.left, { label: 'migrate.php', color: C.emerald, marker: 'emerald', dashed: true, labelDy: 12 });
    drawEdge(g, { x: 455, y: 210 }, { x: 455, y: 260 }, { label: 'audit mirror', color: C.rose, marker: 'rose', dashed: true, labelDx: 78, labelDy: -2 });

    // Waypoint-routed LAN links (thread the left corridor x≈305–345)
    polyEdge(g, [{ x: 430, y: 210 }, { x: 345, y: 245 }, { x: 345, y: 675 }, mysql.left],
      { label: 'PDO :3306', color: C.blue, marker: 'blue', labelSeg: 1, labelDx: 46 });
    polyEdge(g, [{ x: 430, y: 340 }, { x: 325, y: 375 }, { x: 325, y: 655 }, seed.right],
      { label: 'tier-3 read', color: C.slate, dashed: true, labelSeg: 1, labelDx: -52 });
    polyEdge(g, [{ x: 430, y: 430 }, { x: 305, y: 465 }, { x: 305, y: 780 }, printers.right],
      { label: 'certificates', color: C.emerald, marker: 'emerald', dashed: true, labelSeg: 1, labelDx: -52 });
    drawEdge(g, next.bottom, mysql.top, { label: 'Prisma :3306', color: C.blue, marker: 'blue', labelDx: 70 });

    // ── Through the firewall to cloud ──
    drawEdge(g, hub.right, { x: 755, y: 380 }, { label: 'REST/SSE :443', color: C.gold, marker: 'gold' });
    drawEdge(g, api.right, { x: 755, y: 440 }, { color: C.violet, marker: 'violet', dashed: true });
    drawEdge(g, next.right, { x: 755, y: 500 }, { label: 'worker push', color: C.blue, marker: 'blue', labelDy: 12 });

    drawEdge(g, { x: 865, y: 380 }, { x: 980, y: 185 }, { label: 'TLS 1.3 tunnel', color: C.teal, marker: 'teal', labelDy: -22 });
    drawEdge(g, { x: 865, y: 440 }, { x: 980, y: 355 }, { label: 'failover', color: C.emerald, marker: 'emerald', dashed: true, labelDy: -22 });
    drawEdge(g, { x: 865, y: 500 }, { x: 980, y: 685 }, { label: 'git deploy', color: C.blue, marker: 'blue', dashed: true, labelDy: -18 });

    // ── Cloud internal policy chain ──
    drawEdge(g, { x: 1150, y: 240 }, { x: 1150, y: 300 }, { label: 'same region', color: C.slate, dashed: true, labelDx: 70 });
    drawEdge(g, { x: 1150, y: 410 }, { x: 1150, y: 470 }, { label: 'rules enforced', color: C.rose, marker: 'rose', labelDx: 78 });
    drawEdge(g, { x: 1050, y: 240 }, { x: 1050, y: 470 }, { label: 'policy hook', color: C.rose, marker: 'rose', dashed: true, bulge: -180, labelDx: -40, labelDy: -4 });
    drawEdge(g, { x: 755 + 35, y: 570 }, { x: 980, y: 525 }, { label: 'edge enforcement', color: C.rose, marker: 'rose', dashed: true, labelDy: -20 });
    drawEdge(g, { x: 1150, y: 580 }, { x: 1150, y: 640 }, { color: C.blue, marker: 'blue', dashed: true });
    drawEdge(g, { x: 1150, y: 730 }, { x: 1150, y: 790 }, { color: C.sky, marker: 'sky', dashed: true });

    // Latency pills
    drawPill(g, { x: 985, y: 88, text: '≈ 150–220 ms RTT', color: C.teal });
    drawPill(g, { x: 60, y: 850, text: 'loopback < 1 ms', color: C.emerald });

    drawLegend(g, {
      x: 30, y: 935, w: 320,
      items: [
        { kind: 'line', label: 'LAN HTTP/HTTPS', color: C.emerald, marker: 'emerald' },
        { kind: 'line', label: 'Cloud TLS 1.3 tunnel', color: C.teal, marker: 'teal' },
        { kind: 'line', label: 'DB protocol (PDO/Prisma)', color: C.blue, marker: 'blue' },
        { kind: 'line', label: 'Security control path', color: C.rose, marker: 'rose', dashed: true },
        { kind: 'cylinder', label: 'Data store', color: C.teal }
      ]
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SYSTEM INTEGRATION CONCEPT MAP
  // ═══════════════════════════════════════════════════════════════════════════
  function renderIntegrationConceptMap(shell) {
    const W = 1560, H = 1080;
    const svgRoot = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full h-full', 'data-map-name': 'cmsys-integration-concept-map', role: 'img', 'aria-label': 'System integration concept map' }, shell.canvas);
    injectDefs(svgRoot);
    const g = svg('g', {}, svgRoot);

    // Center hub
    const hub = drawNode(g, {
      x: 545, y: 400, w: 470, h: 170, accent: C.gold, fill: C.panel2,
      title: 'CMSys-DB-Hub — Data Governance Core', sub: [
        'Live Node Explorer · REL-01..26 matrix · 8-Rule Forensic Audit',
        'Two-Way Patch · Parity Inspector · Audit Certificates · System Maps'
      ], titleSize: 15, subSize: 11,
      tip: '<br>The federation\'s control tower: every system\'s data is observed, reconciled and audited here.'
    });

    // Shared concept nodes (bottom band)
    const concepts = [
      { id: 'truth', x: 200, y: 910, title: 'Single Source of Truth', sub: ['Firebase RTDB · cmsys-v2-1fb05'], accent: C.teal, tip: '<br>All apps agree: cloud RTDB nodes are authoritative; mirrors reconcile to it.' },
      { id: 'audit', x: 520, y: 910, title: 'Auditability (REL-25)', sub: ['immutable mutation trail'], accent: C.rose, tip: '<br>Every integration writes an auditable footprint — dual-logged cloud + MySQL.' },
      { id: 'invar', x: 840, y: 910, title: 'Naval Invariants', sub: ['667 headcount · 6 votes · 13 trades'], accent: C.gold, tip: '<br>Headcount conservation, statutory votes 2104/2001/2506/1303/2103 and trade matrix bind all modules.' },
      { id: 'cont', x: 1160, y: 910, title: 'Continuity & Failover', sub: ['3-tier ladder · PWA offline'], accent: C.sky, tip: '<br>Operations continue through link loss via seed fallback and service-worker caches.' }
    ];
    const conceptNodes = concepts.map(c => drawNode(g, {
      x: c.x, y: c.y, w: 250, h: 84, accent: c.accent, fill: C.panel, title: c.title, sub: c.sub, shape: 'ellipse', tip: c.tip, titleSize: 12, subSize: 10
    }));

    // Application nodes
    const v2 = drawNode(g, {
      x: 90, y: 120, w: 380, h: 150, accent: C.sky, chip: 'MONOLITH', title: 'CMSys V2 Desktop + api.php',
      sub: ['Muster ledger · 5-category project tree', 'Job cards · material logs · vote budgets', 'PHP 8 PDO engine over ncw_ps_db'],
      tip: '<br>Primary producer of work_orders, job_cards, daily_allocations and estimate data.'
    });
    const pwa = drawNode(g, {
      x: 1090, y: 120, w: 380, h: 150, accent: C.sky, chip: 'PWA', title: 'CMSys V2 Mobile PWA',
      sub: ['Field supervisor portal · offline-first', 'availability/{YYYY-MM}/{DD} leave codes', 'check-in / nominal roll capture'],
      tip: '<br>Feeds the headcount conservation law with live leave/medical/attendance status.'
    });
    const logi = drawNode(g, {
      x: 60, y: 560, w: 400, h: 150, accent: C.blue, chip: ':8000', title: 'CMSys Logistics (Next.js 15)',
      sub: ['NAV 254 transfers · NAV 255 inward receipts', 'Central / Zone / Ready-Use / Balance stores', 'Prisma ORM · sync-logistics-to-firebase.js'],
      tip: '<br>Store-ledger authority; vouchers synchronize into /nav254_vouchers and /inventory.'
    });
    const water = drawNode(g, {
      x: 1100, y: 560, w: 380, h: 150, accent: C.violet, chip: 'UTILITY', title: 'CMSys-Waterworks + Inventory',
      sub: ['Pump stations · flow telemetry · pipelines', 'locations + maintenance_records lifecycle', 'migrate.php catalog import'],
      tip: '<br>Utility & store-accounting subsystems sharing facilities and inventory catalogs.'
    });

    // Integration bus
    const bus = drawNode(g, {
      x: 545, y: 640, w: 470, h: 110, accent: C.teal, fill: C.tealSoft,
      title: 'Shared Data Fabric', sub: [
        'RTDB nodes: sailors · work_orders · job_cards · inventory · locations ·',
        'daily_allocations · daily_evaluations · estimates · temp_issues · nav254_vouchers · audit_log'
      ], titleSize: 13, subSize: 9.5,
      tip: '<br>The twelve-node schema every application reads and writes through registered REL links.'
    });

    // ── Proposition edges (concept-map style: verb phrases) ──
    drawEdge(g, { x: v2.x + v2.w, y: v2.y + 90 }, { x: hub.x, y: hub.y + 40 }, {
      label: 'produces work orders, job cards & muster → audited by', color: C.sky, marker: 'sky', labelDy: -12
    });
    drawEdge(g, { x: hub.x + hub.w, y: hub.y + 40 }, { x: pwa.x, y: pwa.y + 90 }, {
      label: 'reconciles headcount ↔ leave status captured by', color: C.sky, marker: 'sky', labelDy: -12
    });
    drawEdge(g, { x: v2.x + 200, y: v2.y + v2.h }, { x: bus.x + 60, y: bus.y }, {
      label: 'writes operational nodes into', color: C.teal, marker: 'teal', dashed: true, labelDx: -80
    });
    drawEdge(g, { x: pwa.x + 190, y: pwa.y + pwa.h }, { x: bus.x + bus.w - 60, y: bus.y }, {
      label: 'streams availability & allocations into', color: C.teal, marker: 'teal', dashed: true, labelDx: 80
    });
    drawEdge(g, { x: logi.x + logi.w, y: logi.y + 70 }, { x: bus.x, y: bus.y + 55 }, {
      label: 'synchronizes NAV 254/255 vouchers → store nodes', color: C.blue, marker: 'blue', labelDy: 24
    });
    drawEdge(g, { x: bus.x + bus.w, y: bus.y + 55 }, { x: water.x, y: water.y + 70 }, {
      label: 'binds facilities & maintenance lifecycle ↔', color: C.violet, marker: 'violet', labelDy: 24
    });
    drawEdge(g, { x: logi.x + 220, y: logi.y }, { x: hub.x + 40, y: hub.y + hub.h }, {
      label: 'parity monitored by Cross-System Inspector', color: C.blue, marker: 'blue', dashed: true, labelDx: -110, labelDy: -6
    });
    drawEdge(g, { x: water.x + 190, y: water.y }, { x: hub.x + hub.w - 40, y: hub.y + hub.h }, {
      label: 'facility health feeds forensic audit rules', color: C.violet, marker: 'violet', dashed: true, labelDx: 110, labelDy: -6
    });

    // Hub → data fabric → concept band
    drawEdge(g, { x: hub.x + 235, y: hub.y + hub.h }, { x: bus.x + 235, y: bus.y }, {
      label: 'reads & writes through', color: C.teal, marker: 'teal', curve: 0.1, labelDx: 96, labelDy: -2
    });
    drawEdge(g, { x: bus.x + 55, y: bus.y + bus.h }, { x: conceptNodes[0].x + 125, y: conceptNodes[0].y }, { color: C.teal, marker: 'teal', dashed: true, curve: 0.35 });
    drawEdge(g, { x: bus.x + 125, y: bus.y + bus.h }, { x: conceptNodes[1].x + 125, y: conceptNodes[1].y }, { color: C.rose, marker: 'rose', dashed: true, curve: 0.12 });
    drawEdge(g, { x: bus.x + 300, y: bus.y + bus.h }, { x: conceptNodes[2].x + 125, y: conceptNodes[2].y }, { color: C.gold, marker: 'gold', dashed: true, curve: 0.12 });
    drawEdge(g, { x: bus.x + 420, y: bus.y + bus.h }, { x: conceptNodes[3].x + 125, y: conceptNodes[3].y }, { color: C.sky, marker: 'sky', dashed: true, curve: 0.35 });

    // Side note clusters
    drawCluster(g, { x: 620, y: 60, w: 320, h: 250, label: 'INTEGRATION MECHANISMS', sub: 'How the federation stays coherent', color: C.gold, dash: '3 5' });
    [
      ['REST + SSE subscriptions', 'live reads without polling storms'],
      ['sync-logistics-to-firebase.js', 'Prisma store commits → RTDB deltas'],
      ['api.php syncToFirebase()', 'legacy MySQL rows → operational nodes'],
      ['REL-25 dual-write ledger', 'audit parity across cloud and SQL']
    ].forEach((it, i) => {
      const t = svg('text', { x: 648, y: 122 + i * 48, fill: C.gold, 'font-family': FONT_MONO, 'font-size': 10, 'font-weight': 700 }, g);
      t.textContent = it[0];
      const d = svg('text', { x: 648, y: 139 + i * 48, fill: C.sub, 'font-family': FONT_UI, 'font-size': 10.5 }, g);
      d.textContent = it[1];
    });

    drawLegend(g, {
      x: 60, y: 745, w: 330,
      items: [
        { kind: 'line', label: 'Data production / consumption', color: C.sky, marker: 'sky' },
        { kind: 'line', label: 'Schema-level binding', color: C.teal, marker: 'teal' },
        { kind: 'line', label: 'Operational sync bridge', color: C.blue, marker: 'blue' },
        { kind: 'line', label: 'Governance / audit relation', color: C.rose, marker: 'rose', dashed: true },
        { kind: 'rect', label: 'System / concept cluster', color: C.gold }
      ]
    });

    attachPanZoom(shell, svgRoot, g);
    attachTooltip(shell, svgRoot);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Public mount API
  // ═══════════════════════════════════════════════════════════════════════════
  function renderDbConnectionMaps(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-1.5" id="dbMapModeSwitch">
            <button type="button" class="sysmap-pill sysmap-pill-active" data-dbmap="concept"><i class="fa-solid fa-brain mr-1"></i>Concept Map</button>
            <button type="button" class="sysmap-pill" data-dbmap="flow"><i class="fa-solid fa-flow-chart mr-1"></i>Flowcharts</button>
            <button type="button" class="sysmap-pill" data-dbmap="network"><i class="fa-solid fa-network-wired mr-1"></i>Network Map</button>
          </div>
          <p class="text-[11px] text-slate-400"><i class="fa-solid fa-computer-mouse text-teal-400 mr-1"></i>Scroll to zoom · drag to pan · hover nodes for detail · export any map as SVG</p>
        </div>
        <div data-dbmap-panel></div>
      </div>
    `;
    const panel = container.querySelector('[data-dbmap-panel]');
    const mount = (mode) => {
      panel.innerHTML = '';
      const host = document.createElement('div');
      panel.appendChild(host);
      if (mode === 'concept') {
        const shell = buildShell(host, {
          title: '<i class="fa-solid fa-brain text-sky-400 mr-2"></i>Concept Map · How CMSys Connects to Data',
          subtitle: 'Clients → transports → connection strategy concepts → persistence (labeled propositions, not just wires)',
          legendHtml: ''
        });
        shell.root = host.querySelector('.sysmap-shell');
        renderDbConceptMap(shell);
      } else if (mode === 'flow') {
        renderConnectionFlowcharts({ container: host });
      } else {
        const shell = buildShell(host, {
          title: '<i class="fa-solid fa-network-wired text-emerald-400 mr-2"></i>Network Map · Dockyard LAN → Firewall → Firebase Cloud',
          subtitle: 'Physical & logical topology: hosts, ports, protocols, security boundaries and latency classes',
          legendHtml: ''
        });
        shell.root = host.querySelector('.sysmap-shell');
        renderNetworkMap(shell);
      }
      container.querySelectorAll('[data-dbmap]').forEach(btn => {
        btn.classList.toggle('sysmap-pill-active', btn.getAttribute('data-dbmap') === mode);
      });
    };
    container.querySelectorAll('[data-dbmap]').forEach(btn => {
      btn.addEventListener('click', () => mount(btn.getAttribute('data-dbmap')));
    });
    mount('concept');
  }

  window.CmsysMaps = {
    renderDbConnectionMaps,
    renderIntegrationConceptMap: (container) => {
      if (!container) return;
      container.innerHTML = '';
      const host = document.createElement('div');
      container.appendChild(host);
      const shell = buildShell(host, {
        title: '<i class="fa-solid fa-share-nodes text-gold-400 mr-2"></i>Concept Map · All System Integrations',
        subtitle: 'Every federated application, the shared data fabric, and the propositions that connect them (click nodes, hover edges)',
        legendHtml: ''
      });
      shell.root = host.querySelector('.sysmap-shell');
      renderIntegrationConceptMap(shell);
    },
    version: '2.5.0'
  };
})();
