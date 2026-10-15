import { planAdapter, PHASES } from './plan/game-core.mjs';
import { renderPlan, renderScoreboard, turnAnnouncement } from './plan/ui.mjs';
import { renderRules } from './plan/rules.mjs';

/** Add a descriptor and adapter here to share the shell, rooms and transport. */
export const GAMES = Object.freeze([{
  id: 'plan', title: 'PLAN', subtitle: 'Predict your tricks.',
  description: 'A little strategy. A little intuition. Six rounds, with a turn to open the bidding for everyone.',
  players: '2–6 players', duration: '20–60 min', category: 'CARDS & PREDICTIONS',
  peerNamespace: 'plan-v1-', adapter: planAdapter, phases: PHASES,
  renderGame: renderPlan, renderScoreboard, renderRules, turnAnnouncement,
}]);
export const getGame = id => GAMES.find(game => game.id === id) ?? GAMES[0];

// Realtime and standalone games load their own entry points separately from PLAN's adapter.
export const COLLECTION_GAMES = Object.freeze([Object.freeze({
  id: 'catana', title: 'Catana Codex', subtitle: 'A world worth building.',
  description: 'Settle a new island, trade with friends, and turn a handful of resources into roads, towns, and a winning strategy.',
  players: '2–4 players', duration: '45–90 min', category: 'BUILDING & TRADING · ONLINE MULTIPLAYER',
  href: './games/catana/', cover: './assets/catana-cover.jpg',
  coverSrcset: './assets/catana-cover-600.webp 600w, ./assets/catana-cover-1200.webp 1200w',
  coverAlt: 'A hexagonal island with forests, fields, mountains and colorful wooden settlements surrounded by a teal sea',
}), Object.freeze({
  id: 'hamster', title: 'HAMSTER multiplayer', subtitle: 'Little paws. Big company.',
  description: 'Explore a cozy three-floor habitat with friends. Gather treats, dash past rivals, and bank the most snacks before the picnic ends.',
  players: '2–4 players', duration: '3 min', inputLabel: 'Keyboard & touch', category: '3D PICNIC · ONLINE MULTIPLAYER',
  href: './games/hamster/', cover: './assets/hamster-cover.webp',
  coverAlt: 'A golden hamster surrounded by wooden hideouts, colorful tunnels and treats',
}), ...GAMES, Object.freeze({
  id: 'tow', title: 'TOW', subtitle: 'Keep your trailer close.',
  description: 'Race your friends along a new winding road. Dodge the barrels, mind the corners, and bring your trailer across the finish.',
  players: '2–4 drivers', duration: '1–3 min', category: 'TRAILER RACING · ONLINE MULTIPLAYER',
  href: './games/tow/', cover: './assets/tow-cover.jpg',
  coverSrcset: './assets/tow-cover-600.webp 600w, ./assets/tow-cover-1200.webp 1200w',
  coverAlt: 'Four colorful cars towing ivory trailers around a winding forest road',
  controls: 'Keyboard controls only for now',
})]);
