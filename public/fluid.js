/* Meridian — dark interactive fluid background.
   Slow-drifting gradient blobs in the brand blue/indigo family, additively
   blended on black, with pointer parallax. Rendered at reduced resolution for
   performance; pauses when hidden and respects reduced-motion. */
(function () {
  'use strict';
  const canvas = document.getElementById('fx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SCALE = 0.42;              // draw small, CSS upscales — cheap + soft
  let W, H, raf = null, running = false;

  // Brand-family palette: electric blue, indigo, twilight, breeze, deep navy.
  const PAL = [
    [0, 0, 238], [40, 20, 160], [90, 60, 210], [60, 120, 210], [10, 20, 60],
  ];
  const blobs = [];
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  const rand = (a, b) => a + Math.random() * (b - a);

  function resize() {
    W = canvas.width = Math.max(320, Math.floor(innerWidth * SCALE));
    H = canvas.height = Math.max(320, Math.floor(innerHeight * SCALE));
  }
  function init() {
    blobs.length = 0;
    const n = innerWidth < 640 ? 5 : 7;
    for (let i = 0; i < n; i++) {
      blobs.push({
        ax: Math.random(), ay: Math.random(),
        ox: rand(0.08, 0.24), oy: rand(0.08, 0.24),
        sp: rand(0.00005, 0.00013), ph: rand(0, Math.PI * 2),
        r: rand(0.32, 0.6), c: PAL[i % PAL.length],
        a: rand(0.20, 0.42), d: rand(0.3, 1),
      });
    }
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;
    ctx.globalCompositeOperation = 'lighter';
    const base = Math.min(W, H);
    for (const b of blobs) {
      const ang = t * b.sp + b.ph;
      const px = (mouse.x - 0.5) * 0.14 * b.d;
      const py = (mouse.y - 0.5) * 0.14 * b.d;
      const x = (b.ax + Math.cos(ang) * b.ox + px) * W;
      const y = (b.ay + Math.sin(ang * 1.3) * b.oy + py) * H;
      const r = b.r * base * (1 + 0.08 * Math.sin(ang * 2.1));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const [cr, cg, cb] = b.c;
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${b.a})`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${b.a * 0.22})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  function loop(t) { if (!running) return; draw(t); raf = requestAnimationFrame(loop); }
  function start() { if (running) return; running = true; raf = requestAnimationFrame(loop); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf), (raf = null); }

  addEventListener('resize', () => { resize(); init(); if (reduce) draw(0); });
  addEventListener('pointermove', (e) => {
    mouse.tx = e.clientX / innerWidth; mouse.ty = e.clientY / innerHeight;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (reduce) return; document.hidden ? stop() : start();
  });

  resize(); init();
  reduce ? draw(0) : start();
})();
