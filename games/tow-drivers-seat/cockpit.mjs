const TAU = Math.PI * 2;
function shape(ctx, points, fill) {
  ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function round(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}
function text(ctx, value, x, y, size, color = '#d4d7c6', align = 'center') {
  ctx.font = `600 ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillStyle = color; ctx.fillText(value, x, y);
}

/** Sharp 2D interior over one economical 3D renderer. Cached trim, animated hands. */
export class Cockpit {
  constructor(canvas) {
    this.canvas = document.createElement('canvas'); this.canvas.className = 'cockpit-overlay'; this.canvas.setAttribute('aria-hidden', 'true');
    canvas.after(this.canvas); this.ctx = this.canvas.getContext('2d');
    this.trim = document.createElement('canvas'); this.angle = 0;
  }
  resize(width, height, density) {
    Object.assign(this, { width, height, density });
    for (const c of [this.canvas, this.trim]) { c.width = Math.round(width * density); c.height = Math.round(height * density); }
    const mw = Math.min(width * .20, height * .40, 212), mh = mw * .70;
    this.mirror = { x: Math.max(9, width * .026), y: height * .405, w: mw, h: mh };
    this.staticTrim();
  }
  staticTrim() {
    const ctx = this.trim.getContext('2d'), w = this.width, h = this.height;
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0); ctx.clearRect(0, 0, w, h);
    // The bonnet stays below the usable road; the windshield has a broad opening.
    const hood = ctx.createLinearGradient(0, h * .65, 0, h * .82); hood.addColorStop(0, '#dcc28d'); hood.addColorStop(1, '#93816a');
    shape(ctx, [[w*.21,h*.77],[w*.27,h*.68],[w*.76,h*.68],[w*.86,h*.79]], hood);
    ctx.strokeStyle = '#f8e9b64d'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(w*.30,h*.70); ctx.lineTo(w*.27,h*.77); ctx.moveTo(w*.73,h*.70); ctx.lineTo(w*.78,h*.77); ctx.stroke();
    // Windshield frame and A pillars, with warm edge highlights.
    shape(ctx, [[0,0],[w,0],[w,h*.045],[w*.90,h*.024],[w*.10,h*.024],[0,h*.06]], '#202c29');
    shape(ctx, [[0,0],[w*.055,0],[w*.105,h*.75],[w*.06,h*.83],[0,h*.68]], '#26342f');
    shape(ctx, [[w,0],[w*.956,0],[w*.89,h*.74],[w*.95,h*.82],[w,h*.67]], '#27362f');
    ctx.strokeStyle = '#9eab9170'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w*.055,0); ctx.lineTo(w*.105,h*.75); ctx.moveTo(w*.956,0); ctx.lineTo(w*.89,h*.74); ctx.stroke();
    // Dashboard and stitched, curved upper lip.
    const dash = ctx.createLinearGradient(0,h*.73,0,h); dash.addColorStop(0,'#475048'); dash.addColorStop(.12,'#303d36'); dash.addColorStop(1,'#15231f');
    ctx.beginPath(); ctx.moveTo(0,h*.81); ctx.bezierCurveTo(w*.23,h*.71,w*.70,h*.72,w,h*.81); ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fillStyle=dash; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0,h*.81); ctx.bezierCurveTo(w*.23,h*.71,w*.70,h*.72,w,h*.81); ctx.strokeStyle='#a3a58b'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,h*.825); ctx.bezierCurveTo(w*.23,h*.725,w*.70,h*.735,w,h*.825); ctx.setLineDash([3,5]); ctx.strokeStyle='#b7b69b50'; ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
    // Passenger vents and brushed metal strip.
    round(ctx,w*.70,h*.83,w*.21,h*.075,5,'#172720','#59685a');
    for(let i=1;i<5;i++) { ctx.fillStyle='#53604f';ctx.fillRect(w*.71,h*(.832+i*.013),w*.19,1); }
    round(ctx,w*.69,h*.94,w*.23,2,1,'#8c96775c');
    text(ctx,'T O W  /  D R I V E R ’ S  S E A T',w*.805,h*.975,Math.max(5,Math.min(8,w*.008)),'#aeb7a1');
    // Mirror housing surrounds a transparent opening into the real rear view.
    const m=this.mirror;
    ctx.strokeStyle='#2c3a32'; ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(w*.075,m.y+m.h*.70);ctx.lineTo(m.x+m.w*.60,m.y+m.h+15);ctx.stroke();
    round(ctx,m.x-6,m.y-6,m.w+12,m.h+12,12,'#27362f','#a2ab8d');
    ctx.clearRect(m.x,m.y,m.w,m.h);
    ctx.strokeStyle='#d6dac050';ctx.lineWidth=1;ctx.strokeRect(m.x+.5,m.y+.5,m.w-1,m.h-1);
    text(ctx,'LEFT  /  LIVE',m.x+9,m.y+m.h+20,Math.max(6,Math.min(8,w*.008)),'#d6dfca','left');
  }
  draw(car, color, dt) {
    const ctx=this.ctx,w=this.width,h=this.height;
    ctx.setTransform(this.density,0,0,this.density,0,0); ctx.clearRect(0,0,w,h); ctx.drawImage(this.trim,0,0,w,h);
    const speed=Math.round(Math.abs(car.speed)*4.5/64*3.6), unit=Math.max(.6,Math.min(1,w/960));
    // Compact instrument cluster behind the top of the wheel.
    const cx=w*.47, cy=h*.955, r=Math.min(h*.225,w*.225), clusterY=h*.81;
    round(ctx,cx-r*1.02,clusterY-r*.11,r*2.04,r*.58,14,'#15231fe8','#627260');
    text(ctx,String(speed).padStart(2,'0'),cx,clusterY+r*.26,r*.29,'#edce92');
    text(ctx,'KM/H',cx+r*.55,clusterY+r*.17,r*.07,'#a3b298');
    text(ctx,car.speed < -1?'R':car.speed>1?'D':'N',cx-r*.62,clusterY+r*.19,r*.15,'#c6d7ba');
    ctx.strokeStyle='#576b53';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx-r*.80,clusterY+r*.36);ctx.lineTo(cx+r*.80,clusterY+r*.36);ctx.stroke();
    ctx.strokeStyle=car.braking?'#ed967d':'#c1d294';ctx.beginPath();ctx.moveTo(cx-r*.80,clusterY+r*.36);ctx.lineTo(cx-r*.80+r*1.6*Math.min(speed/120,1),clusterY+r*.36);ctx.stroke();
    this.angle+=(car.steer*2.35-this.angle)*(1-Math.exp(-20*dt));
    const a=this.angle;
    const grip=side=>({x:cx+Math.cos(a)*side*r*.94-Math.sin(a)*(-r*.12),y:cy+Math.sin(a)*side*r*.94+Math.cos(a)*(-r*.12)});
    // Sleeves follow fixed elbows and the actual moving grip positions.
    for(const side of [-1,1]) {
      const g=grip(side),ex=cx+side*r*1.30,ey=cy+r*.95;
      ctx.lineCap='round'; ctx.strokeStyle='#10221d';ctx.lineWidth=r*.44;ctx.beginPath();ctx.moveTo(ex,ey);ctx.quadraticCurveTo(ex,g.y+r*.50,g.x,g.y+r*.15);ctx.stroke();
      ctx.strokeStyle='#627768';ctx.lineWidth=r*.35;ctx.beginPath();ctx.moveTo(ex,ey);ctx.quadraticCurveTo(ex,g.y+r*.50,g.x,g.y+r*.15);ctx.stroke();
      ctx.strokeStyle='#85947b';ctx.lineWidth=r*.023;ctx.beginPath();ctx.moveTo(ex-side*r*.07,ey);ctx.lineTo(g.x-side*r*.07,g.y+r*.27);ctx.stroke();
      ctx.strokeStyle='#394c3e';ctx.lineWidth=r*.37;ctx.beginPath();ctx.moveTo(g.x,g.y+r*.19);ctx.lineTo(g.x,g.y+r*.25);ctx.stroke();
    }
    ctx.save();ctx.translate(cx,cy);ctx.rotate(a);
    // Three spoke steering wheel with stitched rim and metal bevels.
    ctx.lineWidth=r*.14;ctx.strokeStyle='#0c1814';ctx.beginPath();ctx.arc(0,0,r,0,TAU);ctx.stroke();
    ctx.lineWidth=r*.018;ctx.strokeStyle='#77806c';ctx.beginPath();ctx.arc(0,0,r*1.075,0,TAU);ctx.stroke();
    ctx.lineWidth=r*.013;ctx.strokeStyle='#b5ad8c66';ctx.setLineDash([2*unit,6*unit]);ctx.beginPath();ctx.arc(0,0,r*.94,0,TAU);ctx.stroke();ctx.setLineDash([]);
    for(const side of [-1,1]) shape(ctx,[[side*r*.20,-r*.08],[side*r*.90,-r*.18],[side*r*.92,r*.03],[side*r*.22,r*.22]],'#637263');
    shape(ctx,[[-r*.13,r*.16],[r*.13,r*.16],[r*.16,r*.91],[-r*.16,r*.91]],'#435749');
    round(ctx,-r*.35,-r*.25,r*.70,r*.60,r*.17,'#2d4035','#7f8a6e');
    text(ctx,'T↗',0,r*.12,r*.23,color);text(ctx,'AIRBAG',0,r*.26,r*.05,'#8d9a84');
    // Bare hands: warm skin, curled fingers and thumbs around the rim.
    for(const side of [-1,1]) {
      ctx.save();ctx.translate(side*r*.94,-r*.12);ctx.rotate(-side*.13);
      const skin=ctx.createLinearGradient(-r*.14,0,r*.14,0);skin.addColorStop(0,'#b88765');skin.addColorStop(.55,'#dfb38d');skin.addColorStop(1,'#bc8c6a');
      round(ctx,-r*.125,-r*.20,r*.25,r*.43,r*.10,skin);
      round(ctx,-side*r*.03-r*.06,-r*.10,r*.12,r*.29,r*.055,'#e2b791');
      ctx.strokeStyle='#976e535c';ctx.lineWidth=Math.max(.6,r*.009);
      for(let n=0;n<3;n++) {ctx.beginPath();ctx.moveTo(-r*.10,-r*.11+n*r*.065);ctx.quadraticCurveTo(0,-r*.14+n*r*.065,r*.09,-r*.10+n*r*.065);ctx.stroke();}
      ctx.restore();
    }
    ctx.restore();
    if(car.braking) text(ctx,'BRAKE',w*.64,h*.94,8*unit,'#f1aa8b');
  }
}
