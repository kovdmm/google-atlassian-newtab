// A small fireworks: sparks fly up and inward from the two bottom corners of the screen, over about a second and a half.
// Played when a card is moved into a "done" column (board-actions.js). Nothing is played for people who asked their
// system for less motion. The canvas lives only while the sparks do and never catches a click.

const FIREWORKS_COLORS = ["#ffd54f", "#ff8a65", "#4fc3f7", "#81c784", "#ba68c8", "#f06292"];
const FIREWORKS_MS = 1600;
const SPARKS_PER_CORNER = 36;
let fireworks = null; // { canvas, sparks, start } while playing

function launchFireworks() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const w = innerWidth, h = innerHeight;
  // a new launch while one is playing just adds its sparks to the running animation
  const sparks = [-1, 1].flatMap(side => Array.from({ length: SPARKS_PER_CORNER }, () => {
    const angle = (Math.PI / 180) * (50 + Math.random() * 30); // 50°–80° above the floor, leaning to the middle
    const speed = Math.min(h, 900) * (0.9 + Math.random() * 0.7);
    return {
      x: side < 0 ? 0 : w,
      y: h,
      vx: -side * Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      size: 2 + Math.random() * 2,
      color: FIREWORKS_COLORS[Math.floor(Math.random() * FIREWORKS_COLORS.length)],
      life: 0.8 + Math.random() * 0.7, // seconds
    };
  }));
  if (fireworks) {
    fireworks.sparks.push(...sparks);
    fireworks.start = performance.now();
    return;
  }

  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "3000", pointerEvents: "none" });
  document.body.append(canvas);
  fireworks = { canvas, sparks, start: performance.now() };
  const ctx = canvas.getContext("2d");
  let last = performance.now();

  const frame = now => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    ctx.clearRect(0, 0, w, h);
    fireworks.sparks.forEach(s => {
      s.life -= dt;
      if (s.life <= 0) return;
      s.vy += 900 * dt; // gravity
      s.vx *= 1 - 0.8 * dt; // air drag
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      ctx.globalAlpha = Math.min(1, s.life * 2);
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    if (now - fireworks.start < FIREWORKS_MS && fireworks.sparks.some(s => s.life > 0)) return requestAnimationFrame(frame);
    canvas.remove();
    fireworks = null;
  };
  requestAnimationFrame(frame);
}
