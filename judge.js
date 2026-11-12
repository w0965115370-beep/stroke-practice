// Judge one handwritten stroke against an MOE Track (coords in MOE 2048 box).
// Array.prototype.at needs iOS 15.4+; school iPads are often older
const lastOf = a => a[a.length - 1];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const len = p => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);
function densify(p, step = 20) {           // points every `step` units along polyline
  const out = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const n = Math.max(1, Math.ceil(dist(p[i - 1], p[i]) / step));
    for (let k = 1; k <= n; k++) out.push([p[i - 1][0] + (p[i][0] - p[i - 1][0]) * k / n, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k / n]);
  }
  return out;
}
const near = (pt, path) => Math.min(...path.map(q => dist(pt, q)));

// tol: how far (MOE units, stroke width is ~150) a child may wander. Lenient on purpose for grade 1.
function judgeStroke(user, track, tol = 200) {
  if (user.length < 2) return { ok: false, why: "tap" };
  const T = densify(track), U = densify(user);
  const tLen = len(track);
  if (dist(U[0], T[0]) > tol * 1.25) return { ok: false, why: "start" };
  if (dist(lastOf(U), lastOf(T)) > tol * 1.25) return { ok: false, why: "end" };
  // every part of the real stroke must be traced (blocks start→end shortcuts across bends)
  const covered = T.filter(p => near(p, U) <= tol).length / T.length;
  if (covered < 0.9) return { ok: false, why: "shortcut", covered };
  // the child's line must stay on the stroke (blocks scribbling over everything)
  const onTrack = U.filter(p => near(p, T) <= tol).length / U.length;
  if (onTrack < 0.85) return { ok: false, why: "off_track", onTrack };
  // must not be wildly longer than the stroke (zig-zag scribble inside tolerance band)
  if (tLen > 100 && len(user) > tLen * 2.2) return { ok: false, why: "too_long" };
  return { ok: true };
}
if (typeof module !== "undefined") module.exports = { judgeStroke };
