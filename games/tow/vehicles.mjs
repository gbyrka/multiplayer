// Vehicle artwork from PARK, kept local to this independently published repository.
import { hitch } from './physics.mjs';

export class VehicleArt {
  rect(ctx, x, y, w, h, radius, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  text(ctx, text, x, y, size, color, weight = 600) {
    ctx.font = `${weight} ${size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, x, y);
  }

  drawLights(ctx, car) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.a);
    const beam = ctx.createLinearGradient(0, -car.h / 2, 0, -car.h / 2 - 100);
    beam.addColorStop(0, '#f2ecc91c'); beam.addColorStop(1, '#f2ecc900');
    ctx.fillStyle = beam;
    for (const x of [-11, 11]) {
      ctx.beginPath(); ctx.moveTo(x - 4, -29); ctx.lineTo(x - 32, -125); ctx.lineTo(x + 32, -125); ctx.lineTo(x + 4, -29); ctx.fill();
    }
    ctx.restore();
  }

  brakeLights(ctx, width, length, active, reverse) {
    ctx.save();
    ctx.fillStyle = active ? '#ff6d55' : '#923e38';
    ctx.shadowColor = '#ff533b'; ctx.shadowBlur = active ? 13 : 0;
    this.rect(ctx, -width / 2 + 3, length / 2 - 6, 8, 3, 1, ctx.fillStyle);
    this.rect(ctx, width / 2 - 11, length / 2 - 6, 8, 3, 1, ctx.fillStyle);
    if (active) this.rect(ctx, -5, length / 2 - 8, 10, 2, 1, '#ff6d55');
    if (reverse) { ctx.shadowColor = '#fffbd6'; ctx.fillStyle = '#fffbd6'; ctx.fillRect(-7, length / 2 - 5, 3, 2); ctx.fillRect(4, length / 2 - 5, 3, 2); }
    ctx.restore();
  }

  drawCar(ctx, car, color, player) {
    ctx.save(); ctx.translate(car.x, car.y); ctx.rotate(car.a);
    ctx.save(); ctx.shadowColor = '#050e0ddd'; ctx.shadowBlur = 7; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
    this.rect(ctx, -17, -32, 34, 64, 9, '#121b18'); ctx.restore();
    for (const x of [-17, 17]) for (const y of [-19, 20]) {
      ctx.save(); ctx.translate(x, y); if (y < 0 && player) ctx.rotate(car.steer);
      this.rect(ctx, -3, -7, 6, 14, 2, '#0b1110'); ctx.fillStyle = '#59615a'; ctx.fillRect(x < 0 ? -3 : 2, -4, 1, 8); ctx.restore();
    }
    const paint = ctx.createLinearGradient(-17, 0, 17, 0);
    paint.addColorStop(0, '#1a211d'); paint.addColorStop(.12, color); paint.addColorStop(.5, color); paint.addColorStop(.87, color); paint.addColorStop(1, '#253027');
    this.rect(ctx, -17, -32, 34, 64, 8, paint, '#0b151888');
    this.rect(ctx, -14, -29, 28, 14, 5, '#ffffff10');
    ctx.strokeStyle = '#161e2033'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(-10, -25); ctx.lineTo(-11, -18); ctx.moveTo(10, -25); ctx.lineTo(11, -18); ctx.stroke();
    ctx.fillStyle = '#172e30';
    ctx.beginPath(); ctx.moveTo(-12, -16); ctx.quadraticCurveTo(0, -20, 12, -16); ctx.lineTo(10, -4); ctx.lineTo(-10, -4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#aed1c63a'; ctx.beginPath(); ctx.moveTo(-11, -15); ctx.lineTo(5, -16); ctx.lineTo(-3, -5); ctx.lineTo(-10, -5); ctx.fill();
    this.rect(ctx, -10, -2, 20, 18, 4, color);
    this.rect(ctx, -9, -1, 18, 2, 1, '#ffffff28');
    ctx.fillStyle = '#192d2e'; ctx.beginPath(); ctx.moveTo(-10, 17); ctx.lineTo(10, 17); ctx.lineTo(12, 25); ctx.lineTo(-12, 25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b3d1c429'; ctx.fillRect(-8, 18, 13, 2);
    ctx.fillStyle = '#142524'; ctx.fillRect(-15, -8, 3, 22); ctx.fillRect(12, -8, 3, 22);
    this.rect(ctx, -21, -12, 5, 7, 2, color); this.rect(ctx, 16, -12, 5, 7, 2, color);
    ctx.fillStyle = '#ffffff55'; ctx.fillRect(-14, 8, 2, 4); ctx.fillRect(12, 8, 2, 4);
    ctx.save(); ctx.shadowColor = '#fff3c1'; ctx.shadowBlur = player ? 7 : 0;
    this.rect(ctx, -13, -30, 8, 3, 1, player ? '#fff0bc' : '#b8c3b6'); this.rect(ctx, 5, -30, 8, 3, 1, player ? '#fff0bc' : '#b8c3b6'); ctx.restore();
    this.rect(ctx, -6, -31, 12, 2, 1, '#172421');
    this.rect(ctx, -5, 29, 10, 2, 1, '#e3dfbb');
    this.brakeLights(ctx, car.w, car.h, player && car.braking, player && car.speed < -.5);
    ctx.restore();
  }

  drawTrailer(ctx, rig) {
    const trailer = rig.trailer, h = hitch(rig.car);
    ctx.strokeStyle = '#88958c'; ctx.lineWidth = 3;
    const sin = Math.sin(trailer.a), cos = Math.cos(trailer.a);
    const front = { x: trailer.x + sin * 26, y: trailer.y - cos * 26 };
    ctx.beginPath(); ctx.moveTo(front.x - cos * 12, front.y - sin * 12); ctx.lineTo(h.x, h.y); ctx.lineTo(front.x + cos * 12, front.y + sin * 12); ctx.stroke();
    ctx.save(); ctx.translate(trailer.x, trailer.y); ctx.rotate(trailer.a);
    this.rect(ctx, -20, -2, 6, 16, 2, '#0d1713'); this.rect(ctx, 14, -2, 6, 16, 2, '#0d1713');
    ctx.save(); ctx.shadowColor = '#020c0999'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 5;
    this.rect(ctx, -16, -29, 32, 58, 4, '#d4d9cd'); ctx.restore();
    const roof = ctx.createLinearGradient(-14, 0, 14, 0); roof.addColorStop(0, '#b0baad'); roof.addColorStop(.25, '#f1f1e6'); roof.addColorStop(1, '#c7cfc1');
    this.rect(ctx, -14, -27, 28, 52, 3, roof, '#879786');
    ctx.strokeStyle = '#a7b3a4'; ctx.lineWidth = 1;
    for (const x of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(x, -22); ctx.lineTo(x, 21); ctx.stroke(); }
    this.rect(ctx, -9, -4, 18, 12, 2, '#b9c4b5');
    this.text(ctx, 'P', 0, 5, 9, '#738570', 800);
    this.brakeLights(ctx, trailer.w, trailer.h, rig.car.braking, rig.car.speed < -.5);
    ctx.restore();
  }

}
