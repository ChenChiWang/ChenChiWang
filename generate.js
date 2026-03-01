const seedRandom = require('seed-random');
const fs = require('fs');

const WIDTH = 900;
const HEIGHT = 400;
const CX = WIDTH / 2;
const CY = HEIGHT / 2;

const today = new Date().toISOString().slice(0, 10);
const random = seedRandom(today);

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

function hsl(h, s, l) {
  return `hsl(${((h % 360) + 360) % 360},${s}%,${l}%)`;
}

// 閉合路徑：整數座標節省 ~30% 字元，視覺無差異
function pointsToDClosed(pts) {
  return pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${Math.round(p.x)},${Math.round(p.y)}`
  ).join('') + 'Z';
}

const PHI = (1 + Math.sqrt(5)) / 2;
const TAU = Math.PI * 2;

// ============================================================
// Calabi-Yau 參數方程式（完全對應 p5.js）
// ============================================================
// 每個 k 截面：alpha 0→2π 產生一個完整的閉合瓣形。
// 末尾 Z 指令連回起點，讓每個維度自成閉環。
// n 個 k 在空間上相關聯銜接（共享端點附近區域），
// 但各自獨立閉合，擁有各自的顏色與維度身份。

function computeCurvePoints(n, k, angle, layer, scale, daily) {
  const steps = 90;
  const gap = 0.12;
  const pts = [];

  for (let i = 0; i <= steps; i++) {
    const alpha = gap + (i / steps) * (TAU - 2 * gap);
    const theta = (alpha + TAU * k) / n;
    let px, py;

    if (layer === 'outer') {
      const x = Math.cos(theta + angle * 0.5);
      const y = Math.sin(theta + angle * 0.3);
      // 呼吸：空間結構(alpha*n) + 不急不徐的時間節奏(breathRate)
      const twist = Math.sin(alpha * n + angle * daily.breathRate + daily.phase) * daily.twistAmp;
      px = (x * Math.cos(twist) - y * Math.sin(twist)) * scale;
      py = (x * Math.sin(twist) + y * Math.cos(twist)) * scale;
    } else {
      const r = Math.pow(daily.innerWave + (1 - daily.innerWave) * Math.sin(alpha * n), 1 / n);
      const x = r * Math.cos(theta + angle * 0.7);
      const y = r * Math.sin(theta + angle * 0.5);
      // 內層呼吸略慢（×0.7），像更深層的韻律
      const twist = Math.cos(alpha * n - angle * daily.breathRate * 0.7 + daily.phase * 0.7) * daily.twistAmp * 1.2;
      px = (x * Math.cos(twist) - y * Math.sin(twist)) * scale * daily.innerScale;
      py = (x * Math.sin(twist) + y * Math.cos(twist)) * scale * daily.innerScale;
    }

    pts.push({ x: px, y: py });
  }

  return pointsToDClosed(pts);
}

// ============================================================
// 主生成函式
// ============================================================
// 動畫週期 120s，角度循環 20π（所有係數 LCM），
// 速率 ≈ 0.52 rad/s（接近 p5.js 的 0.3 rad/s 慢速優雅感）。
// 每個 k 有：核心線 + 殘影（幀偏移 1）+ 內層結構 = 3 paths。

function generateCalabiYau(n) {
  const scale = randFloat(120, 155);
  const FRAMES = Math.min(72, Math.floor(520 / n));
  const ANGLE_CYCLE = 20 * Math.PI;
  const hueOffset = randFloat(0, 360);

  // ── 每日隨機變量 ──
  // twistAmp = 生命力：有的日子氣息深沉，有的日子輕淺
  // breathRate = 呼吸節奏：永遠不急不徐，3~5 次 / 120s 週期
  // phase = 每天的起始姿態
  const daily = {
    twistAmp: randFloat(0.8, Math.PI),   // 生命力（振幅）
    breathRate: randFloat(3, 5) / 10,    // 呼吸頻率（angle 每 20π 走 3~5 個完整週期）
    phase: randFloat(0, TAU),             // 初始相位
    innerWave: randFloat(0.5, 0.8),       // 內層 r 的波動基底
    innerScale: randFloat(0.7, 0.85),     // 內層相對大小
  };

  const animDur = 120;
  const breathSec = (animDur / (daily.breathRate * 10)).toFixed(0);

  console.log(`  vitality: ${daily.twistAmp.toFixed(2)} rad (${(daily.twistAmp / Math.PI * 180).toFixed(0)}°), breath: ~${breathSec}s/cycle`);

  // 產生所有幀的路徑 d 值
  const outerFrames = [];
  const innerFrames = [];

  for (let f = 0; f < FRAMES; f++) {
    const angle = (f / FRAMES) * ANGLE_CYCLE;
    const outerF = [];
    const innerF = [];
    for (let k = 0; k < n; k++) {
      outerF.push(computeCurvePoints(n, k, angle, 'outer', scale, daily));
      innerF.push(computeCurvePoints(n, k, angle, 'inner', scale, daily));
    }
    outerFrames.push(outerF);
    innerFrames.push(innerF);
  }

  // 組裝路徑 metadata
  const paths = [];

  for (let k = 0; k < n; k++) {
    const foldHue = hueOffset + (k / n) * 360;

    // ── 核心線：高亮度主曲線 ──
    paths.push({
      stroke: hsl(foldHue, 80, 85),
      width: 1.3,
      opacity: 0.50,
      dFrames: outerFrames.map(f => f[k]),
    });

    // ── 殘影：偏移 1 幀，模擬 p5.js 半透明背景的拖尾 ──
    paths.push({
      stroke: hsl(foldHue, 70, 78),
      width: 3.0,
      opacity: 0.10,
      dFrames: outerFrames.map((_, f) =>
        outerFrames[(f - 1 + FRAMES) % FRAMES][k]
      ),
    });

    // ── 內層結構線 ──
    paths.push({
      stroke: hsl(foldHue, 55, 65),
      width: 0.6,
      opacity: 0.20,
      dFrames: innerFrames.map(f => f[k]),
    });
  }

  return { n, paths, animDur, FRAMES };
}

// ============================================================
// 4 個 Calabi-Yau 變體
// ============================================================

const THEMES = [
  { name: 'Calabi-Yau Quintic',  n: 5 },
  { name: 'Calabi-Yau Sextic',   n: 6 },
  { name: 'Calabi-Yau Septic',   n: 7 },
];

// ============================================================
// 組裝 SVG
// ============================================================

function buildSVG(result, bgColor, watermark) {
  const { paths, animDur } = result;

  const css = `
    .bg { fill: ${bgColor}; }
    .c {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
    }`;

  let pathsSVG = '';

  for (let pi = 0; pi < paths.length; pi++) {
    const p = paths[pi];
    const dValues = p.dFrames.join(';');

    const style = [
      `stroke:${p.stroke}`,
      `stroke-width:${p.width.toFixed(2)}`,
      `stroke-opacity:${p.opacity.toFixed(3)}`,
    ].join(';');

    pathsSVG += `<path class="c" style="${style}" d="${p.dFrames[0]}">`;
    pathsSVG += `<animate attributeName="d" values="${dValues}" dur="${animDur}s" repeatCount="indefinite" calcMode="linear"/>`;
    pathsSVG += `</path>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}">
<style>${css}</style>
<rect class="bg" width="${WIDTH}" height="${HEIGHT}"/>
<g transform="translate(${CX},${CY})">
${pathsSVG}
</g>
<text x="${WIDTH - 15}" y="${HEIGHT - 12}" fill="white" fill-opacity="0.2" font-family="monospace" font-size="10" text-anchor="end">${watermark}</text>
</svg>`;
}

// ============================================================
// 主程式
// ============================================================

function main() {
  const dayOfYear = Math.floor(
    (new Date(today) - new Date(today.slice(0, 4) + '-01-01')) / 86400000
  );
  const theme = THEMES[dayOfYear % THEMES.length];
  const bgOptions = ['#04040E', '#06061A', '#080814', '#050510', '#0A0A12'];
  const bgColor = pick(bgOptions);

  console.log(`Date: ${today}`);
  console.log(`Theme: ${theme.name}`);
  console.log('Generating...');

  const result = generateCalabiYau(theme.n);
  const watermark = `${today}  ·  ${theme.name}`;
  const svg = buildSVG(result, bgColor, watermark);

  fs.writeFileSync('art.svg', svg);
  const sizeKB = (Buffer.byteLength(svg) / 1024).toFixed(1);
  console.log(`Generated art.svg (${sizeKB} KB, ${result.paths.length} paths, ${result.FRAMES} frames, ${result.animDur}s cycle)`);
}

main();
