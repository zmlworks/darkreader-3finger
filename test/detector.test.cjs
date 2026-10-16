// 3本指タップ検出のユニットテスト（node、依存なし）: node test/detector.test.cjs
const assert = require("assert");
const { createTapDetector } = require("../src/detector.js");

// シーケンス記法: [time, type, [[id,x,y],...], touchesCount]
function run(seq, opts) {
  let taps = 0;
  const d = createTapDetector(Object.assign({ onTap: () => taps++ }, opts));
  for (const [t, type, ch, n] of seq) d.feed(type, t, ch.map(([id, x, y]) => ({ id, x, y })), n);
  return taps;
}
const A = [1, 100, 300], B = [2, 160, 310], C = [3, 220, 300], D = [4, 280, 320];
const mv = (p, dx, dy) => [p[0], p[1] + dx, p[2] + dy];

const cases = [];
const T = (name, seq, want, opts) => cases.push({ name, seq, want, opts });

T("basic 3-finger tap", [[0, "start", [A], 1], [20, "start", [B], 2], [40, "start", [C], 3],
  [150, "end", [A], 2], [160, "end", [B], 1], [170, "end", [C], 0]], 1);
T("all 3 in one touchstart / one touchend", [[0, "start", [A, B, C], 3], [120, "end", [A, B, C], 0]], 1);
T("small jitter (<20px) ok", [[0, "start", [A, B, C], 3], [50, "move", [mv(A, 8, 8), mv(B, -10, 5)], 3],
  [100, "end", [mv(A, 10, 10), mv(B, -12, 6), mv(C, 0, 19)], 0]], 1);
T("two fingers → ignored", [[0, "start", [A, B], 2], [100, "end", [A, B], 0]], 0);
T("one finger → ignored", [[0, "start", [A], 1], [80, "end", [A], 0]], 0);
T("four fingers → ignored", [[0, "start", [A, B, C], 3], [30, "start", [D], 4], [120, "end", [A, B, C, D], 0]], 0);
T("4th finger after one lifted → ignored", [[0, "start", [A, B, C], 3], [60, "end", [A], 2], [80, "start", [D], 3],
  [140, "end", [B, C, D], 0]], 0);
T("held too long (>350ms after 3rd)", [[0, "start", [A, B], 2], [40, "start", [C], 3], [400, "end", [A, B, C], 0]], 0);
T("exactly 350ms ok", [[0, "start", [A, B, C], 3], [350, "end", [A, B, C], 0]], 1);
T("slow stagger (2 held, 3rd much later)", [[0, "start", [A, B], 2], [600, "start", [C], 3], [700, "end", [A, B, C], 0]], 0);
T("finger moved 25px (swipe) → ignored", [[0, "start", [A, B, C], 3], [60, "move", [mv(A, 0, 25)], 3], [120, "end", [mv(A, 0, 25), B, C], 0]], 0);
T("move only visible in touchend coords → ignored", [[0, "start", [A, B, C], 3], [120, "end", [A, B, mv(C, 30, 0)], 0]], 0);
T("pinch-like spread → ignored", [[0, "start", [A, B, C], 3], [50, "move", [mv(A, -15, 0), mv(C, 15, 0)], 3],
  [90, "move", [mv(A, -30, 0), mv(C, 30, 0)], 3], [150, "end", [A, B, C], 0]], 0);
T("touchcancel → ignored", [[0, "start", [A, B, C], 3], [80, "cancel", [A, B, C], 0]], 0);
T("lifted before 3rd arrived → ignored", [[0, "start", [A, B], 2], [30, "end", [A], 1], [50, "start", [C], 2], [60, "start", [A], 3],
  [150, "end", [A, B, C], 0]], 0);
T("two taps in a row → 2", [[0, "start", [A, B, C], 3], [100, "end", [A, B, C], 0], [500, "start", [A, B, C], 3], [600, "end", [A, B, C], 0]], 2);
T("recovers after missed touchend (stale state)", [[0, "start", [A, B], 2], /* ends lost */ [900, "start", [A, B, C], 3], [1000, "end", [A, B, C], 0]], 1);
T("invalid gesture then valid one", [[0, "start", [A, B, C, D], 4], [100, "end", [A, B, C, D], 0], [300, "start", [A, B, C], 3], [400, "end", [A, B, C], 0]], 1);
// ズーム: 2倍拡大中は CSS px で 10px 未満が閾値（画面上 20px）
T("zoom 2x: 12 CSS px move rejected", [[0, "start", [A, B, C], 3], [100, "end", [mv(A, 12, 0), B, C], 0]], 0, { getScale: () => 2 });
T("zoom 2x: 8 CSS px move ok", [[0, "start", [A, B, C], 3], [100, "end", [mv(A, 8, 0), B, C], 0]], 1, { getScale: () => 2 });
T("zoom 0.5x: 30 CSS px move ok", [[0, "start", [A, B, C], 3], [100, "end", [mv(A, 30, 0), B, C], 0]], 1, { getScale: () => 0.5 });
T("partial lift then all lifted in time", [[0, "start", [A, B, C], 3], [100, "end", [A], 2], [200, "end", [B], 1], [300, "end", [C], 0]], 1);
T("tail finger lifted too late", [[0, "start", [A, B, C], 3], [100, "end", [A, B], 1], [420, "end", [C], 0]], 0);

let fail = 0;
for (const c of cases) {
  const got = run(c.seq, c.opts);
  const ok = got === c.want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (taps=${got}, want ${c.want})`);
}
console.log(`\n${cases.length - fail}/${cases.length} passed`);
assert.strictEqual(fail, 0);
