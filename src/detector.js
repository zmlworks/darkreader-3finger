/* 3本指タップ検出（DOM 非依存の純粋ロジック）。content.js と node のテストの両方から使う。
   入力: feed(type, time, changed, touchesCount)
     type          "start" | "move" | "end" | "cancel"
     time          ms（event.timeStamp など単調増加する値）
     changed       [{ id, x, y }]  … TouchEvent.changedTouches（clientX/Y = CSS px）
     touchesCount  TouchEvent.touches.length（画面上に残っている指の数）
   判定: ちょうど 3 本が同時に触れ（4 本目なし）、3 本目が触れてから maxDurationMs 以内に全指が離れ、
        各指の移動量が maxMovePx 未満、指が触れ始めてから 3 本揃うまで maxStaggerMs 以内。 */
var DR3F = typeof DR3F !== "undefined" ? DR3F : {};
DR3F.createTapDetector = function createTapDetector(opts) {
  const o = Object.assign(
    {
      fingers: 3,
      maxDurationMs: 350, // 3 本目の接地 → 最後の指が離れるまで
      maxStaggerMs: 250, // 1 本目の接地 → 3 本目の接地まで
      maxMovePx: 20, // 画面上の見かけの距離（CSS px、ズーム倍率 1 のとき）
      getScale: () => 1, // ピンチズーム倍率（visualViewport.scale）。拡大中は CSS px での閾値を小さくする
      onTap: () => {},
    },
    opts || {}
  );
  let g = null; // 進行中のジェスチャー

  function moved(p, x, y) {
    const s = o.getScale() || 1;
    const lim = o.maxMovePx / s;
    const dx = x - p.x;
    const dy = y - p.y;
    return dx * dx + dy * dy >= lim * lim;
  }

  function feed(type, time, changed, touchesCount) {
    changed = changed || [];
    if (type === "start") {
      // 画面上の指が今回触れた指だけ → 新しいジェスチャー（前回の end を取りこぼしていても回復できる）
      if (!g || touchesCount <= changed.length) {
        g = { pts: new Map(), t0: time, t3: null, valid: true, lifted: false };
      }
      for (const c of changed) g.pts.set(c.id, { x: c.x, y: c.y });
      if (g.lifted) g.valid = false; // 途中で指を離してから置き直した
      const n = Math.max(touchesCount, g.pts.size);
      if (n > o.fingers) g.valid = false; // 4 本目
      if (n === o.fingers && g.t3 === null) {
        g.t3 = time;
        if (time - g.t0 > o.maxStaggerMs) g.valid = false;
      }
      return;
    }
    if (!g) return;
    if (type === "move") {
      for (const c of changed) {
        const p = g.pts.get(c.id);
        if (p && moved(p, c.x, c.y)) g.valid = false;
      }
      return;
    }
    if (type === "end" || type === "cancel") {
      if (type === "cancel") g.valid = false;
      for (const c of changed) {
        const p = g.pts.get(c.id);
        if (p && moved(p, c.x, c.y)) g.valid = false;
      }
      if (g.t3 === null) g.valid = false; // 3 本揃う前に指が離れた
      g.lifted = true;
      if (touchesCount === 0) {
        const ok = g.valid && g.t3 !== null && time - g.t3 <= o.maxDurationMs;
        g = null;
        if (ok) o.onTap();
      }
    }
  }

  return { feed, reset: () => (g = null), options: o };
};
if (typeof module !== "undefined" && module.exports) module.exports = DR3F;
