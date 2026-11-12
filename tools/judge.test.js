const assert = require("assert");
const fs = require("fs");
const { judgeStroke } = require("../judge.js");
// 必 from MOE page: extract Track points of each stroke
const path = require("path");
const xml = fs.readFileSync(path.join(__dirname, "fixtures/5FC5.xml"), "utf8");
const strokes = [...xml.matchAll(/<Track>([\s\S]*?)<\/Track>/g)].map(m =>
  [...m[1].matchAll(/x="([\d.]+)" y="([\d.]+)"/g)].map(p => [+p[1], +p[2]]));
assert.strictEqual(strokes.length, 5);

const wobble = (pts, amp) => pts.map(([x, y], i) => [x + Math.sin(i * 0.25) * amp, y + Math.cos(i * 0.2) * amp]);
const dense = p => { const o = []; for (let i = 1; i < p.length; i++) for (let k = 0; k < 10; k++) o.push([p[i-1][0] + (p[i][0]-p[i-1][0]) * k / 10, p[i-1][1] + (p[i][1]-p[i-1][1]) * k / 10]); o.push(p.at(-1)); return o; };

const hook = strokes[1];                        // 臥鉤: 6 track points with bends
const cases = [
  ["正確描寫（有點抖）", judgeStroke(wobble(dense(hook), 60), hook), true],
  ["只點起點", judgeStroke([hook[0]], hook), false],
  ["起點直接拉到終點（抄捷徑）", judgeStroke(dense([hook[0], hook.at(-1)]), hook), false],
  ["方向寫反", judgeStroke(dense([...hook].reverse()), hook), false],
  ["在附近亂塗", judgeStroke(wobble(dense([...hook, ...[...hook].reverse(), ...hook]), 150), hook), false],
  ["點(短筆畫)正確", judgeStroke(dense(strokes[0]), strokes[0]), true],
  ["寫到別的筆畫位置", judgeStroke(dense(strokes[3]), strokes[0]), false],
  // write stage / small phone screen: looser tolerance must still block cheating
  ["[寬鬆] 整筆偏移 180 仍算對", judgeStroke(wobble(dense(hook), 60).map(([x, y]) => [x + 130, y + 125]), hook, 320), true],
  ["[寬鬆] 抄捷徑仍算錯", judgeStroke(dense([hook[0], hook.at(-1)]), hook, 320), false],
  ["[寬鬆] 方向寫反仍算錯", judgeStroke(dense([...hook].reverse()), hook, 320), false],
  ["[寬鬆] 只點起點仍算錯", judgeStroke([hook[0]], hook, 320), false],
];
for (const [name, r, expect] of cases) { console.log(r.ok === expect ? "✓" : "✗", name, JSON.stringify(r)); assert.strictEqual(r.ok, expect, name); }
console.log("all passed");
