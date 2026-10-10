import { el, button, eyebrow } from '../../shared/dom.mjs';
import { TOPOLOGY, HEX_RADIUS, BOARD_CENTER, generateBoard } from './board.mjs';
import { RESOURCES, RESOURCE_NAMES, TERRAIN_RESOURCE, DEVELOPMENT_NAMES, COSTS, resourceBag, resourceCount } from './constants.mjs';

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== null && value !== undefined && value !== false) node.setAttribute(key, String(value));
  for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const atlas = new URL(`./assets/terrain-atlas.webp?v=${document.documentElement.dataset.appVersion ?? 'dev'}`, import.meta.url).href;
document.documentElement.style.setProperty('--terrain-art', `url("${atlas}")`);
const terrainCells = { forest: [0, 0], hills: [1, 0], pasture: [2, 0], fields: [0, 1], mountains: [1, 1], desert: [2, 1] };
const terrainNames = { forest: 'Forest', hills: 'Hills', pasture: 'Pasture', fields: 'Fields', mountains: 'Mountains', desert: 'Desert' };
const ownerName = (view, id) => view.players.find(player => player.id === id)?.name ?? 'Player';
const ownTurn = view => view.currentPlayerId === view.me.id;
const iconPaths = {
  brick: ['M3 11 13 6l15 6-10 6Z', 'M3 11v9l15 6v-8M18 18l10-6v9l-10 5M11 8l15 6M10 14v9'],
  lumber: ['M16 3 5 14h6L4 22h9v7h6v-7h9l-7-8h6Z', 'M16 8v15M11 16l5 4 5-4'],
  wool: ['M9 9a6 6 0 0 1 11-2 6 6 0 0 1 8 7 6 6 0 0 1-2 11H10a7 7 0 0 1-5-12 5 5 0 0 1 4-4Z', 'M13 14c-4-3-6 4-2 6s8-3 4-5M21 11c6-1 5 8 1 9'],
  grain: ['M16 29V4M16 12C7 13 6 7 6 6c7 0 10 2 10 6ZM16 19C7 20 6 14 6 13c7 0 10 2 10 6ZM16 26C7 27 6 21 6 20c7 0 10 2 10 6ZM16 9c9 1 10-5 10-6-7 0-10 2-10 6ZM16 16c9 1 10-5 10-6-7 0-10 2-10 6ZM16 23c9 1 10-5 10-6-7 0-10 2-10 6Z'],
  ore: ['M4 22 9 9l10-5 9 10-4 13-13 2Z', 'M9 9l7 8 12-3M16 17l-5 12M16 17l3-13M16 17l8 10M4 22l12-5'],
};
export function resourceIcon(resource, className = '') {
  return svg('svg', { viewBox: '0 0 32 32', class: `resource-icon ${className}`, 'aria-hidden': 'true' }, iconPaths[resource].map((d, index) => svg('path', { d, fill: index === 0 ? 'currentColor' : 'none', 'fill-opacity': index === 0 ? '.22' : null, stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linejoin': 'round' })));
}
const costLabel = cost => RESOURCES.filter(resource => cost[resource]).map(resource => `${cost[resource]} ${resource}`).join(' + ');
const bagLabel = bag => RESOURCES.filter(resource => bag[resource]).map(resource => `${bag[resource]} ${resource}`).join(' + ');

function town(kind, color) {
  return svg('g', { class: `town ${kind}`, filter: 'url(#piece-shadow)' },
    svg('ellipse', { cx: 1, cy: 9, rx: kind === 'city' ? 20 : 15, ry: 7, fill: '#09201f', opacity: '.5' }),
    kind === 'city' ? [svg('path', { d: 'M-18 2v-15l8-7 8 7v8h10v-10l8-6 8 7V9H-18Z', fill: color, stroke: '#251f24', 'stroke-width': 2 }), svg('path', { d: 'M-18-13l8-7 8 7M8-15l8-6 8 7', fill: 'none', stroke: '#fff5d4', 'stroke-width': 3, opacity: '.65' }), svg('path', { d: 'M-8 9V1h6v8M13 9V0h5v9', fill: '#344443' })] : [
      svg('path', { d: 'M-13-2v13H9V-2L-2-13Z', fill: color, stroke: '#251f24', 'stroke-width': 2 }),
      svg('path', { d: 'M9-2l7-5v13l-7 5Z', fill: color, stroke: '#251f24', 'stroke-width': 2 }),
      svg('path', { d: 'M-13-2-2-13l7-5L16-7 9-2-2-13', fill: '#fff1d0', 'fill-opacity': '.32', stroke: '#251f24', 'stroke-width': 2 }),
      svg('path', { d: 'M-5 11V3h6v8', fill: '#344443' }),
    ]);
}

export function renderBoard(view, ui = {}) {
  const mode = ['setup_settlement', 'setup_road', 'road_building', 'robber'].includes(view.phase) ?
    { setup_settlement: 'settlement', setup_road: 'road', road_building: 'road', robber: 'robber' }[view.phase] : ui.buildMode;
  const points = hex => hex.vertices.map(id => `${TOPOLOGY.vertices[id].x},${TOPOLOGY.vertices[id].y}`).join(' ');
  const colors = Object.fromEntries(view.players.map(player => [player.id, player.color]));
  const board = svg('svg', { id: 'island', viewBox: '0 0 880 740', class: 'island', role: 'group', 'aria-label': 'Catana Codex island. Select highlighted locations to build.', 'data-render-key': 'island' },
    svg('defs', {},
      svg('radialGradient', { id: 'ocean' }, svg('stop', { offset: '0', 'stop-color': '#38685b' }), svg('stop', { offset: '.75', 'stop-color': '#1e4b49' }), svg('stop', { offset: '1', 'stop-color': '#143a3d' })),
      svg('linearGradient', { id: 'timber', x1: 0, y1: 0, x2: 1, y2: 1 }, svg('stop', { offset: 0, 'stop-color': '#ae8555' }), svg('stop', { offset: '.5', 'stop-color': '#6d4e33' }), svg('stop', { offset: 1, 'stop-color': '#b18b5b' })),
      svg('radialGradient', { id: 'token' }, svg('stop', { offset: 0, 'stop-color': '#fff7df' }), svg('stop', { offset: 1, 'stop-color': '#dfcaa4' })),
      svg('filter', { id: 'piece-shadow', x: '-80%', y: '-80%', width: '260%', height: '260%' }, svg('feDropShadow', { dx: 2, dy: 4, stdDeviation: 2, 'flood-color': '#061512', 'flood-opacity': '.5' })),
      TOPOLOGY.hexes.map(hex => {
        const [column, row] = terrainCells[view.board.hexes[hex.id].terrain];
        return svg('pattern', { id: `terrain-${hex.id}`, x: hex.x - HEX_RADIUS, y: hex.y - HEX_RADIUS, width: 144, height: 144,
          patternUnits: 'userSpaceOnUse', viewBox: `${column * 512} ${row * 512} 512 512`, preserveAspectRatio: 'none' },
          svg('image', { href: atlas, width: 1536, height: 1024 }));
      }),
    ),
    svg('rect', { x: 12, y: 12, width: 856, height: 716, rx: 160, fill: 'url(#timber)', stroke: '#c6a575', 'stroke-width': 2 }),
    svg('rect', { x: 23, y: 23, width: 834, height: 694, rx: 151, fill: 'url(#ocean)', stroke: '#302e24', 'stroke-width': 5 }),
    [0, 1, 2, 3].map(index => svg('rect', { x: 36 + index * 11, y: 36 + index * 11, width: 808 - index * 22, height: 668 - index * 22, rx: 141 - index * 11, fill: 'none', stroke: '#b9d1b9', 'stroke-width': 1, opacity: '.08' })),
    svg('g', { transform: 'translate(794 643)', class: 'compass', opacity: '.45', 'aria-hidden': 'true' }, svg('path', { d: 'M0-28 7-7 28 0 7 7 0 28-7 7-28 0-7-7Z', fill: '#dccea4', stroke: '#f4e4bc' }), svg('circle', { r: 6, fill: '#235052' }), svg('text', { y: -36, 'text-anchor': 'middle', fill: '#e5d8b9', 'font-size': 12 }, 'N')),
  );
  for (const hex of view.board.hexes) {
    const geometry = TOPOLOGY.hexes[hex.id], legal = view.legal?.robberHexes.includes(hex.id), selected = ui.selection?.kind === 'robber' && ui.selection.id === hex.id;
    const label = `${terrainNames[hex.terrain]}${hex.number ? `, ${RESOURCE_NAMES[TERRAIN_RESOURCE[hex.terrain]]}, number ${hex.number}` : ', no production'}${view.robber === hex.id ? ', robber blocks production' : ''}`;
    board.append(svg('g', { class: `terrain${legal ? ' legal-hex' : ''}${selected ? ' selected-hex' : ''}`, 'data-render-key': `hex-${hex.id}`, 'data-action': legal ? 'select-hex' : 'inspect-hex', 'data-hex': hex.id, role: 'button', tabindex: 0, 'aria-label': legal ? `Move robber to ${label}` : label },
      svg('title', {}, label),
      svg('polygon', { points: points(geometry), transform: 'translate(0 5)', fill: '#151f18', opacity: '.5' }),
      svg('polygon', { points: points(geometry), fill: `url(#terrain-${hex.id})` }),
      svg('polygon', { points: points(geometry), fill: selected ? '#ffe0a5' : 'none', 'fill-opacity': '.18', stroke: legal ? '#ffe3a1' : '#d4bf8f', 'stroke-width': legal ? 5 : 3, 'stroke-opacity': legal ? 1 : '.7' }),
      hex.number ? svg('g', { class: `number-token${[6, 8].includes(hex.number) ? ' red-number' : ''}`, transform: `translate(${geometry.x} ${geometry.y + 6})`, 'pointer-events': 'none' },
        svg('circle', { r: 23, cy: 3, fill: '#122920', opacity: '.55' }), svg('circle', { r: 23, fill: 'url(#token)', stroke: '#c1a16d', 'stroke-width': 2 }),
        svg('circle', { r: 19, fill: 'none', stroke: '#faf0d0', 'stroke-width': '.8' }),
        svg('text', { y: 4, 'text-anchor': 'middle', 'font-size': 24, 'font-weight': 700, fill: [6, 8].includes(hex.number) ? '#a13d31' : '#38382d' }, hex.number),
        svg('text', { y: 16, 'text-anchor': 'middle', 'font-size': 9, 'letter-spacing': 1, fill: [6, 8].includes(hex.number) ? '#a13d31' : '#766746' }, '•'.repeat(6 - Math.abs(7 - hex.number))),
      ) : null,
    ));
  }
  for (const harbor of view.board.harbors) {
    const ends = TOPOLOGY.edges[harbor.edge].vertices.map(id => TOPOLOGY.vertices[id]), x = (ends[0].x + ends[1].x) / 2, y = (ends[0].y + ends[1].y) / 2;
    const dx = x - BOARD_CENTER.x, dy = y - BOARD_CENTER.y, length = Math.hypot(dx, dy), px = x + dx / length * 65, py = y + dy / length * 65;
    board.append(svg('g', { class: 'harbor', 'data-render-key': `harbor-${harbor.edge}` },
      svg('title', {}, harbor.resource ? `${RESOURCE_NAMES[harbor.resource]} harbor: trade 2 for 1. Build at either endpoint.` : 'General harbor: trade any 3 of one resource for 1. Build at either endpoint.'),
      ends.map(vertex => svg('line', { x1: vertex.x, y1: vertex.y, x2: px, y2: py, stroke: '#e0c798', 'stroke-width': 2, 'stroke-dasharray': '4 5', opacity: '.6' })),
      svg('g', { transform: `translate(${px} ${py})` }, svg('rect', { x: -31, y: -23, width: 62, height: 46, rx: 11, fill: '#153d3b', stroke: '#b6a277', 'stroke-width': 1.5 }),
        svg('path', { d: 'M-23 10h11l-3 5h-5ZM-18 9V-5l-9 11h9', fill: '#e8d6a9', stroke: '#e8d6a9', 'stroke-width': 1 }),
        svg('text', { x: 7, y: -5, 'text-anchor': 'middle', fill: '#f7e8c5', 'font-size': 15, 'font-weight': 700 }, harbor.resource ? '2:1' : '3:1'),
        svg('text', { x: 7, y: 11, 'text-anchor': 'middle', fill: '#d2c7a8', 'font-size': 10 }, harbor.resource ? RESOURCE_NAMES[harbor.resource] : 'Any'),
      ),
    ));
  }
  for (const edge of TOPOLOGY.edges) {
    const owner = view.roads[edge.id], legal = mode === 'road' && view.legal?.roads.includes(edge.id), selected = ui.selection?.kind === 'road' && ui.selection.id === edge.id;
    if (!owner && !legal) continue;
    const [a, b] = edge.vertices.map(id => TOPOLOGY.vertices[id]);
    const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI, middleX = (a.x + b.x) / 2, middleY = (a.y + b.y) / 2;
    board.append(svg('g', { class: owner ? 'built-road' : 'legal-road', 'data-render-key': `road-${edge.id}`,
      'data-action': legal ? 'select-road' : null, 'data-edge': legal ? edge.id : null, role: legal ? 'button' : null, tabindex: legal ? 0 : null,
      'aria-label': legal ? `Build road on edge ${edge.id + 1}` : `${ownerName(view, owner)}'s road` },
      svg('title', {}, owner ? `${ownerName(view, owner)}'s road` : 'Select road location'),
      legal ? svg('rect', { x: middleX - 32, y: middleY - 27, width: 64, height: 54, fill: 'transparent', transform: `rotate(${angle} ${middleX} ${middleY})` }) : null,
      svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'transparent', 'stroke-width': 54, 'stroke-linecap': 'round' }),
      svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#172722', 'stroke-width': owner ? 13 : 10, 'stroke-linecap': 'round', opacity: '.8', 'pointer-events': 'none' }),
      svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: owner ? colors[owner] : '#ffe1a0', 'stroke-width': owner ? 8 : selected ? 8 : 5, 'stroke-linecap': 'round', 'stroke-dasharray': owner || selected ? null : '9 8', 'pointer-events': 'none' }),
      owner ? svg('line', { x1: a.x, y1: a.y - 1, x2: b.x, y2: b.y - 1, stroke: '#ffffff', opacity: '.3', 'stroke-width': 2, 'pointer-events': 'none' }) : null,
    ));
  }
  for (const vertex of TOPOLOGY.vertices) {
    const building = view.buildings[vertex.id], legal = mode === 'settlement' && view.legal?.settlements.includes(vertex.id) || mode === 'city' && view.legal?.cities.includes(vertex.id);
    const selected = ['settlement', 'city'].includes(ui.selection?.kind) && ui.selection.id === vertex.id;
    if (!building && !legal) continue;
    board.append(svg('g', { transform: `translate(${vertex.x} ${vertex.y})`, class: legal ? 'legal-vertex' : 'built-town', 'data-render-key': `town-${vertex.id}`,
      'data-action': legal ? 'select-vertex' : null, 'data-vertex': legal ? vertex.id : null, role: legal ? 'button' : null, tabindex: legal ? 0 : null,
      'aria-label': legal ? `${mode === 'city' ? 'Upgrade to city' : 'Build settlement'} at intersection ${vertex.id + 1}` : `${ownerName(view, building.owner)}'s ${building.kind}` },
      svg('title', {}, legal ? 'Select this location' : `${ownerName(view, building.owner)}'s ${building.kind}`),
      legal ? [svg('circle', { r: 27, fill: 'transparent' }), svg('circle', { r: selected ? 16 : 12, fill: '#162e26', stroke: '#ffe2a5', 'stroke-width': selected ? 4 : 3 }), svg('path', { d: 'M-5 0H5M0-5V5', stroke: '#ffe2a5', 'stroke-width': 2 })] : null,
      building ? town(building.kind, colors[building.owner]) : null,
    ));
  }
  if (view.robber !== null) {
    const hex = TOPOLOGY.hexes[view.robber];
    board.append(svg('g', { class: 'robber-piece', transform: `translate(${hex.x + 33} ${hex.y - 26})`, filter: 'url(#piece-shadow)', 'pointer-events': 'none', 'data-render-key': 'robber' },
      svg('title', {}, 'The robber blocks this hex'), svg('ellipse', { cx: 0, cy: 18, rx: 12, ry: 5, fill: '#041b16', opacity: '.6' }),
      svg('path', { d: 'M-11 15-7-6Q0-14 7-6L11 15Q0 22-11 15', fill: '#273035', stroke: '#ced0c2', 'stroke-width': 1 }),
      svg('circle', { cy: -12, r: 7, fill: '#394448', stroke: '#b2bfb8', 'stroke-width': 1 }), svg('path', { d: 'M-3-3-5 13', stroke: '#879990', 'stroke-width': 2, opacity: '.65' }),
    ));
  }
  return board;
}

export function turnAnnouncement(view) {
  const name = ownTurn(view) ? 'Your turn' : `${ownerName(view, view.currentPlayerId)}'s turn`;
  const descriptions = { setup_settlement: 'Place a settlement', setup_road: 'Place an adjoining road', roll: 'Roll for resources', main: 'Trade, build, or end your turn',
    discard: 'Discard required resource cards', robber: 'Move the robber', steal: 'Choose a player to rob', road_building: `Place up to ${view.freeRoads} free roads`, year_of_plenty: 'Choose resources from the bank', monopoly: 'Choose a resource to monopolize' };
  if (view.phase === 'game_result') return `${ownerName(view, view.winnerId)} wins!`;
  if (view.phase === 'discard') return view.discards[view.me.id] ? `Discard ${view.discards[view.me.id]} resource cards` : 'Waiting for players to discard';
  return `${name} · ${descriptions[view.phase] ?? ''}`;
}

const previewBoard = generateBoard(() => 0);
export function renderHome(ui) {
  const preview = { board: previewBoard, players: [], roads: [], buildings: [], robber: previewBoard.hexes.find(hex => hex.terrain === 'desert').id, legal: { roads: [], settlements: [], cities: [], robberHexes: [] } };
  return el('div', { class: 'home', 'data-render-key': 'home' },
    el('section', { class: 'home-world' }, eyebrow('AN ISLAND. A FEW FRIENDS. ENDLESS POSSIBILITIES.'),
      el('h1', {}, 'A world worth', el('br'), el('em', {}, 'building.')),
      el('p', { class: 'home-description' }, 'Settle a new shore. Trade a little luck. Turn a handful of resources into something remarkable.'),
      el('div', { class: 'preview-island', 'aria-hidden': 'true', inert: true }, renderBoard(preview)),
      el('div', { class: 'home-facts' }, el('span', {}, '2–4 friends'), el('span', {}, 'Mouse & touch'), el('span', {}, 'A new island every match')),
    ),
    el('section', { class: 'entry-panel panel' }, eyebrow('CATANA CODEX'), el('h2', {}, ui.joining ? 'Your island awaits.' : 'Gather your people.'),
      el('p', { class: 'muted' }, 'No account. Just a name and an invitation.'),
      el('form', { id: 'entry-form', 'data-form': 'connect' },
        el('label', { for: 'your-name' }, 'YOUR NAME'), el('input', { id: 'your-name', name: 'name', maxlength: 16, autocomplete: 'nickname', placeholder: 'What should we call you?', value: ui.name, required: true }),
        ui.joining ? [el('label', { for: 'room-code-input' }, 'ROOM CODE'), el('input', { id: 'room-code-input', name: 'room', maxlength: 8, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: ui.code, placeholder: '8-character code', required: true })] : null,
        el('p', { id: 'form-error', class: 'error', role: 'alert' }, ui.error),
        el('button', { type: 'submit', class: 'button primary wide' }, ui.joining ? 'JOIN GAME ↗' : 'CREATE GAME ↗'),
        button(ui.joining ? 'Create a new room' : 'Join with a room code', 'switch-mode', { class: 'button quiet wide' }),
      ),
      el('div', { class: 'entry-note' }, el('strong', {}, 'Make an evening of it.'), el('p', {}, 'Invite 1–3 friends. Everyone chooses READY, then the host starts. Keep the host’s tab open.')),
      button('Explore the rules', 'rules', { class: 'button text-button' }),
      el('p', { class: 'small muted' }, '3–4 players: 10 victory points.', el('br'), '2 players: 12 points and a dice-directed robber.'),
    ),
  );
}
export function renderLobby(view, code, invite, pending) {
  return el('section', { class: 'lobby panel', 'data-render-key': 'lobby' },
    el('div', {}, eyebrow('A NEW CHAPTER, TOGETHER'), el('h1', {}, 'Save a seat', el('br'), el('em', {}, 'at the island.')),
      el('label', { for: 'invite-link' }, 'ROOM CODE'), el('strong', { id: 'room-code', class: 'room-code' }, code),
      el('input', { id: 'invite-link', value: invite, readonly: true, 'aria-label': 'Invite link' }), button('COPY INVITE LINK ↗', 'copy-invite', { class: 'button primary' }),
      el('p', { class: 'muted small' }, 'A match for 2–4 people. Keep the host’s tab open.')),
    el('div', {}, el('h2', {}, 'At the table'), el('ol', { class: 'lobby-players' }, view.players.map(player => el('li', { 'data-render-key': player.id },
      el('i', { class: 'player-dot', style: `--player-color:${player.color}` }), el('strong', {}, player.name, player.id === view.me.id ? el('small', {}, ' YOU') : null), el('span', { class: 'ready-status' }, player.host ? 'HOST · READY' : player.ready ? '✓ READY' : 'NOT READY')))),
      el('p', { class: 'muted' }, `${view.players.length} / 4 players · ${view.players.length === 2 ? '12 VP · Dice-directed robber' : '10 VP · Classic rules'}`),
      view.me.host ? button('START GAME', 'start', { class: 'button primary wide', disabled: !view.canStart || pending }) : button(view.me.ready ? '✓ READY · CLICK TO UNREADY' : 'READY', 'ready', { class: 'button primary wide', disabled: pending }),
      el('p', { class: 'muted small' }, view.canStart ? 'Everyone is ready. The host can begin.' : 'Invite at least one friend and wait for every guest to be ready.')),
  );
}
function renderDice(dice) {
  const patterns = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return el('div', { class: 'dice-pair', 'aria-label': dice ? `Dice ${dice[0]} and ${dice[1]}, total ${dice[0] + dice[1]}` : 'Dice not rolled' },
    (dice ?? [null, null]).map((value, index) => el('span', { class: `die${value ? ' rolled' : ''}`, 'data-render-key': `die-${index}` },
      value ? Array.from({ length: 9 }, (_, pip) => el('i', { class: patterns[value].includes(pip) ? 'pip' : '' })) : el('b', {}, '?'))),
    dice ? el('strong', { class: 'dice-total' }, dice[0] + dice[1]) : null);
}
function renderPlayers(view) {
  return el('div', { class: 'player-strip', 'data-render-key': 'players' }, view.players.map(player => el('article', {
    class: `player-tile${player.id === view.currentPlayerId ? ' active-player' : ''}${player.id === view.me.id ? ' you' : ''}`,
    style: `--player-color:${player.color}`, 'data-render-key': `player-${player.id}` },
    el('div', { class: 'player-name' }, el('i', { class: 'player-dot' }), el('strong', {}, player.name), player.id === view.me.id ? el('small', {}, 'YOU') : null,
      el('span', { class: 'player-score', title: 'Public victory points' }, player.score, el('small', {}, ' VP'))),
    el('div', { class: 'player-stats' }, el('span', { title: 'Resource cards' }, `${player.resourceCount} resources`), el('span', { title: 'Unplayed development cards' }, `${player.developmentCount} cards`), el('span', { title: 'Played Knights' }, `${player.knights} knights`)),
    (view.longestRoadOwner === player.id || view.largestArmyOwner === player.id) ? el('div', { class: 'player-awards' }, view.longestRoadOwner === player.id ? el('span', {}, '↝ Longest Road +2') : null, view.largestArmyOwner === player.id ? el('span', {}, '⚑ Largest Army +2') : null) : null,
  )));
}
function renderHand(view) {
  return el('section', { class: 'hand-panel', 'data-render-key': 'hand', 'aria-label': 'Your private resources' },
    el('div', { class: 'hand-heading' }, el('div', {}, eyebrow('YOUR HAND · ONLY YOU CAN SEE'), el('h2', {}, 'The makings of an empire.')), el('span', { class: 'private-score' }, el('b', {}, view.me.score), ` / ${view.targetScore} VP`)),
    el('div', { class: 'resource-hand' }, RESOURCES.map(resource => el('div', { class: `resource-card ${resource}${view.me.resources[resource] ? '' : ' empty-card'}`, 'data-render-key': `resource-${resource}`, 'aria-label': `${view.me.resources[resource]} ${RESOURCE_NAMES[resource]}` },
      el('div', { class: `card-landscape landscape-${resource}` }, resourceIcon(resource)), el('div', { class: 'resource-card-label' }, el('span', {}, RESOURCE_NAMES[resource]), el('b', {}, view.me.resources[resource]))))),
    el('div', { class: 'piece-supply' }, el('span', {}, `${view.me.pieces.road} roads left`), el('span', {}, `${view.me.pieces.settlement} settlements left`), el('span', {}, `${view.me.pieces.city} cities left`), el('span', {}, `${view.me.development.length} development cards`)),
  );
}
function renderSelection(view, ui, pending) {
  if (!ui.selection) return null;
  const { kind } = ui.selection, names = { road: 'road', settlement: 'settlement', city: 'city', robber: 'robber' };
  return el('div', { class: 'placement-confirm', 'data-render-key': 'placement-confirm' }, el('p', {}, kind === 'robber' ? 'Move the robber here?' : `Place your ${names[kind]} here?`),
    el('div', { class: 'button-row' }, button(kind === 'robber' ? 'MOVE ROBBER' : `PLACE ${kind.toUpperCase()}`, 'confirm-placement', { class: 'button primary', disabled: pending }), button('Cancel', 'cancel-placement', { class: 'button quiet' })));
}
function resourcePicker(view, ui, mode, pending) {
  const count = mode === 'discard' ? view.discards[view.me.id] : Math.min(2, resourceCount(view.bank)), limits = mode === 'discard' ? view.me.resources : view.bank;
  const draft = ui.resourceDraft ?? resourceBag(), sum = resourceCount(draft);
  return el('form', { 'data-form': mode, id: 'resource-picker', 'data-render-key': `picker-${mode}` },
    el('h3', {}, mode === 'discard' ? `Return ${count} cards to the bank` : `Take ${count} cards from the bank`),
    el('p', { class: 'muted small' }, mode === 'discard' ? 'Keep the resources you need most. Your selection is private.' : 'Choose any combination of the available resources.'),
    RESOURCES.map(resource => el('label', { class: 'resource-choice', for: `choose-${resource}` }, el('span', {}, resourceIcon(resource), RESOURCE_NAMES[resource]), el('span', { class: 'muted small' }, `${limits[resource]} available`),
      el('input', { type: 'number', id: `choose-${resource}`, name: resource, min: 0, max: limits[resource], step: 1, value: draft[resource], inputmode: 'numeric', 'data-draft': 'resources', 'aria-label': `${RESOURCE_NAMES[resource]} to ${mode === 'discard' ? 'discard' : 'take'}` }))),
    el('p', { class: 'selection-count', id: 'selection-count', 'data-required': count }, `${sum} / ${count} selected`),
    el('button', { type: 'submit', class: 'button primary wide', id: 'submit-resources', disabled: sum !== count || pending }, mode === 'discard' ? 'DISCARD SELECTED' : 'TAKE RESOURCES'));
}
function buildPanel(view, ui, pending) {
  return el('div', { class: 'build-panel' },
    el('p', { class: 'muted small' }, ownTurn(view) ? 'Choose a piece, then tap a glowing location.' : 'Plan your next move while your friends build.'),
    el('div', { class: 'build-buttons' }, ['road', 'settlement', 'city'].map(kind => button([
      el('span', { class: 'build-symbol', 'aria-hidden': 'true' }, { road: '↝', settlement: '⌂', city: '♜' }[kind]), el('span', {}, el('strong', {}, kind[0].toUpperCase() + kind.slice(1)), el('small', {}, costLabel(COSTS[kind]))),
    ], 'build-mode', { class: `button build-button${ui.buildMode === kind ? ' selected' : ''}`, 'data-kind': kind, 'aria-pressed': String(ui.buildMode === kind), disabled: pending || !view.legal[`${kind === 'city' ? 'citie' : kind}s`].length }))),
    button([el('strong', {}, 'Buy development card'), el('small', {}, costLabel(COSTS.development))], 'buy-development', { class: 'button development-buy', disabled: pending || !view.legal.canBuyDevelopment }),
    el('p', { class: 'muted small' }, `${view.developmentRemaining} development cards in the deck.`),
    renderSelection(view, ui, pending));
}
function tradePanel(view, ui, pending) {
  const active = ownTurn(view), mode = active ? ui.tradeMode ?? 'bank' : 'offer', draft = ui.tradeDraft ?? { give: resourceBag(), want: resourceBag(), target: '' };
  const give = ui.bankGive ?? 'brick', receive = ui.bankReceive ?? 'lumber', ratio = view.me.ratios[give];
  return el('div', { class: 'trade-panel' },
    active ? el('div', { class: 'segmented' }, button('Bank & harbors', 'trade-mode', { 'data-mode': 'bank', class: `button quiet${mode === 'bank' ? ' selected' : ''}` }), button('Player trade', 'trade-mode', { 'data-mode': 'offer', class: `button quiet${mode === 'offer' ? ' selected' : ''}` })) : null,
    !view.legal.canTrade ? el('p', { class: 'muted' }, 'Trading opens after the current player rolls and resolves any robber action.') : mode === 'bank' ? el('form', { 'data-form': 'bank', id: 'bank-trade' },
      el('h3', {}, 'A fair exchange.'), el('label', { for: 'bank-give' }, 'YOU GIVE'), el('select', { id: 'bank-give', name: 'give', 'data-draft': 'bank-give' }, RESOURCES.map(resource => el('option', { value: resource, selected: resource === give }, `${RESOURCE_NAMES[resource]} · ${view.me.ratios[resource]}:1`))),
      el('label', { for: 'bank-receive' }, 'YOU RECEIVE'), el('select', { id: 'bank-receive', name: 'receive', 'data-draft': 'bank-receive' }, RESOURCES.map(resource => el('option', { value: resource, selected: resource === receive }, `${RESOURCE_NAMES[resource]} · ${view.bank[resource]} in bank`))),
      el('label', { for: 'bank-quantity' }, 'NUMBER OF EXCHANGES'), el('input', { id: 'bank-quantity', name: 'quantity', type: 'number', min: 1, max: 19, value: ui.bankQuantity ?? 1, 'data-draft': 'bank-quantity', inputmode: 'numeric' }),
      el('p', { class: 'muted small' }, `Your rate: ${ratio} ${give} for 1 resource. A town at a harbor improves its rate.`),
      el('button', { type: 'submit', class: 'button primary wide', disabled: pending }, 'TRADE WITH BANK')) : el('form', { 'data-form': 'offer', id: 'player-trade' },
      el('h3', {}, 'Make an offer.'), el('p', { class: 'muted small' }, 'Only trades involving the current player are allowed. Every exchange is checked before cards change hands.'),
      el('div', { class: 'trade-grid-heading' }, el('span', {}, 'RESOURCE'), el('span', {}, 'GIVE'), el('span', {}, 'ASK')),
      RESOURCES.map(resource => el('div', { class: 'trade-resource-row' }, el('span', {}, resourceIcon(resource), RESOURCE_NAMES[resource]),
        el('input', { type: 'number', name: `give-${resource}`, min: 0, max: view.me.resources[resource], value: draft.give[resource], inputmode: 'numeric', 'data-draft': 'trade-give', 'data-resource': resource, 'aria-label': `${RESOURCE_NAMES[resource]} to offer` }),
        el('input', { type: 'number', name: `want-${resource}`, min: 0, max: 19, value: draft.want[resource], inputmode: 'numeric', 'data-draft': 'trade-want', 'data-resource': resource, 'aria-label': `${RESOURCE_NAMES[resource]} to request` }))),
      el('label', { for: 'trade-target' }, 'OFFER TO'), el('select', { id: 'trade-target', name: 'target', 'data-draft': 'trade-target' }, active ? el('option', { value: '', selected: !draft.target }, 'Everyone') : null,
        view.players.filter(player => player.id !== view.me.id && (active || player.id === view.currentPlayerId)).map(player => el('option', { value: player.id, selected: draft.target === player.id }, player.name))),
      el('button', { type: 'submit', class: 'button primary wide', disabled: pending }, 'PROPOSE TRADE')),
    view.trade ? renderOffer(view, pending) : null);
}
function renderOffer(view, pending) {
  const offer = view.trade, eligible = offer.proposer !== view.me.id && (offer.target === null || offer.target === view.me.id) && (ownTurn(view) || offer.proposer === view.currentPlayerId);
  const affordable = RESOURCES.every(resource => view.me.resources[resource] >= offer.want[resource]);
  return el('section', { class: 'trade-offer', 'data-render-key': `offer-${offer.id}` }, eyebrow(`${ownerName(view, offer.proposer)} OFFERS`),
    el('strong', {}, bagLabel(offer.give)), el('span', { class: 'exchange-arrow' }, '↓ in exchange for ↓'), el('strong', {}, bagLabel(offer.want)),
    el('p', { class: 'small muted' }, offer.target ? `For ${ownerName(view, offer.target)}` : 'Open to every other player'),
    eligible ? [button('ACCEPT TRADE', 'accept-trade', { class: 'button primary wide', disabled: pending || !affordable }), button('Make a counteroffer', 'counteroffer', { class: 'button quiet wide' })] : null,
    [view.currentPlayerId, offer.proposer, offer.target].includes(view.me.id) ? button(offer.proposer === view.me.id ? 'Withdraw offer' : 'Decline offer', 'cancel-trade', { class: 'button text-button wide', disabled: pending }) : null);
}
function cardsPanel(view, pending) {
  const descriptions = { knight: 'Move the robber and steal a card. Played Knights count toward Largest Army.', road_building: 'Place up to two free roads using the usual placement rules.', year_of_plenty: 'Take any two available resource cards from the bank.', monopoly: 'Choose a resource. Every opponent gives you all their cards of that type.', victory_point: 'One hidden victory point. Revealed automatically when you win.' };
  return el('div', { class: 'development-hand' }, view.me.development.length ? view.me.development.map(card => el('article', { class: `development-card${card.playable ? ' playable' : ''}`, 'data-render-key': `dev-${card.id}` },
    el('span', { class: 'development-mark', 'aria-hidden': 'true' }, { knight: '⚑', road_building: '↝', year_of_plenty: '✦', monopoly: '◈', victory_point: '♛' }[card.type]),
    el('div', {}, el('h3', {}, DEVELOPMENT_NAMES[card.type]), el('p', { class: 'small muted' }, descriptions[card.type]),
      card.type !== 'victory_point' ? button(card.boughtThisTurn ? 'Available on a later turn' : `PLAY ${DEVELOPMENT_NAMES[card.type].toUpperCase()}`, 'play-development', { class: 'button secondary wide', 'data-card': card.id, disabled: pending || !card.playable }) : el('span', { class: 'hidden-point' }, '+1 VP · PRIVATE')))) :
    el('p', { class: 'muted' }, 'Your story is still unwritten. Buy development cards with 1 wool, 1 grain, and 1 ore.'), el('p', { class: 'muted small' }, 'Play one card per turn, even before rolling. Newly bought cards must wait. Hidden victory points can win immediately.'));
}
function renderActions(view, ui, pending) {
  let content;
  if (view.phase === 'discard' && view.discards[view.me.id]) content = resourcePicker(view, ui, 'discard', pending);
  else if (ownTurn(view) && view.phase === 'year_of_plenty') content = resourcePicker(view, ui, 'plenty', pending);
  else if (ownTurn(view) && view.phase === 'monopoly') content = el('div', {}, el('h3', {}, 'Choose your monopoly'), el('p', { class: 'muted small' }, 'Take every opponent’s cards of one resource type.'), RESOURCES.map(resource => button([resourceIcon(resource), RESOURCE_NAMES[resource]], 'monopoly', { class: 'button monopoly-button', 'data-resource': resource, disabled: pending })));
  else if (ownTurn(view) && view.phase === 'steal') content = el('div', {}, el('h3', {}, 'Choose a player to rob'), el('p', { class: 'muted small' }, 'Take one random resource card. Only opponents with cards beside this hex are eligible.'), view.legal.victims.map(id => button(ownerName(view, id), 'steal', { class: 'button secondary wide', 'data-victim': id, disabled: pending })));
  else if (ownTurn(view) && ['setup_settlement', 'setup_road', 'robber', 'road_building'].includes(view.phase)) content = el('div', {},
    el('h3', {}, { setup_settlement: 'Choose your new home.', setup_road: 'Connect your settlement.', robber: 'A shadow on the island.', road_building: 'Build without spending.' }[view.phase]),
    el('p', { class: 'muted' }, view.phase === 'robber' && view.robberRoll ? `Destination roll: ${view.robberRoll.dice.join(' + ')} = ${view.robberRoll.total}. ${view.robberRoll.total === 7 ? 'Move to the desert.' : 'Only matching number tokens are eligible.'}${view.robberRoll.attempts > 1 ? ` ${view.robberRoll.attempts - 1} automatic rerolls.` : ''}` : view.phase === 'setup_settlement' ? 'Tap a glowing intersection. Your second settlement supplies your starting resources.' : view.phase === 'setup_road' ? 'Tap a highlighted edge adjoining the settlement you just placed.' : view.phase === 'road_building' ? `${view.freeRoads} free roads remaining. Tap a highlighted edge.` : 'Tap another hex, then choose an adjacent opponent to rob.'),
    renderSelection(view, ui, pending), view.phase === 'road_building' ? button('Finish road building', 'finish-roads', { class: 'button quiet wide', disabled: pending }) : null);
  else content = [
    el('div', { class: 'action-tabs', role: 'tablist', 'aria-label': 'Game actions' }, ['build', 'trade', 'cards'].map(panel => button(panel[0].toUpperCase() + panel.slice(1), 'panel', { class: `button tab${(ui.panel ?? 'build') === panel ? ' selected' : ''}`, 'data-panel': panel, role: 'tab', 'aria-selected': String((ui.panel ?? 'build') === panel) }))),
    (ui.panel ?? 'build') === 'trade' ? tradePanel(view, ui, pending) : ui.panel === 'cards' ? cardsPanel(view, pending) : buildPanel(view, ui, pending),
  ];
  return el('aside', { class: 'actions-panel panel', 'data-render-key': 'actions' },
    el('div', { class: 'action-heading' }, eyebrow(ownTurn(view) ? 'YOUR NEXT MOVE' : 'AROUND THE TABLE'), el('span', { class: 'turn-counter' }, view.turnNumber ? `TURN ${view.turnNumber}` : `SETUP ${Math.min(view.setupStep + 1, view.setupTotal)} / ${view.setupTotal}`)),
    el('h2', {}, view.phase === 'discard' ? 'A little give and take.' : ownTurn(view) ? 'Make your move.' : `${ownerName(view, view.currentPlayerId)} is playing.`),
    view.legal.canRoll ? button('ROLL DICE', 'roll', { class: 'button primary wide roll-button', disabled: pending }) : null,
    content,
    view.trade && ui.panel !== 'trade' ? button('A trade is on the table ↗', 'panel', { class: 'button trade-alert wide', 'data-panel': 'trade' }) : null,
    view.legal.canEnd ? button('END TURN →', 'end-turn', { class: 'button end-turn wide', disabled: pending }) : null,
    el('details', { class: 'bank-overview', 'data-render-key': 'bank-details' }, el('summary', {}, 'Resource bank & awards'),
      el('div', { class: 'bank-counts' }, RESOURCES.map(resource => el('span', {}, resourceIcon(resource), `${view.bank[resource]} ${RESOURCE_NAMES[resource]}`))),
      el('p', { class: 'small muted' }, `Longest Road: ${view.longestRoadOwner ? ownerName(view, view.longestRoadOwner) : 'unclaimed'} (5+ roads). Largest Army: ${view.largestArmyOwner ? ownerName(view, view.largestArmyOwner) : 'unclaimed'} (3+ Knights). Awards are worth 2 points each. Incumbents keep tied awards.`)),
  );
}
export function renderGame(view, ui, pending) {
  const inspect = ui.inspectedHex !== undefined ? view.board.hexes[ui.inspectedHex] : null;
  return el('div', { class: 'game', 'data-render-key': 'game' },
    view.phase === 'game_result' && ui.reviewResult ? button('SHOW RESULTS · PLAY AGAIN', 'show-result', { class: 'button primary', 'data-render-key': 'show-result' }) : null,
    renderPlayers(view),
    el('div', { class: 'play-layout' },
      el('div', { class: 'table-column', 'data-render-key': 'table-column' },
        el('div', { class: 'turn-banner', 'data-render-key': 'turn-banner' }, el('div', {}, eyebrow(`${view.targetScore} VICTORY POINTS TO WIN${view.players.length === 2 ? ' · DICE-DIRECTED ROBBER' : ''}`), el('strong', { class: ownTurn(view) ? 'your-turn' : '' }, turnAnnouncement(view))), renderDice(view.dice)),
        el('section', { class: 'board-panel', 'data-render-key': 'board-panel' }, renderBoard(view, ui), el('div', { class: 'board-caption' },
          el('span', {}, inspect ? `${terrainNames[inspect.terrain]} · ${TERRAIN_RESOURCE[inspect.terrain] ? `${RESOURCE_NAMES[TERRAIN_RESOURCE[inspect.terrain]]} · Roll ${inspect.number}` : 'No resource production'}` : 'Tap a terrain to inspect · Glowing locations are legal'), el('span', {}, 'CATANA CODEX'))),
        renderHand(view),
      ),
      el('div', { class: 'sidebar', 'data-render-key': 'sidebar' }, renderActions(view, ui, pending),
        el('details', { class: 'journal panel', open: true, 'data-render-key': 'journal' }, el('summary', {}, 'Island journal'), el('ol', {}, view.log.toReversed().map(entry => el('li', { 'data-render-key': `event-${entry.id}-${entry.text}` }, entry.text))))),
    ),
    view.phase === 'game_result' ? renderResult(view, pending) : null,
  );
}
function renderResult(view, pending) {
  const winner = view.players.find(player => player.id === view.winnerId);
  return el('section', { class: `result-overlay${winner.id === view.me.id ? ' your-victory' : ''}`, 'data-render-key': 'result', role: 'region', 'aria-label': 'Game results' },
    el('div', { class: 'result-card panel' }, el('span', { class: 'victory-seal', 'aria-hidden': 'true' }, '♛'), eyebrow('A CHAPTER TO REMEMBER'), el('h1', {}, winner.id === view.me.id ? 'Your island.' : winner.name, el('br'), el('em', {}, winner.id === view.me.id ? 'Your victory.' : 'takes the crown.')),
      el('p', { class: 'muted' }, `${winner.name} wins with ${winner.score} victory points.`),
      el('ol', { class: 'result-scores' }, [...view.players].sort((a, b) => b.score - a.score).map(player => el('li', {}, el('span', {}, player.name), el('span', {}, `${player.score} VP`, el('small', {}, `${player.victoryCards} hidden victory cards`))))),
      view.me.host ? button('PLAY AGAIN · A NEW ISLAND', 'play-again', { class: 'button primary wide', disabled: pending }) : el('p', { class: 'muted' }, 'Waiting for the host to start another match.'), button('Review the island', 'review-result', { class: 'button quiet wide' })));
}
export function renderRules() {
  const sections = [
    ['Your objective', 'Build settlements (1 point) and cities (2 points), earn Longest Road and Largest Army (2 points each), and collect hidden Victory Point cards (1 point each). Win immediately on your own turn at 10 points with 3–4 players, or 12 with 2 players. An award gained on another player’s turn cannot win until your own turn begins.'],
    ['A new island', '19 hexes: 4 forests, 4 pastures, 4 fields, 3 hills, 3 mountains, and 1 desert. Number tokens are 2 and 12 once each, and 3–6 and 8–11 twice each. No 6 or 8 touches another 6 or 8. The board and nine harbors are generated by the host once per match.'],
    ['Settle in snake order', 'A random player begins. Each player places a settlement and an adjoining road in clockwise order, then everyone does so in reverse order, starting with the last player again. Keep at least one empty intersection between all settlements. Your second settlement gives one starting resource from each adjacent productive hex. The first placing player takes the first turn.'],
    ['Dice & resources', 'On your turn, roll two dice. All settlements beside matching hexes receive 1 resource and cities receive 2. Forests produce lumber; hills brick; pastures wool; fields grain; mountains ore. The robber blocks its hex. Each resource has 19 cards. If several players need more of a resource than the bank holds, nobody receives that resource. If only one player needs it, they receive the remaining cards. Other resources are unaffected.'],
    ['Build & trade', 'After rolling, you can trade and build in any order. Roads cost 1 brick + 1 lumber. Settlements cost 1 brick + 1 lumber + 1 wool + 1 grain. Cities cost 2 grain + 3 ore and replace your own settlement, returning that piece. Development cards cost 1 wool + 1 grain + 1 ore. You have 15 roads, 5 settlements and 4 cities. Roads must connect to your own town or road; an opponent’s town blocks continuation. New settlements need an adjoining road and must obey the distance rule.'],
    ['Negotiation & harbors', 'Offer resources you own for resources you want; other players may accept or counter. Every player trade must involve the player whose turn it is. Gifts and swapping the same resource in both directions are not allowed. Trade 4 identical resources with the bank for any 1 other resource. A town at a general harbor gives 3:1; a resource harbor gives 2:1 for that resource. A harbor can be used the turn it is acquired.'],
    ['Seven & the robber', 'A 7 produces nothing. Every player holding more than 7 resource cards discards half, rounded down. After all discards, the current player moves the robber to a different hex, then steals one random card from an eligible adjacent opponent. When there are multiple opponents, choose one. Empty hands cannot be robbed. A Knight moves and steals without causing discards.'],
    ['Exactly two players', 'All standard rules apply except the target is 12 points and every robber move uses a separate two-dice destination roll. Move to a hex showing that total; 7 means the desert. The robber must leave its current hex. If the result has no valid destination, the host automatically rerolls until it does. If several hexes qualify, choose one. No extra towns, extra turns or other two-player variants are used.'],
    ['Development cards', 'The deck has 14 Knights, 5 Victory Points, and 2 each of Road Building, Year of Plenty and Monopoly. Play one non-Victory-Point card per turn, before or after rolling, only if bought on an earlier turn. Resolve discards and robber actions before playing another action. A Knight moves the robber and steals a resource. Road Building places up to two free legal roads; unavailable pieces or locations can reduce that number. Year of Plenty takes two available resources, or fewer if fewer remain in the entire bank. Monopoly takes every opponent’s cards of one chosen resource. Cards cannot be traded. Victory Points stay hidden and count toward immediate victory, including newly bought ones.'],
    ['Longest Road & Largest Army', 'Longest Road requires at least 5 connected road segments. Count the longest continuous route, using each road once; forks do not add separate branches, loops are allowed, and an opponent’s settlement or city breaks a route. Largest Army requires at least 3 played Knights. To take an award, exceed the holder’s count. A tie preserves the holder. If a road is broken and the holder is no longer tied for the longest, a sole qualifying leader takes the award; a tie between other leaders leaves it unclaimed.'],
    ['Playing together', 'Only the host validates actions and draws dice and cards. Your resource types and unplayed development cards are sent only to you; opponents see counts and public scores. Keep the host’s tab open. As with the other turn-based games here, a lost player connection stops the match. The host can return the remaining players to the lobby so a disconnected friend can rejoin and everyone can start fresh. A lost host connection ends the room.'],
  ];
  return el('div', { class: 'rules-content' }, eyebrow('THE CATANA CODEX'), el('h2', {}, 'A little knowledge.', el('br'), el('em', {}, 'A grand adventure.')), sections.map(([title, text]) => el('section', {}, el('h3', {}, title), el('p', {}, text))),
    el('p', { class: 'muted small' }, 'Original artwork and interface. An independent implementation inspired by classic resource-trading board games.'));
}
