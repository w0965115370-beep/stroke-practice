"use strict";
const $app = document.getElementById("app");
const NS = "http://www.w3.org/2000/svg";
const ATTRIBUTION = `筆順資料來源：中華民國教育部《<a href="https://stroke-order.learningweb.moe.edu.tw/" target="_blank" rel="noopener">國字標準字體筆順學習網</a>》，
  依 <a href="https://creativecommons.org/licenses/by-nc-nd/3.0/tw/" target="_blank" rel="noopener">CC BY-NC-ND 3.0 臺灣</a> 授權使用。`;
const SPINES = ["#E46F5A", "#F0A63A", "#5DAE73", "#4C8FCB", "#9A6FC2", "#E57FA6"];
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- small inline icons ----------
const icon = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  back: icon(`<path d="M15 5l-7 7 7 7"/>`),
  next: icon(`<path d="M9 5l7 7-7 7"/>`),
  replay: icon(`<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>`),
  eye: icon(`<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  erase: icon(`<path d="M7 20h13"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8z"/>`),
  pencil: icon(`<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M13.5 6.5l4 4"/>`),
};

// 田字格 cell; `inner` is drawn in MOE 2048 coordinates
const cellSVG = (inner, cls = "cell") =>
  `<svg class="${cls}" viewBox="0 0 2048 2048" aria-hidden="true"><rect class="frame" x="11" y="11" width="2026" height="2026" rx="70"/><path class="cross" d="M1024 30V2018M30 1024H2018"/>${inner}</svg>`;
const glyphPaths = strokes => `<path class="glyph" d="${strokes.map(s => s.d).join("")}"/>`;
const glyphFallback = ch => `<text x="1024" y="1560" text-anchor="middle">${esc(ch)}</text>`;

// Red teacher stamp (印章)
const stampSVG = (text, cls = "stamp") => `<svg class="${cls}" viewBox="0 0 200 200" aria-hidden="true">
  <circle class="stamp-ring" cx="100" cy="100" r="90" stroke-width="9"/><circle class="stamp-ring" cx="100" cy="100" r="76" stroke-width="3"/>
  <text class="stamp-text" x="100" y="${text.length > 1 ? 122 : 136}" text-anchor="middle" font-size="${text.length > 1 ? 64 : 100}">${esc(text)}</text></svg>`;

// 直式注音: "ㄏㄠˇ" -> symbols stacked, tone mark at the last symbol's upper right, light tone "˙" on top
function zyHTML(zy) {
  const syl = (zy || "").trim().split(/\s+/)[0];
  if (!syl) return "";
  const light = syl.startsWith("˙"), tone = /[ˊˇˋ]$/.test(syl) ? syl.at(-1) : "";
  const sym = [...syl.slice(light ? 1 : 0, tone ? -1 : undefined)];
  return `<span class="zy-col" aria-label="${esc(syl)}">${light ? `<i class="light">˙</i>` : ""}${sym.map((c, i) =>
    `<i>${esc(c)}${i === sym.length - 1 && tone ? `<span class="tone">${tone}</span>` : ""}</i>`).join("")}</span>`;
}

// ---------- word list (Google Sheet CSV, or words.csv) ----------
function parseCSV(text) {
  const rows = [[]]; let f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { rows.at(-1).push(f); f = ""; }
    else if (c === "\n") { rows.at(-1).push(f); f = ""; rows.push([]); }
    else if (c !== "\r") f += c;
  }
  rows.at(-1).push(f);
  const head = rows.shift().map(h => h.trim().replace(/^﻿/, ""));
  return rows.filter(r => r.some(x => x.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

async function fetchCSV(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) return null;
  return parseCSV(await r.text());
}
// words.csv rows -> [{sem, name, words:[{ch, zy}]}]
function groupUnits(rows) {
  const units = [];
  for (const row of rows) {
    const ch = [...(row["字"] || "")][0];
    if (!ch) continue;
    const sem = row["學期"] || "", name = row["單元"] || "練習";
    let u = units.at(-1);
    if (!u || u.sem !== sem || u.name !== name) units.push(u = { sem, name, words: [] });
    if (!u.words.some(w => w.ch === ch)) u.words.push({ ch, zy: row["注音"] || "" });
  }
  return units;
}

// "第三課：秋千" -> ["第三課", "秋千"]
const splitLesson = name => { const m = name.match(/^(第.+?課)\s*[：:]\s*(.+)$/); return m ? [m[1], m[2]] : ["", name]; };

// ---------- students (from the sheet's 學生 tab) ----------
// No list -> no login screen; the app works anonymously.
// The class's Apps Script web app (roster, records, points) is never in the site's files (the site is
// public). Its id arrives in the QR code's link as #w=<deployment id>; the part after "#" is never sent
// to the web server.
function takeRosterFromLink() {
  const w = new URLSearchParams(location.hash.slice(1)).get("w") || "";
  if (!/^[\w-]+$|^http:\/\/127\.0\.0\.1:\d+\/$/.test(w)) return; // the 127.0.0.1 form is the local test mock
  try { localStorage.setItem("stroke.roster", JSON.stringify({ w })); } catch {}
  setStudent(null); // every scan starts at "你是誰？" so a shared iPad never keeps the last child
  history.replaceState(null, "", location.pathname + location.search);
}
let rosterError = false;
function getRoster() { try { return JSON.parse(localStorage.getItem("stroke.roster")); } catch { return null; } }
const studentKey = s => `${s.no}-${s.name}`;
function getStudent() { try { return JSON.parse(localStorage.getItem("stroke.student")); } catch { return null; } }
function setStudent(s) { lastPoints = null; try { s ? localStorage.setItem("stroke.student", JSON.stringify(s)) : localStorage.removeItem("stroke.student"); } catch {} }

// ---------- practice records & points (Google Apps Script web app) ----------
function recordsUrl() {
  const w = (getRoster() || {}).w;
  return !w ? "" : w.startsWith("http") ? w /* local mock for testing */ : `https://script.google.com/macros/s/${w}/exec`;
}
async function api(body) {
  const r = await fetch(recordsUrl(), { method: "POST", body: JSON.stringify(body) });
  return r.json();
}
// Records wait in a queue on the iPad until the server confirms them, so no practice is lost offline.
const queue = () => { try { return JSON.parse(localStorage.getItem("stroke.queue")) || []; } catch { return []; } };
const saveQueue = q => { try { localStorage.setItem("stroke.queue", JSON.stringify(q)); } catch {} };
let sending = null;
function sendRecords() { // resolves to the server's reply for the last record sent, or null if offline
  return sending ||= (async () => {
    let last = null;
    for (let rec; (rec = queue()[0]) && recordsUrl();) {
      try { last = await (await fetch(recordsUrl(), { method: "POST", body: JSON.stringify(rec) })).json(); }
      catch { return null; }
      saveQueue(queue().filter(r => r.id !== rec.id)); // the server answered (stored, or refused bad data)
    }
    return last;
  })().finally(() => sending = null);
}
function recordPractice(rec) {
  const me = getStudent();
  if (!recordsUrl() || !me) return Promise.resolve(undefined);
  saveQueue([...queue(), { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), time: new Date().toISOString(), no: me.no, name: me.name, ...rec }]);
  return sendRecords();
}
let lastPoints = null; // {points, card} of the current student, from boot / last record / points request
async function fetchPoints() {
  const me = getStudent();
  if (!recordsUrl() || !me) return null;
  try {
    const j = await (await fetch(`${recordsUrl()}?no=${encodeURIComponent(me.no)}&name=${encodeURIComponent(me.name)}`)).json();
    return j.ok ? (lastPoints = j) : null;
  } catch { return null; }
}
// 集點卡: `card` circles, the earned ones stamped
function pointCard({ points, card }) {
  const filled = points && points % card === 0 ? card : points % card, num = Math.max(1, Math.ceil(points / card));
  return `<div class="pcard"><div class="pcard-head"><span>第 ${num} 張集點卡</span><b>${filled} / ${card}</b></div>
    <div class="dots">${Array.from({ length: card }, (_, i) => `<i class="${i < filled ? "on" : ""}"></i>`).join("")}</div></div>`;
}

// ---------- completion stamps (kept on this device, separately for each student) ----------
const doneKey = () => { const st = getStudent(); return "stroke.done" + (st ? "." + studentKey(st) : ""); };
function getDone() { try { return new Set(JSON.parse(localStorage.getItem(doneKey()) || "[]")); } catch { return new Set(); } }
function markDone(ch) { try { const s = getDone(); s.add(ch); localStorage.setItem(doneKey(), JSON.stringify([...s])); } catch {} }

// ---------- MOE stroke data ----------
const hex = ch => ch.codePointAt(0).toString(16).toUpperCase();
const strokeCache = new Map();
function loadStrokes(ch) {
  if (!strokeCache.has(ch)) strokeCache.set(ch, (async () => {
    let xml = null;
    const r = await fetch(`data/${hex(ch)}.xml`);
    if (r.ok) xml = await r.text();
    else if (recordsUrl()) {
      const j = await (await fetch(`${recordsUrl()}?stroke=${encodeURIComponent(ch)}`)).json();
      if (j.ok) xml = j.xml;
    }
    if (!xml) return null;
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const n = (el, a) => +el.getAttribute(a);
    return [...doc.querySelectorAll("Stroke")].map(s => {
      let d = "";
      for (const c of s.querySelector("Outline").children) {
        if (c.tagName === "MoveTo") d += `M${n(c, "x")} ${n(c, "y")}`;
        else if (c.tagName === "LineTo") d += `L${n(c, "x")} ${n(c, "y")}`;
        else if (c.tagName === "QuadTo") d += `Q${n(c, "x1")} ${n(c, "y1")} ${n(c, "x2")} ${n(c, "y2")}`;
        else if (c.tagName === "CubicTo") d += `C${n(c, "x1")} ${n(c, "y1")} ${n(c, "x2")} ${n(c, "y2")} ${n(c, "x3")} ${n(c, "y3")}`;
      }
      const track = [...s.querySelector("Track").children].map(p => [n(p, "x"), n(p, "y")]);
      return { d: d + "Z", track };
    });
  })().catch(() => { strokeCache.delete(ch); return null; }));
  return strokeCache.get(ch);
}

// Reveal one stroke along its MOE track, clipped to its outline (clip id = clipPrefix + i).
// When done, leave the filled outline in `group` (if given).
function revealStroke(animG, group, s, clipId, color, msPerUnit) {
  const pts = s.track.length > 1 ? s.track : [s.track[0], s.track[0]];
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", "M" + pts.map(q => q.join(" ")).join("L"));
  Object.entries({ fill: "none", stroke: color, "stroke-width": 300, "stroke-linecap": "round", "stroke-linejoin": "round", "clip-path": `url(#${clipId})` })
    .forEach(([k, v]) => p.setAttribute(k, v));
  animG.append(p);
  const L = Math.max(1, p.getTotalLength());
  p.style.strokeDasharray = `${L} ${L + 400}`;
  const a = p.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
    { duration: reducedMotion ? 1 : Math.max(250, L * msPerUnit), easing: "ease-in-out", fill: "forwards" });
  return a.finished.catch(() => {}).then(() => {
    p.remove();
    if (group) { const f = document.createElementNS(NS, "path"); f.setAttribute("d", s.d); f.setAttribute("fill", color); group.append(f); }
  });
}
const clipDefs = (strokes, prefix) => `<defs>${strokes.map((s, i) => `<clipPath id="${prefix}${i}"><path d="${s.d}"/></clipPath>`).join("")}</defs>`;

// ---------- screens ----------
let units = [], students = [];
const footer = () => `<footer>${ATTRIBUTION}</footer>`;
const backBtn = (label, hash) => `<button class="back" onclick="location.hash='${hash}'">${ICONS.back}${esc(label)}</button>`;

function showHome() {
  const done = getDone();
  const me = getStudent();
  let html = `<a class="teacher-link" href="#/teacher">老師後台</a><section class="hero">
      <div><h1>筆順小練習</h1><p>先看、再描、自己寫</p>
        ${rosterError ? `<div class="who">讀不到學生名單，請確認網路連線，或請老師重新產生 QR Code</div>` : ""}
        ${me ? `<div class="who"><span>${esc(me.name)}，你好！</span><span class="pts"></span><button onclick="setStudent(null); location.hash='#/login'">換人</button></div>` : ""}</div>
      <div class="hero-char">${cellSVG("", "cell")}</div>
    </section>`, lastSem = null;
  units.forEach((u, i) => {
    if (u.sem !== lastSem) { if (lastSem !== null) html += `</div>`; html += `<h2 class="sem">${esc(u.sem || "練習")}</h2><div class="units">`; lastSem = u.sem; }
    const [num, title] = splitLesson(u.name);
    const n = u.words.filter(w => done.has(w.ch)).length;
    html += `<button class="unit" style="--spine:${SPINES[i % SPINES.length]}" onclick="location.hash='#/u/${i}'">
      <span class="num">${esc(num)}${n ? `<b>完成 ${n}/${u.words.length}</b>` : ""}</span>
      <span class="name">${esc(title)}</span>
      <span class="chars">${esc(u.words.map(w => w.ch).join(" "))}</span></button>`;
  });
  $app.innerHTML = html + (units.length ? `</div>` : `<p class="note">字表還沒有字。請老師在 Google Sheet 加入要練習的字。</p>`) + footer();
  chalkWrite($app.querySelector(".hero-char svg"), "好");
  const showPts = p => { const el = $app.querySelector(".who .pts"); if (p && el) el.textContent = `★ ${p.points} 點`; };
  showPts(lastPoints);
  sendRecords().then(r => r && r.ok ? (lastPoints = r) : lastPoints || fetchPoints()).then(showPts);
}

function showLogin() {
  $app.innerHTML = `<a class="teacher-link" href="#/teacher">老師後台</a><section class="hero login-hero"><div><h1>你是誰？</h1><p>找到你的座號和名字，點一下</p></div></section>
    <div class="students">${students.map((s, i) =>
      `<button class="student" style="--spine:${SPINES[i % SPINES.length]}" data-i="${i}"><b>${esc(s.no)}</b><span>${esc(s.name)}</span></button>`).join("")}</div>` + footer();
  $app.querySelectorAll(".student").forEach(b => b.onclick = () => confirmStudent(students[+b.dataset.i]));
}

function confirmStudent(s) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="box" role="dialog" aria-label="確認名字"><div class="who-big"><b>${esc(s.no)}</b>${esc(s.name)}</div>
    <h2>你是${esc(s.name)}嗎？</h2><div class="btns"><button class="btn no">不是</button><button class="btn primary yes">是我</button></div></div>`;
  ov.querySelector(".no").onclick = () => ov.remove();
  ov.querySelector(".yes").onclick = () => { ov.remove(); setStudent(s); location.hash = ""; route(); };
  document.body.append(ov);
  ov.querySelector(".yes").focus({ preventScroll: true });
}

// The hero: chalk writes one character once on load.
async function chalkWrite(svg, ch) {
  const strokes = await loadStrokes(ch);
  if (!strokes || !svg.isConnected) return;
  svg.insertAdjacentHTML("beforeend", clipDefs(strokes, "hero") + `<g class="a"></g><g class="f"></g>`);
  const [a, f] = [svg.querySelector("g.a"), svg.querySelector("g.f")];
  await sleep(400);
  for (let i = 0; i < strokes.length && svg.isConnected; i++) {
    await revealStroke(a, f, strokes[i], "hero" + i, "var(--chalk)", 0.45);
    await sleep(120);
  }
}

function showUnit(ui) {
  const u = units[ui]; if (!u) return showHome();
  const done = getDone();
  const [num, title] = splitLesson(u.name);
  $app.innerHTML = `<header class="top">${backBtn("首頁", "")}<h1>${esc(num)} ${esc(title)}</h1></header>
    <div class="tiles">${u.words.map((w, i) =>
      `<button class="tile" data-ch="${esc(w.ch)}" aria-label="練習「${esc(w.ch)}」${done.has(w.ch) ? "，已完成" : ""}" onclick="location.hash='#/c/${ui}/${i}'">
        ${cellSVG(glyphFallback(w.ch))}<span class="zy">${zyHTML(w.zy)}</span>${done.has(w.ch) ? stampSVG("棒", "stamp-mini") : ""}</button>`).join("")}</div>` + footer();
  // swap the font fallback for the MOE standard glyph as each one loads
  for (const tile of $app.querySelectorAll(".tile")) loadStrokes(tile.dataset.ch).then(s => {
    if (s) tile.querySelector(".cell").insertAdjacentHTML("beforeend", glyphPaths(s)), tile.querySelector(".cell text").remove();
  });
}

async function showChar(ui, wi) {
  const u = units[ui], w = u && u.words[wi]; if (!w) return showHome();
  $app.innerHTML = `<header class="top">${backBtn(splitLesson(u.name)[1], `#/u/${ui}`)}</header><p class="note">載入中…</p>`;
  const strokes = await loadStrokes(w.ch);
  if (location.hash !== `#/c/${ui}/${wi}`) return; // navigated away while loading
  if (!strokes) {
    $app.querySelector(".note").textContent = `「${w.ch}」的筆順還在準備中，請過一段時間再回來練習。`;
    return;
  }
  new Practice(w, strokes, ui, wi);
}

// ---------- practice: 看 → 描 → 寫 ----------
class Practice {
  constructor(word, strokes, ui, wi) {
    Object.assign(this, { word, strokes, ui, wi, stage: "watch", idx: 0, fails: 0, busy: false, runId: 0 });
    const next = units[ui].words[wi + 1];
    $app.innerHTML = `
      <div class="practice">
        <div class="p-top">${backBtn(splitLesson(units[ui].name)[1], `#/u/${ui}`)}</div>
        <div class="board-wrap">
          <svg class="board" viewBox="0 0 2048 2048" aria-label="寫字格">
            ${clipDefs(strokes, "clip")}
            <rect class="frame" x="9" y="9" width="2030" height="2030" rx="60"/>
            <path class="cross" d="M1024 30V2018M30 1024H2018"/>
            <g class="ghost" fill="var(--ghost)">${strokes.map(s => `<path d="${s.d}"/>`).join("")}</g>
            <g class="done" fill="var(--ink)"></g>
            <g class="anim"></g>
            <g class="hint"></g>
            <path class="ink" fill="none" stroke="var(--hint)" stroke-width="70" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="side">
          <div class="charcard">
            ${cellSVG(glyphPaths(strokes))}
            <span class="zy">${zyHTML(word.zy)}</span>
            <span class="count">共<b>${strokes.length}</b>畫</span>
          </div>
          <div class="steps">
            <div class="step" data-s="watch"><i>1</i>看</div>
            <div class="step" data-s="trace"><i>2</i>描</div>
            <div class="step" data-s="write"><i>3</i>寫</div>
          </div>
          <div class="msg" role="status"></div>
          <div class="btns"></div>
          ${next ? `<button class="btn" onclick="location.hash='#/c/${ui}/${wi + 1}'">下一個字「${esc(next.ch)}」${ICONS.next}</button>` : ""}
        </div>
      </div>${footer()}`;
    this.svg = $app.querySelector("svg.board");
    for (const k of ["ghost", "done", "anim", "hint", "ink"]) this[k] = this.svg.querySelector("." + k);
    this.msgEl = $app.querySelector(".msg");
    this.btnsEl = $app.querySelector(".btns");
    this.bindPointer();
    this.setStage("watch");
  }

  say(text, cls = "") { this.msgEl.textContent = text; this.msgEl.className = "msg " + cls; }
  buttons(list) {
    this.btnsEl.innerHTML = "";
    for (const [ic, label, cls, fn] of list) {
      const b = document.createElement("button"); b.className = "btn " + cls; b.innerHTML = (ICONS[ic] || "") + esc(label); b.onclick = fn; this.btnsEl.append(b);
    }
  }

  setStage(stage) {
    this.runId++; // cancels any running animation loop
    Object.assign(this, { stage, idx: 0, fails: 0, totalFails: 0, startedAt: Date.now(), busy: false, shift: [0, 0], shiftN: 0 });
    const order = ["watch", "trace", "write"];
    $app.querySelectorAll(".step").forEach(el => el.className = "step" + (el.dataset.s === stage ? " on" : order.indexOf(el.dataset.s) < order.indexOf(stage) ? " done" : ""));
    this.done.innerHTML = this.anim.innerHTML = this.hint.innerHTML = "";
    this.ink.removeAttribute("d");
    this.ghost.style.display = stage === "write" ? "none" : "";
    if (stage === "watch") {
      this.buttons([["replay", "再看一次", "", () => this.setStage("watch")], ["pencil", "開始描", "primary", () => this.setStage("trace")]]);
      this.playAll();
    } else if (stage === "trace") {
      this.buttons([["eye", "看示範", "", () => this.setStage("watch")], ["erase", "重來", "", () => this.setStage("trace")]]);
      this.say("照著淡淡的字，一筆一筆描");
    } else {
      this.buttons([["eye", "看示範", "", () => this.setStage("watch")], ["erase", "重來", "", () => this.setStage("write")]]);
      this.say(`自己寫寫看，共 ${this.strokes.length} 畫`);
    }
  }

  async playAll() {
    const run = this.runId;
    this.busy = true;
    for (let i = 0; i < this.strokes.length; i++) {
      this.say(`第 ${i + 1} 畫`);
      await this.animateStroke(i, this.done, "var(--ink)");
      if (run !== this.runId) return;
      await sleep(250);
    }
    this.busy = false;
    this.say(`共 ${this.strokes.length} 畫，看清楚了嗎？`, "good");
  }

  animateStroke(i, group, color, msPerUnit = 0.75) { return revealStroke(this.anim, group, this.strokes[i], "clip" + i, color, msPerUnit); }

  // Allowed wander in MOE units (2048 = board). Looser when writing freely, and never under
  // ~45 screen px so a finger on a small phone board isn't judged more harshly than on an iPad.
  tolerance() {
    const unitsPerPx = 2048 / this.svg.getBoundingClientRect().width;
    return Math.max(this.stage === "write" ? 260 : 200, 45 * unitsPerPx);
  }

  showDot() {
    const [x, y] = this.strokes[this.idx].track[0];
    this.hint.innerHTML = `<circle class="startdot" cx="${x}" cy="${y}" r="70" fill="var(--stamp)" opacity=".85"/>`;
  }

  bindPointer() {
    let pid = null, pts = [];
    const toSvg = e => { const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(this.svg.getScreenCTM().inverse()); return [p.x, p.y]; };
    const draw = () => this.ink.setAttribute("d", "M" + pts.map(p => p[0].toFixed(0) + " " + p[1].toFixed(0)).join("L"));
    this.svg.addEventListener("pointerdown", e => {
      if (this.stage === "watch" || this.busy || pid !== null) return;
      pid = e.pointerId; this.svg.setPointerCapture(pid);
      pts = [toSvg(e)]; this.ink.style.stroke = ""; draw();
      e.preventDefault();
    });
    this.svg.addEventListener("pointermove", e => {
      if (e.pointerId !== pid) return;
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) pts.push(toSvg(ev));
      draw();
    });
    const end = e => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.onStroke(e.type === "pointercancel" ? [] : pts);
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
  }

  async onStroke(pts) {
    const run = this.runId;
    const track = this.strokes[this.idx].track;
    // Free writing: a child's whole character drifts. Undo the average drift of strokes already accepted.
    const [dx, dy] = this.shift;
    const r = judgeStroke(pts.map(([x, y]) => [x - dx, y - dy]), track, this.tolerance());
    if (r.ok && this.stage === "write") {
      const mx = (pts[0][0] - track[0][0] + pts.at(-1)[0] - track.at(-1)[0]) / 2;
      const my = (pts[0][1] - track[0][1] + pts.at(-1)[1] - track.at(-1)[1]) / 2;
      const n = this.shiftN++;
      this.shift = [(dx * n + mx) / (n + 1), (dy * n + my) / (n + 1)];
    }
    if (r.ok) {
      this.ink.removeAttribute("d"); this.hint.innerHTML = "";
      this.busy = true;
      await this.animateStroke(this.idx, this.done, "var(--ink)", 0.25);
      if (run !== this.runId) return;
      this.busy = false; this.idx++; this.fails = 0;
      if (this.idx === this.strokes.length) return this.finishStage();
      this.say(["很好！", "對了！", "寫得好！", "繼續！"][this.idx % 4] + ` 接著寫第 ${this.idx + 1} 畫`, "good");
      return;
    }
    // wrong: show red ink briefly, then help more each time
    this.fails++; this.totalFails++;
    this.ink.style.stroke = "var(--stamp)";
    this.say(r.why === "tap" ? "要用手指畫出一筆喔" : r.why === "start" ? "不是這一筆喔，想想看下一筆先寫哪裡" : "再試一次，想想這一筆怎麼走", "bad");
    this.busy = true;
    await sleep(500);
    if (run !== this.runId) return;
    this.ink.removeAttribute("d");
    // no hints at first: let the child work it out; help only after repeated misses
    if (this.fails === 2) { this.showDot(); this.say("從紅點開始寫寫看", "bad"); }
    if (this.fails >= 3) { this.say("看一下這一筆怎麼寫", "bad"); await this.animateStroke(this.idx, null, "var(--hint)", 0.9); }
    if (run !== this.runId) return;
    this.busy = false;
  }

  finishStage() {
    const tracing = this.stage === "trace";
    const saving = tracing ? null : recordPractice({ ch: this.word.ch, unit: units[this.ui].name, errors: this.totalFails, secs: Math.round((Date.now() - this.startedAt) / 1000) });
    if (!tracing) markDone(this.word.ch);
    const next = units[this.ui].words[this.wi + 1];
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `<div class="box" role="dialog" aria-label="${tracing ? "描完了" : "寫完了"}">${stampSVG(tracing ? "很好" : "好棒")}
      <h2>${tracing ? "描完了！換你自己寫" : `「${esc(this.word.ch)}」寫完了！`}</h2>${saving ? `<div class="pointbox">集點中…</div>` : ""}<div class="btns"></div></div>`;
    const btns = ov.querySelector(".btns");
    const add = (ic, label, cls, fn) => { const b = document.createElement("button"); b.className = "btn " + cls; b.innerHTML = ic === "next" ? esc(label) + ICONS.next : (ICONS[ic] || "") + esc(label); b.onclick = () => { ov.remove(); fn(); }; btns.append(b); };
    if (tracing) { add("replay", "再描一次", "", () => this.setStage("trace")); add("pencil", "自己寫", "primary", () => this.setStage("write")); }
    else {
      add("replay", "再寫一次", "", () => this.setStage("write"));
      if (next) add("next", `下一個字「${next.ch}」`, "go", () => location.hash = `#/c/${this.ui}/${this.wi + 1}`);
      else add("back", "回到這一課", "go", () => location.hash = `#/u/${this.ui}`);
    }
    document.body.append(ov);
    ov.querySelector(".btn.primary, .btn.go").focus({ preventScroll: true });
    saving && saving.then(r => {
      const box = ov.querySelector(".pointbox");
      if (!box) return;
      if (!r || !r.ok) { box.textContent = "現在連不上網路，點數會在下次連上網時補上"; return; }
      lastPoints = r;
      const full = r.added && r.points % r.card === 0;
      box.innerHTML = `<p class="${r.added ? "plus" : ""}">${full ? "集滿一張集點卡！拿給老師看" : r.added ? "集點 +1！" : `今天已經集過「${esc(this.word.ch)}」的點了，換別的字試試看`}</p>` + pointCard(r);
    });
  }
}

// ---------- routing ----------
function route() {
  if (!teacherCanLeave()) return;
  document.querySelectorAll(".overlay").forEach(o => o.remove());
  document.body.classList.remove("teacher-mode");
  const m = location.hash.match(/^#\/(u|c)\/(\d+)(?:\/(\d+))?$/);
  if (location.hash === "#/teacher") showTeacher();
  else if (students.length && (!getStudent() || location.hash === "#/login")) showLogin();
  else if (!m) showHome();
  else if (m[1] === "u") showUnit(+m[2]);
  else showChar(+m[2], +m[3]);
  window.scrollTo(0, 0);
}

// ---------- class data: one request, shown instantly from what this iPad remembers ----------
async function defaultUnits() {
  const rows = await fetchCSV("words.csv");
  if (!rows) throw new Error("字表讀取失敗");
  return groupUnits(rows);
}
const readBoot = () => { try { return JSON.parse(localStorage.getItem("stroke.boot")); } catch { return null; } };
async function fetchBoot() {
  const me = getStudent(), q = me ? `&no=${encodeURIComponent(me.no)}&name=${encodeURIComponent(me.name)}` : "";
  const j = await (await fetch(recordsUrl() + "?boot=1" + q, { cache: "no-store" })).json();
  if (!j.ok) throw new Error(j.error || "boot");
  if (j.me) lastPoints = j.me;
  try { localStorage.setItem("stroke.boot", JSON.stringify({ w: getRoster().w, units: j.units, students: j.students })); } catch {}
  return j;
}
async function applyBoot(b) {
  rosterError = false;
  students = b.students.filter(s => s.name);
  units = b.units.length ? b.units : await defaultUnits(); // class list if the teacher saved one
}
// fresh: wait for the server (teacher just saved). Otherwise paint from the remembered copy and refresh behind it.
async function loadData({ fresh = false } = {}) {
  if (!recordsUrl()) { students = []; units = await defaultUnits(); return; }
  const cached = readBoot();
  if (!fresh && cached && cached.w === getRoster().w) {
    await applyBoot(cached);
    fetchBoot().then(async b => {
      const changed = JSON.stringify([b.units, b.students]) !== JSON.stringify([cached.units, cached.students]);
      if (changed) { await applyBoot(b); if (!/^#\/(c|teacher)/.test(location.hash) && !document.querySelector(".overlay")) route(); }
      else if (lastPoints) { const el = $app.querySelector(".who .pts"); if (el) el.textContent = `★ ${lastPoints.points} 點`; }
    }).catch(() => {});
    return;
  }
  try { await applyBoot(await fetchBoot()); }
  catch { rosterError = true; students = []; units = await defaultUnits(); }
}
takeRosterFromLink();
loadData()
  .then(() => { window.addEventListener("hashchange", route); route(); })
  .catch(err => { $app.innerHTML = `<p class="note">讀不到字表，請確認網路連線後重新整理。<br>(${esc(err.message)})</p>`; });
