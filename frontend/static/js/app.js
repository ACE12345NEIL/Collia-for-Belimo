/**
 * BELIMO | Collia - Frontend Application Logic
 * Dynamic Entity Management (Floors, Rooms, Equipment), CSV Filename Binding, Navigation & CRUD
 */

const state = {
  topology: null,
  selectedEntity: null,
  selectedType: null, // 'building' | 'floor' | 'room' | 'equipment'
  activeFloorId: null, // Currently selected floor for filtering/view
  currentZoom: 1.0,
  activeTab: 'layout'
};

let toastTimer = null;

// -------------------------------------------------------------
// Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadTopology();
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

  // Redraw SVG schematic arrows on resize
  window.addEventListener('resize', () => {
    updateCanvasSchematicArrows();
  });
}

// -------------------------------------------------------------
// API Calls & State Synchronization
// -------------------------------------------------------------
async function loadTopology() {
  try {
    const res = await fetch('/api/topology');
    if (!res.ok) throw new Error('Failed to load topology');
    state.topology = await res.json();

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
    const floors = state.topology.floors || [];

    // Group rooms by floor
    floors.forEach(fl => {
      const floorRooms = rooms.filter(r => r.floor_id === fl.id);
      if (floorRooms.length === 0 && floors.length <= 1) return; // Skip header for single floor with no rooms

      // Floor group header label
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

        const roomDiv = document.createElement('div');
        roomDiv.className = `rounded border ${isSelected ? 'border-primary' : 'border-border-subtle'} bg-surface-base overflow-hidden`;
        roomDiv.setAttribute('data-room-id', room.id);

        roomDiv.innerHTML = `
          <div class="flex items-center justify-between px-space-sm py-1.5 bg-surface-subtle/80 cursor-pointer room-header group" onclick="toggleRoom('${room.id}')">
            <div class="flex items-center gap-1 min-w-0" onclick="event.stopPropagation(); selectEntity('room', '${room.id}')">
              <span class="material-symbols-outlined text-[16px] text-secondary transition-transform duration-150 transform rotate-90" id="caret-${room.id}">chevron_right</span>
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
          <div class="p-space-xs flex flex-col gap-1 bg-surface-base" id="content-${room.id}">
            ${roomEq.map(eq => {
              const isEqSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
              const isVav = eq.equipment_type === 'VAV';
              return `
                <div class="flex items-center justify-between px-2 py-1 rounded border ${isEqSelected ? 'border-primary bg-primary/5' : 'border-border-subtle/60 bg-surface-canvas hover:border-primary/50'} transition-colors group cursor-pointer" onclick="selectEntity('equipment', '${eq.id}')">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="material-symbols-outlined text-[15px] text-primary">${isVav ? 'hvac' : 'air'}</span>
                    <span class="font-code-xs text-code-xs ${isEqSelected ? 'text-primary font-medium' : 'text-on-surface'} truncate">${eq.name}</span>
                  </div>
                  <div class="flex items-center gap-1">
                    ${eq.csv_filename ? `<span class="font-code-xs text-[9px] text-secondary bg-surface-subtle px-1 py-0.2 rounded border border-border-subtle truncate max-w-[80px]" title="CSV: ${eq.csv_filename}">${eq.csv_filename}</span>` : ''}
                    <button class="text-secondary opacity-0 group-hover:opacity-100 hover:text-error transition-opacity" onclick="event.stopPropagation(); deleteEntityPrompt('equipment', '${eq.id}', '${eq.name}')">
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
          <span class="material-symbols-outlined text-[18px] ${isSelected ? 'text-primary' : 'text-secondary group-hover:text-primary'} transition-colors">${icon}</span>
          <div class="flex flex-col min-w-0">
            <span class="font-label-sm text-label-sm ${isSelected ? 'text-primary font-semibold' : 'text-on-surface font-medium'} truncate">${eq.name}</span>
            <span class="font-code-xs text-code-xs text-secondary truncate">${eq.description || eq.equipment_type}</span>
          </div>
        </div>
        <div class="flex items-center gap-1">
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
// Central Canvas Rendering (No CFM, Fully Aligned)
// -------------------------------------------------------------
function renderCanvas() {
  if (!state.topology) return;

  // 1. Render Plant components
  const plantContainer = document.getElementById('plant-components-container');
  if (plantContainer) {
    const sharedEq = state.topology.shared_equipment || [];
    plantContainer.innerHTML = '';

    sharedEq.forEach(eq => {
      const isSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
      let icon = 'mode_fan';
      let sublabel = 'Air Handling Unit';
      let cardWidth = 'w-[140px]';
      let statHtml = `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-on-surface"><span class="">Supply Fan</span><span class="text-status-success font-medium">Auto</span></div>`;

      if (eq.equipment_type === 'CHILLER') {
        icon = 'ac_unit';
        sublabel = 'Central Chiller';
        cardWidth = 'w-[125px]';
        statHtml = `<div class="font-code-xs text-[10px] text-status-success flex items-center gap-1 mt-1"><span class="w-1.5 h-1.5 rounded-full bg-status-success"></span> Running</div>`;
      } else if (eq.equipment_type === 'EV') {
        icon = 'speed';
        sublabel = 'Energy Valve';
        cardWidth = 'w-[145px]';
        statHtml = `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-secondary border-t border-border-subtle pt-1"><span class="">ΔT: 6.7°C</span><span class="">14.2 m³/h</span></div>`;
      }

      const card = document.createElement('div');
      card.id = `node-${eq.id}`;
      card.className = `${cardWidth} p-2.5 rounded ${isSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto`;
      card.onclick = () => selectEntity('equipment', eq.id);

      card.innerHTML = `
        ${isSelected ? `<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>` : ''}
        <div class="flex items-center justify-between mb-1">
          <span class="font-label-sm text-label-sm font-semibold ${isSelected ? 'text-primary' : 'text-on-surface'} truncate">${eq.name}</span>
          <span class="material-symbols-outlined text-[16px] ${isSelected ? 'text-primary' : 'text-secondary'}">${icon}</span>
        </div>
        <div class="font-code-xs text-[11px] text-secondary truncate">${sublabel}</div>
        ${statHtml}
      `;
      plantContainer.appendChild(card);
    });
  }

  // 2. Render Floors & Rooms / Zones — grouped by floor
  const zonesContainer = document.getElementById('zones-canvas-container');
  if (zonesContainer) {
    const rooms = state.topology.rooms || [];
    const floors = state.topology.floors || [];
    zonesContainer.innerHTML = '';

    // Group rooms by floor_id
    const roomsByFloor = {};
    floors.forEach(fl => { roomsByFloor[fl.id] = []; });
    rooms.forEach(room => {
      if (roomsByFloor[room.floor_id]) {
        roomsByFloor[room.floor_id].push(room);
      }
    });

    floors.forEach(floor => {
      const floorRooms = roomsByFloor[floor.id] || [];
      const isActiveFloor = state.activeFloorId === floor.id;
      const isFloorSelected = state.selectedEntity && state.selectedEntity.id === floor.id;

      const floorSection = document.createElement('div');
      floorSection.className = `rounded-lg border-2 ${isFloorSelected ? 'border-primary ring-2 ring-primary/20' : isActiveFloor ? 'border-primary/30' : 'border-border-subtle'} bg-surface-base/70 p-4 transition-all`;

      // Floor header
      const floorHeader = document.createElement('div');
      floorHeader.className = 'flex items-center justify-between pb-2 mb-3 border-b border-border-subtle cursor-pointer';
      floorHeader.onclick = () => {
        state.activeFloorId = floor.id;
        selectEntity('floor', floor.id);
      };
      floorHeader.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[20px] ${isActiveFloor ? 'text-primary' : 'text-secondary'}">layers</span>
          <span class="font-headline-sm text-headline-sm font-semibold ${isActiveFloor ? 'text-primary' : 'text-on-surface'}">${floor.name}</span>
          <span class="px-2 py-0.5 rounded bg-surface-subtle border border-border-subtle font-code-xs text-[10px] text-secondary uppercase tracking-wider">Level ${floor.floor_number}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="font-code-xs text-[11px] text-secondary">${floorRooms.length} ${floorRooms.length === 1 ? 'room' : 'rooms'}</span>
          ${isActiveFloor ? '<span class="w-2 h-2 rounded-full bg-primary"></span>' : ''}
        </div>
      `;
      floorSection.appendChild(floorHeader);

      // Rooms row within this floor
      if (floorRooms.length > 0) {
        const roomsRow = document.createElement('div');
        roomsRow.className = 'flex items-start gap-4 overflow-x-auto pb-1';

        floorRooms.forEach(room => {
          const roomEq = (state.topology.room_equipment || []).filter(eq => eq.room_id === room.id);
          const isRoomSelected = state.selectedEntity && state.selectedEntity.id === room.id;

          const zoneDiv = document.createElement('div');
          zoneDiv.className = `flex-1 min-w-[260px] max-w-[320px] rounded border ${isRoomSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border-subtle'} bg-surface-base p-3 shadow-xs transition-all pointer-events-auto`;
          zoneDiv.onclick = (e) => {
            if (e.target === zoneDiv || e.target.closest('.room-card-header')) {
              selectEntity('room', room.id);
            }
          };

          zoneDiv.innerHTML = `
            <div class="flex items-center justify-between pb-2 border-b border-border-subtle mb-3 room-card-header cursor-pointer">
              <div class="flex items-center gap-1.5 min-w-0">
                <span class="material-symbols-outlined text-[16px] text-secondary">meeting_room</span>
                <span class="font-label-md text-label-md font-semibold text-on-surface truncate">${room.name}</span>
              </div>
              <span class="font-code-xs text-[11px] text-secondary shrink-0">${room.area_sqm || 0} m²</span>
            </div>
            <div class="grid grid-cols-2 gap-2.5">
              ${roomEq.map(eq => {
                const isEqSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
                const isVav = eq.equipment_type === 'VAV';

                return `
                  <div class="p-2.5 rounded ${isEqSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto" id="node-${eq.id}" onclick="event.stopPropagation(); selectEntity('equipment', '${eq.id}')">
                    ${isEqSelected ? '<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>' : ''}
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-label-sm text-label-sm font-semibold ${isEqSelected ? 'text-primary font-bold' : 'text-on-surface'} truncate">${eq.equipment_type}</span>
                      <span class="material-symbols-outlined text-[16px] ${isEqSelected ? 'text-primary' : 'text-secondary'}">${isVav ? 'hvac' : 'air'}</span>
                    </div>
                    <div class="font-code-xs text-[10px] text-secondary truncate">${eq.name}</div>
                    <div class="mt-2 pt-1.5 border-t border-border-subtle flex flex-col gap-0.5">
                      <div class="flex justify-between font-code-xs text-[11px]">
                        <span class="text-secondary">${isVav ? 'Airflow' : 'CO2'}:</span>
                        <span class="font-semibold text-on-surface">${isVav ? 'Normal' : '—'}</span>
                      </div>
                      <div class="flex justify-between font-code-xs text-[11px]">
                        <span class="text-secondary">CSV:</span>
                        <span class="font-code-xs text-[10px] text-primary truncate max-w-[65px]" title="${eq.csv_filename || 'Not assigned'}">${eq.csv_filename || '—'}</span>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          `;
          roomsRow.appendChild(zoneDiv);
        });

        floorSection.appendChild(roomsRow);
      } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'text-center py-4 text-secondary font-code-xs text-code-xs';
        emptyMsg.textContent = 'No rooms configured on this floor. Use "Add Room" to create one.';
        floorSection.appendChild(emptyMsg);
      }

      zonesContainer.appendChild(floorSection);
    });
  }

  // Draw clean, top-layer dynamic schematic interconnect arrows
  requestAnimationFrame(() => {
    updateCanvasSchematicArrows();
  });
}

// -------------------------------------------------------------
// Dynamic Top-Layer SVG Schematic Interconnect Arrows
// Connects Chiller -> EV -> AHU, AHU -> VAVs, RAQS -> VAV
// -------------------------------------------------------------
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
        <path d="M0,0 L6,3 L0,6 Z" fill="#0284C7"></path>
      </marker>
      <marker id="arrow-return" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#64748B"></path>
      </marker>
      <marker id="arrow-air" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
        <path d="M0,0 L6,3 L0,6 Z" fill="#ff7a1a"></path>
      </marker>
      <marker id="arrow-reset-signal" markerHeight="5" markerWidth="5" orient="auto" refX="4" refY="2.5">
        <path d="M0,0 L5,2.5 L0,5 Z" fill="#ff7a1a"></path>
      </marker>
    </defs>
  `;

  let paths = '';

  // 1. Central Hydronic Plant Interconnects (Chiller -> EV -> AHU)
  const chillerEl = document.getElementById('node-eq_chiller_01') || document.querySelector('[id*="chiller"]');
  const evEl = document.getElementById('node-eq_ev_01') || document.querySelector('[id*="ev"]');
  const ahuEl = document.getElementById('node-eq_ahu_01') || document.querySelector('[id*="ahu"]');

  const c = getCoords(chillerEl);
  const ev = getCoords(evEl);
  const ahu = getCoords(ahuEl);

  if (c && ev) {
    const midX = Math.round((c.right + ev.x) / 2);
    const y = Math.round(c.centerY);
    paths += `
      <!-- Chiller to EV -->
      <path d="M ${Math.round(c.right)} ${y} L ${Math.round(ev.x)} ${y}" fill="none" stroke="#0284C7" stroke-width="3" marker-end="url(#arrow-chw)"></path>
      <rect x="${midX - 26}" y="${y - 18}" width="52" height="15" rx="3" fill="#FFFFFF" stroke="#0284C7" stroke-width="0.8"></rect>
      <text x="${midX}" y="${y - 7}" text-anchor="middle" class="font-code-xs text-[9px] fill-[#0284C7] font-bold">6.1°C</text>
    `;
  }

  if (ev && ahu) {
    const midX = Math.round((ev.right + ahu.x) / 2);
    const y = Math.round(ev.centerY);
    paths += `
      <!-- EV to AHU -->
      <path d="M ${Math.round(ev.right)} ${y} L ${Math.round(ahu.x)} ${y}" fill="none" stroke="#0284C7" stroke-width="3" marker-end="url(#arrow-chw)"></path>
      <rect x="${midX - 26}" y="${y - 18}" width="52" height="15" rx="3" fill="#FFFFFF" stroke="#0284C7" stroke-width="0.8"></rect>
      <text x="${midX}" y="${y - 7}" text-anchor="middle" class="font-code-xs text-[9px] fill-[#0284C7] font-bold">Coil In</text>
    `;
  }

  if (c && ahu) {
    const returnY = Math.round(Math.max(c.bottom, ahu.bottom) + 14);
    const midX = Math.round((c.centerX + ahu.centerX) / 2);
    paths += `
      <!-- Hydronic Return -->
      <path d="M ${Math.round(ahu.centerX)} ${Math.round(ahu.bottom)} L ${Math.round(ahu.centerX)} ${returnY} L ${Math.round(c.centerX)} ${returnY} L ${Math.round(c.centerX)} ${Math.round(c.bottom + 4)}" fill="none" stroke="#64748B" stroke-dasharray="5,4" stroke-width="2.5" marker-end="url(#arrow-return)"></path>
      <rect x="${midX - 70}" y="${returnY - 9}" width="140" height="18" rx="4" fill="#FFFFFF" stroke="#64748B" stroke-width="1"></rect>
      <text x="${midX}" y="${returnY + 4}" text-anchor="middle" class="font-code-xs text-[10px] fill-secondary font-medium">◀ Hydronic Return 12.8°C ◀</text>
    `;
  }

  // 2. Supply Air Duct from AHU-01 to Floor Rooms / VAV Actuators
  if (ahu) {
    const vavNodes = [];
    (state.topology.rooms || []).forEach(room => {
      const roomEq = (state.topology.room_equipment || []).filter(e => e.room_id === room.id);
      const vav = roomEq.find(e => e.equipment_type === 'VAV');
      if (vav) {
        const vEl = document.getElementById('node-' + vav.id);
        const vCoords = getCoords(vEl);
        if (vCoords) {
          vavNodes.push({ room, vav, coords: vCoords });
        }
      }
    });

    if (vavNodes.length > 0) {
      const riserX = Math.round(ahu.right + 25);
      const trunkY = Math.round(ahu.centerY);

      // Main AHU exit line
      paths += `
        <!-- Supply Air Trunk exit -->
        <path d="M ${Math.round(ahu.right)} ${trunkY} L ${riserX} ${trunkY}" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-linecap="round"></path>
        <rect x="${riserX - 10}" y="${trunkY - 18}" width="95" height="15" rx="3" fill="#FFFFFF" stroke="#ff7a1a" stroke-width="0.8"></rect>
        <text x="${riserX + 38}" y="${trunkY - 7}" text-anchor="middle" class="font-code-xs text-[9px] fill-primary font-bold">Supply Air Trunk</text>
      `;

      // Group VAVs by floor
      const vavsByFloor = {};
      vavNodes.forEach(item => {
        const flId = item.room.floor_id;
        if (!vavsByFloor[flId]) vavsByFloor[flId] = [];
        vavsByFloor[flId].push(item);
      });

      let maxRiserY = trunkY;

      Object.keys(vavsByFloor).forEach(flId => {
        const items = vavsByFloor[flId];
        const minVavX = Math.min(...items.map(i => i.coords.x));
        const floorEl = document.getElementById('floor-container-' + flId) || items[0].coords;
        const flCoords = getCoords(floorEl) || items[0].coords;

        // Position distribution channel right above the room cards
        const floorDistY = Math.round(flCoords.y + 44);
        if (floorDistY > maxRiserY) maxRiserY = floorDistY;

        // Horizontal branch duct from riser across to first VAV room
        paths += `
          <!-- Floor ${flId} Supply Duct Branch -->
          <path d="M ${riserX} ${floorDistY} L ${Math.round(minVavX - 8)} ${floorDistY}" fill="none" stroke="#ff7a1a" stroke-width="2.5" stroke-linecap="round"></path>
        `;

        // Supply drop into each VAV on this floor
        items.forEach(item => {
          const dropX = Math.round(item.coords.x - 8);
          const vavY = Math.round(item.coords.centerY);
          paths += `
            <!-- Duct drop into ${item.vav.name} -->
            <path d="M ${dropX} ${floorDistY} L ${dropX} ${vavY} L ${Math.round(item.coords.x)} ${vavY}" fill="none" stroke="#ff7a1a" stroke-width="2" marker-end="url(#arrow-air)"></path>
          `;
        });
      });

      // Main vertical riser from AHU to the lowest floor branch
      paths += `
        <!-- Main vertical supply duct riser -->
        <path d="M ${riserX} ${trunkY} L ${riserX} ${maxRiserY}" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-linecap="round"></path>
      `;
    }
  }

  // 3. Zone Control Signals (RAQS Sensor controls VAV Actuator)
  (state.topology.rooms || []).forEach(room => {
    const roomEq = (state.topology.room_equipment || []).filter(e => e.room_id === room.id);
    const vav = roomEq.find(e => e.equipment_type === 'VAV');
    const raqs = roomEq.find(e => e.equipment_type === 'RAQS');

    if (vav && raqs) {
      const vEl = document.getElementById('node-' + vav.id);
      const rEl = document.getElementById('node-' + raqs.id);
      const vc = getCoords(vEl);
      const rc = getCoords(rEl);

      if (vc && rc) {
        const rx = Math.round(rc.x);
        const vx = Math.round(vc.right);
        const y = Math.round(rc.centerY);

        if (rx > vx) {
          // Clean directional arrow from RAQS into VAV across card gap
          paths += `
            <!-- Telemetry Control Loop RAQS -> VAV in ${room.name} -->
            <path d="M ${rx} ${y} L ${vx} ${y}" fill="none" stroke="#ff7a1a" stroke-dasharray="3,2" stroke-width="1.8" marker-end="url(#arrow-reset-signal)"></path>
          `;
        }
      }
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
  } else if (type === 'equipment') {
    state.selectedEntity = (state.topology.room_equipment || []).concat(state.topology.shared_equipment || []).find(e => e.id === id);
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
    } else {
      equipmentFields.classList.add('hidden');
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

  // Populate relationships
  if (relationsContainer) {
    const rels = (state.topology?.relationships || []).filter(r => r.source_id === entity.id || r.target_id === entity.id);
    if (rels.length === 0) {
      relationsContainer.innerHTML = `<span class="font-code-xs text-code-xs text-secondary">No direct graph links configured.</span>`;
    } else {
      relationsContainer.innerHTML = rels.map(r => `
        <div class="flex items-center justify-between p-2 rounded bg-surface-canvas border border-border-subtle font-code-xs text-code-xs">
          <div class="flex items-center gap-1.5 truncate">
            <span class="font-semibold text-primary">${r.relationship_type}</span>
            <span class="text-secondary">${r.source_id === entity.id ? '-> ' + r.target_id : '<- ' + r.source_id}</span>
          </div>
          <span class="text-secondary truncate max-w-[120px]" title="${r.description}">${r.description || ''}</span>
        </div>
      `).join('');
    }
  }

  drawer.classList.remove('translate-x-full');
}

function closeDetailDrawer() {
  const drawer = document.getElementById('entity-detail-drawer');
  if (drawer) {
    drawer.classList.add('translate-x-full');
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

  const payload = {
    name: nameInput ? nameInput.value.trim() : entity.name,
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
    if (csvInput) payload.csv_filename = csvInput.value.trim();
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

  const bldgId = state.topology && state.topology.building ? state.topology.building.id : 'bldg_01';

  const payload = {
    building_id: bldgId,
    name: nameInput.value.trim(),
    floor_number: parseInt(numberInput.value, 10) || 1,
    description: descInput.value.trim()
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

  const payload = {
    floor_id: floorId,
    name: nameInput.value.trim(),
    room_number: numberInput.value.trim(),
    area_sqm: parseFloat(areaInput.value) || 0.0,
    description: descInput.value.trim()
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
    nameInput.value = '';
    numberInput.value = '';
    areaInput.value = '';
    descInput.value = '';

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
  if (modal) modal.classList.remove('hidden');
}

function closeAddRoomDeviceModal() {
  const modal = document.getElementById('modal-add-room-device');
  if (modal) modal.classList.add('hidden');
}

async function submitAddRoomDevice(e) {
  e.preventDefault();
  const roomId = document.getElementById('modal-device-room-id').value;
  const typeSelect = document.getElementById('modal-device-type');
  const nameInput = document.getElementById('modal-device-name');
  const descInput = document.getElementById('modal-device-desc');
  const csvInput = document.getElementById('modal-device-csv');

  const payload = {
    room_id: roomId,
    equipment_type: typeSelect.value,
    name: nameInput.value.trim(),
    description: descInput.value.trim(),
    csv_filename: csvInput.value.trim()
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

    closeAddRoomDeviceModal();
    nameInput.value = '';
    descInput.value = '';
    csvInput.value = '';

    showToast(`Device "${payload.name}" added to room`);
    await loadTopology();
  } catch (err) {
    showToast(err.message || 'Error adding device', true);
  }
}

function openAddPlantModal() {
  const modal = document.getElementById('modal-add-plant');
  if (modal) modal.classList.remove('hidden');
}

function closeAddPlantModal() {
  const modal = document.getElementById('modal-add-plant');
  if (modal) modal.classList.add('hidden');
}

async function submitAddPlant(e) {
  e.preventDefault();
  const typeSelect = document.getElementById('modal-plant-type');
  const nameInput = document.getElementById('modal-plant-name');
  const descInput = document.getElementById('modal-plant-desc');
  const csvInput = document.getElementById('modal-plant-csv');

  const bldgId = state.topology && state.topology.building ? state.topology.building.id : null;

  const payload = {
    equipment_type: typeSelect.value,
    name: nameInput.value.trim(),
    description: descInput.value.trim(),
    csv_filename: csvInput.value.trim(),
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

    closeAddPlantModal();
    nameInput.value = '';
    descInput.value = '';
    csvInput.value = '';

    showToast(`Plant Unit "${payload.name}" created`);
    await loadTopology();
  } catch (err) {
    showToast(err.message || 'Error adding plant unit', true);
  }
}

// -------------------------------------------------------------
// Canvas Controls (Zoom & Switch Views)
// -------------------------------------------------------------
function zoomCanvas(delta) {
  const workspace = document.getElementById('canvas-workspace');
  if (!workspace) return;
  state.currentZoom = Math.min(Math.max(state.currentZoom + delta, 0.6), 1.6);
  workspace.style.transform = `scale(${state.currentZoom})`;
  updateCanvasSchematicArrows();
}

function resetZoom() {
  const workspace = document.getElementById('canvas-workspace');
  if (!workspace) return;
  state.currentZoom = 1.0;
  workspace.style.transform = 'scale(1.0)';
  updateCanvasSchematicArrows();
}

function fitCanvas() {
  const workspace = document.getElementById('canvas-workspace');
  if (!workspace) return;
  state.currentZoom = 0.9;
  workspace.style.transform = 'scale(0.9)';
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
  const content = document.getElementById('content-' + roomId);
  const caret = document.getElementById('caret-' + roomId);
  if (!content || !caret) return;
  if (content.classList.contains('hidden')) {
    content.classList.remove('hidden');
    caret.classList.add('rotate-90');
  } else {
    content.classList.add('hidden');
    caret.classList.remove('rotate-90');
  }
}

function copyFolderPath() {
  navigator.clipboard.writeText("data/csv/").then(() => {
    showToast("Copied 'data/csv/' path to clipboard");
  }).catch(() => {
    prompt("Source CSV directory path:", "data/csv/");
  });
}

function simulateDataProcessing() {
  const btn = document.getElementById('btn-process-data');
  if (!btn) return;
  const originalText = btn.innerHTML;
  btn.innerHTML = `<span class="material-symbols-outlined text-[18px] animate-spin">refresh</span> Scanning data/csv/...`;
  btn.classList.add('opacity-75');

  setTimeout(() => {
    btn.innerHTML = `<span class="material-symbols-outlined text-[18px]">check</span> data/csv/ scanned (Ready)`;
    btn.classList.remove('opacity-75');
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 2000);
  }, 1000);
}

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
