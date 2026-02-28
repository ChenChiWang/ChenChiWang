const { createCanvas } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const seedRandom = require('seed-random');
const fs = require('fs');

const WIDTH = 900;
const HEIGHT = 400;
const CX = WIDTH / 2;
const CY_CENTER = HEIGHT / 2;
const FRAMES = 90;
const FRAME_DELAY = 33;

// 用當天日期當 seed
const today = new Date().toISOString().slice(0, 10);
const random = seedRandom(today);

// Calabi-Yau 主題調色盤
const PALETTES = [
  ['#E0AAFF', '#C77DFF', '#9D4EDD', '#7B2CBF', '#5A189A'],
  ['#CAF0F8', '#90E0EF', '#00B4D8', '#0077B6', '#03045E'],
  ['#FFF8E1', '#FFE082', '#FFB300', '#FF8F00', '#E65100'],
  ['#B7E4C7', '#74C69D', '#52B788', '#2D6A4F', '#1B4332'],
  ['#FFE5EC', '#FFB3C6', '#FF8FAB', '#FB6F92', '#C9184A'],
  ['#00F5D4', '#00BBF9', '#9B5DE5', '#F15BB5', '#FEE440'],
  ['#D6E4F0', '#8BB8D6', '#4A90BD', '#2C6A9E', '#0D3B66'],
  ['#FFDDB5', '#FFB347', '#FF8C00', '#CC5500', '#8B3A00'],
  ['#F0F4F8', '#C9D6DF', '#91ABB9', '#5A8296', '#2E4756'],
  ['#C3B1E1', '#957FEF', '#6C49D8', '#4A1FA0', '#2E0F6E'],
];

// ============================================================
// 工具函式
// ============================================================

function randInt(min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randFloat(min, max) {
  return random() * (max - min) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lerpColor(hex1, hex2, t) {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

// ============================================================
// Calabi-Yau 流形核心數學
// Fermat 曲面: z1^n + z2^n = 1 in C^2
// ============================================================

function calabiYauPoint(n, alpha, beta, k1, k2) {
  const cb = Math.pow(Math.cos(beta), 2 / n);
  const sb = Math.pow(Math.sin(beta), 2 / n);
  const phase1 = alpha + (2 * Math.PI * k1) / n;
  const phase2 = -alpha + (2 * Math.PI * k2) / n;
  return {
    x: cb * Math.cos(phase1),
    y: cb * Math.sin(phase1),
    z: sb * Math.cos(phase2),
    w: sb * Math.sin(phase2),
  };
}

function projectTo2D(p, rotX, rotY, rotZ) {
  let x = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
  let z = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);
  let y = p.y;
  const y2 = y * Math.cos(rotX) - z * Math.sin(rotX);
  const z2 = y * Math.sin(rotX) + z * Math.cos(rotX);
  const x3 = x * Math.cos(rotZ) - y2 * Math.sin(rotZ);
  const y3 = x * Math.sin(rotZ) + y2 * Math.cos(rotZ);
  return { x: x3, y: y3, depth: z2 };
}

function sampleCY(n, alphaSteps, betaSteps, k2, rotX, rotY, rotZ, scale, cx, cy) {
  const points = [];
  const betaMin = 0.05;
  const betaMax = Math.PI / 2 - 0.05;
  for (let k1 = 0; k1 < n; k1++) {
    for (let ai = 0; ai <= alphaSteps; ai++) {
      for (let bi = 0; bi <= betaSteps; bi++) {
        const alpha = (ai / alphaSteps) * (2 * Math.PI) / n;
        const beta = betaMin + (bi / betaSteps) * (betaMax - betaMin);
        const p4d = calabiYauPoint(n, alpha, beta, k1, k2);
        const p2d = projectTo2D(p4d, rotX, rotY, rotZ);
        points.push({
          sx: cx + p2d.x * scale,
          sy: cy + p2d.y * scale,
          depth: p2d.depth,
          alpha: ai / alphaSteps,
          beta: bi / betaSteps,
          k1,
        });
      }
    }
  }
  return points;
}

// ============================================================
// 演算法 1：發光曲面
// ============================================================
function drawLuminousSurface(ctx, palette, params) {
  const { n, k2, rotX, rotY, rotZ, scale } = params;
  const points = sampleCY(n, 100, 25, k2, rotX, rotY, rotZ, scale, CX, CY_CENTER);
  points.sort((a, b) => a.depth - b.depth);

  const minD = Math.min(...points.map((p) => p.depth));
  const maxD = Math.max(...points.map((p) => p.depth));
  const range = maxD - minD || 1;

  for (const p of points) {
    const t = (p.depth - minD) / range;
    const ci = Math.floor(t * (palette.length - 1));
    const ct = t * (palette.length - 1) - ci;
    const color = lerpColor(
      palette[Math.min(ci, palette.length - 1)],
      palette[Math.min(ci + 1, palette.length - 1)],
      ct
    );
    ctx.globalAlpha = 0.3 + t * 0.5;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 1.2 + t * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// 演算法 2：線框網格
// ============================================================
function drawWireframe(ctx, palette, params) {
  const { n, k2, rotX, rotY, rotZ, scale } = params;
  const alphaSteps = 50;
  const betaSteps = 12;
  const betaMin = 0.05;
  const betaMax = Math.PI / 2 - 0.05;

  for (let k1 = 0; k1 < n; k1++) {
    // alpha 方向曲線
    for (let bi = 0; bi <= betaSteps; bi++) {
      const beta = betaMin + (bi / betaSteps) * (betaMax - betaMin);
      ctx.beginPath();
      ctx.strokeStyle = palette[bi % palette.length];
      ctx.lineWidth = 0.6 + (bi / betaSteps) * 0.8;
      ctx.globalAlpha = 0.25 + (bi / betaSteps) * 0.45;
      for (let ai = 0; ai <= alphaSteps; ai++) {
        const alpha = (ai / alphaSteps) * (2 * Math.PI) / n;
        const p4d = calabiYauPoint(n, alpha, beta, k1, k2);
        const p2d = projectTo2D(p4d, rotX, rotY, rotZ);
        const sx = CX + p2d.x * scale;
        const sy = CY_CENTER + p2d.y * scale;
        if (ai === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // beta 方向曲線
    for (let ai = 0; ai <= alphaSteps; ai += 3) {
      const alpha = (ai / alphaSteps) * (2 * Math.PI) / n;
      ctx.beginPath();
      ctx.strokeStyle = palette[palette.length - 1];
      ctx.lineWidth = 0.4;
      ctx.globalAlpha = 0.15;
      for (let bi = 0; bi <= betaSteps; bi++) {
        const beta = betaMin + (bi / betaSteps) * (betaMax - betaMin);
        const p4d = calabiYauPoint(n, alpha, beta, k1, k2);
        const p2d = projectTo2D(p4d, rotX, rotY, rotZ);
        const sx = CX + p2d.x * scale;
        const sy = CY_CENTER + p2d.y * scale;
        if (bi === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }
}

// ============================================================
// 演算法 3：截面疊加
// ============================================================
function drawCrossSections(ctx, palette, params) {
  const { n, k2, rotX, rotY, rotZ, scale } = params;
  const sections = 25;
  const alphaSteps = 150;
  const betaMin = 0.08;
  const betaMax = Math.PI / 2 - 0.08;

  for (let si = 0; si < sections; si++) {
    const beta = betaMin + (si / (sections - 1)) * (betaMax - betaMin);
    const t = si / (sections - 1);
    const ci = Math.floor(t * (palette.length - 1));
    const ct = t * (palette.length - 1) - ci;
    const color = lerpColor(
      palette[Math.min(ci, palette.length - 1)],
      palette[Math.min(ci + 1, palette.length - 1)],
      ct
    );
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 + t * 1.5;
    ctx.globalAlpha = 0.2 + t * 0.5;

    for (let k1 = 0; k1 < n; k1++) {
      ctx.beginPath();
      for (let ai = 0; ai <= alphaSteps; ai++) {
        const alpha = (ai / alphaSteps) * (2 * Math.PI) / n;
        const p4d = calabiYauPoint(n, alpha, beta, k1, k2);
        const p2d = projectTo2D(p4d, rotX, rotY, rotZ);
        const sx = CX + p2d.x * scale;
        const sy = CY_CENTER + p2d.y * scale;
        if (ai === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }
}

// ============================================================
// 演算法 4：光譜點雲
// ============================================================
function drawSpectralCloud(ctx, palette, params) {
  const { n, k2, rotX, rotY, rotZ, scale } = params;
  const points = sampleCY(n, 80, 20, k2, rotX, rotY, rotZ, scale, CX, CY_CENTER);
  points.sort((a, b) => a.depth - b.depth);

  for (const p of points) {
    const hue = (p.k1 / n) * 360 + p.beta * 60;
    const sat = 70 + p.beta * 30;
    const light = 40 + p.alpha * 35;
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
    ctx.globalAlpha = 0.35 + p.beta * 0.5;
    ctx.beginPath();
    ctx.arc(p.sx, p.sy, 1.0 + p.beta * 2.0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// 演算法 5：多體共振
// ============================================================
function drawMultiBody(ctx, palette, params) {
  const { rotX, rotY, rotZ } = params;
  const bodies = [
    { n: 3, k2: 0, offsetX: -220 },
    { n: 5, k2: 0, offsetX: 0 },
    { n: 7, k2: 0, offsetX: 220 },
  ];
  const scale = 90;

  for (let bi = 0; bi < bodies.length; bi++) {
    const body = bodies[bi];
    const cx = CX + body.offsetX;
    const bodyRotY = rotY + bi * 0.5;
    const points = sampleCY(
      body.n, 60, 15, body.k2, rotX, bodyRotY, rotZ, scale, cx, CY_CENTER
    );
    points.sort((a, b) => a.depth - b.depth);

    const bp = [
      palette[bi % palette.length],
      palette[(bi + 1) % palette.length],
      palette[(bi + 2) % palette.length],
    ];

    for (const p of points) {
      const color = lerpColor(bp[0], bp[2], p.beta);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.3 + p.beta * 0.5;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 1.0 + p.beta * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = palette[bi % palette.length];
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`n=${body.n}`, cx, CY_CENTER + scale + 20);
  }
}

// ============================================================
// 演算法 6：拓撲層次
// ============================================================
function drawTopologicalLayers(ctx, palette, params) {
  const { n, k2, rotX, rotY, rotZ, scale } = params;
  const alphaSteps = 80;
  const betaSteps = 15;
  const betaMin = 0.05;
  const betaMax = Math.PI / 2 - 0.05;

  for (let k1 = 0; k1 < n; k1++) {
    const color = palette[k1 % palette.length];

    for (let bi = 0; bi < betaSteps; bi++) {
      const beta1 = betaMin + (bi / betaSteps) * (betaMax - betaMin);
      const beta2 = betaMin + ((bi + 1) / betaSteps) * (betaMax - betaMin);

      for (let ai = 0; ai < alphaSteps; ai++) {
        const a1 = (ai / alphaSteps) * (2 * Math.PI) / n;
        const a2 = ((ai + 1) / alphaSteps) * (2 * Math.PI) / n;

        const s00 = projectTo2D(calabiYauPoint(n, a1, beta1, k1, k2), rotX, rotY, rotZ);
        const s10 = projectTo2D(calabiYauPoint(n, a2, beta1, k1, k2), rotX, rotY, rotZ);
        const s01 = projectTo2D(calabiYauPoint(n, a1, beta2, k1, k2), rotX, rotY, rotZ);
        const s11 = projectTo2D(calabiYauPoint(n, a2, beta2, k1, k2), rotX, rotY, rotZ);

        const avgDepth = (s00.depth + s10.depth + s01.depth + s11.depth) / 4;
        const depthFactor = (avgDepth + 1.5) / 3;

        ctx.globalAlpha = 0.08 + depthFactor * 0.15;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(CX + s00.x * scale, CY_CENTER + s00.y * scale);
        ctx.lineTo(CX + s10.x * scale, CY_CENTER + s10.y * scale);
        ctx.lineTo(CX + s11.x * scale, CY_CENTER + s11.y * scale);
        ctx.lineTo(CX + s01.x * scale, CY_CENTER + s01.y * scale);
        ctx.closePath();
        ctx.fill();
      }
    }

    // 邊緣曲線
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.6;
    for (let ai = 0; ai <= alphaSteps; ai++) {
      const alpha = (ai / alphaSteps) * (2 * Math.PI) / n;
      const p2d = projectTo2D(
        calabiYauPoint(n, alpha, betaMax, k1, k2), rotX, rotY, rotZ
      );
      const sx = CX + p2d.x * scale;
      const sy = CY_CENTER + p2d.y * scale;
      if (ai === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
  }
}

// ============================================================
// 主程式
// ============================================================
function main() {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const palette = shuffle(pick(PALETTES));
  const bgOptions = ['#05050F', '#0A0A1A', '#0D0D1F', '#080812', '#0B0B18', '#060610'];
  const bgColor = pick(bgOptions);

  const algorithms = [
    drawLuminousSurface,
    drawWireframe,
    drawCrossSections,
    drawSpectralCloud,
    drawMultiBody,
    drawTopologicalLayers,
  ];
  const algo = pick(algorithms);

  // 固定參數（整段動畫不變），只有 rotY 逐幀遞增
  const n = pick([3, 4, 5, 6]);
  const k2 = randInt(0, n - 1);
  const rotX = randFloat(0.3, 1.2);
  const baseRotY = randFloat(0, Math.PI * 2);
  const rotZ = randFloat(-0.3, 0.3);
  const scale = randFloat(140, 180);

  console.log(`Date: ${today}`);
  console.log(`Algorithm: ${algo.name}`);
  console.log(`n=${n}, k2=${k2}`);
  console.log(`Palette: ${palette.join(', ')}`);
  console.log(`Generating ${FRAMES} frames...`);

  const gif = GIFEncoder();

  for (let f = 0; f < FRAMES; f++) {
    // 清除畫布
    ctx.globalAlpha = 1;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // rotY 從 0 轉到 2π 形成無縫循環
    const rotY = baseRotY + (f / FRAMES) * 2 * Math.PI;
    const params = { n, k2, rotX, rotY, rotZ, scale };

    algo(ctx, palette, params);

    // 右下角日期
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(today, WIDTH - 15, HEIGHT - 12);

    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const pal = quantize(data, 256);
    const index = applyPalette(data, pal);
    gif.writeFrame(index, WIDTH, HEIGHT, {
      palette: pal,
      delay: FRAME_DELAY,
      repeat: 0,
    });
    process.stdout.write(`\rFrame ${f + 1}/${FRAMES}`);
  }

  gif.finish();
  fs.writeFileSync('art.gif', Buffer.from(gif.bytes()));
  console.log('\nGenerated art.gif successfully!');
}

main();
