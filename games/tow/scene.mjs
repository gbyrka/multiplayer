import { VehicleArt } from './vehicles.mjs';
import { pointAt, project, seededRandom } from './track.mjs';

export const COLORS = ['#f1ba58', '#84bec7'];

export class RaceScene {
  constructor(canvas, minimap) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.map = minimap; this.mapCtx = minimap.getContext('2d');
    this.art = new VehicleArt(); this.camera = null;
    this.tile = document.createElement('canvas'); this.tile.width = this.tile.height = 128;
    const ctx = this.tile.getContext('2d'), random = seededRandom(1847);
    ctx.fillStyle = '#2e3734'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 420; i++) { ctx.fillStyle = i % 3 === 0 ? '#b1bfa514' : '#101a1820'; ctx.fillRect(random() * 128, random() * 128, random() * 1.6 + .3, .7); }
    this.asphalt = this.ctx.createPattern(this.tile, 'repeat');
  }
  configure(track) { this.track = track; this.camera = null; this.resize(); }
  resize() {
    const rect = this.canvas.getBoundingClientRect(), density = Math.min(2, devicePixelRatio || 1);
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * density); this.canvas.height = Math.round(this.height * density); this.density = density;
    this.map.width = Math.round(170 * density); this.map.height = Math.round(190 * density);
  }
  path(ctx, offset = 0) {
    ctx.beginPath();
    this.track.points.forEach((p, i) => {
      const q = this.track.points[Math.min(i + 1, this.track.points.length - 1)], previous = this.track.points[Math.max(0, i - 1)];
      const dx = q.x - previous.x, dy = q.y - previous.y, length = Math.hypot(dx, dy);
      const x = p.x - dy / length * offset, y = p.y + dx / length * offset;
      if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
  }
  gate(ctx, distance, finish = false) {
    const p = pointAt(this.track, distance);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
    if (finish) {
      for (let row = 0; row < 2; row++) for (let col = 0; col < 16; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#e3e5d9' : '#17211e'; ctx.fillRect(-160 + col * 20, -14 + row * 14, 20, 14);
      }
      this.art.text(ctx, 'F I N I S H', 0, -34, 15, '#d8e9c7', 800);
    } else {
      ctx.strokeStyle = '#c4ee9135'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.moveTo(-150, 0); ctx.lineTo(150, 0); ctx.stroke();
      ctx.setLineDash([]);
      for (const x of [-162, 162]) this.art.rect(ctx, x - 5, -14, 10, 28, 2, '#c4ee91');
    }
    ctx.restore();
  }
  draw(rigs, slot, names, state, dt) {
    if (!this.track || !rigs) return;
    const { ctx, width, height, density } = this, car = rigs[slot].car;
    const target = { x: car.x + car.vx * .38, y: car.y + car.vy * .38 };
    if (!this.camera) this.camera = target;
    const follow = 1 - Math.exp(-9 * dt);
    this.camera.x += (target.x - this.camera.x) * follow; this.camera.y += (target.y - this.camera.y) * follow;
    const zoom = Math.max(.42, Math.min(width / 920, height / 620));
    ctx.setTransform(density, 0, 0, density, 0, 0); ctx.fillStyle = '#354933'; ctx.fillRect(0, 0, width, height);
    ctx.translate(width / 2, height * .55); ctx.scale(zoom, zoom); ctx.translate(-this.camera.x, -this.camera.y);
    const visible = (x, y, margin = 90) => Math.abs(x - this.camera.x) < width / zoom / 2 + margin && Math.abs(y - this.camera.y) < height / zoom + margin;
    // Decorations are deterministic and culled; no enormous map-sized canvas.
    for (let i = 0; i < this.track.points.length; i += 3) {
      const p = pointAt(this.track, this.track.points[i].s), random = seededRandom(this.track.seed + i * 73);
      for (const side of [-1, 1]) {
        const distance = side * (230 + random() * 110), x = p.x + p.nx * distance, y = p.y + p.ny * distance;
        if (!visible(x, y)) continue;
        ctx.fillStyle = '#15291855'; ctx.beginPath(); ctx.ellipse(x + 9, y + 12, 31, 24, .3, 0, Math.PI * 2); ctx.fill();
        for (let n = 0; n < 5; n++) {
          ctx.fillStyle = ['#4a6740', '#58764a', '#3a5838', '#63814e', '#425e3c'][n];
          ctx.beginPath(); ctx.arc(x + (random() - .5) * 26, y + (random() - .5) * 26, 13 + random() * 9, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    ctx.lineJoin = ctx.lineCap = 'round';
    this.path(ctx); ctx.strokeStyle = '#172d2199'; ctx.lineWidth = 368; ctx.stroke();
    this.path(ctx); ctx.strokeStyle = '#87917b'; ctx.lineWidth = 354; ctx.stroke();
    this.path(ctx); ctx.strokeStyle = this.asphalt; ctx.lineWidth = 344; ctx.stroke();
    for (const edge of [-156, 156]) { this.path(ctx, edge); ctx.strokeStyle = '#c6cdb765'; ctx.lineWidth = 2; ctx.stroke(); }
    this.path(ctx); ctx.strokeStyle = '#c4cbb63a'; ctx.lineWidth = 2; ctx.setLineDash([23, 24]); ctx.stroke(); ctx.setLineDash([]);
    for (let distance = 700; distance < this.track.finish; distance += 500) {
      const p = pointAt(this.track, distance); if (!visible(p.x, p.y, 40)) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.strokeStyle = '#c4ee9144'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-12, 8); ctx.lineTo(0, -5); ctx.lineTo(12, 8); ctx.stroke(); ctx.restore();
    }
    for (const obstacle of this.track.obstacles) if (visible(obstacle.x, obstacle.y)) {
      ctx.save(); ctx.translate(obstacle.x, obstacle.y); ctx.rotate(obstacle.a);
      ctx.shadowColor = '#0007'; ctx.shadowBlur = 5; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 4;
      this.art.rect(ctx, -obstacle.w / 2, -obstacle.h / 2, obstacle.w, obstacle.h, obstacle.kind === 'barrel' ? 8 : 3, '#ba7852', '#503e2e');
      ctx.shadowBlur = 0; this.art.rect(ctx, -obstacle.w / 2 + 3, -4, obstacle.w - 6, 8, 1, '#eadcb8');
      ctx.restore();
    }
    for (const distance of this.track.gates) { const p = pointAt(this.track, distance); if (visible(p.x, p.y)) this.gate(ctx, distance, distance === this.track.finish); }
    const start = pointAt(this.track, this.track.start + 60);
    if (visible(start.x, start.y)) {
      ctx.save(); ctx.translate(start.x, start.y); ctx.rotate(start.a); ctx.fillStyle = '#c4ee9155'; ctx.fillRect(-158, -2, 316, 4);
      this.art.text(ctx, 'S T A R T', 0, 29, 13, '#d8e9c7', 750); ctx.restore();
    }
    rigs.forEach((rig, i) => {
      ctx.save(); if (state.finished[i] !== null) ctx.globalAlpha = .5;
      this.art.drawLights(ctx, rig.car); this.art.drawTrailer(ctx, rig); this.art.drawCar(ctx, rig.car, COLORS[i], true);
      this.art.rect(ctx, rig.car.x - 42, rig.car.y + 50, 84, 19, 5, '#15251de8', COLORS[i] + '66');
      this.art.text(ctx, `${i + 1} · ${names[i] ?? 'Driver'}`, rig.car.x, rig.car.y + 63, 10, COLORS[i], 750); ctx.restore();
    });
    this.drawMap(rigs, slot);
  }

  drawMap(rigs, slot) {
    const ctx = this.mapCtx, density = this.density, { bounds } = this.track;
    ctx.setTransform(density, 0, 0, density, 0, 0); ctx.clearRect(0, 0, 170, 190);
    const mx = x => 17 + (x - bounds.minX) / (bounds.maxX - bounds.minX) * 136;
    const my = y => 12 + (y - bounds.minY) / (bounds.maxY - bounds.minY) * 160;
    ctx.beginPath(); this.track.points.forEach((p, i) => i ? ctx.lineTo(mx(p.x), my(p.y)) : ctx.moveTo(mx(p.x), my(p.y)));
    ctx.strokeStyle = '#80927c'; ctx.lineWidth = 5; ctx.lineJoin = 'round'; ctx.stroke();
    const finish = pointAt(this.track, this.track.finish);
    this.art.text(ctx, '⚑', mx(finish.x), my(finish.y) + 3, 15, '#e9efdf', 800);
    rigs.forEach((rig, i) => {
      const p = project(this.track, rig.car.x, rig.car.y), x = mx(p.x) + (i ? 5 : -5), y = my(p.y);
      ctx.beginPath(); ctx.arc(x, y, i === slot ? 5 : 4, 0, Math.PI * 2); ctx.fillStyle = COLORS[i]; ctx.fill();
      ctx.strokeStyle = '#17251d'; ctx.lineWidth = 2; ctx.stroke();
      this.art.text(ctx, String(i + 1), x + (i ? 13 : -13), y + 4, 10, COLORS[i], 800);
    });
    this.art.text(ctx, 'ROUTE OVERVIEW', 85, 185, 8, '#a7b69f', 650);
  }
}
