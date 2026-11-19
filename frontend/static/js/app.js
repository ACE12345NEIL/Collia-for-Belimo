/**
 * BELIMO | Collia - Frontend Application Logic
 * Dynamic Entity Management (Floors, Rooms, Equipment), CSV Filename Binding,
 * Auto-Expanding Layout Containers, 60% Opacity Dynamic Schematic Interconnect Arrows,
 * and Simple, Rule-Governed HVAC Connection Configuration & Editing.
 */

const state = {
  topology: null,
  selectedEntity: null,
  selectedType: null, // 'building' | 'floor' | 'room' | 'equipment'
  activeFloorId: null,
  currentZoom: 1.0,
  panX: 32,
  panY: 32,
  activeTab: 'layout',
  csvStatuses: {},
  boxPositions: {},
  arrowOffsets: {}
};

let toastTimer = null;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadTopology();
  // Fetch initial CSV status on boot (directory is opened on-demand via the button)
  fetchCsvStatus();
});

function initEventListeners() {
  // Facility name update on blur or Enter
  const facilityInput = document.getElementById('facility-name-input');
  if (facilityInput) {
    facilityInput.addEventListener('change', () => {
      updateFacilityName(facilityInput.value);
    });
    facilityInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        facilityInput.blur();
      }
    });
  }

  // Sidebar Add Room button
  const btnAddRoom = document.getElementById('btn-add-room');
  if (btnAddRoom) {
    btnAddRoom.addEventListener('click', () => openAddRoomModal());
  }

  // Sidebar Add Equipment button
  const btnAddEq = document.getElementById('btn-add-eq');
  if (btnAddEq) {
    btnAddEq.addEventListener('click', () => openAddPlantModal());
  }

  // Restore sidebar collapse states
  initCollapsibleSidebars();

  // Redraw SVG schematic arrows on resize
  window.addEventListener('resize', () => {
    updateCanvasSchematicArrows();
  });

  // Google Maps-style pan + zoom on canvas
  initCanvasInteraction();

  // Draggable Plant box and Floor boxes with real-time arrow routing
  initDraggableBoxes();
}

// -------------------------------------------------------------
// Canvas Pan + Zoom (Google Maps style)
// -------------------------------------------------------------
function applyCanvasTransform() {
  const workspace = document.getElementById('canvas-workspace');
  if (!workspace) return;
  workspace.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.currentZoom})`;
}

function initCanvasInteraction() {
  const viewport = document.getElementById('canvas-viewport');
  const workspace = document.getElementById('canvas-workspace');
  if (!viewport || !workspace) return;

  let isPanning = false;
  let startMouseX = 0, startMouseY = 0;
  let startPanX = 0, startPanY = 0;

  // Apply initial transform
  applyCanvasTransform();

  viewport.addEventListener('mousedown', e => {
    // Only pan on left-click on the viewport/workspace background (not on cards)
    if (e.button !== 0) return;
    // Allow clicks through to card elements (don't pan if target is an interactive element)
    const tag = e.target.tagName.toLowerCase();
    const isInteractive = ['button', 'input', 'select', 'textarea', 'a', 'label'].includes(tag);
    const isInsideCard = e.target.closest('[id^="node-"], [id^="room-card-"], .modal, [data-no-pan]');
    const isDraggableBox = e.target.closest('#plant-boundary-box, .floor-group-container');
    const isDraggableArrow = e.target.closest('[data-arrow-id]');
    if (isInteractive || isInsideCard || isDraggableBox || isDraggableArrow) return;

    isPanning = true;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    startPanX = state.panX;
    startPanY = state.panY;
    viewport.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!isPanning) return;
    state.panX = startPanX + (e.clientX - startMouseX);
    state.panY = startPanY + (e.clientY - startMouseY);
    applyCanvasTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!isPanning) return;
    isPanning = false;
    viewport.style.cursor = 'grab';
    // Redraw arrows after pan settle
    requestAnimationFrame(() => updateCanvasSchematicArrows());
  });

  // Scroll-wheel zoom centred on cursor position
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;  // cursor relative to viewport
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    const newZoom = Math.min(Math.max(state.currentZoom + delta, 0.15), 3.0);
    const zoomRatio = newZoom / state.currentZoom;

    // Adjust pan so the point under the cursor stays fixed
    state.panX = mouseX - zoomRatio * (mouseX - state.panX);
    state.panY = mouseY - zoomRatio * (mouseY - state.panY);
    state.currentZoom = newZoom;

    applyCanvasTransform();
    requestAnimationFrame(() => updateCanvasSchematicArrows());
  }, { passive: false });

  // Touch support for pan
  let lastTouchX = 0, lastTouchY = 0;
  viewport.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, { passive: true });
  viewport.addEventListener('touchmove', e => {
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      state.panX += dx;
      state.panY += dy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      applyCanvasTransform();
    }
  }, { passive: true });
}

// -------------------------------------------------------------
// Draggable Section Boxes & Movable Arrows
// User can drag Plant box, Floor boxes, and any Arrow route freely
// -------------------------------------------------------------
function initDraggableBoxes() {
  const workspace = document.getElementById('canvas-workspace');
  const viewport = document.getElementById('canvas-viewport');
  if (!workspace || !viewport) return;

  // Restore saved positions from localStorage
  try {
    const saved = localStorage.getItem('collia_box_positions');
    if (saved) {
      state.boxPositions = Object.assign({}, JSON.parse(saved), state.boxPositions || {});
    }
  } catch (err) {
    console.warn('Could not read collia_box_positions from localStorage:', err);
  }

  // Restore saved arrow offsets from localStorage
  try {
    const savedArrows = localStorage.getItem('collia_arrow_offsets');
    if (savedArrows) {
      state.arrowOffsets = Object.assign({}, JSON.parse(savedArrows), state.arrowOffsets || {});
    }
  } catch (err) {
    console.warn('Could not read collia_arrow_offsets from localStorage:', err);
  }

  if (!state.boxPositions) state.boxPositions = {};
  if (!state.arrowOffsets) state.arrowOffsets = {};

  // Apply any restored positions to existing DOM nodes
  const plantBox = document.getElementById('plant-boundary-box');
  if (plantBox && state.boxPositions['plant-boundary-box']) {
    const pos = state.boxPositions['plant-boundary-box'];
    plantBox.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }
  document.querySelectorAll('.floor-group-container').forEach(el => {
    if (state.boxPositions[el.id]) {
      const pos = state.boxPositions[el.id];
      el.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
  });

  let dragMode = null; // 'box' | 'arrow' | null
  let activeTarget = null;
  let activeKey = '';
  let activeHandle = 'mid'; // 'start' | 'end' | 'mid' | 'knee'
  let activeKneeIndex = -1;
  let startMouseX = 0, startMouseY = 0;
  let initialOffsetX = 0, initialOffsetY = 0;
  let isDragging = false;
  let rafId = null;

  workspace.addEventListener('mousedown', e => {
    if (e.button !== 0) return; // Only left-click

    // Never drag on interactive form controls
    const tag = e.target.tagName.toLowerCase();
    if (['button', 'input', 'select', 'textarea', 'a'].includes(tag) || e.target.closest('button, input, select, textarea, a, .modal')) {
      return;
    }

    // 1. Check if clicking on a movable Arrow (start handle, end handle, line, or label badge)
    const arrowEl = e.target.closest('[data-arrow-id]');
    if (arrowEl) {
      const arrowId = arrowEl.getAttribute('data-arrow-id');
      const handleType = arrowEl.getAttribute('data-handle') || 'mid';
      if (arrowId) {
        dragMode = 'arrow';
        activeTarget = arrowEl;
        activeKey = arrowId;
        activeHandle = handleType;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        isDragging = false;

        const savedOff = (state.arrowOffsets && state.arrowOffsets[arrowId]) || {};
        if (handleType === 'start') {
          initialOffsetX = savedOff.startX || 0;
          initialOffsetY = savedOff.startY || 0;
          viewport.style.cursor = 'crosshair';
        } else if (handleType === 'end') {
          initialOffsetX = savedOff.endX || 0;
          initialOffsetY = savedOff.endY || 0;
          viewport.style.cursor = 'crosshair';
        } else if (handleType === 'knee') {
          activeKneeIndex = parseInt(arrowEl.getAttribute('data-knee-index') || '0');
          const knees = savedOff.knees || [];
          initialOffsetX = knees[activeKneeIndex]?.x || 0;
          initialOffsetY = knees[activeKneeIndex]?.y || 0;
          viewport.style.cursor = 'grabbing';
        } else {
          initialOffsetX = savedOff.x || 0;
          initialOffsetY = savedOff.y || 0;
          viewport.style.cursor = 'grabbing';
        }

        e.stopPropagation();
        e.preventDefault();
        return;
      }
    }

    // Never drag box when clicking inside equipment cards or room cards
    if (e.target.closest('[id^="node-"], [id^="room-card-"]')) {
      return;
    }

    // 2. Check if clicking Plant box or Floor box
    const plantEl = e.target.closest('#plant-boundary-box');
    const floorEl = e.target.closest('.floor-group-container');

    let target = null;
    let key = '';

    if (plantEl) {
      target = plantEl;
      key = 'plant-boundary-box';
    } else if (floorEl) {
      target = floorEl;
      key = floorEl.id || 'floor-box-default';
    }

    if (!target) return;

    dragMode = 'box';
    activeTarget = target;
    activeKey = key;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    isDragging = false;

    const saved = (state.boxPositions && state.boxPositions[activeKey]) || { x: 0, y: 0 };
    initialOffsetX = saved.x;
    initialOffsetY = saved.y;

    activeTarget.style.transition = 'none';
    activeTarget.style.willChange = 'transform';
    activeTarget.classList.add('ring-2', 'ring-primary/60', 'shadow-md');

    e.stopPropagation();
  });

  window.addEventListener('mousemove', e => {
    if (!dragMode) return;

    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;

    if (!isDragging && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      isDragging = true;
      document.body.style.userSelect = 'none';
      viewport.style.cursor = activeHandle === 'start' || activeHandle === 'end' ? 'crosshair' : 'grabbing';
      if (activeTarget && activeTarget.style) {
        activeTarget.style.cursor = activeHandle === 'start' || activeHandle === 'end' ? 'crosshair' : 'grabbing';
      }
    }

    if (isDragging) {
      const scale = state.currentZoom || 1.0;
      const newX = Math.round(initialOffsetX + dx / scale);
      const newY = Math.round(initialOffsetY + dy / scale);

      if (dragMode === 'box') {
        activeTarget.style.transform = `translate(${newX}px, ${newY}px)`;
        if (!state.boxPositions) state.boxPositions = {};
        state.boxPositions[activeKey] = { x: newX, y: newY };
      } else if (dragMode === 'arrow') {
        if (!state.arrowOffsets) state.arrowOffsets = {};
        if (!state.arrowOffsets[activeKey]) state.arrowOffsets[activeKey] = {};

        if (activeHandle === 'start') {
          state.arrowOffsets[activeKey].startX = newX;
          state.arrowOffsets[activeKey].startY = newY;
        } else if (activeHandle === 'end') {
          state.arrowOffsets[activeKey].endX = newX;
          state.arrowOffsets[activeKey].endY = newY;
        } else if (activeHandle === 'knee') {
          if (!state.arrowOffsets[activeKey].knees) state.arrowOffsets[activeKey].knees = [];
          state.arrowOffsets[activeKey].knees[activeKneeIndex] = { x: newX, y: newY };
        } else {
          state.arrowOffsets[activeKey].x = newX;
          state.arrowOffsets[activeKey].y = newY;
        }
      }

      // Update connecting SVG arrows in real-time
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          updateCanvasSchematicArrows();
          rafId = null;
        });
      }
    }
  });

  window.addEventListener('mouseup', e => {
    if (!dragMode) return;

    const mode = dragMode;
    const target = activeTarget;
    const key = activeKey;
    const didDrag = isDragging;

    if (mode === 'box' && target) {
      target.style.transition = '';
      target.style.willChange = '';
      target.style.cursor = '';
      target.classList.remove('ring-2', 'ring-primary/60', 'shadow-md');
    }

    viewport.style.cursor = '';
    document.body.style.userSelect = '';

    dragMode = null;
    activeTarget = null;
    activeKey = '';
    isDragging = false;

    if (didDrag) {
      if (mode === 'box') {
        try {
          localStorage.setItem('collia_box_positions', JSON.stringify(state.boxPositions));
        } catch (err) {}
      } else if (mode === 'arrow') {
        try {
          localStorage.setItem('collia_arrow_offsets', JSON.stringify(state.arrowOffsets));
        } catch (err) {}
      }
      updateCanvasSchematicArrows();
    } else if (mode === 'box') {
      // If user simply clicked on the floor badge without dragging, select that floor
      const badge = e.target.closest('.floor-drag-handle');
      if (badge && target) {
        const floorId = target.id ? target.id.replace('floor-box-', '') : null;
        if (floorId) {
          selectEntity('floor', floorId);
        }
      }
    }
  });

  // ── Right-click on a knee handle → directly remove it ────────────────────
  workspace.addEventListener('contextmenu', e => {
    const kneeEl = e.target.closest('[data-handle="knee"]');
    if (kneeEl) {
      e.preventDefault();
      e.stopPropagation();
      const arrowId = kneeEl.getAttribute('data-arrow-id');
      const idx = parseInt(kneeEl.getAttribute('data-knee-index') || '0');
      if (arrowId && state.arrowOffsets && state.arrowOffsets[arrowId] && state.arrowOffsets[arrowId].knees) {
        state.arrowOffsets[arrowId].knees.splice(idx, 1);
        try { localStorage.setItem('collia_arrow_offsets', JSON.stringify(state.arrowOffsets)); } catch(err){}
        updateCanvasSchematicArrows();
        showToast('Bend point deleted', 'info');
      }
    }
  });

  // ── Double-click on an arrow path → add a bend (knee) point ───────────────
  // Double-click on an existing knee handle → remove it
  workspace.addEventListener('dblclick', e => {
    const arrowEl = e.target.closest('[data-arrow-id]');
    if (!arrowEl) return;
    const arrowId = arrowEl.getAttribute('data-arrow-id');
    const handleType = arrowEl.getAttribute('data-handle') || 'mid';
    if (!arrowId) return;

    if (!state.arrowOffsets) state.arrowOffsets = {};
    if (!state.arrowOffsets[arrowId]) state.arrowOffsets[arrowId] = {};
    if (!state.arrowOffsets[arrowId].knees) state.arrowOffsets[arrowId].knees = [];

    if (handleType === 'knee') {
      // Remove this knee point
      const idx = parseInt(arrowEl.getAttribute('data-knee-index') || '0');
      state.arrowOffsets[arrowId].knees.splice(idx, 1);
      showToast('Bend point deleted', 'info');
    } else if (handleType === 'mid' || handleType === 'start' || handleType === 'end') {
      // Add a new knee at the click position in canvas-space
      const svg = document.getElementById('canvas-schematic-svg');
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const scale = state.currentZoom || 1.0;
      const kx = Math.round((e.clientX - svgRect.left) / scale);
      const ky = Math.round((e.clientY - svgRect.top) / scale);
      state.arrowOffsets[arrowId].knees.push({ x: kx, y: ky });
      showToast('Bend point added — drag the ◆ to route the arrow (right-click to delete)', 'info');
    }

    try { localStorage.setItem('collia_arrow_offsets', JSON.stringify(state.arrowOffsets)); } catch(err){}
    updateCanvasSchematicArrows();
    e.stopPropagation();
    e.preventDefault();
  });
}

function resetBoxPositions() {
  state.boxPositions = {};
  state.arrowOffsets = {};
  try {
    localStorage.removeItem('collia_box_positions');
    localStorage.removeItem('collia_arrow_offsets');
  } catch (err) {}

  const plantBox = document.getElementById('plant-boundary-box');
  if (plantBox) {
    plantBox.style.transform = '';
  }

  document.querySelectorAll('.floor-group-container').forEach(el => {
    el.style.transform = '';
  });

  updateCanvasSchematicArrows();
  showToast('Plant, Floor, and Arrow positions reset to default', 'info');
}

// -------------------------------------------------------------
// CSV Health & Status Indicator Helpers
// -------------------------------------------------------------
function renderCsvStatusDot(eqId) {
  const statusInfo = state.csvStatuses ? state.csvStatuses[eqId] : null;
  const allEq = [...(state.topology?.room_equipment || []), ...(state.topology?.shared_equipment || [])];
  const eq = allEq.find(e => e.id === eqId);

  // If status is not yet loaded or equipment has no file assigned
  if (!statusInfo) {
    if (!eq || !eq.csv_filename) {
      return `<span style="display:inline-block;width:12px;height:12px;min-width:12px;min-height:12px;border-radius:50%;background-color:#dc2626;box-shadow:0 0 0 2px rgba(220,38,38,0.25);" class="shrink-0" title="Box without a file (Red dot)"></span>`;
    }
    return `<span style="display:inline-block;width:12px;height:12px;min-width:12px;min-height:12px;border-radius:50%;background-color:#9ca3af;box-shadow:0 0 0 2px rgba(156,163,175,0.25);" class="shrink-0" title="CSV status loading..."></span>`;
  }

  if (statusInfo.status === 'NO_FILE' || statusInfo.status === 'INVALID') {
    return `<span style="display:inline-block;width:12px;height:12px;min-width:12px;min-height:12px;border-radius:50%;background-color:#dc2626;box-shadow:0 0 0 2px rgba(220,38,38,0.25);" class="shrink-0" title="Box without a file / missing (Red dot)"></span>`;
  }
  if (statusInfo.status === 'NO_DATA') {
    return `<span style="display:inline-block;width:12px;height:12px;min-width:12px;min-height:12px;border-radius:50%;background-color:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,0.25);" class="shrink-0" title="File without data (Yellow dot - 0 rows)"></span>`;
  }
  if (statusInfo.status === 'HAS_DATA') {
    return `<span style="display:inline-block;width:12px;height:12px;min-width:12px;min-height:12px;border-radius:50%;background-color:#16a34a;box-shadow:0 0 0 2px rgba(22,163,74,0.25);" class="shrink-0" title="File valid with data (${statusInfo.row_count} rows) (Green dot)"></span>`;
  }
  return '';
}

function renderCsvStatusBadge(eqId) {
  const statusInfo = state.csvStatuses ? state.csvStatuses[eqId] : null;
  const allEq = [...(state.topology?.room_equipment || []), ...(state.topology?.shared_equipment || [])];
  const eq = allEq.find(e => e.id === eqId);

  if (!statusInfo) {
    if (!eq || !eq.csv_filename) {
      return `<span style="color:#dc2626; font-size:10px; font-weight:600;">(No file)</span>`;
    }
    return '';
  }

  if (statusInfo.status === 'NO_FILE' || statusInfo.status === 'INVALID') {
    return `<span style="color:#dc2626; font-size:10px; font-weight:600;">(No file)</span>`;
  }
  if (statusInfo.status === 'NO_DATA') {
    return `<span style="color:#d97706; font-size:10px; font-weight:600;">(0 rows)</span>`;
  }
  if (statusInfo.status === 'HAS_DATA') {
    return `<span style="color:#16a34a; font-size:10px; font-weight:600;">(${statusInfo.row_count} rows)</span>`;
  }
  return '';
}

// -------------------------------------------------------------
// API Calls & State Synchronization
// -------------------------------------------------------------
async function loadTopology() {
  try {
    const [topoRes, csvRes] = await Promise.all([
      fetch('/api/topology'),
      fetch('/api/csv/status').catch(() => null)
    ]);
    if (!topoRes.ok) throw new Error('Failed to load topology');
    state.topology = await topoRes.json();

    if (csvRes && csvRes.ok) {
      const csvData = await csvRes.json();
      state.csvStatuses = csvData.equipment_statuses || {};
    }

    // Set default active floor if not set
    if (!state.activeFloorId && state.topology.floors && state.topology.floors.length > 0) {
      state.activeFloorId = state.topology.floors[0].id;
    }

    // Sync facility name header
    if (state.topology.building) {
      const facilityInput = document.getElementById('facility-name-input');
      if (facilityInput && document.activeElement !== facilityInput) {
        facilityInput.value = state.topology.building.name;
      }
    }

    renderSidebar();
    renderCanvas();

    // Refresh selected entity in detail panel if open
    if (state.selectedEntity) {
      refreshSelectedEntity();
    }
  } catch (err) {
    console.error('Error loading topology:', err);
  }
}

async function updateFacilityName(name) {
  if (!state.topology || !state.topology.building) return;
  const bldgId = state.topology.building.id;
  try {
    const res = await fetch(`/api/buildings/${bldgId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() })
    });
    if (res.ok) {
      const updated = await res.json();
      state.topology.building = updated;
      showToast('Facility name updated');
    }
  } catch (err) {
    console.error('Failed to update facility name:', err);
    showToast('Failed to update facility name', true);
  }
}

// -------------------------------------------------------------
// Sidebar Rendering (Floors, Rooms, Plant Units)
// -------------------------------------------------------------
function renderSidebar() {
  if (!state.topology) return;

  // ── Track expanded rooms (initially all rooms are collapsed for neatness) ──
  if (!state.expandedRooms) {
    state.expandedRooms = new Set();
  }

  // 1. FLOORS LIST
  const floorsList = document.getElementById('floors-list');
  const floorCounterBadge = document.getElementById('floor-counter-badge');
  const floors = state.topology.floors || [];

  if (floorCounterBadge) {
    floorCounterBadge.innerText = `${floors.length} ${floors.length === 1 ? 'Floor' : 'Floors'}`;
  }

  if (floorsList) {
    floorsList.innerHTML = '';
    floors.forEach(fl => {
      const isSelected = state.selectedEntity && state.selectedEntity.id === fl.id;
      const isActiveFloor = state.activeFloorId === fl.id;
      const floorRooms = (state.topology.rooms || []).filter(r => r.floor_id === fl.id);

      const div = document.createElement('div');
      div.className = `flex items-center justify-between px-2.5 py-1.5 rounded border ${isSelected ? 'border-primary bg-primary/5' : isActiveFloor ? 'border-primary/60 bg-surface-canvas' : 'border-border-subtle bg-surface-canvas hover:border-border-strong'} cursor-pointer group transition-colors`;
      div.onclick = () => {
        state.activeFloorId = fl.id;
        selectEntity('floor', fl.id);
      };

      div.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <span class="material-symbols-outlined text-[17px] ${isSelected ? 'text-primary' : 'text-secondary'}">layers</span>
          <div class="flex flex-col min-w-0">
            <span class="font-label-sm text-label-sm ${isSelected ? 'text-primary font-semibold' : 'text-on-surface font-medium'} truncate">${fl.name}</span>
            <span class="font-code-xs text-[10px] text-secondary">${floorRooms.length} rooms (Level ${fl.floor_number})</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded" onclick="event.stopPropagation(); selectEntity('floor', '${fl.id}')" title="Floor Details">
            <span class="material-symbols-outlined text-[14px]">tune</span>
          </button>
          <button class="text-secondary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity" onclick="event.stopPropagation(); deleteEntityPrompt('floor', '${fl.id}', '${fl.name}')" title="Delete Floor">
            <span class="material-symbols-outlined text-[14px]">remove</span>
          </button>
        </div>
      `;
      floorsList.appendChild(div);
    });
  }

  // 2. ROOMS TREE
  const roomsTree = document.getElementById('rooms-tree');
  const roomCounterBadge = document.getElementById('room-counter-badge');
  const rooms = state.topology.rooms || [];

  if (roomCounterBadge) {
    roomCounterBadge.innerText = `${rooms.length} ${rooms.length === 1 ? 'Room' : 'Rooms'}`;
  }

  if (roomsTree) {
    roomsTree.innerHTML = '';

    floors.forEach(fl => {
      const floorRooms = rooms.filter(r => r.floor_id === fl.id);
      if (floorRooms.length === 0 && floors.length <= 1) return;

      if (floors.length > 1) {
        const floorLabel = document.createElement('div');
        floorLabel.className = 'flex items-center gap-1.5 px-1 py-1 mt-1 first:mt-0';
        floorLabel.innerHTML = `
          <span class="material-symbols-outlined text-[14px] text-secondary">layers</span>
          <span class="font-code-xs text-code-xs text-secondary uppercase tracking-wider font-semibold">${fl.name} (Level ${fl.floor_number})</span>
          <span class="flex-1 border-b border-border-subtle ml-1"></span>
        `;
        roomsTree.appendChild(floorLabel);
      }

      floorRooms.forEach(room => {
        const roomEq = (state.topology.room_equipment || []).filter(eq => eq.room_id === room.id);
        const isSelected = state.selectedEntity && state.selectedEntity.id === room.id;
        const isExpanded = Boolean(state.expandedRooms && state.expandedRooms.has(room.id));

        const roomDiv = document.createElement('div');
        roomDiv.className = `rounded border ${isSelected ? 'border-primary' : 'border-border-subtle'} bg-surface-base overflow-hidden`;
        roomDiv.setAttribute('data-room-id', room.id);

        roomDiv.innerHTML = `
          <div class="flex items-center justify-between px-space-sm py-1.5 bg-surface-subtle/80 cursor-pointer room-header group" onclick="toggleRoom('${room.id}')">
            <div class="flex items-center gap-1 min-w-0" onclick="event.stopPropagation(); selectEntity('room', '${room.id}')">
              <span class="material-symbols-outlined text-[16px] text-secondary transition-transform duration-150 transform ${isExpanded ? 'rotate-90' : ''}" id="caret-${room.id}">chevron_right</span>
              <span class="font-label-sm text-label-sm text-on-surface font-medium truncate">${room.name}</span>
            </div>
            <div class="flex items-center gap-1">
              <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded" onclick="event.stopPropagation(); selectEntity('room', '${room.id}')" title="Room Details">
                <span class="material-symbols-outlined text-[14px]">tune</span>
              </button>
              <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-error rounded" onclick="event.stopPropagation(); deleteEntityPrompt('room', '${room.id}', '${room.name}')" title="Delete Room">
                <span class="material-symbols-outlined text-[14px]">remove</span>
              </button>
            </div>
          </div>
          <div class="p-space-xs flex flex-col gap-1 bg-surface-base ${isExpanded ? '' : 'hidden'}" id="content-${room.id}">
            ${roomEq.map(eq => {
              const isEqSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
              const isVav = eq.equipment_type === 'VAV';
              return `
                <div class="flex items-center justify-between px-2 py-1 rounded border ${isEqSelected ? 'border-primary bg-primary/5' : 'border-border-subtle/60 bg-surface-canvas hover:border-primary/50'} transition-colors group cursor-pointer" onclick="selectEntity('equipment', '${eq.id}')">
                  <div class="flex items-center gap-1.5 min-w-0">
                    ${renderCsvStatusDot(eq.id)}
                    <span class="material-symbols-outlined text-[15px] text-primary">${isVav ? 'hvac' : 'air'}</span>
                    <span class="font-code-xs text-code-xs ${isEqSelected ? 'text-primary font-medium' : 'text-on-surface'} truncate">${eq.name}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded" onclick="event.stopPropagation(); openConfigureEntityDirectly('${eq.id}')" title="Edit Connections">
                      <span class="material-symbols-outlined text-[13px]">hub</span>
                    </button>
                    ${eq.csv_filename ? `<span class="font-code-xs text-[9px] text-secondary bg-surface-subtle px-1 py-0.2 rounded border border-border-subtle truncate max-w-[80px]" title="CSV: ${eq.csv_filename}">${eq.csv_filename}</span>` : ''}
                    <button class="text-secondary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity" onclick="event.stopPropagation(); deleteEntityPrompt('equipment', '${eq.id}', '${eq.name}')" title="Delete Device">
                      <span class="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
            <button class="w-full text-center py-1 mt-0.5 text-secondary hover:text-primary font-code-xs text-code-xs border border-dashed border-border-subtle rounded hover:border-primary/40 bg-surface-canvas/50 transition-all flex items-center justify-center gap-1" onclick="openAddRoomDeviceModal('${room.id}', '${room.name}')">
              <span class="material-symbols-outlined text-[13px]">add</span> Add Device
            </button>
          </div>
        `;
        roomsTree.appendChild(roomDiv);
      });
    });
  }

  // 3. SHARED PLANT UNITS
  const sharedList = document.getElementById('shared-equipment-list');
  const sharedBadge = document.getElementById('shared-counter-badge');
  const sharedEq = state.topology.shared_equipment || [];

  if (sharedBadge) {
    sharedBadge.innerText = `${sharedEq.length} Plant Units`;
  }

  if (sharedList) {
    sharedList.innerHTML = '';
    sharedEq.forEach(eq => {
      const isSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
      let icon = 'mode_fan';
      if (eq.equipment_type === 'CHILLER') icon = 'ac_unit';
      if (eq.equipment_type === 'EV') icon = 'speed';

      const div = document.createElement('div');
      div.className = `flex items-center justify-between px-2.5 py-1.5 rounded border ${isSelected ? 'border-primary bg-primary/5' : 'border-border-subtle bg-surface-canvas hover:border-border-strong'} cursor-pointer group transition-colors`;
      div.onclick = () => selectEntity('equipment', eq.id);

      div.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          ${renderCsvStatusDot(eq.id)}
          <span class="material-symbols-outlined text-[18px] ${isSelected ? 'text-primary' : 'text-secondary group-hover:text-primary'} transition-colors">${icon}</span>
          <div class="flex flex-col min-w-0">
            <span class="font-label-sm text-label-sm ${isSelected ? 'text-primary font-semibold' : 'text-on-surface font-medium'} truncate">${eq.name}</span>
            <span class="font-code-xs text-code-xs text-secondary truncate">${eq.description || eq.equipment_type}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded" onclick="event.stopPropagation(); openConfigureEntityDirectly('${eq.id}')" title="Edit Connections">
            <span class="material-symbols-outlined text-[14px]">hub</span>
          </button>
          ${eq.csv_filename ? `<span class="font-code-xs text-[9px] text-secondary bg-surface-subtle px-1 py-0.2 rounded border border-border-subtle truncate max-w-[80px]" title="CSV: ${eq.csv_filename}">${eq.csv_filename}</span>` : ''}
          <button class="text-secondary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity" onclick="event.stopPropagation(); deleteEntityPrompt('equipment', '${eq.id}', '${eq.name}')">
            <span class="material-symbols-outlined text-[14px]">remove</span>
          </button>
        </div>
      `;
      sharedList.appendChild(div);
    });
  }
}

// -------------------------------------------------------------
// Central Canvas Rendering (Auto-expanding Box Sizes, Multi-device)
// -------------------------------------------------------------
function renderCanvas() {
  if (!state.topology) return;

  // 1. Apply saved position to Plant box if dragged previously
  const plantBox = document.getElementById('plant-boundary-box');
  if (plantBox && state.boxPositions && state.boxPositions['plant-boundary-box']) {
    const pos = state.boxPositions['plant-boundary-box'];
    plantBox.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
  }

  // Render Plant components into three tier rows: Chillers | EVs | AHUs
  const tierChiller = document.getElementById('plant-tier-chiller');
  const tierEV = document.getElementById('plant-tier-ev');
  const tierAHU = document.getElementById('plant-tier-ahu');
  if (tierChiller && tierEV && tierAHU) {
    const sharedEq = state.topology.shared_equipment || [];
    tierChiller.innerHTML = '';
    tierEV.innerHTML = '';
    tierAHU.innerHTML = '';

    const sortedSharedEq = [...sharedEq].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    sortedSharedEq.forEach(eq => {
      const isSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
      const csvInfo = state.csvStatuses ? state.csvStatuses[eq.id] : null;
      const hasData = csvInfo && csvInfo.status === 'HAS_DATA' && csvInfo.row_count > 0;

      let icon = 'mode_fan';
      let sublabel = 'Air Handling Unit';
      let cardWidth = 'min-w-[130px] w-auto';
      let statHtml = `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-secondary border-t border-border-subtle pt-1"><span class="">Supply Fan</span><span class="${hasData ? 'text-status-success font-medium' : 'font-medium'}">${hasData ? 'Auto' : '--'}</span></div>`;

      if (eq.equipment_type === 'CHILLER') {
        icon = 'ac_unit';
        sublabel = 'Central Chiller';
        cardWidth = 'min-w-[120px] w-auto';
        statHtml = hasData 
          ? `<div class="font-code-xs text-[10px] text-status-success flex items-center gap-1 mt-1 border-t border-border-subtle pt-1"><span class="w-1.5 h-1.5 rounded-full bg-status-success"></span> Running</div>`
          : `<div class="font-code-xs text-[10px] text-secondary flex items-center gap-1 mt-1 border-t border-border-subtle pt-1"><span class="w-1.5 h-1.5 rounded-full bg-border-strong"></span><span>--</span></div>`;
      } else if (eq.equipment_type === 'EV') {
        icon = 'speed';
        sublabel = 'Energy Valve';
        cardWidth = 'min-w-[130px] w-auto';
        statHtml = hasData
          ? `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-secondary border-t border-border-subtle pt-1"><span class="">ΔT: 6.7°C</span><span class="">14.2 m³/h</span></div>`
          : `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-secondary border-t border-border-subtle pt-1"><span class="">ΔT:</span><span class="">--</span><span class="">Flow:</span><span class="">--</span></div>`;
      }

      const card = document.createElement('div');
      card.id = `node-${eq.id}`;
      card.className = `${cardWidth} p-2.5 rounded ${isSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto select-none`;
      card.title = `Click to inspect details and edit connections for ${eq.name}`;

      card.innerHTML = `
        ${isSelected ? `<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>` : ''}
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-1.5 min-w-0">
            ${renderCsvStatusDot(eq.id)}
            <span class="font-label-sm text-label-sm font-semibold ${isSelected ? 'text-primary' : 'text-on-surface'} truncate">${eq.name}</span>
          </div>
          <div class="flex items-center gap-1">
            <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); openConfigureEntityDirectly('${eq.id}')" title="Edit Connections">
              <span class="material-symbols-outlined text-[15px]">hub</span>
            </button>
            <span class="material-symbols-outlined text-[16px] ${isSelected ? 'text-primary' : 'text-secondary'}">${icon}</span>
          </div>
        </div>
        <div class="font-code-xs text-[11px] text-secondary truncate">${sublabel}</div>
        <div class="flex items-center justify-between mt-1 text-[10px] font-code-xs border-t border-border-subtle pt-1">
          <span class="text-secondary">CSV:</span>
          <div class="flex items-center gap-1">
            <span class="font-code-xs text-primary truncate max-w-[80px]" title="${eq.csv_filename || 'No file assigned'}">${eq.csv_filename || '—'}</span>
            ${renderCsvStatusBadge(eq.id)}
          </div>
        </div>
        ${statHtml}
      `;

      card.onclick = () => selectEntity('equipment', eq.id);

      if (eq.equipment_type === 'CHILLER') tierChiller.appendChild(card);
      else if (eq.equipment_type === 'EV') tierEV.appendChild(card);
      else tierAHU.appendChild(card);
    });
  }

  // 2. Render Floors & Rooms breakdown in System Layout (Box-like border per floor)
  const zonesContainer = document.getElementById('zones-canvas-container');
  if (zonesContainer) {
    const rooms = state.topology.rooms || [];
    const floors = state.topology.floors || [];
    const roomEq = state.topology.room_equipment || [];
    zonesContainer.innerHTML = '';

    // Group rooms by floor (roomsByFloor)
    const roomsByFloor = {};
    floors.forEach(f => { roomsByFloor[f.id] = []; });
    rooms.forEach(r => {
      const fid = r.floor_id || (floors[0] ? floors[0].id : 'default');
      if (!roomsByFloor[fid]) roomsByFloor[fid] = [];
      roomsByFloor[fid].push(r);
    });

    Object.keys(roomsByFloor).forEach(floorId => {
      const floorRooms = roomsByFloor[floorId];
      if (!floorRooms || floorRooms.length === 0) return;
      const floorObj = floors.find(f => f.id === floorId) || { name: `Floor ${floorId}`, floor_number: 1 };
      const floorSection = floorObj.name;
      const isFloorSelected = state.selectedEntity && state.selectedEntity.id === floorId;

      // Floor Breakdown Box-like Border Container (Auto-expanding width)
      const floorBox = document.createElement('div');
      floorBox.id = `floor-box-${floorId}`;
      floorBox.className = `floor-group-container relative rounded-lg border-2 ${isFloorSelected ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border-strong/70 bg-surface-base/50'} pt-7 pb-5 px-5 flex flex-col gap-4 shrink-0 transition-all shadow-xs min-w-fit w-auto`;

      // Apply saved position to Floor box if dragged previously
      const savedPos = state.boxPositions && state.boxPositions[`floor-box-${floorId}`];
      if (savedPos) {
        floorBox.style.transform = `translate(${savedPos.x}px, ${savedPos.y}px)`;
      }

      // Floor Breakdown Badge on top-left border (Draggable + Click to select)
      const floorBadge = document.createElement('div');
      floorBadge.className = 'floor-drag-handle absolute -top-3 left-3 bg-surface-base px-3 py-1 border border-border-strong rounded font-label-sm text-label-sm font-semibold text-on-surface flex items-center gap-1.5 shadow-xs cursor-grab active:cursor-grabbing select-none hover:border-primary hover:text-primary transition-colors';
      floorBadge.title = 'Drag to move Floor section | Click to view/edit Floor details';
      floorBadge.innerHTML = `
        <span class="material-symbols-outlined text-[15px] text-secondary/70">drag_indicator</span>
        <span class="material-symbols-outlined text-[15px] text-primary">layers</span>
        <span class="uppercase tracking-wide leading-none">${floorSection}</span>
        <span class="text-border-strong font-normal">|</span>
        <span class="font-code-xs text-[10px] text-secondary leading-none">Level ${floorObj.floor_number || 1}</span>
        <span class="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-code-xs text-[9px] font-bold leading-none">${floorRooms.length} ${floorRooms.length === 1 ? 'Room' : 'Rooms'}</span>
      `;
      floorBox.appendChild(floorBadge);

      // Rooms row inside this floor box (flex-wrap for automatic expansion)
      const roomsRow = document.createElement('div');
      roomsRow.className = 'flex items-start gap-6 flex-wrap';

      floorRooms.forEach(room => {
        const thisRoomEq = roomEq.filter(eq => eq.room_id === room.id);
        const isRoomSelected = state.selectedEntity && state.selectedEntity.id === room.id;

        const zoneDiv = document.createElement('div');
        zoneDiv.id = `room-card-${room.id}`;
        // Automatically increases size to fit all room equipment cleanly
        zoneDiv.className = `min-w-[280px] w-auto max-w-[620px] rounded border ${isRoomSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border-subtle'} bg-surface-base p-4 shadow-xs transition-all pointer-events-auto shrink-0 flex flex-col cursor-pointer`;

        let headerHtml = `
          <div class="flex items-center justify-between pb-2 border-b border-border-subtle mb-3 room-card-header cursor-pointer select-none" onclick="selectEntity('room', '${room.id}')">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="material-symbols-outlined text-[16px] text-secondary">meeting_room</span>
              <span class="font-label-md text-label-md font-semibold text-on-surface truncate">${room.name}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="font-code-xs text-[11px] text-secondary shrink-0">${room.area_sqm || 0} m²</span>
              <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded border border-border-subtle hover:border-primary/50 transition-colors" onclick="event.stopPropagation(); openAddRoomDeviceModal('${room.id}', '${room.name}')" title="Add Device to ${room.name}">
                <span class="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>
          </div>
        `;

        // Render ALL devices belonging to this room (Multiple VAVs and RAQS supported)
        let devicesHtml = '<div class="grid grid-cols-2 gap-3 flex-1">';
        if (thisRoomEq.length === 0) {
          devicesHtml += `
            <div class="p-2.5 rounded border border-dashed border-border-subtle flex flex-col items-center justify-center text-secondary text-center cursor-pointer hover:border-primary hover:text-primary transition-colors min-h-[90px]" onclick="openAddRoomDeviceModal('${room.id}', '${room.name}')">
              <span class="material-symbols-outlined text-[16px]">add</span>
              <span class="font-code-xs text-[10px] mt-0.5">Add VAV</span>
            </div>
            <div class="p-2.5 rounded border border-dashed border-border-subtle flex flex-col items-center justify-center text-secondary text-center cursor-pointer hover:border-primary hover:text-primary transition-colors min-h-[90px]" onclick="openAddRoomDeviceModal('${room.id}', '${room.name}')">
              <span class="material-symbols-outlined text-[16px]">add</span>
              <span class="font-code-xs text-[10px] mt-0.5">Add RAQS</span>
            </div>
          `;
        } else {
          thisRoomEq.forEach(eq => {
            const isEqSelected = state.selectedEntity?.id === eq.id;
            const isVav = eq.equipment_type === 'VAV';
            const icon = isVav ? 'hvac' : 'air';
            const typeBadge = isVav ? 'VAV' : (eq.equipment_type === 'RAQS' ? 'RAQS' : eq.equipment_type);

            const eqCsvInfo = state.csvStatuses ? state.csvStatuses[eq.id] : null;
            const eqHasData = eqCsvInfo && eqCsvInfo.status === 'HAS_DATA' && eqCsvInfo.row_count > 0;
            const statVal = eqHasData ? (isVav ? 'Normal' : 'Active') : '--';

            devicesHtml += `
              <div class="p-2.5 rounded ${isEqSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto min-w-[125px]" id="node-${eq.id}" onclick="event.stopPropagation(); selectEntity('equipment', '${eq.id}')">
                ${isEqSelected ? '<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>' : ''}
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-1.5 min-w-0">
                    ${renderCsvStatusDot(eq.id)}
                    <span class="font-label-sm text-label-sm font-semibold ${isEqSelected ? 'text-primary font-bold' : 'text-on-surface'} truncate">${typeBadge}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    <button class="w-4 h-4 flex items-center justify-center text-secondary hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); openConfigureEntityDirectly('${eq.id}')" title="Edit Connections">
                      <span class="material-symbols-outlined text-[13px]">hub</span>
                    </button>
                    <span class="material-symbols-outlined text-[16px] ${isEqSelected ? 'text-primary' : 'text-secondary'}">${icon}</span>
                  </div>
                </div>
                <div class="font-code-xs text-[10px] text-secondary truncate" title="${eq.name}">${eq.name}</div>
                <div class="mt-2 pt-1.5 border-t border-border-subtle flex flex-col gap-0.5">
                  <div class="flex justify-between font-code-xs text-[11px]">
                    <span class="text-secondary">${isVav ? 'Airflow:' : 'Status:'}</span>
                    <span class="${eqHasData ? 'font-semibold text-on-surface' : 'font-medium text-secondary'}">${statVal}</span>
                  </div>
                  <div class="flex justify-between items-center font-code-xs text-[11px]">
                    <span class="text-secondary">CSV:</span>
                    <div class="flex items-center gap-1">
                      <span class="font-code-xs text-[10px] text-primary truncate max-w-[65px]" title="${eq.csv_filename || 'Not assigned'}">${eq.csv_filename || '—'}</span>
                      ${renderCsvStatusBadge(eq.id)}
                    </div>
                  </div>
                </div>
              </div>
            `;
          });
        }
        devicesHtml += '</div>';

        zoneDiv.innerHTML = headerHtml + devicesHtml;

        zoneDiv.onclick = (e) => {
          if (e.target === zoneDiv || e.target.closest('.room-card-header')) {
            selectEntity('room', room.id);
          }
        };

        roomsRow.appendChild(zoneDiv);
      });

      floorBox.appendChild(roomsRow);
      zonesContainer.appendChild(floorBox);
    });
  }

  // Draw clean, 60% opacity dynamic schematic interconnect arrows
  requestAnimationFrame(() => {
    updateCanvasSchematicArrows();
  });
}

// -------------------------------------------------------------
// Dynamic Top-Layer SVG Schematic Interconnect Arrows
// Reduced Opacity to 60% (stroke-opacity="0.6")
// Connects Chiller -> EV -> AHU and Air Supply Duct to Rooms
// Three-tier vertical layout: Chillers (top) | EVs (mid) | AHUs (bottom)
// Arrows flow DOWNWARD within plant box, never crossing horizontally between tiers.
// Return lines go left-of-plant below the box. Air ducts exit right from AHU tier.
// -------------------------------------------------------------

// Build an SVG path that routes from (sx,sy) → knees[] → (ex,ey).
// Between each segment we use an orthogonal L-route (horizontal then vertical).
// If no knees, falls back to the original direct / mid-step path.
function buildArrowPath(sx, sy, ex, ey, knees, midX, midY) {
  if (!knees || knees.length === 0) {
    // Original straight / elbow route
    if (midX !== undefined && midY !== undefined) {
      if (Math.abs(sx - ex) < 4) return `M ${sx} ${sy} L ${sx} ${ey}`;
      return `M ${sx} ${sy} L ${sx} ${midY} L ${ex} ${midY} L ${ex} ${ey}`;
    }
    return `M ${sx} ${sy} L ${ex} ${ey}`;
  }
  // With knees: chain through each waypoint with right-angle bends
  const pts = [{ x: sx, y: sy }, ...knees, { x: ex, y: ey }];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur  = pts[i];
    // Route via horizontal-then-vertical elbow
    d += ` L ${cur.x} ${prev.y} L ${cur.x} ${cur.y}`;
  }
  return d;
}

// Render draggable knee-point diamond handles for a given arrow
function renderKneeHandles(arrowId, knees, color) {
  if (!knees || knees.length === 0) return '';
  return knees.map((k, i) => `
    <circle cx="${k.x}" cy="${k.y}" r="22" fill="transparent" class="pointer-events-auto cursor-grab" data-arrow-id="${arrowId}" data-handle="knee" data-knee-index="${i}" title="Drag bend point ◆ | Right-click or double-click to delete"></circle>
    <rect x="${k.x - 7}" y="${k.y - 7}" width="14" height="14" rx="2" transform="rotate(45 ${k.x} ${k.y})" fill="${color}" stroke="#FFFFFF" stroke-width="2" class="pointer-events-auto cursor-grab hover:scale-125 transition-transform" data-arrow-id="${arrowId}" data-handle="knee" data-knee-index="${i}" title="Drag bend point ◆ | Right-click or double-click to delete"></rect>
  `).join('');
}

function updateCanvasSchematicArrows() {
  const svg = document.getElementById('canvas-schematic-svg');
  const workspace = document.getElementById('canvas-workspace');
  if (!svg || !workspace || !state.topology) return;

  const wRect = workspace.getBoundingClientRect();
  const scale = state.currentZoom || 1.0;

  function getCoords(el) {
    if (!el) return null;
    const eRect = el.getBoundingClientRect();
    return {
      x: (eRect.left - wRect.left) / scale,
      y: (eRect.top - wRect.top) / scale,
      width: eRect.width / scale,
      height: eRect.height / scale,
      right: (eRect.right - wRect.left) / scale,
      bottom: (eRect.bottom - wRect.top) / scale,
      centerX: ((eRect.left + eRect.right) / 2 - wRect.left) / scale,
      centerY: ((eRect.top + eRect.bottom) / 2 - wRect.top) / scale,
    };
  }

  const defs = `
    <defs>
      <marker id="arrow-chw" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#0284C7" fill-opacity="0.35"></path>
      </marker>
      <marker id="arrow-ev" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#16A34A" fill-opacity="0.35"></path>
      </marker>
      <marker id="arrow-return" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#64748B" fill-opacity="0.6"></path>
      </marker>
      <marker id="arrow-air" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#ff7a1a" fill-opacity="0.6"></path>
      </marker>
      <marker id="arrow-reset-signal" markerHeight="5" markerWidth="5" orient="auto" refX="4" refY="2.5">
        <path d="M0,0 L5,2.5 L0,5 Z" fill="#ff7a1a" fill-opacity="0.6"></path>
      </marker>
    </defs>
  `;

  let paths = '';
  const rels = state.topology.relationships || [];
  const sharedEq = state.topology.shared_equipment || [];
  const chillers = sharedEq.filter(e => e.equipment_type === 'CHILLER');
  const evs = sharedEq.filter(e => e.equipment_type === 'EV');
  const ahus = sharedEq.filter(e => e.equipment_type === 'AHU');

  // ─────────────────────────────────────────────────────────────
  // 1. Chiller → EV  (VERTICAL, downward, Blue)
  //    Exits bottom-center of chiller card, enters top-center of EV card.
  //    Offset each arrow horizontally by a small amount so multiple arrows
  //    between different chillers/EVs never overlap.
  // ─────────────────────────────────────────────────────────────
  let chwArrowIdx = 0;
  chillers.forEach(ch => {
    const cEl = document.getElementById(`node-${ch.id}`);
    const c = getCoords(cEl);
    if (!c) return;

    const targetEvRels = rels.filter(r => r.source_id === ch.id && r.relationship_type === 'SUPPLIES');
    const targetEvs = targetEvRels.map(r => evs.find(e => e.id === r.target_id)).filter(Boolean);

    targetEvs.forEach(evObj => {
      const evEl = document.getElementById(`node-${evObj.id}`);
      const ev = getCoords(evEl);
      if (!ev) return;

      const arrowId = `arrow-chw-${ch.id}-${evObj.id}`;
      const off = (state.arrowOffsets && state.arrowOffsets[arrowId]) || {};

      // Stagger horizontally: each Chiller→EV pair gets its own x offset column
      const offset = (chwArrowIdx - Math.floor(targetEvs.length / 2)) * 14 + (off.x || 0);
      const startX = Math.round(c.centerX + offset + (off.startX || 0));
      const endX   = Math.round(ev.centerX + offset + (off.endX || 0));
      const startY = Math.round(c.bottom + (off.startY || 0));
      const endY   = Math.round(ev.y + (off.endY || 0));
      const midY   = Math.round((c.bottom + ev.y) / 2 + (off.y || 0));

      // Straight down if aligned, else step horizontally at midpoint
      const knees = off.knees || [];
      const d = buildArrowPath(startX, startY, endX, endY, knees, endX, midY);

      const labelX = Math.round((startX + endX) / 2);
      const labelY = Math.round(midY);

      paths += `
        <!-- Chiller→EV ↓ (Blue 35%) -->
        <g class="arrow-group" data-arrow-id="${arrowId}">
          <path d="${d}" fill="none" stroke="transparent" stroke-width="18" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/25 transition-colors" data-arrow-id="${arrowId}" data-handle="mid" style="pointer-events:stroke;"></path>
          <path d="${d}" fill="none" stroke="#0284C7" stroke-width="2.5" stroke-opacity="0.35" marker-end="url(#arrow-chw)" pointer-events="none"></path>
          <!-- Start Pin (Chiller exit) -->
          <circle cx="${startX}" cy="${startY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (Chiller exit)"></circle>
          <circle cx="${startX}" cy="${startY}" r="9" fill="#0284C7" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (Chiller exit)"></circle>
          <!-- End Pin (EV inlet) -->
          <circle cx="${endX}" cy="${endY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (EV inlet)"></circle>
          <circle cx="${endX}" cy="${endY}" r="9" fill="#0284C7" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (EV inlet)"></circle>
          <!-- Mid Handle (no label) -->
          <circle cx="${labelX}" cy="${labelY}" r="5" fill="#FFFFFF" stroke="#0284C7" stroke-width="2" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-125 transition-transform" data-arrow-id="${arrowId}" data-handle="mid" title="Drag whole pipe route | Dbl-click to add bend"></circle>
          ${renderKneeHandles(arrowId, knees, '#0284C7')}
        </g>
      `;
      chwArrowIdx++;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. EV → AHU  (VERTICAL, downward, Green)
  //    Exits bottom-center of EV card, enters top-center of AHU card.
  //    Each EV→AHU pair gets its own x column to avoid overlap.
  // ─────────────────────────────────────────────────────────────
  let evArrowIdx = 0;
  evs.forEach(evObj => {
    const evEl = document.getElementById(`node-${evObj.id}`);
    const ev = getCoords(evEl);
    if (!ev) return;

    const targetAhuRels = rels.filter(r =>
      r.source_id === evObj.id &&
      (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES')
    );
    const targetAhus = targetAhuRels.map(r => ahus.find(a => a.id === r.target_id)).filter(Boolean);

    targetAhus.forEach(ahuObj => {
      const ahuEl = document.getElementById(`node-${ahuObj.id}`);
      const ahu = getCoords(ahuEl);
      if (!ahu) return;

      const arrowId = `arrow-ev-${evObj.id}-${ahuObj.id}`;
      const off = (state.arrowOffsets && state.arrowOffsets[arrowId]) || {};

      const offset = (evArrowIdx - Math.floor(targetAhus.length / 2)) * 14 + (off.x || 0);
      const startX = Math.round(ev.centerX + offset + (off.startX || 0));
      const endX   = Math.round(ahu.centerX + offset + (off.endX || 0));
      const startY = Math.round(ev.bottom + (off.startY || 0));
      const endY   = Math.round(ahu.y + (off.endY || 0));
      const midY   = Math.round((ev.bottom + ahu.y) / 2 + (off.y || 0));

      const knees2 = off.knees || [];
      const d = buildArrowPath(startX, startY, endX, endY, knees2, endX, midY);

      const labelX = Math.round((startX + endX) / 2);
      const labelY = Math.round(midY);

      paths += `
        <!-- EV→AHU ↓ (Green 35%) -->
        <g class="arrow-group" data-arrow-id="${arrowId}">
          <path d="${d}" fill="none" stroke="transparent" stroke-width="18" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/25 transition-colors" data-arrow-id="${arrowId}" data-handle="mid" style="pointer-events:stroke;"></path>
          <path d="${d}" fill="none" stroke="#16A34A" stroke-width="2.5" stroke-opacity="0.35" marker-end="url(#arrow-ev)" pointer-events="none"></path>
          <!-- Start Pin (EV outlet) -->
          <circle cx="${startX}" cy="${startY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (EV outlet)"></circle>
          <circle cx="${startX}" cy="${startY}" r="9" fill="#16A34A" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (EV outlet)"></circle>
          <!-- End Pin (AHU coil inlet) -->
          <circle cx="${endX}" cy="${endY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (AHU coil inlet)"></circle>
          <circle cx="${endX}" cy="${endY}" r="9" fill="#16A34A" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (AHU coil inlet)"></circle>
          <!-- Mid Handle (no label) -->
          <circle cx="${labelX}" cy="${labelY}" r="5" fill="#FFFFFF" stroke="#16A34A" stroke-width="2" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-125 transition-transform" data-arrow-id="${arrowId}" data-handle="mid" title="Drag whole coil pipe route | Dbl-click to add bend"></circle>
          ${renderKneeHandles(arrowId, knees2, '#16A34A')}
        </g>
      `;
      evArrowIdx++;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Hydronic Return: AHU → Chiller  (dashed grey, below plant box)
  //    Each return pair exits the left side of its AHU card and routes
  //    through a horizontal channel BELOW the entire plant box, then
  //    rises back into the bottom of the matching chiller card.
  //    Each pair uses a different Y level in the channel so lines never overlap.
  // ─────────────────────────────────────────────────────────────
  const returnPairs = [];
  ahus.forEach(ahu => {
    const upstreamEvRels = rels.filter(r =>
      r.target_id === ahu.id &&
      (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES')
    );
    const upstreamEvs = upstreamEvRels.map(r => evs.find(e => e.id === r.source_id)).filter(Boolean);

    let matchedChillers = [];
    upstreamEvs.forEach(ev => {
      const chRels = rels.filter(r => r.target_id === ev.id && r.relationship_type === 'SUPPLIES');
      chRels.forEach(cr => {
        const ch = chillers.find(c => c.id === cr.source_id);
        if (ch && !matchedChillers.includes(ch)) matchedChillers.push(ch);
      });
    });

    // Direct Chiller → AHU connection
    rels.filter(r => r.target_id === ahu.id && r.relationship_type === 'SUPPLIES').forEach(cr => {
      const ch = chillers.find(c => c.id === cr.source_id);
      if (ch && !matchedChillers.includes(ch)) matchedChillers.push(ch);
    });

    // Direct AHU → Chiller relationship
    rels.filter(r => r.source_id === ahu.id && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES')).forEach(dr => {
      const ch = chillers.find(c => c.id === dr.target_id);
      if (ch && !matchedChillers.includes(ch)) matchedChillers.push(ch);
    });

    // Implicit loop: AHU in hydronic loop via EV → link to primary chiller
    if (matchedChillers.length === 0 && upstreamEvs.length > 0 && chillers.length > 0) {
      matchedChillers.push(chillers[0]);
    }

    matchedChillers.forEach(ch => {
      if (!returnPairs.some(p => p.ahu.id === ahu.id && p.chiller.id === ch.id)) {
        returnPairs.push({ ahu, chiller: ch });
      }
    });
  });

  // Find the bottom-most edge of the entire plant box
  const allPlantCards = [...chillers, ...evs, ...ahus]
    .map(e => getCoords(document.getElementById(`node-${e.id}`)))
    .filter(Boolean);
  const plantBottomMax = allPlantCards.length > 0 ? Math.max(...allPlantCards.map(c => c.bottom)) : 300;

  // Find left edge of plant box for the return channel corridor
  const plantLeftMin = allPlantCards.length > 0 ? Math.min(...allPlantCards.map(c => c.x)) : 30;
  const returnChannelBaseY = Math.round(plantBottomMax + 18);

  returnPairs.forEach((pair, pairIdx) => {
    const cEl = document.getElementById(`node-${pair.chiller.id}`);
    const aEl = document.getElementById(`node-${pair.ahu.id}`);
    const c = getCoords(cEl);
    const a = getCoords(aEl);
    if (!c || !a) return;

    const arrowId = `arrow-return-${pair.ahu.id}-${pair.chiller.id}`;
    const off = (state.arrowOffsets && state.arrowOffsets[arrowId]) || {};

    // Each pair gets its own Y level in the return channel (stacked, 20px apart)
    const returnY = Math.round(returnChannelBaseY + pairIdx * 20 + (off.y || 0));

    // Exit the AHU left-side center; re-enter the chiller left-side bottom
    const ahuExitX    = Math.round(a.x + (off.startX || 0));
    const ahuExitY    = Math.round(a.centerY + (off.startY || 0));
    const chillerEntX = Math.round(c.x + (off.endX || 0));
    const chillerEntY = Math.round(c.bottom + (off.endY || 0));

    // Left corridor X: 20px left of the leftmost plant card, stagger per pair
    const corridorX   = Math.round(plantLeftMin - 24 - pairIdx * 16 + (off.x || 0));

    // Build path: knees override the default L-shaped corridor route
    const kneesR = off.knees || [];
    let d;
    if (kneesR.length > 0) {
      d = buildArrowPath(ahuExitX, ahuExitY, chillerEntX, chillerEntY, kneesR);
    } else {
      // Allow moving the whole return line via (off.x, off.y)
      // off.x adjusts the left corridor, off.y adjusts the horizontal bottom return channel
      d = `M ${ahuExitX} ${ahuExitY} L ${corridorX} ${ahuExitY} L ${corridorX} ${returnY} L ${chillerEntX} ${returnY} L ${chillerEntX} ${chillerEntY}`;
    }

    // Mid handle placed on the horizontal return channel
    const midHandleX = Math.round((corridorX + chillerEntX) / 2);
    const midHandleY = returnY;

    paths += `
      <!-- Hydronic Return ${pair.ahu.name} → ${pair.chiller.name} (grey dashed 60%) -->
      <g class="arrow-group" data-arrow-id="${arrowId}">
        <!-- Wide invisible stroke for easy grabbing and moving of entire return line -->
        <path d="${d}" fill="none" stroke="transparent" stroke-width="22" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/20 transition-colors" data-arrow-id="${arrowId}" data-handle="mid" style="pointer-events:stroke;" title="Drag grey return line | Dbl-click to add bend"></path>
        <path d="${d}" fill="none" stroke="#64748B" stroke-dasharray="5,4" stroke-width="2.5" stroke-opacity="0.6" marker-end="url(#arrow-return)" pointer-events="none"></path>
        <!-- Start Pin (AHU return outlet) -->
        <circle cx="${ahuExitX}" cy="${ahuExitY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (AHU return outlet)"></circle>
        <circle cx="${ahuExitX}" cy="${ahuExitY}" r="9" fill="#64748B" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (AHU return outlet)"></circle>
        <!-- End Pin (Chiller return inlet) -->
        <circle cx="${chillerEntX}" cy="${chillerEntY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (Chiller return inlet)"></circle>
        <circle cx="${chillerEntX}" cy="${chillerEntY}" r="9" fill="#64748B" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="end" title="Drag arrow end point (Chiller return inlet)"></circle>
        <!-- Channel mid-drag handle on return pipe -->
        <circle cx="${midHandleX}" cy="${midHandleY}" r="18" fill="transparent" class="pointer-events-auto cursor-grab" data-arrow-id="${arrowId}" data-handle="mid" title="Drag return line | Dbl-click to add bend"></circle>
        <circle cx="${midHandleX}" cy="${midHandleY}" r="6" fill="#64748B" stroke="#FFFFFF" stroke-width="2" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-125 transition-transform" data-arrow-id="${arrowId}" data-handle="mid" title="Drag return line | Dbl-click to add bend"></circle>
        ${renderKneeHandles(arrowId, kneesR, '#64748B')}
      </g>
    `;
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Supply Air Ducts: AHU → rooms (orange)
  //    Each AHU exits its RIGHT side, rises/drops to a horizontal
  //    manifold above the room boxes, then drops into each served room.
  //    Each AHU gets its own manifold Y elevation so they don't overlap.
  // ─────────────────────────────────────────────────────────────
  ahus.forEach((ahuObj, ahuIdx) => {
    const ahuEl = document.getElementById(`node-${ahuObj.id}`);
    const ahu = getCoords(ahuEl);
    if (!ahu) return;

    const ahuRels = rels.filter(r =>
      r.source_id === ahuObj.id &&
      (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'SERVES' || r.relationship_type === 'CONNECTED_TO')
    );
    if (ahuRels.length === 0) return;

    const targetIds = new Set(ahuRels.map(r => r.target_id));
    const allRoomDivs = Array.from(document.querySelectorAll('#zones-canvas-container [id^="room-card-"]'));

    const connectedRoomDivs = allRoomDivs.filter(div => {
      const roomId = div.id.replace('room-card-', '');
      if (targetIds.has(roomId)) return true;
      const vavNodes = div.querySelectorAll('[id^="node-"]');
      return Array.from(vavNodes).some(n => targetIds.has(n.id.replace('node-', '')));
    });

    if (connectedRoomDivs.length === 0) return;

    const minRoomTop = Math.min(...connectedRoomDivs.map(d => getCoords(d)?.y || 480));

    const arrowId = `arrow-air-${ahuObj.id}`;
    const off = (state.arrowOffsets && state.arrowOffsets[arrowId]) || {};

    // Each AHU gets its own manifold level, stacked above zones area
    const manifoldY = Math.round(minRoomTop - 36 - ahuIdx * 22 + (off.y || 0));

    // Exit right side of AHU, then rise to manifold
    const exitX  = Math.round(ahu.right + (off.startX || 0));
    const exitY  = Math.round(ahu.centerY + (off.startY || 0));
    const riserX = Math.round(ahu.right + 30 + ahuIdx * 20 + (off.x || 0));
    const exitPath = `M ${exitX} ${exitY} L ${riserX} ${exitY} L ${riserX} ${manifoldY}`;

    const roomDrops = connectedRoomDivs.map(div => {
      const rc = getCoords(div);
      if (!rc) return null;
      const roomId = div.id.replace('room-card-', '');
      const dropArrowId = `arrow-drop-${ahuObj.id}-${roomId}`;
      const dropOff = (state.arrowOffsets && state.arrowOffsets[dropArrowId]) || {};

      const vavEl = div.querySelector('[id*="vav"]');
      const vavCoords = vavEl ? getCoords(vavEl) : null;
      const baseDropX = vavCoords ? Math.round(vavCoords.centerX) : Math.round(rc.centerX);
      const dropX = Math.round(baseDropX + (ahuIdx * 14 - (ahus.length - 1) * 7) + (dropOff.x || 0) + (dropOff.endX || 0));
      const dropTop = Math.round(rc.y - 4 + (dropOff.y || 0) + (dropOff.endY || 0));
      return { x: dropX, top: dropTop, id: dropArrowId };
    }).filter(Boolean);

    if (roomDrops.length > 0) {
      const minX = Math.min(...roomDrops.map(d => d.x), riserX);
      const maxX = Math.max(...roomDrops.map(d => d.x), riserX);
      const kneesAir = off.knees || [];

      paths += `
        <!-- AHU air trunk ${ahuObj.name} (orange 60%) -->
        <g class="arrow-group" data-arrow-id="${arrowId}">
          <path d="${exitPath}" fill="none" stroke="transparent" stroke-width="20" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/25 transition-colors" data-arrow-id="${arrowId}" data-handle="mid" style="pointer-events:stroke;"></path>
          <path d="${exitPath}" fill="none" stroke="#ff7a1a" stroke-linecap="round" stroke-width="3.5" stroke-opacity="0.6" pointer-events="none"></path>
          <path d="M ${minX} ${manifoldY} L ${maxX} ${manifoldY}" fill="none" stroke="transparent" stroke-width="20" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/25 transition-colors" data-arrow-id="${arrowId}" data-handle="mid" style="pointer-events:stroke;"></path>
          <path d="M ${minX} ${manifoldY} L ${maxX} ${manifoldY}" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-opacity="0.6" pointer-events="none"></path>
          <!-- Start Pin (AHU supply air outlet) -->
          <circle cx="${exitX}" cy="${exitY}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (AHU supply outlet)"></circle>
          <circle cx="${exitX}" cy="${exitY}" r="9" fill="#ff7a1a" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${arrowId}" data-handle="start" title="Drag arrow start point (AHU supply outlet)"></circle>
          <!-- Manifold & Riser Handle -->
          <circle cx="${riserX}" cy="${manifoldY}" r="6" fill="#FFFFFF" stroke="#ff7a1a" stroke-width="2" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:scale-125 transition-transform" data-arrow-id="${arrowId}" data-handle="mid" title="Drag supply air manifold & riser | Dbl-click to add bend"></circle>
          ${renderKneeHandles(arrowId, kneesAir, '#ff7a1a')}
        </g>
      `;

      roomDrops.forEach(drop => {
        const dropKnees = (state.arrowOffsets && state.arrowOffsets[drop.id] && state.arrowOffsets[drop.id].knees) || [];
        const dropPath = buildArrowPath(drop.x, manifoldY, drop.x, drop.top, dropKnees);
        paths += `
          <!-- Air drop to room -->
          <g class="arrow-group" data-arrow-id="${drop.id}">
            <path d="${dropPath}" fill="none" stroke="transparent" stroke-width="16" class="pointer-events-auto cursor-grab active:cursor-grabbing hover:stroke-primary/25 transition-colors" data-arrow-id="${drop.id}" data-handle="mid" style="pointer-events:stroke;"></path>
            <path d="${dropPath}" fill="none" stroke="#ff7a1a" stroke-width="2.5" stroke-opacity="0.6" marker-end="url(#arrow-air)" pointer-events="none"></path>
            <!-- End Pin (Room VAV inlet) -->
            <circle cx="${drop.x}" cy="${drop.top}" r="20" fill="transparent" class="pointer-events-auto cursor-crosshair" data-arrow-id="${drop.id}" data-handle="end" title="Drag arrow end point (Room air terminal entry)"></circle>
            <circle cx="${drop.x}" cy="${drop.top}" r="9" fill="#ff7a1a" stroke="#FFFFFF" stroke-width="2.5" class="pointer-events-auto cursor-crosshair hover:scale-[1.8] transition-transform" data-arrow-id="${drop.id}" data-handle="end" title="Drag arrow end point (Room air terminal entry)"></circle>
            ${renderKneeHandles(drop.id, dropKnees, '#ff7a1a')}
          </g>
        `;
      });
    }
  });

  svg.innerHTML = defs + paths;
}

// -------------------------------------------------------------
// Entity Selection & Detail Drawer
// -------------------------------------------------------------
function selectEntity(type, id) {
  state.selectedType = type;
  if (!state.topology) return;

  if (type === 'room') {
    state.selectedEntity = (state.topology.rooms || []).find(r => r.id === id);
    if (!state.expandedRooms) state.expandedRooms = new Set();
    state.expandedRooms.add(id);
  } else if (type === 'equipment') {
    state.selectedEntity = (state.topology.room_equipment || []).concat(state.topology.shared_equipment || []).find(e => e.id === id);
    if (state.selectedEntity && state.selectedEntity.room_id) {
      if (!state.expandedRooms) state.expandedRooms = new Set();
      state.expandedRooms.add(state.selectedEntity.room_id);
    }
  } else if (type === 'floor') {
    state.selectedEntity = (state.topology.floors || []).find(f => f.id === id);
  } else if (type === 'building') {
    state.selectedEntity = state.topology.building;
  }

  // Update Active Selection footer bar
  const selectionLabel = document.getElementById('active-selection-label');
  if (selectionLabel && state.selectedEntity) {
    const desc = state.selectedEntity.description ? ` (${state.selectedEntity.description})` : '';
    selectionLabel.innerText = `Active Selection: [${type.toUpperCase()}] ${state.selectedEntity.name}${desc}`;
  }

  // Re-render UI highlights
  renderSidebar();
  renderCanvas();

  // Open the detail drawer
  openDetailDrawer(type, state.selectedEntity);
}

function selectCanvasElement(nodeId) {
  if (!nodeId) return;
  const cleanId = nodeId.replace(/^node-/, '');

  const allEq = (state.topology?.room_equipment || []).concat(state.topology?.shared_equipment || []);
  let found = allEq.find(e => e.id === cleanId);

  if (!found) {
    found = allEq.find(e => e.id.includes(cleanId) || cleanId.includes(e.id.replace('eq_', '')));
  }

  if (found) {
    selectEntity('equipment', found.id);
  } else {
    const room = (state.topology?.rooms || []).find(r => r.id === cleanId || cleanId.includes(r.id.replace('rm_', '')));
    if (room) {
      selectEntity('room', room.id);
    }
  }
}

function refreshSelectedEntity() {
  if (!state.selectedEntity || !state.selectedType) return;
  selectEntity(state.selectedType, state.selectedEntity.id);
}

function openDetailDrawer(type, entity) {
  if (!entity) return;
  const drawer = document.getElementById('entity-detail-drawer');
  if (!drawer) return;

  const titleEl = document.getElementById('drawer-title');
  const typeBadgeEl = document.getElementById('drawer-type-badge');
  const idEl = document.getElementById('drawer-id');
  const nameInput = document.getElementById('drawer-name-input');
  const descInput = document.getElementById('drawer-desc-input');
  const equipmentFields = document.getElementById('drawer-equipment-fields');
  const roomFields = document.getElementById('drawer-room-fields');
  const floorFields = document.getElementById('drawer-floor-fields');
  const relationsContainer = document.getElementById('drawer-relationships-list');
  const btnConfigureConn = document.getElementById('drawer-btn-configure-conn');

  // Populate basic info
  if (titleEl) titleEl.innerText = entity.name;
  if (typeBadgeEl) typeBadgeEl.innerText = (entity.equipment_type || type).toUpperCase();
  if (idEl) idEl.innerText = entity.id;
  if (nameInput) nameInput.value = entity.name || '';
  if (descInput) descInput.value = entity.description || '';

  // Equipment specific fields
  if (equipmentFields) {
    if (type === 'equipment') {
      equipmentFields.classList.remove('hidden');
      const csvInput = document.getElementById('drawer-csv-input');
      const categoryBadge = document.getElementById('drawer-category-badge');
      const paramsList = document.getElementById('drawer-params-list');
      const roomSelectContainer = document.getElementById('drawer-room-select-container');
      const roomSelect = document.getElementById('drawer-room-select');

      if (csvInput) csvInput.value = entity.csv_filename || '';
      if (categoryBadge) categoryBadge.innerText = entity.category;

      const csvStatusBox = document.getElementById('drawer-csv-status-box');
      if (csvStatusBox) {
        const info = state.csvStatuses ? state.csvStatuses[entity.id] : null;
        if (!info || info.status === 'NO_FILE') {
          csvStatusBox.innerHTML = `
            <div class="flex items-center gap-2 p-2 rounded bg-error/10 border border-error/30 text-error font-code-xs text-[11px]">
              <span class="w-2 h-2 rounded-full bg-status-error shrink-0"></span>
              <span><strong>No CSV File:</strong> Filename missing or unassigned (Red dot)</span>
            </div>
          `;
        } else if (info.status === 'NO_DATA') {
          csvStatusBox.innerHTML = `
            <div class="flex items-center gap-2 p-2 rounded bg-status-warning/10 border border-status-warning/30 text-status-warning font-code-xs text-[11px]">
              <span class="w-2 h-2 rounded-full bg-status-warning shrink-0"></span>
              <span><strong>File Without Data:</strong> 0 data rows${info.created_dummy ? ' (Dummy template created)' : ''} (Yellow dot)</span>
            </div>
          `;
        } else if (info.status === 'HAS_DATA') {
          csvStatusBox.innerHTML = `
            <div class="flex items-center gap-2 p-2 rounded bg-status-success/10 border border-status-success/30 text-status-success font-code-xs text-[11px]">
              <span class="w-2 h-2 rounded-full bg-status-success shrink-0"></span>
              <span><strong>Active Telemetry:</strong> ${info.row_count} data rows detected (Green dot)</span>
            </div>
          `;
        }
      }

      if (paramsList) {
        paramsList.innerHTML = (entity.standard_parameters || []).map(p => `
          <span class="px-2 py-0.5 rounded bg-surface-subtle border border-border-subtle font-code-xs text-code-xs text-secondary">${p}</span>
        `).join('');
      }

      if (entity.category === 'ROOM_LEVEL' && roomSelect) {
        roomSelectContainer.classList.remove('hidden');
        roomSelect.innerHTML = (state.topology?.rooms || []).map(r => `
          <option value="${r.id}" ${r.id === entity.room_id ? 'selected' : ''}>${r.name}</option>
        `).join('');
      } else if (roomSelectContainer) {
        roomSelectContainer.classList.add('hidden');
      }

      if (btnConfigureConn) {
        btnConfigureConn.classList.remove('hidden');
        btnConfigureConn.innerHTML = `
          <span class="material-symbols-outlined text-[16px]">hub</span>
          <span>Edit Connections (${entity.equipment_type})</span>
        `;
      }
    } else {
      equipmentFields.classList.add('hidden');
      if (btnConfigureConn) btnConfigureConn.classList.add('hidden');
    }
  }

  // Room specific fields
  if (roomFields) {
    if (type === 'room') {
      roomFields.classList.remove('hidden');
      const roomNumInput = document.getElementById('drawer-room-number-input');
      const areaInput = document.getElementById('drawer-room-area-input');
      if (roomNumInput) roomNumInput.value = entity.room_number || '';
      if (areaInput) areaInput.value = entity.area_sqm || 0;
    } else {
      roomFields.classList.add('hidden');
    }
  }

  // Floor specific fields
  if (floorFields) {
    if (type === 'floor') {
      floorFields.classList.remove('hidden');
      const floorNumInput = document.getElementById('drawer-floor-number-input');
      if (floorNumInput) floorNumInput.value = entity.floor_number || 1;
    } else {
      floorFields.classList.add('hidden');
    }
  }

  // Populate active relationships with individual disconnect buttons
  if (relationsContainer) {
    const rels = (state.topology?.relationships || []).filter(r => r.source_id === entity.id || r.target_id === entity.id);
    if (rels.length === 0) {
      relationsContainer.innerHTML = `<span class="font-code-xs text-code-xs text-secondary italic">No active connections configured.</span>`;
    } else {
      const allEq = (state.topology?.room_equipment || []).concat(state.topology?.shared_equipment || []);
      const allRooms = state.topology?.rooms || [];

      function getEntityName(id) {
        const foundEq = allEq.find(e => e.id === id);
        if (foundEq) return `${foundEq.name} [${foundEq.equipment_type}]`;
        const foundRm = allRooms.find(r => r.id === id);
        if (foundRm) return `${foundRm.name} [Room]`;
        return id;
      }

      relationsContainer.innerHTML = rels.map(r => {
        const isSource = r.source_id === entity.id;
        const otherId = isSource ? r.target_id : r.source_id;
        const otherName = getEntityName(otherId);
        const direction = isSource ? `→ ${otherName}` : `← ${otherName}`;

        return `
          <div class="flex items-center justify-between p-2 rounded bg-surface-canvas border border-border-subtle font-code-xs text-code-xs hover:border-primary/40 transition-colors">
            <div class="flex flex-col min-w-0 pr-1">
              <div class="flex items-center gap-1.5 truncate">
                <span class="font-semibold text-primary px-1 py-0.2 rounded bg-primary/10 text-[10px]">${r.relationship_type}</span>
                <span class="text-on-surface font-medium truncate">${direction}</span>
              </div>
              ${r.description ? `<span class="text-secondary text-[10px] truncate mt-0.5" title="${r.description}">${r.description}</span>` : ''}
            </div>
            <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-error rounded shrink-0 transition-colors" onclick="event.stopPropagation(); deleteRelationshipDirectly('${r.id}')" title="Disconnect">
              <span class="material-symbols-outlined text-[13px]">close</span>
            </button>
          </div>
        `;
      }).join('');
    }
  }

  // Populate drawer quick-connect target dropdown
  const quickTargetSelect = document.getElementById('drawer-quick-target-select');
  if (quickTargetSelect) {
    const allEq = (state.topology?.shared_equipment || []).concat(state.topology?.room_equipment || []);
    const allRooms = state.topology?.rooms || [];
    quickTargetSelect.innerHTML = `
      <option value="">-- Select Target Entity --</option>
      <optgroup label="Plant Units">
        ${(state.topology?.shared_equipment || []).filter(e => e.id !== entity.id).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Room Devices">
        ${(state.topology?.room_equipment || []).filter(e => e.id !== entity.id).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Rooms">
        ${allRooms.filter(r => r.id !== entity.id).map(r => `<option value="${r.id}|ROOM">${r.name}</option>`).join('')}
      </optgroup>
    `;
  }

  drawer.classList.remove('translate-x-full');
}

function closeDetailDrawer() {
  const drawer = document.getElementById('entity-detail-drawer');
  if (drawer) {
    drawer.classList.add('translate-x-full');
  }
}

async function deleteRelationshipDirectly(relId) {
  try {
    const res = await fetch(`/api/relationships/${relId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete relationship');
    showToast('Connection removed');
    await loadTopology();
    if (state.selectedEntity && state.selectedType) {
      selectEntity(state.selectedType, state.selectedEntity.id);
    }
  } catch (err) {
    showToast(err.message || 'Error removing connection', true);
  }
}

async function submitDrawerQuickConnect() {
  if (!state.selectedEntity || !state.selectedType) {
    showToast('Select an entity first', true);
    return;
  }
  const quickTargetSelect = document.getElementById('drawer-quick-target-select');
  const quickRelType = document.getElementById('drawer-quick-rel-type');
  if (!quickTargetSelect || !quickTargetSelect.value) {
    showToast('Please select a target entity to connect', true);
    return;
  }

  const [targetId, targetType] = quickTargetSelect.value.split('|');
  const relType = quickRelType ? quickRelType.value : 'CONNECTED_TO';

  const sourceId = state.selectedEntity.id;
  const sourceType = state.selectedType.toUpperCase();

  try {
    const res = await fetch('/api/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: sourceId,
        source_type: sourceType,
        relationship_type: relType,
        target_id: targetId,
        target_type: targetType,
        description: `${state.selectedEntity.name} ${relType} target`
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to add connection');
    }
    showToast('Connection established');
    await loadTopology();
    selectEntity(state.selectedType, state.selectedEntity.id);
  } catch (err) {
    showToast(err.message || 'Error adding connection', true);
  }
}

// -------------------------------------------------------------
// Entity Updates & Deletion
// -------------------------------------------------------------
async function saveDrawerChanges() {
  if (!state.selectedEntity || !state.selectedType) return;
  const entity = state.selectedEntity;
  const type = state.selectedType;

  const nameInput = document.getElementById('drawer-name-input');
  const descInput = document.getElementById('drawer-desc-input');

  const nameVal = nameInput ? nameInput.value.trim() : entity.name;
  if (!nameVal) {
    showToast('Name cannot be empty', true);
    if (nameInput) nameInput.focus();
    return;
  }

  const payload = {
    name: nameVal,
    description: descInput ? descInput.value.trim() : entity.description
  };

  let endpoint = '';
  if (type === 'room') {
    endpoint = `/api/rooms/${entity.id}`;
    const roomNum = document.getElementById('drawer-room-number-input');
    const area = document.getElementById('drawer-room-area-input');
    if (roomNum) payload.room_number = roomNum.value.trim();
    if (area) payload.area_sqm = parseFloat(area.value) || 0.0;
  } else if (type === 'equipment') {
    endpoint = `/api/equipment/${entity.id}`;
    const csvInput = document.getElementById('drawer-csv-input');
    let csvVal = csvInput ? csvInput.value.trim() : '';
    if (!csvVal) {
      showToast('Associated CSV filename cannot be empty', true);
      if (csvInput) csvInput.focus();
      return;
    }
    if (!csvVal.toLowerCase().endsWith('.csv') && !csvVal.toLowerCase().endsWith('.xlsx') && !csvVal.toLowerCase().endsWith('.xls')) {
      csvVal += '.csv';
    }
    payload.csv_filename = csvVal;
    if (entity.category === 'ROOM_LEVEL') {
      const roomSelect = document.getElementById('drawer-room-select');
      if (roomSelect) payload.room_id = roomSelect.value;
    }
  } else if (type === 'floor') {
    endpoint = `/api/floors/${entity.id}`;
    const floorNum = document.getElementById('drawer-floor-number-input');
    if (floorNum) payload.floor_number = parseInt(floorNum.value, 10) || 1;
  } else if (type === 'building') {
    endpoint = `/api/buildings/${entity.id}`;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Update failed');
    }

    showToast('Saved changes successfully');
    await loadTopology();
  } catch (err) {
    console.error('Error saving entity:', err);
    showToast(err.message || 'Failed to save changes', true);
  }
}

async function deleteDrawerEntity() {
  if (!state.selectedEntity || !state.selectedType) return;
  const entity = state.selectedEntity;
  const type = state.selectedType;
  deleteEntityPrompt(type, entity.id, entity.name);
}

async function deleteEntityPrompt(type, id, name) {
  const confirmed = confirm(`Are you sure you want to delete ${type.toUpperCase()} "${name}" (${id})? This will update persistent CSV configuration.`);
  if (!confirmed) return;

  let endpoint = '';
  if (type === 'room') endpoint = `/api/rooms/${id}`;
  else if (type === 'equipment') endpoint = `/api/equipment/${id}`;
  else if (type === 'floor') endpoint = `/api/floors/${id}`;
  else if (type === 'building') endpoint = `/api/buildings/${id}`;

  try {
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (!res.ok) throw new Error('Deletion failed');

    showToast(`Deleted ${name}`);
    if (state.selectedEntity && state.selectedEntity.id === id) {
      closeDetailDrawer();
      state.selectedEntity = null;
    }
    await loadTopology();
  } catch (err) {
    console.error('Failed to delete entity:', err);
    showToast('Failed to delete entity', true);
  }
}

// -------------------------------------------------------------
// Modals: Add Floor, Add Room, Add Device, Add Plant
// -------------------------------------------------------------
function openAddFloorModal() {
  const modal = document.getElementById('modal-add-floor');
  if (modal) modal.classList.remove('hidden');
}

function closeAddFloorModal() {
  const modal = document.getElementById('modal-add-floor');
  if (modal) modal.classList.add('hidden');
}

async function submitAddFloor(e) {
  e.preventDefault();
  const nameInput = document.getElementById('modal-floor-name');
  const numberInput = document.getElementById('modal-floor-number');
  const descInput = document.getElementById('modal-floor-desc');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  if (!nameVal) {
    showToast('Please enter a Floor Name', true);
    if (nameInput) nameInput.focus();
    return;
  }

  const bldgId = state.topology && state.topology.building ? state.topology.building.id : 'bldg_01';

  const payload = {
    building_id: bldgId,
    name: nameVal,
    floor_number: parseInt(numberInput ? numberInput.value : 1, 10) || 1,
    description: descInput ? descInput.value.trim() : ''
  };

  try {
    const res = await fetch('/api/floors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to add floor');
    }

    closeAddFloorModal();
    nameInput.value = '';
    numberInput.value = '';
    descInput.value = '';

    showToast(`Floor "${payload.name}" created`);
    await loadTopology();
  } catch (err) {
    showToast(err.message || 'Error adding floor', true);
  }
}

function openAddRoomModal() {
  const modal = document.getElementById('modal-add-room');
  const floorSelect = document.getElementById('modal-room-floor-select');
  if (floorSelect && state.topology?.floors) {
    floorSelect.innerHTML = state.topology.floors.map(f => `
      <option value="${f.id}" ${f.id === state.activeFloorId ? 'selected' : ''}>${f.name} (Level ${f.floor_number})</option>
    `).join('');
  }
  if (modal) modal.classList.remove('hidden');
}

function closeAddRoomModal() {
  const modal = document.getElementById('modal-add-room');
  if (modal) modal.classList.add('hidden');
}

async function submitAddRoom(e) {
  e.preventDefault();
  const floorSelect = document.getElementById('modal-room-floor-select');
  const nameInput = document.getElementById('modal-room-name');
  const numberInput = document.getElementById('modal-room-number');
  const areaInput = document.getElementById('modal-room-area');
  const descInput = document.getElementById('modal-room-desc');

  const floorId = floorSelect && floorSelect.value ? floorSelect.value : state.activeFloorId;

  if (!floorId) {
    showToast('No floor found to place room into', true);
    return;
  }

  const nameVal = nameInput ? nameInput.value.trim() : '';
  if (!nameVal) {
    showToast('Please enter a Room Name', true);
    if (nameInput) nameInput.focus();
    return;
  }

  const payload = {
    floor_id: floorId,
    name: nameVal,
    room_number: numberInput ? numberInput.value.trim() : '',
    area_sqm: parseFloat(areaInput ? areaInput.value : 0) || 0.0,
    description: descInput ? descInput.value.trim() : ''
  };

  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to add room');
    }

    closeAddRoomModal();
    if (nameInput) nameInput.value = '';
    if (numberInput) numberInput.value = '';
    if (areaInput) areaInput.value = '';
    if (descInput) descInput.value = '';

    showToast(`Room "${payload.name}" created`);
    await loadTopology();
  } catch (err) {
    showToast(err.message || 'Error adding room', true);
  }
}

function openAddRoomDeviceModal(roomId, roomName) {
  const modal = document.getElementById('modal-add-room-device');
  const roomIdInput = document.getElementById('modal-device-room-id');
  const roomNameDisplay = document.getElementById('modal-device-room-name-display');

  if (roomIdInput) roomIdInput.value = roomId;
  if (roomNameDisplay) roomNameDisplay.innerText = roomName;
  if (modal) {
    modal.classList.remove('hidden');
    onRoomDeviceTypeChanged();
  }
}

function closeAddRoomDeviceModal() {
  const modal = document.getElementById('modal-add-room-device');
  if (modal) modal.classList.add('hidden');
}

function onRoomDeviceTypeChanged() {
  const roomId = document.getElementById('modal-device-room-id')?.value;
  const typeSelect = document.getElementById('modal-device-type');
  const container = document.getElementById('modal-device-dynamic-connections');
  const targetSelect = document.getElementById('modal-device-custom-target');
  if (!typeSelect || !container) return;

  const type = typeSelect.value;
  const ahus = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'AHU');
  const sameRoomRaqs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'RAQS' && e.room_id === roomId);
  const sameRoomVavs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'VAV' && e.room_id === roomId);
  const rooms = state.topology?.rooms || [];

  if (type === 'VAV') {
    container.innerHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Source AHU (Conditioned Air)</label>
          <select id="device-create-conn-ahu" class="px-2.5 py-1.5 rounded border border-border-strong bg-surface-canvas text-on-surface font-code-xs text-[11px] outline-none focus:border-primary">
            <option value="">-- None / Select Upstream AHU --</option>
            ${ahus.map(a => `<option value="${a.id}">${a.name} (${a.id})</option>`).join('')}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Associated RAQS (Same Room)</label>
          ${sameRoomRaqs.length === 0 ? `<div class="p-1.5 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No RAQS in this room yet.</div>` : `
            <div class="max-h-28 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
              ${sameRoomRaqs.map(rq => `
                <label class="flex items-center gap-2 p-1 rounded hover:bg-surface-subtle cursor-pointer transition-colors">
                  <input type="checkbox" id="device-create-conn-raqs-${rq.id}" value="${rq.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                  <span class="material-symbols-outlined text-[15px] text-primary">air</span>
                  <span class="font-code-xs text-[11px] text-on-surface truncate">${rq.name}</span>
                </label>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  } else if (type === 'RAQS') {
    container.innerHTML = `
      <div class="flex flex-col gap-1">
        <label class="font-label-sm text-on-surface font-medium text-[12px]">Provide Telemetry To VAV (Same Room)</label>
        ${sameRoomVavs.length === 0 ? `<div class="p-1.5 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No VAVs in this room yet.</div>` : `
          <div class="max-h-28 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
            ${sameRoomVavs.map(v => `
              <label class="flex items-center gap-2 p-1 rounded hover:bg-surface-subtle cursor-pointer transition-colors">
                <input type="checkbox" id="device-create-conn-vav-${v.id}" value="${v.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                <span class="material-symbols-outlined text-[15px] text-primary">hvac</span>
                <span class="font-code-xs text-[11px] text-on-surface truncate">${v.name}</span>
              </label>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }

  if (targetSelect) {
    const allEq = (state.topology?.shared_equipment || []).concat(state.topology?.room_equipment || []);
    targetSelect.innerHTML = `
      <option value="">-- None / Select Target --</option>
      <optgroup label="Plant Units">
        ${(state.topology?.shared_equipment || []).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Room Devices">
        ${(state.topology?.room_equipment || []).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Rooms">
        ${rooms.map(r => `<option value="${r.id}|ROOM">${r.name}</option>`).join('')}
      </optgroup>
    `;
  }
}

async function submitAddRoomDevice(e) {
  e.preventDefault();
  const roomId = document.getElementById('modal-device-room-id').value;
  const typeSelect = document.getElementById('modal-device-type');
  const nameInput = document.getElementById('modal-device-name');
  const descInput = document.getElementById('modal-device-desc');
  const csvInput = document.getElementById('modal-device-csv');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  let csvVal = csvInput ? csvInput.value.trim() : '';

  if (!nameVal) {
    showToast('Please enter a Device Name', true);
    if (nameInput) nameInput.focus();
    return;
  }
  if (!csvVal) {
    showToast('Please enter an Excel/CSV filename (e.g. VAV_104.csv)', true);
    if (csvInput) csvInput.focus();
    return;
  }
  if (!csvVal.toLowerCase().endsWith('.csv') && !csvVal.toLowerCase().endsWith('.xlsx') && !csvVal.toLowerCase().endsWith('.xls')) {
    csvVal += '.csv';
  }

  const eqType = typeSelect.value;
  const payload = {
    room_id: roomId,
    equipment_type: eqType,
    name: nameVal,
    description: descInput ? descInput.value.trim() : '',
    csv_filename: csvVal
  };

  try {
    const res = await fetch('/api/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create room device');
    }

    const created = await res.json();

    // Establish initial connections
    if (eqType === 'VAV') {
      const ahuSel = document.getElementById('device-create-conn-ahu');
      if (ahuSel && ahuSel.value) {
        const ahu = (state.topology?.shared_equipment || []).find(e => e.id === ahuSel.value);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: ahuSel.value,
            source_type: 'EQUIPMENT',
            relationship_type: 'SUPPLIES',
            target_id: created.id,
            target_type: 'EQUIPMENT',
            description: `${ahu ? ahu.name : ahuSel.value} supplies conditioned air to ${created.name}`
          })
        });
      }
      const sameRoomRaqs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'RAQS' && e.room_id === roomId);
      for (const rq of sameRoomRaqs) {
        const chk = document.getElementById(`device-create-conn-raqs-${rq.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: rq.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'MEASURES',
              target_id: created.id,
              target_type: 'EQUIPMENT',
              description: `${rq.name} provides telemetry for ${created.name}`
            })
          });
        }
      }
    } else if (eqType === 'RAQS') {
      const sameRoomVavs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'VAV' && e.room_id === roomId);
      for (const v of sameRoomVavs) {
        const chk = document.getElementById(`device-create-conn-vav-${v.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: created.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'MEASURES',
              target_id: v.id,
              target_type: 'EQUIPMENT',
              description: `${created.name} provides telemetry for ${v.name}`
            })
          });
        }
      }
    }

    // Custom Connection
    const customTarget = document.getElementById('modal-device-custom-target');
    const customRel = document.getElementById('modal-device-custom-rel');
    if (customTarget && customTarget.value) {
      const [tId, tType] = customTarget.value.split('|');
      const rType = customRel ? customRel.value : 'CONNECTED_TO';
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: created.id,
          source_type: 'EQUIPMENT',
          relationship_type: rType,
          target_id: tId,
          target_type: tType,
          description: `${created.name} ${rType} target`
        })
      });
    }

    closeAddRoomDeviceModal();
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (csvInput) csvInput.value = '';

    await loadTopology();
    showToast(`Device "${created.name}" created.`);
    selectEntity('equipment', created.id);
  } catch (err) {
    showToast(err.message || 'Error adding device', true);
  }
}

function openAddPlantModal() {
  const modal = document.getElementById('modal-add-plant');
  if (modal) {
    modal.classList.remove('hidden');
    onPlantTypeChanged();
  }
}

function closeAddPlantModal() {
  const modal = document.getElementById('modal-add-plant');
  if (modal) modal.classList.add('hidden');
}

function onPlantTypeChanged() {
  const typeSelect = document.getElementById('modal-plant-type');
  const container = document.getElementById('modal-plant-dynamic-connections');
  const targetSelect = document.getElementById('modal-plant-custom-target');
  if (!typeSelect || !container) return;

  const type = typeSelect.value;
  const evs = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'EV');
  const chillers = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'CHILLER');
  const ahus = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'AHU');
  const vavs = state.topology?.room_equipment || [];
  const rooms = state.topology?.rooms || [];

  if (type === 'CHILLER') {
    container.innerHTML = `
      <div class="flex flex-col gap-1">
        <label class="font-label-sm text-on-surface font-medium flex items-center justify-between">
          <span>Supply Chilled Water to Energy Valve(s) (EVs)</span>
          <span class="font-code-xs text-[10px] text-secondary">Toggle to select</span>
        </label>
        ${evs.length === 0 ? `<div class="p-2 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No EVs created yet. You can create the Chiller now and connect EVs later, or set a custom connection below.</div>` : `
          <div class="max-h-36 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
            ${evs.map(ev => `
              <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border border-transparent hover:border-border-subtle transition-colors">
                <input type="checkbox" id="plant-create-conn-ev-${ev.id}" value="${ev.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                <span class="material-symbols-outlined text-[16px] text-primary">speed</span>
                <span class="font-label-sm text-on-surface text-[12px] truncate">${ev.name} (${ev.id})</span>
              </label>
            `).join('')}
          </div>
        `}
      </div>
    `;
  } else if (type === 'EV') {
    container.innerHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Source Chiller</label>
          <select id="plant-create-conn-chiller" class="px-2.5 py-1.5 rounded border border-border-strong bg-surface-canvas text-on-surface font-code-xs text-[11px] outline-none focus:border-primary">
            <option value="">-- None / Select Upstream Chiller --</option>
            ${chillers.map(c => `<option value="${c.id}">${c.name} (${c.id})</option>`).join('')}
          </select>
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Downstream AHU(s)</label>
          ${ahus.length === 0 ? `<div class="p-2 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No AHUs created yet.</div>` : `
            <div class="max-h-32 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
              ${ahus.map(a => `
                <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border border-transparent hover:border-border-subtle transition-colors">
                  <input type="checkbox" id="plant-create-conn-ahu-${a.id}" value="${a.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                  <span class="material-symbols-outlined text-[16px] text-primary">mode_fan</span>
                  <span class="font-label-sm text-on-surface text-[12px] truncate">${a.name} (${a.id})</span>
                </label>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  } else if (type === 'AHU') {
    container.innerHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Upstream Energy Valve(s) (EVs)</label>
          ${evs.length === 0 ? `<div class="p-1.5 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No EVs created yet.</div>` : `
            <div class="max-h-28 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
              ${evs.map(ev => `
                <label class="flex items-center gap-2 p-1 rounded hover:bg-surface-subtle cursor-pointer transition-colors">
                  <input type="checkbox" id="plant-create-conn-ev-${ev.id}" value="${ev.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                  <span class="material-symbols-outlined text-[15px] text-primary">speed</span>
                  <span class="font-code-xs text-[11px] text-on-surface truncate">${ev.name}</span>
                </label>
              `).join('')}
            </div>
          `}
        </div>
        <div class="flex flex-col gap-1">
          <label class="font-label-sm text-on-surface font-medium text-[12px]">Downstream VAVs / Rooms Served</label>
          ${vavs.length === 0 ? `<div class="p-1.5 rounded bg-surface-canvas border border-dashed border-border-subtle font-code-xs text-[11px] text-secondary italic">No VAVs configured in rooms yet.</div>` : `
            <div class="max-h-36 overflow-y-auto p-1.5 border border-border-strong rounded bg-surface-canvas flex flex-col gap-1">
              ${vavs.map(v => {
                const room = rooms.find(r => r.id === v.room_id);
                return `
                  <label class="flex items-center gap-2 p-1 rounded hover:bg-surface-subtle cursor-pointer transition-colors">
                    <input type="checkbox" id="plant-create-conn-vav-${v.id}" value="${v.id}" class="accent-primary w-4 h-4 rounded cursor-pointer" />
                    <span class="material-symbols-outlined text-[15px] text-primary">hvac</span>
                    <span class="font-code-xs text-[11px] text-on-surface truncate">${v.name} • [${room ? room.name : 'Unassigned'}]</span>
                  </label>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  // Populate custom target select
  if (targetSelect) {
    const allEq = (state.topology?.shared_equipment || []).concat(state.topology?.room_equipment || []);
    targetSelect.innerHTML = `
      <option value="">-- None / Select Target --</option>
      <optgroup label="Plant Units">
        ${(state.topology?.shared_equipment || []).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Room Devices">
        ${(state.topology?.room_equipment || []).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Rooms">
        ${rooms.map(r => `<option value="${r.id}|ROOM">${r.name}</option>`).join('')}
      </optgroup>
    `;
  }
}

async function submitAddPlant(e) {
  e.preventDefault();
  const typeSelect = document.getElementById('modal-plant-type');
  const nameInput = document.getElementById('modal-plant-name');
  const descInput = document.getElementById('modal-plant-desc');
  const csvInput = document.getElementById('modal-plant-csv');

  const nameVal = nameInput ? nameInput.value.trim() : '';
  let csvVal = csvInput ? csvInput.value.trim() : '';

  if (!nameVal) {
    showToast('Please enter an Equipment Name', true);
    if (nameInput) nameInput.focus();
    return;
  }
  if (!csvVal) {
    showToast('Please enter an Excel/CSV filename (e.g. AHU_02.csv)', true);
    if (csvInput) csvInput.focus();
    return;
  }
  if (!csvVal.toLowerCase().endsWith('.csv') && !csvVal.toLowerCase().endsWith('.xlsx') && !csvVal.toLowerCase().endsWith('.xls')) {
    csvVal += '.csv';
  }

  const bldgId = state.topology && state.topology.building ? state.topology.building.id : null;
  const eqType = typeSelect.value;

  const payload = {
    equipment_type: eqType,
    name: nameVal,
    description: descInput ? descInput.value.trim() : '',
    csv_filename: csvVal,
    building_id: bldgId
  };

  try {
    const res = await fetch('/api/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to create plant unit');
    }

    const created = await res.json();

    // Now establish any selected initial connections
    if (eqType === 'CHILLER') {
      const evs = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'EV');
      for (const ev of evs) {
        const chk = document.getElementById(`plant-create-conn-ev-${ev.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: created.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'SUPPLIES',
              target_id: ev.id,
              target_type: 'EQUIPMENT',
              description: `${created.name} supplies chilled water to ${ev.name}`
            })
          });
        }
      }
    } else if (eqType === 'EV') {
      const chillerSel = document.getElementById('plant-create-conn-chiller');
      if (chillerSel && chillerSel.value) {
        const ch = (state.topology?.shared_equipment || []).find(e => e.id === chillerSel.value);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: chillerSel.value,
            source_type: 'EQUIPMENT',
            relationship_type: 'SUPPLIES',
            target_id: created.id,
            target_type: 'EQUIPMENT',
            description: `${ch ? ch.name : chillerSel.value} supplies chilled water to ${created.name}`
          })
        });
      }
      const ahus = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'AHU');
      for (const ahu of ahus) {
        const chk = document.getElementById(`plant-create-conn-ahu-${ahu.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: created.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'CONNECTED_TO',
              target_id: ahu.id,
              target_type: 'EQUIPMENT',
              description: `${created.name} meters hydronic loop to ${ahu.name} cooling coil`
            })
          });
        }
      }
    } else if (eqType === 'AHU') {
      const evs = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'EV');
      for (const ev of evs) {
        const chk = document.getElementById(`plant-create-conn-ev-${ev.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: ev.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'CONNECTED_TO',
              target_id: created.id,
              target_type: 'EQUIPMENT',
              description: `${ev.name} meters hydronic loop to ${created.name} cooling coil`
            })
          });
        }
      }
      const vavs = state.topology?.room_equipment || [];
      for (const v of vavs) {
        const chk = document.getElementById(`plant-create-conn-vav-${v.id}`);
        if (chk && chk.checked) {
          await fetch('/api/relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source_id: created.id,
              source_type: 'EQUIPMENT',
              relationship_type: 'SUPPLIES',
              target_id: v.id,
              target_type: 'EQUIPMENT',
              description: `${created.name} supplies conditioned air to ${v.name}`
            })
          });
          if (v.room_id) {
            await fetch('/api/relationships', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_id: created.id,
                source_type: 'EQUIPMENT',
                relationship_type: 'SERVES',
                target_id: v.room_id,
                target_type: 'ROOM',
                description: `${created.name} duct serves room`
              })
            });
          }
        }
      }
    }

    // Custom Connection
    const customTarget = document.getElementById('modal-plant-custom-target');
    const customRel = document.getElementById('modal-plant-custom-rel');
    if (customTarget && customTarget.value) {
      const [tId, tType] = customTarget.value.split('|');
      const rType = customRel ? customRel.value : 'CONNECTED_TO';
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: created.id,
          source_type: 'EQUIPMENT',
          relationship_type: rType,
          target_id: tId,
          target_type: tType,
          description: `${created.name} ${rType} target`
        })
      });
    }

    closeAddPlantModal();
    if (nameInput) nameInput.value = '';
    if (descInput) descInput.value = '';
    if (csvInput) csvInput.value = '';

    await loadTopology();
    showToast(`Plant Unit "${created.name}" created.`);
    selectEntity('equipment', created.id);
  } catch (err) {
    showToast(err.message || 'Error adding plant unit', true);
  }
}

// -------------------------------------------------------------
// RULE-GOVERNED & CUSTOM HVAC CONNECTION CONFIGURATION MODALS
// -------------------------------------------------------------

function openConfigureEntityDirectly(id) {
  const allEq = (state.topology?.room_equipment || []).concat(state.topology?.shared_equipment || []);
  const eq = allEq.find(e => e.id === id);
  if (!eq) return;

  if (eq.equipment_type === 'CHILLER') {
    openConfigureChiller(eq.id, eq.name);
  } else if (eq.equipment_type === 'EV') {
    openConfigureEV(eq.id, eq.name);
  } else if (eq.equipment_type === 'AHU') {
    openConfigureAHU(eq.id, eq.name);
  } else if (eq.equipment_type === 'VAV') {
    openConfigureVAV(eq.id, eq.name, eq.room_id);
  } else if (eq.equipment_type === 'RAQS') {
    openConfigureRAQS(eq.id, eq.name, eq.room_id);
  }
}

function openConfigurePlantConnections(id, name, type) {
  if (!type && state.topology?.shared_equipment) {
    const found = state.topology.shared_equipment.find(e => e.id === id);
    if (found) type = found.equipment_type;
  }

  if (type === 'CHILLER') {
    openConfigureChiller(id, name);
  } else if (type === 'EV') {
    openConfigureEV(id, name);
  } else if (type === 'AHU') {
    openConfigureAHU(id, name);
  } else {
    showToast(`Configure connections for ${name}`);
  }
}

function openConfigureCurrentEntityConnections() {
  if (!state.selectedEntity || state.selectedType !== 'equipment') {
    showToast('Select an equipment device to configure its connections', true);
    return;
  }
  const eq = state.selectedEntity;
  openConfigureEntityDirectly(eq.id);
}

// Helper for custom connection management inside connection modals
function renderCustomConnectionsSection(modalKey, entityId) {
  const listContainer = document.getElementById(`modal-${modalKey}-custom-list`);
  const targetSelect = document.getElementById(`modal-${modalKey}-custom-target`);
  if (!listContainer) return;

  const allEq = (state.topology?.shared_equipment || []).concat(state.topology?.room_equipment || []);
  const allRooms = state.topology?.rooms || [];

  function getEntityLabel(id) {
    const eq = allEq.find(e => e.id === id);
    if (eq) return `${eq.name} [${eq.equipment_type}]`;
    const rm = allRooms.find(r => r.id === id);
    if (rm) return `${rm.name} [Room]`;
    return id;
  }

  const rels = (state.topology?.relationships || []).filter(r => r.source_id === entityId || r.target_id === entityId);

  if (rels.length === 0) {
    listContainer.innerHTML = `<span class="text-secondary font-code-xs text-[10px] italic">No active connections.</span>`;
  } else {
    listContainer.innerHTML = rels.map(r => {
      const isSource = r.source_id === entityId;
      const otherId = isSource ? r.target_id : r.source_id;
      const otherLabel = getEntityLabel(otherId);
      const dirText = isSource ? `→ ${otherLabel}` : `← ${otherLabel}`;
      return `
        <div class="flex items-center justify-between px-2 py-1 rounded bg-surface-canvas border border-border-subtle font-code-xs text-[11px]">
          <div class="flex items-center gap-1.5 truncate">
            <span class="font-semibold text-primary px-1 py-0.2 rounded bg-primary/10 text-[9px]">${r.relationship_type}</span>
            <span class="text-on-surface truncate">${dirText}</span>
          </div>
          <button type="button" onclick="deleteCustomModalConnection('${r.id}', '${modalKey}', '${entityId}')" class="text-secondary hover:text-error transition-colors ml-2" title="Delete connection">
            <span class="material-symbols-outlined text-[13px]">close</span>
          </button>
        </div>
      `;
    }).join('');
  }

  if (targetSelect) {
    targetSelect.innerHTML = `
      <option value="">Select Target...</option>
      <optgroup label="Plant Units">
        ${(state.topology?.shared_equipment || []).filter(e => e.id !== entityId).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Room Devices">
        ${(state.topology?.room_equipment || []).filter(e => e.id !== entityId).map(e => `<option value="${e.id}|EQUIPMENT">${e.name} [${e.equipment_type}]</option>`).join('')}
      </optgroup>
      <optgroup label="Rooms">
        ${allRooms.filter(r => r.id !== entityId).map(r => `<option value="${r.id}|ROOM">${r.name}</option>`).join('')}
      </optgroup>
    `;
  }
}

async function addCustomModalConnection(modalKey) {
  const idInput = document.getElementById(`modal-${modalKey}-id`);
  const targetSelect = document.getElementById(`modal-${modalKey}-custom-target`);
  const relSelect = document.getElementById(`modal-${modalKey}-custom-rel`);
  if (!idInput || !targetSelect || !targetSelect.value) {
    showToast('Please select a target entity', true);
    return;
  }

  const sourceId = idInput.value;
  const [targetId, targetType] = targetSelect.value.split('|');
  const relType = relSelect ? relSelect.value : 'CONNECTED_TO';

  try {
    const res = await fetch('/api/relationships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_id: sourceId,
        source_type: 'EQUIPMENT',
        relationship_type: relType,
        target_id: targetId,
        target_type: targetType,
        description: `Custom ${relType} link`
      })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to add connection');
    }
    showToast('Custom connection added');
    await loadTopology();
    renderCustomConnectionsSection(modalKey, sourceId);
    if (state.selectedEntity && state.selectedEntity.id === sourceId) {
      selectEntity(state.selectedType, sourceId);
    }
  } catch (err) {
    showToast(err.message || 'Error adding custom connection', true);
  }
}

async function deleteCustomModalConnection(relId, modalKey, entityId) {
  try {
    const res = await fetch(`/api/relationships/${relId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete relationship');
    showToast('Connection removed');
    await loadTopology();
    renderCustomConnectionsSection(modalKey, entityId);
    if (modalKey === 'chiller') {
      const ch = (state.topology?.shared_equipment || []).find(e => e.id === entityId);
      if (ch) openConfigureChiller(ch.id, ch.name);
    } else if (modalKey === 'ev') {
      const ev = (state.topology?.shared_equipment || []).find(e => e.id === entityId);
      if (ev) openConfigureEV(ev.id, ev.name);
    } else if (modalKey === 'ahu') {
      const ahu = (state.topology?.shared_equipment || []).find(e => e.id === entityId);
      if (ahu) openConfigureAHU(ahu.id, ahu.name);
    } else if (modalKey === 'vav') {
      const v = (state.topology?.room_equipment || []).find(e => e.id === entityId);
      if (v) openConfigureVAV(v.id, v.name, v.room_id);
    } else if (modalKey === 'raqs') {
      const rq = (state.topology?.room_equipment || []).find(e => e.id === entityId);
      if (rq) openConfigureRAQS(rq.id, rq.name, rq.room_id);
    }
    if (state.selectedEntity && state.selectedEntity.id === entityId) {
      selectEntity(state.selectedType, entityId);
    }
  } catch (err) {
    showToast(err.message || 'Error removing connection', true);
  }
}

// 1. Chiller Modal (Chiller -> EVs)
function openConfigureChiller(id, name) {
  const modal = document.getElementById('modal-configure-chiller');
  const idInput = document.getElementById('modal-chiller-id');
  const nameLabel = document.getElementById('modal-chiller-name');
  const container = document.getElementById('modal-chiller-evs-container');
  const notice = document.getElementById('modal-chiller-notice');

  if (idInput) idInput.value = id;
  if (nameLabel) nameLabel.innerText = name;

  const evList = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'EV');
  const currentRels = (state.topology?.relationships || []).filter(r => r.source_id === id && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
  const connectedEvIds = new Set(currentRels.map(r => r.target_id));

  if (container) {
    if (evList.length === 0) {
      container.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No Energy Valves (EVs) available yet. Add an EV or configure a custom connection below.</span>';
      if (notice) notice.innerHTML = '<span class="text-status-warning font-semibold">⚠️ No EVs exist. Add an Energy Valve or add a custom connection below.</span>';
    } else {
      container.innerHTML = evList.map(ev => {
        const isChecked = connectedEvIds.has(ev.id);
        return `
          <label class="flex items-center gap-2 p-2 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="chiller-ev" value="${ev.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[16px] text-primary">speed</span>
            <div class="flex flex-col min-w-0">
              <span class="font-label-sm text-on-surface text-[12px] font-medium">${ev.name}</span>
              <span class="font-code-xs text-[10px] text-secondary">${ev.id}</span>
            </div>
          </label>
        `;
      }).join('');
      if (notice) notice.innerText = 'Chiller supplies chilled water to the checked EV(s).';
    }
  }

  renderCustomConnectionsSection('chiller', id);
  if (modal) modal.classList.remove('hidden');
}

function closeConfigureChiller() {
  const modal = document.getElementById('modal-configure-chiller');
  if (modal) modal.classList.add('hidden');
}

async function submitConfigureChiller(e) {
  e.preventDefault();
  const chillerId = document.getElementById('modal-chiller-id').value;
  const checkboxes = document.querySelectorAll('input[name="chiller-ev"]:checked');
  const selectedEvIds = Array.from(checkboxes).map(cb => cb.value);

  const chiller = (state.topology?.shared_equipment || []).find(e => e.id === chillerId);
  const chillerName = chiller ? chiller.name : chillerId;

  try {
    // 1. Delete removed relationships
    const existingRels = (state.topology?.relationships || []).filter(r => r.source_id === chillerId && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
    for (const r of existingRels) {
      if (!selectedEvIds.includes(r.target_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }

    // 2. Create newly selected relationships
    const existingTargetIds = existingRels.map(r => r.target_id);
    for (const evId of selectedEvIds) {
      if (!existingTargetIds.includes(evId)) {
        const ev = (state.topology?.shared_equipment || []).find(e => e.id === evId);
        const evName = ev ? ev.name : evId;
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: chillerId,
            source_type: 'EQUIPMENT',
            relationship_type: 'SUPPLIES',
            target_id: evId,
            target_type: 'EQUIPMENT',
            description: `${chillerName} supplies chilled water to ${evName}`
          })
        });
      }
    }

    closeConfigureChiller();
    showToast(`Connections saved for ${chillerName}`);
    await loadTopology();
    if (state.selectedEntity && state.selectedEntity.id === chillerId) {
      selectEntity('equipment', chillerId);
    }
  } catch (err) {
    showToast(err.message || 'Error saving Chiller connections', true);
  }
}

// 2. EV Modal (Chiller -> EV -> AHUs)
function openConfigureEV(id, name) {
  const modal = document.getElementById('modal-configure-ev');
  const idInput = document.getElementById('modal-ev-id');
  const nameLabel = document.getElementById('modal-ev-name');
  const chillerSelect = document.getElementById('modal-ev-chiller');
  const ahusContainer = document.getElementById('modal-ev-ahus-container');
  const notice = document.getElementById('modal-ev-notice');

  if (idInput) idInput.value = id;
  if (nameLabel) nameLabel.innerText = name;

  const chillers = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'CHILLER');
  const ahus = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'AHU');

  const incomingChillerRel = (state.topology?.relationships || []).find(r => r.target_id === id && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
  const outgoingAhuRels = (state.topology?.relationships || []).filter(r => r.source_id === id && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES'));
  const connectedAhuIds = new Set(outgoingAhuRels.map(r => r.target_id));

  if (chillerSelect) {
    chillerSelect.innerHTML = `
      <option value="">-- Select Upstream Chiller --</option>
      ${chillers.map(c => `
        <option value="${c.id}" ${incomingChillerRel && incomingChillerRel.source_id === c.id ? 'selected' : ''}>${c.name} (${c.id})</option>
      `).join('')}
    `;
  }

  if (ahusContainer) {
    if (ahus.length === 0) {
      ahusContainer.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No AHUs available yet. Create an AHU or add a custom connection below.</span>';
      if (notice) notice.innerHTML = '<span class="text-status-warning font-semibold">⚠️ No AHUs exist yet. Create an AHU to complete the circuit.</span>';
    } else {
      ahusContainer.innerHTML = ahus.map(a => {
        const isChecked = connectedAhuIds.has(a.id);
        return `
          <label class="flex items-center gap-2 p-2 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="ev-ahu" value="${a.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[16px] text-primary">mode_fan</span>
            <div class="flex flex-col min-w-0">
              <span class="font-label-sm text-on-surface text-[12px] font-medium">${a.name}</span>
              <span class="font-code-xs text-[10px] text-secondary">${a.id}</span>
            </div>
          </label>
        `;
      }).join('');
      if (notice) notice.innerText = 'EV receives chilled water from Chiller and meters flow to AHU(s).';
    }
  }

  renderCustomConnectionsSection('ev', id);
  if (modal) modal.classList.remove('hidden');
}

function closeConfigureEV() {
  const modal = document.getElementById('modal-configure-ev');
  if (modal) modal.classList.add('hidden');
}

async function submitConfigureEV(e) {
  e.preventDefault();
  const evId = document.getElementById('modal-ev-id').value;
  const chillerSelect = document.getElementById('modal-ev-chiller');
  const selectedChillerId = chillerSelect ? chillerSelect.value : '';

  const checkboxes = document.querySelectorAll('input[name="ev-ahu"]:checked');
  const selectedAhuIds = Array.from(checkboxes).map(cb => cb.value);

  const ev = (state.topology?.shared_equipment || []).find(e => e.id === evId);
  const evName = ev ? ev.name : evId;

  try {
    // 1. Upstream Chiller -> EV
    const existingChillerRels = (state.topology?.relationships || []).filter(r => r.target_id === evId && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
    for (const r of existingChillerRels) {
      if (r.source_id !== selectedChillerId) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    if (selectedChillerId && !existingChillerRels.some(r => r.source_id === selectedChillerId)) {
      const ch = (state.topology?.shared_equipment || []).find(e => e.id === selectedChillerId);
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: selectedChillerId,
          source_type: 'EQUIPMENT',
          relationship_type: 'SUPPLIES',
          target_id: evId,
          target_type: 'EQUIPMENT',
          description: `${ch ? ch.name : selectedChillerId} supplies chilled water to ${evName}`
        })
      });
    }

    // 2. Downstream EV -> AHUs
    const existingAhuRels = (state.topology?.relationships || []).filter(r => r.source_id === evId && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES'));
    for (const r of existingAhuRels) {
      if (!selectedAhuIds.includes(r.target_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    const existingTargetAhuIds = existingAhuRels.map(r => r.target_id);
    for (const ahuId of selectedAhuIds) {
      if (!existingTargetAhuIds.includes(ahuId)) {
        const ahu = (state.topology?.shared_equipment || []).find(e => e.id === ahuId);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: evId,
            source_type: 'EQUIPMENT',
            relationship_type: 'CONNECTED_TO',
            target_id: ahuId,
            target_type: 'EQUIPMENT',
            description: `${evName} meters hydronic loop to ${ahu ? ahu.name : ahuId} cooling coil`
          })
        });
      }
    }

    closeConfigureEV();
    showToast(`Connections saved for ${evName}`);
    await loadTopology();
    if (state.selectedEntity && state.selectedEntity.id === evId) {
      selectEntity('equipment', evId);
    }
  } catch (err) {
    showToast(err.message || 'Error saving EV connections', true);
  }
}

// 3. AHU Modal (EVs -> AHU -> VAVs across floors/rooms)
function openConfigureAHU(id, name) {
  const modal = document.getElementById('modal-configure-ahu');
  const idInput = document.getElementById('modal-ahu-id');
  const nameLabel = document.getElementById('modal-ahu-name');
  const evsContainer = document.getElementById('modal-ahu-evs-container');
  const vavsContainer = document.getElementById('modal-ahu-vavs-container');
  const notice = document.getElementById('modal-ahu-notice');

  if (idInput) idInput.value = id;
  if (nameLabel) nameLabel.innerText = name;

  const evs = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'EV');
  const vavs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'VAV');
  const rooms = state.topology?.rooms || [];
  const floors = state.topology?.floors || [];

  const incomingEvRels = (state.topology?.relationships || []).filter(r => r.target_id === id && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES'));
  const connectedEvIds = new Set(incomingEvRels.map(r => r.source_id));

  const outgoingVavRels = (state.topology?.relationships || []).filter(r => r.source_id === id && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
  const connectedVavIds = new Set(outgoingVavRels.map(r => r.target_id));

  if (evsContainer) {
    if (evs.length === 0) {
      evsContainer.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No Energy Valves (EVs) available yet.</span>';
    } else {
      evsContainer.innerHTML = evs.map(ev => {
        const isChecked = connectedEvIds.has(ev.id);
        return `
          <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="ahu-ev" value="${ev.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[15px] text-primary">speed</span>
            <span class="font-label-sm text-on-surface text-[12px] truncate">${ev.name} (${ev.id})</span>
          </label>
        `;
      }).join('');
    }
  }

  if (vavsContainer) {
    if (vavs.length === 0) {
      vavsContainer.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No VAVs configured in rooms yet. Add VAVs in rooms to serve them.</span>';
      if (notice) notice.innerHTML = '<span class="text-status-warning font-semibold">⚠️ No VAV actuators exist yet. Add VAVs in rooms or add custom connections below.</span>';
    } else {
      vavsContainer.innerHTML = vavs.map(v => {
        const isChecked = connectedVavIds.has(v.id);
        const room = rooms.find(r => r.id === v.room_id);
        const floor = room ? floors.find(f => f.id === room.floor_id) : null;
        const locationInfo = room ? `${room.name} (${floor ? floor.name : 'Level ?'})` : 'Unassigned';
        return `
          <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="ahu-vav" value="${v.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[15px] text-primary">hvac</span>
            <div class="flex flex-col min-w-0">
              <span class="font-label-sm text-on-surface text-[12px] font-medium">${v.name}</span>
              <span class="font-code-xs text-[10px] text-secondary">${locationInfo}</span>
            </div>
          </label>
        `;
      }).join('');
      if (notice) notice.innerText = 'AHU can serve multiple VAVs across any floor or room.';
    }
  }

  renderCustomConnectionsSection('ahu', id);
  if (modal) modal.classList.remove('hidden');
}

function closeConfigureAHU() {
  const modal = document.getElementById('modal-configure-ahu');
  if (modal) modal.classList.add('hidden');
}

async function submitConfigureAHU(e) {
  e.preventDefault();
  const ahuId = document.getElementById('modal-ahu-id').value;
  const evCheckboxes = document.querySelectorAll('input[name="ahu-ev"]:checked');
  const selectedEvIds = Array.from(evCheckboxes).map(cb => cb.value);

  const vavCheckboxes = document.querySelectorAll('input[name="ahu-vav"]:checked');
  const selectedVavIds = Array.from(vavCheckboxes).map(cb => cb.value);

  const ahu = (state.topology?.shared_equipment || []).find(e => e.id === ahuId);
  const ahuName = ahu ? ahu.name : ahuId;
  const vavs = state.topology?.room_equipment || [];

  try {
    // 1. Upstream EVs -> AHU
    const existingEvRels = (state.topology?.relationships || []).filter(r => r.target_id === ahuId && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES'));
    for (const r of existingEvRels) {
      if (!selectedEvIds.includes(r.source_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    const existingSourceEvIds = existingEvRels.map(r => r.source_id);
    for (const evId of selectedEvIds) {
      if (!existingSourceEvIds.includes(evId)) {
        const ev = (state.topology?.shared_equipment || []).find(e => e.id === evId);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: evId,
            source_type: 'EQUIPMENT',
            relationship_type: 'CONNECTED_TO',
            target_id: ahuId,
            target_type: 'EQUIPMENT',
            description: `${ev ? ev.name : evId} meters hydronic loop to ${ahuName} cooling coil`
          })
        });
      }
    }

    // 2. Downstream AHU -> VAVs
    const existingVavRels = (state.topology?.relationships || []).filter(r => r.source_id === ahuId && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
    for (const r of existingVavRels) {
      if (!selectedVavIds.includes(r.target_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
        // Also clean up SERVES relationship if no other VAV in that room is served by this AHU
        const removedVav = vavs.find(v => v.id === r.target_id);
        if (removedVav && removedVav.room_id) {
          const roomVavsLeft = selectedVavIds.map(vid => vavs.find(v => v.id === vid)).filter(v => v && v.room_id === removedVav.room_id);
          if (roomVavsLeft.length === 0) {
            const servesRel = (state.topology?.relationships || []).find(rel => rel.source_id === ahuId && rel.target_id === removedVav.room_id && rel.relationship_type === 'SERVES');
            if (servesRel) {
              await fetch(`/api/relationships/${servesRel.id}`, { method: 'DELETE' });
            }
          }
        }
      }
    }
    const existingTargetVavIds = existingVavRels.map(r => r.target_id);
    for (const vavId of selectedVavIds) {
      if (!existingTargetVavIds.includes(vavId)) {
        const vav = vavs.find(v => v.id === vavId);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: ahuId,
            source_type: 'EQUIPMENT',
            relationship_type: 'SUPPLIES',
            target_id: vavId,
            target_type: 'EQUIPMENT',
            description: `${ahuName} supplies conditioned air to ${vav ? vav.name : vavId}`
          })
        });

        // Also add AHU SERVES Room relationship if room exists
        if (vav && vav.room_id) {
          const servesExists = (state.topology?.relationships || []).some(r => r.source_id === ahuId && r.target_id === vav.room_id && r.relationship_type === 'SERVES');
          if (!servesExists) {
            await fetch('/api/relationships', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                source_id: ahuId,
                source_type: 'EQUIPMENT',
                relationship_type: 'SERVES',
                target_id: vav.room_id,
                target_type: 'ROOM',
                description: `${ahuName} duct serves room`
              })
            });
          }
        }
      }
    }

    closeConfigureAHU();
    showToast(`Connections saved for ${ahuName}`);
    await loadTopology();
    if (state.selectedEntity && state.selectedEntity.id === ahuId) {
      selectEntity('equipment', ahuId);
    }
  } catch (err) {
    showToast(err.message || 'Error saving AHU connections', true);
  }
}

// 4. VAV Modal (AHU -> VAV & RAQS in same room)
function openConfigureVAV(id, name, roomId) {
  const modal = document.getElementById('modal-configure-vav');
  const idInput = document.getElementById('modal-vav-id');
  const nameLabel = document.getElementById('modal-vav-name');
  const roomBadge = document.getElementById('modal-vav-room-badge');
  const ahuSelect = document.getElementById('modal-vav-ahu');
  const raqsContainer = document.getElementById('modal-vav-raqs-container');
  const notice = document.getElementById('modal-vav-notice');

  if (idInput) idInput.value = id;
  if (nameLabel) nameLabel.innerText = name;

  const room = (state.topology?.rooms || []).find(r => r.id === roomId);
  if (roomBadge) {
    roomBadge.innerText = room ? `ROOM: ${room.name}` : 'ROOM LEVEL';
  }

  const ahus = (state.topology?.shared_equipment || []).filter(e => e.equipment_type === 'AHU');
  const sameRoomRaqs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'RAQS' && e.room_id === roomId);

  const incomingAhuRel = (state.topology?.relationships || []).find(r => r.target_id === id && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
  const incomingRaqsRels = (state.topology?.relationships || []).filter(r => r.target_id === id && (r.relationship_type === 'MEASURES' || r.relationship_type === 'CONTROLS'));
  const connectedRaqsIds = new Set(incomingRaqsRels.map(r => r.source_id));

  if (ahuSelect) {
    ahuSelect.innerHTML = `
      <option value="">-- Select Upstream AHU --</option>
      ${ahus.map(a => `
        <option value="${a.id}" ${incomingAhuRel && incomingAhuRel.source_id === a.id ? 'selected' : ''}>${a.name} (${a.id})</option>
      `).join('')}
    `;
  }

  if (raqsContainer) {
    if (sameRoomRaqs.length === 0) {
      raqsContainer.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No RAQS in this room yet.</span>';
      if (notice) notice.innerHTML = '<span class="text-secondary font-code-xs text-[11px]">Note: RAQS association is strictly limited to sensors within the same room.</span>';
    } else {
      raqsContainer.innerHTML = sameRoomRaqs.map(rq => {
        const isChecked = connectedRaqsIds.has(rq.id);
        return `
          <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="vav-raqs" value="${rq.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[15px] text-primary">air</span>
            <span class="font-label-sm text-on-surface text-[12px] font-medium">${rq.name} (Same Room)</span>
          </label>
        `;
      }).join('');
      if (notice) notice.innerText = 'VAV receives air from AHU and receives telemetry from RAQS in the same room.';
    }
  }

  renderCustomConnectionsSection('vav', id);
  if (modal) modal.classList.remove('hidden');
}

function closeConfigureVAV() {
  const modal = document.getElementById('modal-configure-vav');
  if (modal) modal.classList.add('hidden');
}

async function submitConfigureVAV(e) {
  e.preventDefault();
  const vavId = document.getElementById('modal-vav-id').value;
  const ahuSelect = document.getElementById('modal-vav-ahu');
  const selectedAhuId = ahuSelect ? ahuSelect.value : '';

  const checkboxes = document.querySelectorAll('input[name="vav-raqs"]:checked');
  const selectedRaqsIds = Array.from(checkboxes).map(cb => cb.value);

  const vav = (state.topology?.room_equipment || []).find(e => e.id === vavId);
  const vavName = vav ? vav.name : vavId;

  try {
    // 1. Upstream AHU -> VAV
    const existingAhuRels = (state.topology?.relationships || []).filter(r => r.target_id === vavId && (r.relationship_type === 'SUPPLIES' || r.relationship_type === 'CONNECTED_TO'));
    for (const r of existingAhuRels) {
      if (r.source_id !== selectedAhuId) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    if (selectedAhuId && !existingAhuRels.some(r => r.source_id === selectedAhuId)) {
      const ahu = (state.topology?.shared_equipment || []).find(e => e.id === selectedAhuId);
      await fetch('/api/relationships', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: selectedAhuId,
          source_type: 'EQUIPMENT',
          relationship_type: 'SUPPLIES',
          target_id: vavId,
          target_type: 'EQUIPMENT',
          description: `${ahu ? ahu.name : selectedAhuId} supplies conditioned air to ${vavName}`
        })
      });
    }

    // 2. Associated RAQS -> VAV (Same room only)
    const existingRaqsRels = (state.topology?.relationships || []).filter(r => r.target_id === vavId && (r.relationship_type === 'MEASURES' || r.relationship_type === 'CONTROLS'));
    for (const r of existingRaqsRels) {
      if (!selectedRaqsIds.includes(r.source_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    const existingSourceRaqsIds = existingRaqsRels.map(r => r.source_id);
    for (const rqId of selectedRaqsIds) {
      if (!existingSourceRaqsIds.includes(rqId)) {
        const rq = (state.topology?.room_equipment || []).find(e => e.id === rqId);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: rqId,
            source_type: 'EQUIPMENT',
            relationship_type: 'MEASURES',
            target_id: vavId,
            target_type: 'EQUIPMENT',
            description: `${rq ? rq.name : rqId} provides telemetry for ${vavName}`
          })
        });
      }
    }

    closeConfigureVAV();
    showToast(`Connections saved for ${vavName}`);
    await loadTopology();
    if (state.selectedEntity && state.selectedEntity.id === vavId) {
      selectEntity('equipment', vavId);
    }
  } catch (err) {
    showToast(err.message || 'Error saving VAV connections', true);
  }
}

// 5. RAQS Modal (RAQS -> VAVs in same room)
function openConfigureRAQS(id, name, roomId) {
  const modal = document.getElementById('modal-configure-raqs');
  const idInput = document.getElementById('modal-raqs-id');
  const nameLabel = document.getElementById('modal-raqs-name');
  const roomBadge = document.getElementById('modal-raqs-room-badge');
  const vavsContainer = document.getElementById('modal-raqs-vavs-container');
  const notice = document.getElementById('modal-raqs-notice');

  if (idInput) idInput.value = id;
  if (nameLabel) nameLabel.innerText = name;

  const room = (state.topology?.rooms || []).find(r => r.id === roomId);
  if (roomBadge) {
    roomBadge.innerText = room ? `ROOM: ${room.name}` : 'ROOM LEVEL';
  }

  const sameRoomVavs = (state.topology?.room_equipment || []).filter(e => e.equipment_type === 'VAV' && e.room_id === roomId);
  const outgoingRels = (state.topology?.relationships || []).filter(r => r.source_id === id && (r.relationship_type === 'MEASURES' || r.relationship_type === 'CONTROLS'));
  const connectedVavIds = new Set(outgoingRels.map(r => r.target_id));

  if (vavsContainer) {
    if (sameRoomVavs.length === 0) {
      vavsContainer.innerHTML = '<span class="font-code-xs text-[11px] text-secondary italic p-2">No VAV in this room yet. Add a VAV in this room to associate.</span>';
      if (notice) notice.innerHTML = '<span class="text-status-warning font-semibold">⚠️ No VAVs in this room yet. Add a VAV in this room to associate.</span>';
    } else {
      vavsContainer.innerHTML = sameRoomVavs.map(v => {
        const isChecked = connectedVavIds.has(v.id);
        return `
          <label class="flex items-center gap-2 p-1.5 rounded hover:bg-surface-subtle cursor-pointer border ${isChecked ? 'border-primary/40 bg-primary/5' : 'border-transparent'} transition-colors">
            <input type="checkbox" name="raqs-vav" value="${v.id}" ${isChecked ? 'checked' : ''} class="accent-primary w-4 h-4 rounded cursor-pointer" />
            <span class="material-symbols-outlined text-[15px] text-primary">hvac</span>
            <span class="font-label-sm text-on-surface text-[12px] font-medium">${v.name} (Same Room)</span>
          </label>
        `;
      }).join('');
      if (notice) notice.innerText = 'RAQS measurements are used by VAV control logic in the same room.';
    }
  }

  renderCustomConnectionsSection('raqs', id);
  if (modal) modal.classList.remove('hidden');
}

function closeConfigureRAQS() {
  const modal = document.getElementById('modal-configure-raqs');
  if (modal) modal.classList.add('hidden');
}

async function submitConfigureRAQS(e) {
  e.preventDefault();
  const raqsId = document.getElementById('modal-raqs-id').value;
  const checkboxes = document.querySelectorAll('input[name="raqs-vav"]:checked');
  const selectedVavIds = Array.from(checkboxes).map(cb => cb.value);

  const raqs = (state.topology?.room_equipment || []).find(e => e.id === raqsId);
  const raqsName = raqs ? raqs.name : raqsId;

  try {
    const existingRels = (state.topology?.relationships || []).filter(r => r.source_id === raqsId && (r.relationship_type === 'MEASURES' || r.relationship_type === 'CONTROLS'));
    for (const r of existingRels) {
      if (!selectedVavIds.includes(r.target_id)) {
        await fetch(`/api/relationships/${r.id}`, { method: 'DELETE' });
      }
    }
    const existingTargetIds = existingRels.map(r => r.target_id);
    for (const vavId of selectedVavIds) {
      if (!existingTargetIds.includes(vavId)) {
        const vav = (state.topology?.room_equipment || []).find(e => e.id === vavId);
        await fetch('/api/relationships', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_id: raqsId,
            source_type: 'EQUIPMENT',
            relationship_type: 'MEASURES',
            target_id: vavId,
            target_type: 'EQUIPMENT',
            description: `${raqsName} provides telemetry for ${vav ? vav.name : vavId}`
          })
        });
      }
    }

    closeConfigureRAQS();
    showToast(`Association saved for ${raqsName}`);
    await loadTopology();
    if (state.selectedEntity && state.selectedEntity.id === raqsId) {
      selectEntity('equipment', raqsId);
    }
  } catch (err) {
    showToast(err.message || 'Error saving RAQS association', true);
  }
}

// -------------------------------------------------------------
// Canvas Controls (Zoom & Switch Views)
// -------------------------------------------------------------
function zoomCanvas(delta) {
  const viewport = document.getElementById('canvas-viewport');
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  // Zoom towards the centre of the viewport
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const newZoom = Math.min(Math.max(state.currentZoom + delta, 0.15), 3.0);
  const ratio = newZoom / state.currentZoom;
  state.panX = cx - ratio * (cx - state.panX);
  state.panY = cy - ratio * (cy - state.panY);
  state.currentZoom = newZoom;
  applyCanvasTransform();
  updateCanvasSchematicArrows();
}

function resetZoom() {
  state.currentZoom = 1.0;
  state.panX = 40;
  state.panY = 40;
  applyCanvasTransform();
  updateCanvasSchematicArrows();
}

function fitCanvas() {
  const viewport = document.getElementById('canvas-viewport');
  const plant = document.getElementById('plant-boundary-box');
  const floors = Array.from(document.querySelectorAll('.floor-group-container'));
  if (!viewport || (!plant && floors.length === 0)) {
    state.currentZoom = 0.85;
    state.panX = 40;
    state.panY = 40;
    applyCanvasTransform();
    updateCanvasSchematicArrows();
    return;
  }

  const vRect = viewport.getBoundingClientRect();
  const workspace = document.getElementById('canvas-workspace');
  if (!workspace) return;
  const wRect = workspace.getBoundingClientRect();
  const scale = state.currentZoom || 1.0;

  const boxes = [plant, ...floors].filter(Boolean);
  const rects = boxes.map(b => {
    const r = b.getBoundingClientRect();
    return {
      left: (r.left - wRect.left) / scale,
      top: (r.top - wRect.top) / scale,
      right: (r.right - wRect.left) / scale,
      bottom: (r.bottom - wRect.top) / scale
    };
  });

  const minX = Math.min(...rects.map(r => r.left));
  const minY = Math.min(...rects.map(r => r.top));
  const maxX = Math.max(...rects.map(r => r.right));
  const maxY = Math.max(...rects.map(r => r.bottom));

  const contentW = Math.max(maxX - minX + 120, 600);
  const contentH = Math.max(maxY - minY + 120, 500);

  const zoomX = vRect.width / contentW;
  const zoomY = vRect.height / contentH;
  const fitZoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.2), 1.2);

  state.currentZoom = fitZoom;
  state.panX = Math.round((vRect.width - (maxX - minX) * fitZoom) / 2 - minX * fitZoom);
  state.panY = Math.round((vRect.height - (maxY - minY) * fitZoom) / 2 - minY * fitZoom);

  applyCanvasTransform();
  updateCanvasSchematicArrows();
}

function switchCanvasView(viewType) {
  state.activeTab = viewType;
  const tabLayout = document.getElementById('tab-layout');
  const tabGraph = document.getElementById('tab-graph');

  if (tabLayout && tabGraph) {
    [tabLayout, tabGraph].forEach(tab => {
      tab.classList.remove('border-primary', 'text-primary', 'font-semibold');
      tab.classList.add('border-transparent', 'text-secondary');
    });

    if (viewType === 'graph') {
      tabGraph.classList.add('border-primary', 'text-primary', 'font-semibold');
      tabGraph.classList.remove('border-transparent', 'text-secondary');
      showToast('Graph view preview (Full graph generated in Stage 6)');
    } else {
      tabLayout.classList.add('border-primary', 'text-primary', 'font-semibold');
      tabLayout.classList.remove('border-transparent', 'text-secondary');
    }
  }
}

function toggleRoom(roomId) {
  if (!state.expandedRooms) state.expandedRooms = new Set();
  const content = document.getElementById('content-' + roomId);
  const caret = document.getElementById('caret-' + roomId);
  if (!content || !caret) return;
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    caret.classList.add('rotate-90');
    state.expandedRooms.add(roomId);
  } else {
    content.classList.add('hidden');
    caret.classList.remove('rotate-90');
    state.expandedRooms.delete(roomId);
  }
}

// -------------------------------------------------------------
// Collapsible Sidebars (Main Navigation and System Components)
// -------------------------------------------------------------
function initCollapsibleSidebars() {
  try {
    const mainNavCollapsed = localStorage.getItem('collia_main_nav_collapsed') === 'true';
    if (mainNavCollapsed) {
      applyMainNavCollapsed(true, false);
    }
    const systemComponentsCollapsed = localStorage.getItem('collia_system_components_collapsed') === 'true';
    if (systemComponentsCollapsed) {
      applySystemComponentsCollapsed(true, false);
    }
  } catch (err) {
    console.warn('Error reading sidebar collapse states:', err);
  }
}

function toggleMainNavSidebar() {
  const sidebar = document.getElementById('main-nav-sidebar');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.contains('w-16');
  applyMainNavCollapsed(!isCollapsed, true);
}

function applyMainNavCollapsed(collapsed, save) {
  const sidebar = document.getElementById('main-nav-sidebar');
  const mainContent = document.getElementById('main-content-layout');
  const header = document.getElementById('main-header');
  const icon = document.getElementById('btn-toggle-main-nav-icon');
  const brand = document.getElementById('main-nav-brand');
  const navTexts = document.querySelectorAll('#main-nav-sidebar .nav-text');

  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.remove('w-64');
    sidebar.classList.add('w-16');
    if (mainContent) {
      mainContent.classList.remove('pl-64');
      mainContent.classList.add('pl-16');
    }
    if (header) {
      header.classList.remove('left-64');
      header.classList.add('left-16');
    }
    if (icon) icon.innerText = 'chevron_right';
    if (brand) brand.classList.add('hidden');
    navTexts.forEach(el => el.classList.add('hidden'));
  } else {
    sidebar.classList.remove('w-16');
    sidebar.classList.add('w-64');
    if (mainContent) {
      mainContent.classList.remove('pl-16');
      mainContent.classList.add('pl-64');
    }
    if (header) {
      header.classList.remove('left-16');
      header.classList.add('left-64');
    }
    if (icon) icon.innerText = 'chevron_left';
    if (brand) brand.classList.remove('hidden');
    navTexts.forEach(el => el.classList.remove('hidden'));
  }

  if (save) {
    try {
      localStorage.setItem('collia_main_nav_collapsed', collapsed ? 'true' : 'false');
    } catch (e) {}
  }

  setTimeout(() => {
    updateCanvasSchematicArrows();
  }, 320);
}

function toggleSystemComponentsSidebar() {
  const sidebar = document.getElementById('system-components-sidebar');
  if (!sidebar) return;
  const isCollapsed = sidebar.classList.contains('w-0') || sidebar.style.width === '0px';
  applySystemComponentsCollapsed(!isCollapsed, true);
}

function applySystemComponentsCollapsed(collapsed, save) {
  const sidebar = document.getElementById('system-components-sidebar');
  const icon = document.getElementById('btn-toggle-system-icon');
  const toggleBtn = document.getElementById('btn-toggle-system-components');
  const content = document.getElementById('sidebar-scrollable-container');
  const footerLabel = document.getElementById('sidebar-footer-label');

  if (!sidebar) return;

  if (collapsed) {
    sidebar.classList.remove('w-[310px]');
    sidebar.classList.add('w-0', 'border-r-0', 'overflow-hidden');
    if (content) content.classList.add('hidden');
    if (footerLabel) footerLabel.classList.add('hidden');
    if (icon) icon.innerText = 'chevron_right';
    if (toggleBtn) {
      toggleBtn.classList.remove('left-[298px]');
      toggleBtn.classList.add('left-2');
      toggleBtn.title = 'Expand System Components Panel';
    }
  } else {
    sidebar.classList.remove('w-0', 'border-r-0', 'overflow-hidden');
    sidebar.classList.add('w-[310px]');
    if (content) content.classList.remove('hidden');
    if (footerLabel) footerLabel.classList.remove('hidden');
    if (icon) icon.innerText = 'chevron_left';
    if (toggleBtn) {
      toggleBtn.classList.remove('left-2');
      toggleBtn.classList.add('left-[298px]');
      toggleBtn.title = 'Collapse System Components Panel';
    }
  }

  if (save) {
    try {
      localStorage.setItem('collia_system_components_collapsed', collapsed ? 'true' : 'false');
    } catch (e) {}
  }

  setTimeout(() => {
    updateCanvasSchematicArrows();
  }, 320);
}

// -------------------------------------------------------------
// CSV Folder Integration & Processing Functions
// -------------------------------------------------------------
async function openCsvDirectory() {
  try {
    const resp = await fetch('/api/csv/open-directory', { method: 'POST' });
    const data = await resp.json();
    if (data.opened) {
      showToast('Opened data/csv/ directory in File Explorer');
    } else {
      showToast('Source CSV folder: ' + (data.csv_dir || 'data/csv/'));
    }
  } catch (err) {
    console.error('Failed to open CSV directory:', err);
    showToast('Source CSV folder: data/csv/');
  }
}

// Fallback / legacy alias
function copyFolderPath() {
  openCsvDirectory();
}

function renderTopology() {
  renderSidebar();
  renderCanvas();
  if (state.selectedEntity) {
    refreshSelectedEntity();
  }
}

async function fetchCsvStatus() {
  try {
    const resp = await fetch('/api/csv/status');
    if (resp.ok) {
      const data = await resp.json();
      state.csvStatuses = data.equipment_statuses || {};
      renderTopology();
    }
  } catch (err) {
    console.warn('Could not fetch CSV status:', err);
  }
}

async function processCsvData() {
  const btn = document.getElementById('btn-process-data');
  if (!btn) return;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">sync</span><span>Scanning & Processing...</span>`;
  btn.classList.add('opacity-75');

  try {
    const resp = await fetch('/api/csv/process', { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
    const data = await resp.json();

    state.csvStatuses = data.equipment_statuses || {};
    // Re-render UI to apply dots
    renderTopology();

    if (data.missing_count > 0) {
      showToast(`Scan complete: ${data.total_files_found} files found. ${data.missing_count} missing file(s) marked with red dot.`, true);
    } else {
      showToast(`Scan complete: All ${data.total_files_found} files verified and processed.`, false);
    }

    btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">check</span><span>Processed</span>`;
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.classList.remove('opacity-75');
    }, 2000);
  } catch (err) {
    console.error('Error processing CSVs:', err);
    showToast('Failed to process CSV files: ' + err.message, true);
    btn.innerHTML = originalHtml;
    btn.classList.remove('opacity-75');
  }
}

async function createMissingDummyFiles() {
  const btn = document.getElementById('btn-create-dummies');
  if (!btn) return;
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">note_add</span><span>Creating Templates...</span>`;
  btn.classList.add('opacity-75');

  try {
    const resp = await fetch('/api/csv/create-dummy-files', { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
    const data = await resp.json();

    state.csvStatuses = data.equipment_statuses || {};
    renderTopology();

    const createdCount = data.created_dummy_files ? data.created_dummy_files.length : 0;
    if (createdCount > 0) {
      showToast(`Created ${createdCount} dummy CSV template file(s) without data (yellow dot) in data/csv/.`, false);
    } else {
      showToast('All configured CSV files exist. No missing templates to create.', false);
    }

    btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">check</span><span>Templates Created</span>`;
    setTimeout(() => {
      btn.innerHTML = originalHtml;
      btn.classList.remove('opacity-75');
    }, 2000);
  } catch (err) {
    console.error('Error creating dummy files:', err);
    showToast('Failed to create dummy files: ' + err.message, true);
    btn.innerHTML = originalHtml;
    btn.classList.remove('opacity-75');
  }
}

// Fallback alias
function simulateDataProcessing() {
  processCsvData();
}

window.openCsvDirectory = openCsvDirectory;
window.processCsvData = processCsvData;
window.createMissingDummyFiles = createMissingDummyFiles;

// -------------------------------------------------------------
// Toast Notification (Strictly max 2.5 - 3 seconds, instant close)
// -------------------------------------------------------------
function showToast(message, isError = false) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }

  let toast = document.getElementById('collia-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'collia-toast';
    document.body.appendChild(toast);
  }

  const baseClasses = 'fixed bottom-20 right-6 z-50 px-3.5 py-2 rounded shadow-lg font-body-sm text-body-sm transition-all duration-200 transform translate-y-0 opacity-100 flex items-center gap-2 select-none';
  const colorClasses = isError
    ? 'bg-error text-on-error'
    : 'bg-surface-base border border-border-strong text-on-surface shadow-md';

  toast.className = `${baseClasses} ${colorClasses}`;

  toast.innerHTML = `
    <span class="material-symbols-outlined text-[18px]">${isError ? 'error' : 'check_circle'}</span>
    <span class="font-medium">${message}</span>
    <button onclick="dismissToast()" class="ml-2 text-secondary hover:text-on-surface flex items-center" title="Dismiss">
      <span class="material-symbols-outlined text-[14px]">close</span>
    </button>
  `;

  // Auto-dismiss in strictly 2.5 seconds
  toastTimer = setTimeout(() => {
    dismissToast();
  }, 2500);
}

function dismissToast() {
  const toast = document.getElementById('collia-toast');
  if (toast) {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => {
      if (toast && toast.parentNode) toast.remove();
    }, 200);
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}
