/** Effects follow newly accepted public views, never clicks, private hands or rerenders. */
export function getViewEffects(previous, next) {
  if (!previous || !next || next.revision <= previous.revision) return [];
  const effects = [];
  if (previous.handNumber === next.handNumber && previous.trickNumber === next.trickNumber &&
      ['playing', 'trick_result'].includes(next.phase)) {
    const seen = new Set(previous.trick.map(entry => `${entry.playerId}:${entry.card.id}`));
    for (const entry of next.trick) {
      if (!seen.has(`${entry.playerId}:${entry.card.id}`)) effects.push({ type: 'card', own: entry.playerId === next.me.id });
    }
  }
  if (next.phase === 'game_result' && previous.phase !== 'game_result') {
    const best = Math.max(...next.players.map(player => player.totalScore));
    const winners = next.players.filter(player => player.totalScore === best);
    if (winners.some(player => player.id === next.me.id)) effects.push({ type: 'victory', winners: winners.map(player => player.name), own: true });
  }
  return effects;
}
