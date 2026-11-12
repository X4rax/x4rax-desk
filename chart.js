/* Hand-drawn canvas charts (no chart library, no network). Two charts:
   DeskCharts.equity(canvas, points, opts)   equity curve, points = [{t: epoch seconds, v: value}]
   DeskCharts.candles(canvas, candles, opts) candlesticks + volume + entry/stop/trail lines, candles = [{t,o,h,l,c,v}]
   Both draw only what they are given, scale to the device pixel ratio, and support a touch / pointer crosshair that reports the
   point under the finger through opts.onProbe(point|null) (the page shows the readout as text, so it is accessible).
   Charts are redrawn on resize. Colours are read from the CSS variables once. */
(function () {
  "use strict";
  var COL = null;
  function colors() {
    if (COL) return COL;
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { return (cs.getPropertyValue(n) || "").trim() || d; }
    COL = { ok: v("--ok", "#00d35a"), bad: v("--bad", "#ff4d6d"), warn: v("--warn", "#ffb020"), a: v("--brand-a", "#8b6cff"),
            b: v("--brand-b", "#22d3ee"), line: "rgba(255,255,255,0.08)", text: v("--text-dim", "#a4abc0"), faint: v("--text-faint", "#6c7389"),
            auditor: v("--c-auditor", "#0a84ff") };
    return COL;
  }

  function setup(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.max(120, Math.round(canvas.clientWidth || canvas.parentNode.clientWidth || 320));
    var hgt = Math.max(80, Math.round(canvas.clientHeight || 160));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return { ctx: ctx, w: w, h: hgt };
  }

  function niceRange(lo, hi) {
    if (!(hi > lo)) { var pad = Math.abs(hi) * 0.01 || 1; return [lo - pad, hi + pad]; }
    var p = (hi - lo) * 0.08;
    return [lo - p, hi + p];
  }

  function attachProbe(canvas, state) {
    if (canvas.__probeBound) { canvas.__state = state; return; }
    canvas.__probeBound = true;
    canvas.__state = state;
    function at(ev) {
      var st = canvas.__state;
      if (!st || !st.n) return;
      var r = canvas.getBoundingClientRect();
      var x = (ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX)) - r.left;
      var i = st.indexAt(x);
      if (i === st.cursor) return;
      st.cursor = i;
      st.draw(i);
      if (st.onProbe) st.onProbe(i < 0 ? null : st.items[i]);
    }
    function leave() {
      var st = canvas.__state;
      if (!st) return;
      st.cursor = -1;
      st.draw(-1);
      if (st.onProbe) st.onProbe(null);
    }
    canvas.addEventListener("pointerdown", function (ev) { try { canvas.setPointerCapture(ev.pointerId); } catch (e) {} at(ev); });
    canvas.addEventListener("pointermove", at);
    canvas.addEventListener("pointerup", leave);
    canvas.addEventListener("pointercancel", leave);
    canvas.addEventListener("pointerleave", function (ev) { if (ev.pointerType === "mouse") leave(); });
  }

  function equity(canvas, points, opts) {
    opts = opts || {};
    var C = colors();
    var pts = (points || []).filter(function (p) { return p && isFinite(p.t) && isFinite(p.v); });
    var st = { items: pts, n: pts.length, cursor: -1, onProbe: opts.onProbe };
    function draw(cur) {
      var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h;
      var L = 6, R = 6, T = 10, B = 18;
      if (pts.length < 2) {
        ctx.strokeStyle = C.line; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(L, H / 2); ctx.lineTo(W - R, H / 2); ctx.stroke(); ctx.setLineDash([]);
        return;
      }
      var vs = pts.map(function (p) { return p.v; });
      var base = isFinite(opts.base) ? opts.base : null;
      var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
      if (base !== null) { lo = Math.min(lo, base); hi = Math.max(hi, base); }
      var rng = niceRange(lo, hi);
      var t0 = pts[0].t, t1 = pts[pts.length - 1].t;
      function X(t) { return L + (t1 === t0 ? 0 : (t - t0) / (t1 - t0)) * (W - L - R); }
      function Y(v) { return T + (1 - (v - rng[0]) / (rng[1] - rng[0])) * (H - T - B); }
      var last = pts[pts.length - 1].v, first = base !== null ? base : pts[0].v;
      var col = last >= first ? C.ok : C.bad;
      // grid
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (var g = 0; g < 4; g++) { var gy = T + g * (H - T - B) / 3; ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(W - R, gy); ctx.stroke(); }
      if (base !== null) {
        ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(L, Y(base)); ctx.lineTo(W - R, Y(base)); ctx.stroke(); ctx.setLineDash([]);
      }
      // area
      var grad = ctx.createLinearGradient(0, T, 0, H - B);
      grad.addColorStop(0, col + "55"); grad.addColorStop(1, col + "00");
      ctx.beginPath(); ctx.moveTo(X(pts[0].t), H - B);
      pts.forEach(function (p) { ctx.lineTo(X(p.t), Y(p.v)); });
      ctx.lineTo(X(t1), H - B); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
      // line (glow)
      ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = "round";
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(X(p.t), Y(p.v)); else ctx.moveTo(X(p.t), Y(p.v)); }); ctx.stroke();
      ctx.shadowBlur = 0;
      // axis labels
      ctx.fillStyle = C.faint; ctx.font = "10px -apple-system, system-ui, sans-serif"; ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left"; ctx.fillText(opts.fmtX ? opts.fmtX(t0) : "", L, H - 4);
      ctx.textAlign = "right"; ctx.fillText(opts.fmtX ? opts.fmtX(t1) : "", W - R, H - 4);
      ctx.textAlign = "left"; ctx.fillText(opts.fmtY ? opts.fmtY(rng[1]) : "", L + 2, T + 9);
      ctx.fillText(opts.fmtY ? opts.fmtY(rng[0]) : "", L + 2, H - B - 3);
      // last dot / crosshair
      var k = cur >= 0 ? cur : pts.length - 1, p = pts[k];
      if (cur >= 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(p.t), T); ctx.lineTo(X(p.t), H - B); ctx.stroke();
      }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), cur >= 0 ? 4.5 : 3.5, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "#05060a"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    st.draw = draw;
    st.indexAt = function (x) {
      if (pts.length < 2) return -1;
      var W = canvas.clientWidth || 320, L = 6, R = 6;
      var f = Math.max(0, Math.min(1, (x - L) / (W - L - R)));
      var t = pts[0].t + f * (pts[pts.length - 1].t - pts[0].t), best = 0, bd = Infinity;
      for (var i = 0; i < pts.length; i++) { var d = Math.abs(pts[i].t - t); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    attachProbe(canvas, st);
    draw(-1);
    return st;
  }

  function candles(canvas, series, opts) {
    opts = opts || {};
    var C = colors();
    var cs = (series || []).filter(function (c) { return c && isFinite(c.o) && isFinite(c.h) && isFinite(c.l) && isFinite(c.c); }).slice(-150);
    var st = { items: cs, n: cs.length, cursor: -1, onProbe: opts.onProbe };
    var lines = (opts.lines || []).filter(function (l) { return l && isFinite(l.price) && l.price > 0; });
    function draw(cur) {
      var s = setup(canvas), ctx = s.ctx, W = s.w, H = s.h;
      var L = 6, R = 46, T = 8, B = 20, VH = 28;
      if (cs.length < 2) return;
      var lo = Math.min.apply(null, cs.map(function (c) { return c.l; })), hi = Math.max.apply(null, cs.map(function (c) { return c.h; }));
      lines.forEach(function (l) { lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); });
      var rng = niceRange(lo, hi);
      var plotH = H - T - B - VH - 4;
      function Y(v) { return T + (1 - (v - rng[0]) / (rng[1] - rng[0])) * plotH; }
      var step = (W - L - R) / cs.length, bw = Math.max(1.5, Math.min(9, step * 0.64));
      function X(i) { return L + step * (i + 0.5); }
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      for (var g = 0; g < 4; g++) { var gy = T + g * plotH / 3; ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(W - R, gy); ctx.stroke(); }
      ctx.fillStyle = C.faint; ctx.font = "10px -apple-system, system-ui, sans-serif"; ctx.textAlign = "left";
      [rng[1], (rng[0] + rng[1]) / 2, rng[0]].forEach(function (v, i) { ctx.fillText(opts.fmtP ? opts.fmtP(v) : "", W - R + 4, T + i * plotH / 2 + (i === 0 ? 8 : i === 2 ? -2 : 3)); });
      // volume
      var vmax = Math.max.apply(null, cs.map(function (c) { return c.v || 0; })) || 1;
      cs.forEach(function (c, i) {
        var up = c.c >= c.o, vh = Math.max(1, ((c.v || 0) / vmax) * VH);
        ctx.fillStyle = (up ? C.ok : C.bad) + "55";
        ctx.fillRect(X(i) - bw / 2, H - B - vh, bw, vh);
      });
      // price lines (entry / stop / trail)
      lines.forEach(function (l) {
        ctx.strokeStyle = l.color || C.warn; ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(L, Y(l.price)); ctx.lineTo(W - R, Y(l.price)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = l.color || C.warn; ctx.fillText(l.label || "", L + 3, Y(l.price) - 3);
      });
      // candles
      cs.forEach(function (c, i) {
        var up = c.c >= c.o, col = up ? C.ok : C.bad, x = X(i);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
        var y1 = Y(Math.max(c.o, c.c)), y2 = Y(Math.min(c.o, c.c));
        ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      });
      // time labels
      ctx.fillStyle = C.faint; ctx.textAlign = "left"; ctx.fillText(opts.fmtX ? opts.fmtX(cs[0].t) : "", L, H - 5);
      ctx.textAlign = "right"; ctx.fillText(opts.fmtX ? opts.fmtX(cs[cs.length - 1].t) : "", W - R, H - 5);
      if (cur >= 0) {
        var x = X(cur), c = cs[cur];
        ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, H - B); ctx.moveTo(L, Y(c.c)); ctx.lineTo(W - R, Y(c.c)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#eef1f8"; ctx.beginPath(); ctx.arc(x, Y(c.c), 3.5, 0, 6.2832); ctx.fill();
      }
    }
    st.draw = draw;
    st.indexAt = function (x) {
      if (cs.length < 2) return -1;
      var W = canvas.clientWidth || 320, L = 6, R = 46, step = (W - L - R) / cs.length;
      return Math.max(0, Math.min(cs.length - 1, Math.floor((x - L) / step)));
    };
    attachProbe(canvas, st);
    draw(-1);
    return st;
  }

  window.DeskCharts = { equity: equity, candles: candles };
  window.drawDeskChart = function () {};
})();
