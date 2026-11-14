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

  // 1. Render Plant components
  const plantContainer = document.getElementById('plant-components-container');
  if (plantContainer) {
    const sharedEq = state.topology.shared_equipment || [];
    plantContainer.innerHTML = '';

    sharedEq.forEach(eq => {
      const isSelected = state.selectedEntity && state.selectedEntity.id === eq.id;
      let icon = 'mode_fan';
      let sublabel = 'Air Handling Unit';
      let cardWidth = 'min-w-[140px] w-auto';
      let statHtml = `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-on-surface"><span class="">Supply Fan</span><span class="text-status-success font-medium">Auto</span></div>`;

      if (eq.equipment_type === 'CHILLER') {
        icon = 'ac_unit';
        sublabel = 'Central Chiller';
        cardWidth = 'min-w-[125px] w-auto';
        statHtml = `<div class="font-code-xs text-[10px] text-status-success flex items-center gap-1 mt-1"><span class="w-1.5 h-1.5 rounded-full bg-status-success"></span> Running</div>`;
      } else if (eq.equipment_type === 'EV') {
        icon = 'speed';
        sublabel = 'Energy Valve';
        cardWidth = 'min-w-[145px] w-auto';
        statHtml = `<div class="flex items-center justify-between mt-1 font-code-xs text-[10px] text-secondary border-t border-border-subtle pt-1"><span class="">ΔT: 6.7°C</span><span class="">14.2 m³/h</span></div>`;
      }

      const card = document.createElement('div');
      card.id = `node-${eq.id}`;
      card.className = `${cardWidth} p-2.5 rounded ${isSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto select-none`;
      card.title = `Click to inspect details and edit connections for ${eq.name}`;

      card.innerHTML = `
        ${isSelected ? `<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>` : ''}
        <div class="flex items-center justify-between mb-1">
          <span class="font-label-sm text-label-sm font-semibold ${isSelected ? 'text-primary' : 'text-on-surface'} truncate">${eq.name}</span>
          <div class="flex items-center gap-1">
            <button class="w-5 h-5 flex items-center justify-center text-secondary hover:text-primary rounded opacity-0 group-hover:opacity-100 transition-opacity" onclick="event.stopPropagation(); openConfigureEntityDirectly('${eq.id}')" title="Edit Connections">
              <span class="material-symbols-outlined text-[15px]">hub</span>
            </button>
            <span class="material-symbols-outlined text-[16px] ${isSelected ? 'text-primary' : 'text-secondary'}">${icon}</span>
          </div>
        </div>
        <div class="font-code-xs text-[11px] text-secondary truncate">${sublabel}</div>
        ${statHtml}
      `;

      card.onclick = () => selectEntity('equipment', eq.id);
      plantContainer.appendChild(card);
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
      floorBox.className = `floor-group-container relative rounded-lg border-2 ${isFloorSelected ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : 'border-border-strong/70 bg-surface-base/50'} pt-5 pb-3.5 px-3.5 flex flex-col gap-2 shrink-0 transition-all shadow-xs min-w-fit w-auto`;

      // Floor Breakdown Badge on top-left border
      const floorBadge = document.createElement('div');
      floorBadge.className = 'absolute -top-3 left-3 bg-surface-base px-3 py-1 border border-border-strong rounded font-label-sm text-label-sm font-semibold text-on-surface flex items-center gap-1.5 shadow-xs cursor-pointer select-none hover:border-primary hover:text-primary transition-colors';
      floorBadge.title = 'Click to view/edit Floor details';
      floorBadge.onclick = (e) => {
        e.stopPropagation();
        selectEntity('floor', floorId);
      };
      floorBadge.innerHTML = `
        <span class="material-symbols-outlined text-[15px] text-primary">layers</span>
        <span class="uppercase tracking-wide leading-none">${floorSection}</span>
        <span class="text-border-strong font-normal">|</span>
        <span class="font-code-xs text-[10px] text-secondary leading-none">Level ${floorObj.floor_number || 1}</span>
        <span class="ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-code-xs text-[9px] font-bold leading-none">${floorRooms.length} ${floorRooms.length === 1 ? 'Room' : 'Rooms'}</span>
      `;
      floorBox.appendChild(floorBadge);

      // Rooms row inside this floor box (flex-wrap for automatic expansion)
      const roomsRow = document.createElement('div');
      roomsRow.className = 'flex items-start gap-4 flex-wrap';

      floorRooms.forEach(room => {
        const thisRoomEq = roomEq.filter(eq => eq.room_id === room.id);
        const isRoomSelected = state.selectedEntity && state.selectedEntity.id === room.id;

        const zoneDiv = document.createElement('div');
        zoneDiv.id = `room-card-${room.id}`;
        // Automatically increases size to fit all room equipment cleanly
        zoneDiv.className = `min-w-[280px] w-auto max-w-[620px] rounded border ${isRoomSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border-subtle'} bg-surface-base p-3 shadow-xs transition-all pointer-events-auto shrink-0 flex flex-col cursor-pointer`;

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
        let devicesHtml = '<div class="grid grid-cols-2 gap-2.5 flex-1">';
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

            devicesHtml += `
              <div class="p-2.5 rounded ${isEqSelected ? 'bg-primary/5 border-2 border-primary ring-2 ring-primary/20 shadow-sm' : 'bg-surface-canvas border border-border-strong hover:border-primary'} transition-all cursor-pointer relative group pointer-events-auto min-w-[125px]" id="node-${eq.id}" onclick="event.stopPropagation(); selectEntity('equipment', '${eq.id}')">
                ${isEqSelected ? '<div class="absolute -top-3 right-2 bg-primary text-on-primary text-[9px] font-code-xs px-1.5 py-0.2 rounded shadow-xs uppercase tracking-tight">Active Selected</div>' : ''}
                <div class="flex items-center justify-between mb-1">
                  <span class="font-label-sm text-label-sm font-semibold ${isEqSelected ? 'text-primary font-bold' : 'text-on-surface'} truncate">${typeBadge}</span>
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
                    <span class="font-semibold text-on-surface">${isVav ? 'Normal' : 'Active'}</span>
                  </div>
                  <div class="flex justify-between font-code-xs text-[11px]">
                    <span class="text-secondary">CSV:</span>
                    <span class="font-code-xs text-[10px] text-primary truncate max-w-[65px]" title="${eq.csv_filename || 'Not assigned'}">${eq.csv_filename || '—'}</span>
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
        <path d="M0,0 L6,3 L0,6 Z" fill="#0284C7" fill-opacity="0.6"></path>
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

  // 1. Central Hydronic Loop: Chiller -> EV -> AHU
  const chillers = (state.topology.shared_equipment || []).filter(e => e.equipment_type === 'CHILLER');
  const evs = (state.topology.shared_equipment || []).filter(e => e.equipment_type === 'EV');
  const ahus = (state.topology.shared_equipment || []).filter(e => e.equipment_type === 'AHU');

  // Pair connections: use actual relationships or fallback to available plant units
  chillers.forEach(ch => {
    const cEl = document.getElementById(`node-${ch.id}`);
    const c = getCoords(cEl);
    if (!c) return;

    let targetEvs = (state.topology.relationships || [])
      .filter(r => r.source_id === ch.id && r.relationship_type === 'SUPPLIES')
      .map(r => evs.find(e => e.id === r.target_id))
      .filter(Boolean);

    if (targetEvs.length === 0 && evs.length > 0) {
      targetEvs = [evs[0]];
    }

    targetEvs.forEach(evObj => {
      const evEl = document.getElementById(`node-${evObj.id}`);
      const ev = getCoords(evEl);
      if (!ev) return;

      const startX = Math.round(c.right);
      const endX = Math.round(ev.x);
      const y = Math.round(c.centerY);
      const midX = Math.round((startX + endX) / 2);

      paths += `
        <!-- Chiller to EV (60% opacity) -->
        <path d="M ${startX} ${y} L ${endX} ${y}" fill="none" stroke="#0284C7" stroke-width="3" stroke-opacity="0.6" marker-end="url(#arrow-chw)"></path>
        <rect x="${midX - 25}" y="${y - 18}" width="50" height="15" rx="3" fill="#FFFFFF" stroke="#0284C7" stroke-width="0.8" stroke-opacity="0.6"></rect>
        <text x="${midX}" y="${y - 7}" text-anchor="middle" class="font-code-xs text-[9px] fill-[#0284C7] font-bold" fill-opacity="0.8">6.1°C</text>
      `;
    });
  });

  // EV -> AHU
  evs.forEach(evObj => {
    const evEl = document.getElementById(`node-${evObj.id}`);
    const ev = getCoords(evEl);
    if (!ev) return;

    let targetAhus = (state.topology.relationships || [])
      .filter(r => r.source_id === evObj.id && (r.relationship_type === 'CONNECTED_TO' || r.relationship_type === 'SUPPLIES'))
      .map(r => ahus.find(a => a.id === r.target_id))
      .filter(Boolean);

    if (targetAhus.length === 0 && ahus.length > 0) {
      targetAhus = [ahus[0]];
    }

    targetAhus.forEach(ahuObj => {
      const ahuEl = document.getElementById(`node-${ahuObj.id}`);
      const ahu = getCoords(ahuEl);
      if (!ahu) return;

      const startX = Math.round(ev.right);
      const endX = Math.round(ahu.x);
      const y = Math.round(ev.centerY);
      const midX = Math.round((startX + endX) / 2);

      paths += `
        <!-- EV to AHU (60% opacity) -->
        <path d="M ${startX} ${y} L ${endX} ${y}" fill="none" stroke="#0284C7" stroke-width="3" stroke-opacity="0.6" marker-end="url(#arrow-chw)"></path>
        <rect x="${midX - 25}" y="${y - 18}" width="50" height="15" rx="3" fill="#FFFFFF" stroke="#0284C7" stroke-width="0.8" stroke-opacity="0.6"></rect>
        <text x="${midX}" y="${y - 7}" text-anchor="middle" class="font-code-xs text-[9px] fill-[#0284C7] font-bold" fill-opacity="0.8">Coil In</text>
      `;
    });
  });

  // Hydronic Return Line (bottom margin of plant units)
  const firstChillerEl = chillers[0] ? document.getElementById(`node-${chillers[0].id}`) : null;
  const firstAhuEl = ahus[0] ? document.getElementById(`node-${ahus[0].id}`) : null;
  const cFirst = getCoords(firstChillerEl);
  const aFirst = getCoords(firstAhuEl);

  if (cFirst && aFirst) {
    const returnY = Math.round(Math.max(cFirst.bottom, aFirst.bottom) + 14);
    const midX = Math.round((cFirst.centerX + aFirst.centerX) / 2);

    paths += `
      <!-- Hydronic Return (60% opacity) -->
      <path d="M ${Math.round(aFirst.centerX)} ${Math.round(aFirst.bottom)} L ${Math.round(aFirst.centerX)} ${returnY} L ${Math.round(cFirst.centerX)} ${returnY} L ${Math.round(cFirst.centerX)} ${Math.round(cFirst.bottom + 4)}" fill="none" stroke="#64748B" stroke-dasharray="5,4" stroke-width="2.5" stroke-opacity="0.6" marker-end="url(#arrow-return)"></path>
      <rect x="${midX - 70}" y="${returnY - 9}" width="140" height="18" rx="4" fill="#FFFFFF" stroke="#64748B" stroke-width="1" stroke-opacity="0.6"></rect>
      <text x="${midX}" y="${returnY + 4}" text-anchor="middle" class="font-code-xs text-[10px] fill-secondary font-medium" fill-opacity="0.8">◀ Hydronic Return 12.8°C ◀</text>
    `;
  }

  // 2. Supply Air Duct: AHU exit -> distribution manifold -> rooms
  ahus.forEach(ahuObj => {
    const ahuEl = document.getElementById(`node-${ahuObj.id}`);
    const ahu = getCoords(ahuEl);
    if (!ahu) return;

    const roomDivs = Array.from(document.querySelectorAll('#zones-canvas-container [id^="room-card-"]'));
    if (roomDivs.length === 0) return;

    const trunkY = Math.round(ahu.centerY);
    const riserX = Math.round(ahu.right + 60);
    const manifoldY = Math.round(Math.min(...roomDivs.map(d => getCoords(d)?.y || 300)) - 35);

    paths += `
      <!-- Main AHU exit trunk (60% opacity) -->
      <path d="M ${Math.round(ahu.right)} ${trunkY} L ${riserX} ${trunkY} L ${riserX} ${manifoldY}" fill="none" stroke="#ff7a1a" stroke-linecap="round" stroke-width="3.5" stroke-opacity="0.6"></path>
      <rect x="${riserX - 55}" y="${trunkY - 18}" width="115" height="17" rx="3" fill="#FFFFFF" stroke="#ff7a1a" stroke-width="0.8" stroke-opacity="0.6"></rect>
      <text x="${riserX}" y="${trunkY - 6}" text-anchor="middle" class="font-code-xs text-[10px] fill-primary font-bold" fill-opacity="0.8">Supply Air Duct</text>
    `;

    const roomDrops = roomDivs.map(div => {
      const rc = getCoords(div);
      if (!rc) return null;
      const vavEl = div.querySelector('[id*="vav"]');
      const vavCoords = vavEl ? getCoords(vavEl) : null;
      return {
        x: vavCoords ? Math.round(vavCoords.centerX) : Math.round(rc.centerX),
        top: Math.round(rc.y)
      };
    }).filter(Boolean);

    if (roomDrops.length > 0) {
      const minX = Math.min(...roomDrops.map(d => d.x), riserX);
      const maxX = Math.max(...roomDrops.map(d => d.x), riserX);

      paths += `
        <!-- Distribution Manifold line across rooms (60% opacity) -->
        <path d="M ${minX} ${manifoldY} L ${maxX} ${manifoldY}" fill="none" stroke="#ff7a1a" stroke-width="3" stroke-opacity="0.6" id="svg-air-manifold"></path>
      `;

      roomDrops.forEach(drop => {
        paths += `
          <!-- Drop into room top border (60% opacity) -->
          <path d="M ${drop.x} ${manifoldY} L ${drop.x} ${drop.top - 2}" fill="none" stroke="#ff7a1a" stroke-width="2.5" stroke-opacity="0.6" marker-end="url(#arrow-air)"></path>
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
