import { randomInt } from '../../shared/random.mjs';
import { TERRAIN_COUNTS, NUMBER_TOKENS, RESOURCES } from './constants.mjs';

export const HEX_RADIUS = 72;
export const BOARD_CENTER = Object.freeze({ x: 440, y: 370 });
export const shuffle = (items, pick = randomInt) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = pick(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};

/** Canonical geometry, identical on every client. State contains only tile/piece IDs. */
function createTopology() {
  const hexes = [], vertices = [], edges = [], vertexKeys = new Map(), edgeKeys = new Map();
  for (let r = -2; r <= 2; r++) for (let q = Math.max(-2, -r - 2); q <= Math.min(2, -r + 2); q++) {
    const hex = { id: hexes.length, q, r, x: BOARD_CENTER.x + Math.sqrt(3) * HEX_RADIUS * (q + r / 2), y: BOARD_CENTER.y + HEX_RADIUS * 1.5 * r, vertices: [], edges: [], neighbors: [] };
    for (let corner = 0; corner < 6; corner++) {
      const angle = Math.PI * (corner * 60 - 30) / 180;
      const x = Math.round((hex.x + HEX_RADIUS * Math.cos(angle)) * 1000) / 1000;
      const y = Math.round((hex.y + HEX_RADIUS * Math.sin(angle)) * 1000) / 1000;
      const key = `${x},${y}`;
      if (!vertexKeys.has(key)) { vertexKeys.set(key, vertices.length); vertices.push({ id: vertices.length, x, y, hexes: [], edges: [], neighbors: [] }); }
      const id = vertexKeys.get(key); hex.vertices.push(id); vertices[id].hexes.push(hex.id);
    }
    for (let corner = 0; corner < 6; corner++) {
      const ends = [hex.vertices[corner], hex.vertices[(corner + 1) % 6]].sort((a, b) => a - b), key = ends.join(',');
      if (!edgeKeys.has(key)) {
        const id = edges.length; edgeKeys.set(key, id); edges.push({ id, vertices: ends, hexes: [] });
        ends.forEach((vertex, index) => { vertices[vertex].edges.push(id); vertices[vertex].neighbors.push(ends[1 - index]); });
      }
      const id = edgeKeys.get(key); hex.edges.push(id); edges[id].hexes.push(hex.id);
    }
    hexes.push(hex);
  }
  for (const hex of hexes) hex.neighbors = edges.filter(edge => edge.hexes.length === 2 && edge.hexes.includes(hex.id)).map(edge => edge.hexes.find(id => id !== hex.id));
  const coast = edges.filter(edge => edge.hexes.length === 1).sort((a, b) => {
    const angle = edge => { const ends = edge.vertices.map(id => vertices[id]); return Math.atan2((ends[0].y + ends[1].y) / 2 - BOARD_CENTER.y, (ends[0].x + ends[1].x) / 2 - BOARD_CENTER.x); };
    return angle(a) - angle(b);
  }).map(edge => edge.id);
  return { hexes, vertices, edges, coast };
}
export const TOPOLOGY = createTopology();

export function validateBoard(board) {
  if (!board || !Array.isArray(board.hexes) || board.hexes.length !== 19 || !Array.isArray(board.harbors) || board.harbors.length !== 9) return false;
  const counts = {};
  for (let i = 0; i < 19; i++) {
    const hex = board.hexes[i];
    if (hex?.id !== i || !Object.hasOwn(TERRAIN_COUNTS, hex.terrain)) return false;
    counts[hex.terrain] = (counts[hex.terrain] ?? 0) + 1;
    if (hex.terrain === 'desert' ? hex.number !== null : !NUMBER_TOKENS.includes(hex.number)) return false;
    if ([6, 8].includes(hex.number) && TOPOLOGY.hexes[i].neighbors.some(id => [6, 8].includes(board.hexes[id]?.number))) return false;
  }
  if (Object.entries(TERRAIN_COUNTS).some(([terrain, count]) => counts[terrain] !== count)) return false;
  const tokens = board.hexes.filter(hex => hex.number !== null).map(hex => hex.number).sort((a, b) => a - b);
  if (tokens.join() !== NUMBER_TOKENS.join()) return false;
  const portVertices = new Set(), portCounts = {};
  for (const port of board.harbors) {
    if (!port || !TOPOLOGY.coast.includes(port.edge) || (port.resource !== null && !RESOURCES.includes(port.resource))) return false;
    for (const vertex of TOPOLOGY.edges[port.edge].vertices) { if (portVertices.has(vertex)) return false; portVertices.add(vertex); }
    const type = port.resource ?? 'any'; portCounts[type] = (portCounts[type] ?? 0) + 1;
  }
  return portCounts.any === 4 && RESOURCES.every(resource => portCounts[resource] === 1);
}

export function generateBoard(pick = randomInt) {
  const terrains = shuffle(Object.entries(TERRAIN_COUNTS).flatMap(([terrain, count]) => Array(count).fill(terrain)), pick);
  const candidates = shuffle(TOPOLOGY.hexes.filter(hex => terrains[hex.id] !== 'desert').map(hex => hex.id), pick);
  // Backtracking cannot stall on unlucky repeated random layouts (also works with a deterministic test RNG).
  function findRed(start, selected) {
    if (selected.length === 4) return selected;
    for (let i = start; i < candidates.length; i++) {
      const id = candidates[i];
      if (selected.some(other => TOPOLOGY.hexes[id].neighbors.includes(other))) continue;
      const found = findRed(i + 1, [...selected, id]); if (found) return found;
    }
    return null;
  }
  const redHexes = findRed(0, []), red = shuffle([6, 6, 8, 8], pick), regular = shuffle(NUMBER_TOKENS.filter(number => ![6, 8].includes(number)), pick);
  if (!redHexes) throw new Error('Could not place number tokens.');
  const hexes = terrains.map((terrain, id) => ({ id, terrain, number: terrain === 'desert' ? null : redHexes.includes(id) ? red.pop() : regular.pop() }));
  const portTypes = shuffle([null, null, null, null, ...RESOURCES], pick), rotation = pick(30);
  const harbors = [0, 3, 6, 10, 13, 16, 20, 23, 26].map((offset, index) => ({ edge: TOPOLOGY.coast[(offset + rotation) % 30], resource: portTypes[index] }));
  const board = { hexes, harbors };
  if (!validateBoard(board)) throw new Error('Invalid board layout.');
  return board;
}
