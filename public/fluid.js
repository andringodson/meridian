/* Meridian — interactive fluid background.
   Slow-drifting gradient blobs in the brand blue/indigo family with pointer
   parallax. Rendered at reduced resolution for performance; pauses when hidden
   and respects reduced-motion.

   The blend has to flip with the theme. On black the blobs are composited
   'lighter' so overlaps glow — which is exactly why the same code disappears on
   white, where adding light only drives every pixel further toward the paper.
   The light theme therefore blends normally, at roughly a third of the opacity,
   over a palette deep enough to read as a tint rather than a smudge. */
(function () {
  'use strict';
  const canvas = document.getElementById('fx');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SCALE = 0.42;              // draw small, CSS upscales — cheap + soft
  let W, H, raf = null, running = false;

  // Brand-family palette: electric blue, indigo, twilight, breeze, deep navy.
  const PAL_DARK = [
    [0, 0, 238], [40, 20, 160], [90, 60, 210], [60, 120, 210], [10, 20, 60],
  ];
  // Deeper and cooler: on paper these are washes, so they need saturation to
  // survive being drawn at a third of the alpha.
  const PAL_LIGHT = [
    [0, 0, 214], [58, 40, 190], [96, 84, 224], [40, 110, 205], [22, 46, 128],
  ];

  let light = document.documentElement.classList.contains('light');
  const readTheme = () => { light = document.documentElement.classList.contains('light'); };
  const PAL = () => (light ? PAL_LIGHT : PAL_DARK);
  const ALPHA = () => (light ? 0.34 : 1);
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
        r: rand(0.32, 0.6), i,
        a: rand(0.20, 0.42), d: rand(0.3, 1),
      });
    }
  }
  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    mouse.x += (mouse.tx - mouse.x) * 0.12;
    mouse.y += (mouse.ty - mouse.y) * 0.12;
    // Overlaps glow on black and would bleach out on white — see the note above.
    ctx.globalCompositeOperation = light ? 'source-over' : 'lighter';
    const base = Math.min(W, H);
    const pal = PAL();
    const k = ALPHA();
    for (const b of blobs) {
      const ang = t * b.sp + b.ph;
      const px = (mouse.x - 0.5) * 0.38 * b.d;
      const py = (mouse.y - 0.5) * 0.38 * b.d;
      const x = (b.ax + Math.cos(ang) * b.ox + px) * W;
      const y = (b.ay + Math.sin(ang * 1.3) * b.oy + py) * H;
      const r = b.r * base * (1 + 0.08 * Math.sin(ang * 2.1));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const [cr, cg, cb] = pal[b.i % pal.length];
      const a = b.a * k;
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a * 0.22})`);
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
  // Repaint on a theme flip — with reduced motion there is no loop to pick the
  // new palette up on the next frame, so draw the single static frame again.
  document.documentElement.addEventListener('themechange', () => {
    readTheme();
    if (reduce || !running) draw(0);
  });

  resize(); init();
  reduce ? draw(0) : start();
})();
