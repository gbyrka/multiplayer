import { rankRace } from '../tow/race.mjs';
import { COLORS } from '../tow/scene.mjs';
import { el } from '../../shared/dom.mjs';

/** Use host progress, including resets and completed trailer crossings. */
export function driverProgress(state, track, slot) {
  const finished = state.finished[slot] !== null;
  return { slot, finished, fraction: finished ? 1 : Math.max(0, Math.min(.99,
    (state.progress[slot] - track.start) / (track.finish - track.start))) };
}

export class RaceProgress {
  constructor(root) { this.root = root; this.rows = []; }
  configure(track) { this.track = track; this.rows = []; this.root.replaceChildren(); }
  update(state, slot, names) {
    if (!this.track) return;
    if (this.rows.length !== state.rigs.length) {
      const title = el('div', { class: 'standings-title' }, el('span', {}, 'THE RACE'), el('span', {}, 'FINISH ⚑'));
      this.rows = state.rigs.map((_, i) => {
        const label = el('span', { class: 'standings-name' });
        const value = el('span', { class: 'standings-value' });
        const fill = el('i');
        const row = el('div', { class: `standings-row${i === slot ? ' is-you' : ''}`, style: `--driver:${COLORS[i]}` },
          el('div', { class: 'standings-meta' }, label, value), el('div', { class: 'standings-track' }, fill));
        return { row, label, value, fill };
      });
      this.root.replaceChildren(title, ...this.rows.map(r => r.row));
    }
    const ranked = rankRace(state);
    this.rows.forEach(({ row, label, value, fill }, i) => {
      const { fraction, finished } = driverProgress(state, this.track, i);
      label.textContent = `${ranked.indexOf(i) + 1}. ${names[i]}${i === slot ? ' · YOU' : ''}`;
      value.textContent = finished ? 'FINISHED' : `${Math.floor(fraction * 100)}%`;
      fill.style.transform = `scaleX(${fraction})`;
      row.setAttribute('aria-label', `${names[i]}${i === slot ? ', you' : ''}, position ${ranked.indexOf(i) + 1}, ${finished ? 'finished' : `${Math.floor(fraction * 100)} percent of route`}`);
    });
  }
}
