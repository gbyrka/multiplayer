import { el } from './dom.mjs';

/** Sokoban's warm halo, mint/gold particles and staged medal reveal, adapted for a table. */
export class VictoryCelebration {
  constructor() {
    this.layer = el('div', { class: 'celebration', 'aria-hidden': 'true', hidden: true });
    this.canvas = el('canvas');
    this.layer.append(this.canvas);
    document.body.append(this.layer);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.frame = 0;
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
    window.addEventListener('resize', () => this.cancel());
    this.motion.addEventListener('change', () => this.cancel());
  }

  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.layer.hidden = true;
    this.layer.classList.remove('playing');
  }

  play(winners, own) {
    this.cancel();
    if (!own || this.motion.matches || document.hidden) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const banner = document.querySelector('[data-winner-banner]');
    if (!banner) return;
    const bounds = banner.getBoundingClientRect();
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const origin = { x: w / 2, y: Math.max(130, Math.min(h - 130, bounds.top + bounds.height / 2)) };
    this.layer.style.setProperty('--victory-y', `${origin.y}px`);
    const moment = el('div', { class: 'victory-moment' },
      el('div', { class: 'victory-emblem' }, '✦'),
      el('span', {}, winners.length > 1 ? 'A SHARED VICTORY' : 'A PLAN WELL PLAYED'),
      el('strong', {}, winners.length > 1 ? 'You share the win.' : 'Beautifully played.'),
      el('i', {}, 'A little foresight. A well-earned win.'),
    );
    this.layer.replaceChildren(this.canvas, moment);
    const colors = ['#f6d88f', '#e5ad59', '#fff1c3', '#a9c994', '#6ea897'];
    const particles = Array.from({ length: w < 600 ? 90 : 145 }, (_, i) => {
      const angle = -Math.PI + Math.random() * Math.PI;
      const speed = 130 + Math.random() * 380;
      return {
        x: i % 3 ? origin.x : w * (i % 2 ? .15 : .85), y: i % 3 ? origin.y : Math.min(h - 20, bounds.bottom),
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 100,
        size: 3 + Math.random() * 5, spin: Math.random() * 8 - 4, phase: Math.random() * Math.PI,
        color: colors[i % colors.length], delay: i % 3 ? 0 : .22, star: i % 7 === 0,
      };
    });
    this.layer.hidden = false;
    this.layer.classList.add('playing');
    const started = performance.now();
    const draw = now => {
      const t = (now - started) / 1000;
      if (t >= 2.4) { this.cancel(); return; }
      ctx.clearRect(0, 0, w, h);
      const fade = Math.min(1, (2.4 - t) / .4);
      if (t < 1.1) {
        const radius = 15 + t * Math.max(bounds.width, bounds.height) * 1.25;
        const halo = ctx.createRadialGradient(origin.x, origin.y, radius * .72, origin.x, origin.y, radius);
        halo.addColorStop(0, '#f4d58a00');
        halo.addColorStop(.6, `rgba(246,216,143,${.25 * (1 - t / 1.1)})`);
        halo.addColorStop(1, '#f4d58a00');
        ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
      }
      for (const p of particles) {
        const age = t - p.delay;
        if (age < 0) continue;
        const drag = (1 - Math.exp(-1.5 * age)) / 1.5;
        ctx.save();
        ctx.globalAlpha = fade * Math.min(1, age * 12);
        ctx.translate(p.x + p.vx * drag, p.y + p.vy * drag + 135 * age * age);
        ctx.rotate(p.phase + age * p.spin);
        ctx.fillStyle = p.color;
        if (p.star) {
          ctx.beginPath(); ctx.moveTo(0, -p.size);
          ctx.quadraticCurveTo(1, -1, p.size, 0); ctx.quadraticCurveTo(1, 1, 0, p.size);
          ctx.quadraticCurveTo(-1, 1, -p.size, 0); ctx.quadraticCurveTo(-1, -1, 0, -p.size); ctx.fill();
        } else {
          ctx.scale(1, .35 + .65 * Math.abs(Math.cos(age * 7 + p.phase)));
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .55);
        }
        ctx.restore();
      }
      this.frame = requestAnimationFrame(draw);
    };
    this.frame = requestAnimationFrame(draw);
  }
}
