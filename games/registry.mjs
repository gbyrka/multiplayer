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
