"use strict";
// ================= 老師後台 (#/teacher) =================
// Uses globals from app.js: $app, esc, api, recordsUrl, getRoster, loadData, loadStrokes, fetchCSV, groupUnits, footer.
const T = { tab: "dash", dirty: false, cls: "", card: 20, words: null, kids: null, readings: {}, missing: new Set() };
const tpw = {
  get() { try { return sessionStorage.getItem("stroke.tpw") || ""; } catch { return ""; } },
  set(v) { try { v ? sessionStorage.setItem("stroke.tpw", v) : sessionStorage.removeItem("stroke.tpw"); } catch {} },
};
const tapi = body => api({ ...body, password: tpw.get() });

// unsaved edits: ask before leaving
function teacherCanLeave() {
  if (!T.dirty || location.hash === "#/teacher") return true;
  if (confirm("剛剛的修改還沒儲存，確定要離開嗎？")) { setDirty(false); return true; }
  history.pushState(null, "", "#/teacher");
  return false;
}
window.addEventListener("beforeunload", e => { if (T.dirty) { e.preventDefault(); e.returnValue = ""; } });
function setDirty(v) {
  T.dirty = v;
  const el = document.querySelector(".t-state");
  if (el) { el.textContent = v ? "● 還沒儲存" : "已儲存"; el.classList.toggle("on", v); }
}
function toast(text, bad = false) {
  const el = document.createElement("div");
  el.className = "t-toast" + (bad ? " bad" : ""); el.setAttribute("role", "status"); el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 3200);
}

function tPage(inner) {
  document.body.classList.add("teacher-mode");
  $app.innerHTML = `<div class="t-top t-noprint"><button class="back" onclick="location.hash=''">${ICONS.back}回練習畫面</button>
    <h1>老師後台${T.cls ? `<small>${esc(T.cls)}</small>` : ""}</h1>${tpw.get() ? `<button class="t-logout" id="logout">登出</button>` : ""}</div>${inner}` + footer();
  const lo = document.getElementById("logout");
  if (lo) lo.onclick = () => { if (!T.dirty || confirm("剛剛的修改還沒儲存，確定要登出嗎？")) { setDirty(false); tpw.set(""); showTeacher(); } };
}

async function showTeacher() {
  if (!recordsUrl()) return tConnect();
  if (!tpw.get()) return tLogin();
  let j;
  try { j = await tapi({ action: "login" }); } catch { return tPage(`<p class="note">連不上班級資料，請確認網路後重新整理。</p>`); }
  if (!j.ok) { tpw.set(""); return tLogin(j.error); }
  T.cls = j.cls; T.card = j.card;
  renderTabs();
}

// ---------- first time on this device: connect to the class's data service ----------
function tConnect(err = "") {
  tPage(`<div class="box t-narrow">
    <h2>連接班級資料</h2>
    <p>這台裝置還沒連上班級資料。請貼上 Apps Script「網頁應用程式」的網址（只要做一次）。</p>
    <p class="muted">如果你有老師連結或 QR Code，直接用它打開這個網站也可以。</p>
    <label for="apiurl">網頁應用程式網址</label>
    <input id="apiurl" type="url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off">
    <p class="t-err" id="err">${esc(err)}</p>
    <button class="btn primary" id="connect">連接</button></div>`);
  const go = async () => {
    const raw = document.getElementById("apiurl").value.trim();
    const m = raw.match(/\/macros\/s\/([\w-]+)\/exec/) || raw.match(/^(http:\/\/127\.0\.0\.1:\d+\/)$/);
    if (!m) return tConnect("網址不對，應該長得像 https://script.google.com/macros/s/…/exec");
    try { localStorage.setItem("stroke.roster", JSON.stringify({ w: m[1] })); } catch {}
    try {
      const j = await (await fetch(recordsUrl())).json();
      if (j.ping !== "筆順小練習") throw 0;
    } catch {
      try { localStorage.removeItem("stroke.roster"); } catch {}
      return tConnect("連不上。請確認部署時「誰可以存取」選了「所有人」，並完成授權。");
    }
    await loadData();
    showTeacher();
  };
  document.getElementById("connect").onclick = go;
  document.getElementById("apiurl").onkeydown = e => { if (e.key === "Enter") go(); };
}

// ---------- password (first time: create one) ----------
async function tLogin(err = "") {
  let first = false;
  try { first = !!(await api({ action: "login", password: "" })).noPassword; } catch {}
  tPage(first ? `<div class="box t-narrow">
      <h2>設定老師密碼</h2><p>第一次使用，請設定一組老師密碼（至少 4 個字），之後進後台都要輸入。</p>
      <label for="p1">老師密碼</label><input id="p1" type="password" autocomplete="new-password">
      <label for="p2">再輸入一次</label><input id="p2" type="password" autocomplete="new-password">
      <p class="t-err" id="err">${esc(err)}</p><button class="btn primary" id="ok">設定密碼</button></div>`
    : `<div class="box t-narrow">
      <h2>老師登入</h2>
      <label for="p1">老師密碼</label><input id="p1" type="password" autocomplete="current-password">
      <p class="t-err" id="err">${esc(err)}</p><button class="btn primary" id="ok">進入後台</button>
      <p class="muted">忘記密碼：打開班級的 Google 試算表，在「設定」工作表可以看到或修改。</p></div>`);
  const p1 = document.getElementById("p1"), errEl = document.getElementById("err");
  p1.focus();
  const go = async () => {
    errEl.textContent = "";
    if (first) {
      if (p1.value !== document.getElementById("p2").value) { errEl.textContent = "兩次輸入的密碼不一樣"; return; }
      const j = await api({ action: "setPassword", password: p1.value }).catch(() => ({ ok: false, error: "連不上，請確認網路" }));
      if (!j.ok) { errEl.textContent = j.error; return; }
    }
    tpw.set(p1.value);
    showTeacher();
  };
  document.getElementById("ok").onclick = go;
  $app.querySelectorAll("input").forEach(i => i.onkeydown = e => { if (e.key === "Enter") go(); });
}

// ---------- tabs ----------
const TABS = [["dash", "練習狀況"], ["words", "生字"], ["kids", "學生名單"], ["qr", "QR Code"], ["settings", "設定"]];
function renderTabs() {
  tPage(`<nav class="t-tabs t-noprint" role="tablist">${TABS.map(([k, t]) =>
    `<button role="tab" data-t="${k}" aria-selected="${k === T.tab}">${t}</button>`).join("")}</nav><div id="tbody"><p class="note">讀取中…</p></div>`);
  $app.querySelectorAll(".t-tabs button").forEach(b => b.onclick = () => {
    if (b.dataset.t === T.tab) return;
    if (T.dirty && !confirm("剛剛的修改還沒儲存，確定要切換嗎？")) return;
    setDirty(false); T.tab = b.dataset.t; renderTabs();
  });
  ({ dash: tabDash, words: tabWords, kids: tabKids, qr: tabQR, settings: tabSettings })[T.tab]();
}
const tbody = () => document.getElementById("tbody");
const saveBar = id => `<div class="t-savebar"><span class="t-state">已儲存</span><button class="btn primary" id="${id}">儲存</button></div>`;

// ---------- 練習狀況 ----------
async function tabDash() {
  const d = await tapi({ action: "dashboard" }).catch(() => null);
  if (!d || !d.ok) { tbody().innerHTML = `<p class="note">讀不到紀錄，請重新整理。</p>`; return; }
  const { students, records, card } = d, DAY = 864e5, now = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const key = s => `${s.no}|${s.name}`, last = new Map(), points = new Map();
  for (const r of records) {
    last.set(key(r), Math.max(last.get(key(r)) || 0, Date.parse(r.time)));
    if (!points.has(key(r))) points.set(key(r), new Set());
    points.get(key(r)).add(r.day + "|" + r.ch);
  }
  const groups = { ok: [], idle: [], never: [] };
  for (const s of students) { const t = last.get(key(s)); groups[!t ? "never" : now - t < 7 * DAY ? "ok" : "idle"].push(s); }

  // donut: the class split into 3 states (part-to-whole)
  const R = 80, C = 2 * Math.PI * R, total = students.length || 1, gap = students.length > 1 ? 3 : 0;
  const segs = [["ok", "近 7 天有練習", "✓"], ["idle", "超過 7 天沒練習", "⚠"], ["never", "還沒開始練習", "✕"]];
  let off = 0;
  const arcs = segs.map(([k]) => {
    const len = groups[k].length / total * C;
    const a = len ? `<circle r="${R}" cx="110" cy="110" fill="none" stroke="var(--${k})" stroke-width="34" stroke-dasharray="${Math.max(0, len - gap)} ${C}"
      stroke-dashoffset="${-off}" transform="rotate(-90 110 110)"><title>${groups[k].length} 人</title></circle>` : "";
    off += len; return a;
  }).join("");

  // columns: how many different students practiced each day, last 14 days
  const days = Array.from({ length: 14 }, (_, i) => today.getTime() - (13 - i) * DAY);
  const perDay = days.map(t0 => new Set(records.filter(r => { const t = Date.parse(r.time); return t >= t0 && t < t0 + DAY; }).map(key)).size);
  const maxD = Math.max(1, ...perDay), wk = "日一二三四五六";

  // hardest characters, seen at least twice
  const h = new Map();
  for (const r of records) { const x = h.get(r.ch) || { ch: r.ch, n: 0, e: 0 }; x.n++; x.e += r.errors; h.set(r.ch, x); }
  const hard = [...h.values()].filter(x => x.n >= 2).map(x => ({ ...x, avg: x.e / x.n })).sort((a, b) => b.avg - a.avg).slice(0, 5);
  const maxE = Math.max(0.1, ...hard.map(x => x.avg));
  const lastText = t => { if (!t) return "還沒練習"; const n = Math.round((today - new Date(t).setHours(0, 0, 0, 0)) / DAY); return n <= 0 ? "今天" : n === 1 ? "昨天" : `${n} 天前`; };

  tbody().innerHTML = `<div class="dash">
    <div class="dash-top"><span>更新於 ${new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}</span><button class="btn" id="re">重新整理</button></div>
    <div class="box status-card">
      <svg class="donut" viewBox="0 0 220 220" role="img" aria-label="${groups.ok.length} 人近 7 天有練習，共 ${students.length} 人">
        <circle r="${R}" cx="110" cy="110" fill="none" stroke="var(--grid-soft)" stroke-width="34"/>${arcs}
        <text x="110" y="112" text-anchor="middle" class="big">${groups.ok.length}<tspan class="small" dx="4">/ ${students.length}</tspan></text>
        <text x="110" y="138" text-anchor="middle" class="small">人有練習</text>
      </svg>
      <div class="legend"><h2>這一週的練習狀況</h2>
        ${segs.map(([k, lab, ic]) => `<div class="row"><span class="sw" style="background:var(--${k})"></span><span class="lab">${ic} ${lab}</span><span class="cnt">${groups[k].length} 人</span>
          ${k !== "ok" && groups[k].length ? `<div class="names">${groups[k].map(s => `<span>${esc(s.no)} ${esc(s.name)}</span>`).join("")}</div>` : ""}</div>`).join("")}
      </div>
    </div>
    <div class="box"><h2>每天有幾個人練習（最近兩週）</h2>
      <div class="cols">${perDay.map((n, i) => { const d = new Date(days[i]);
        return `<div class="c" title="${d.getMonth() + 1}/${d.getDate()}：${n} 人"><em>${n || ""}</em><i style="height:${n / maxD * 100}%"></i></div>`; }).join("")}</div>
      <div class="xlab">${days.map((t, i) => `<span>${i === 13 ? "今天" : wk[new Date(t).getDay()]}</span>`).join("")}</div>
    </div>
    <div class="box hard"><h2>最常寫錯的字</h2>
      ${hard.length ? hard.map(x => `<div class="r" title="寫完 ${x.n} 次，平均錯 ${x.avg.toFixed(1)} 筆"><span class="ch">${esc(x.ch)}</span>
        <span class="t"><i style="width:${x.avg / maxE * 100}%"></i></span><span class="v">平均錯 ${x.avg.toFixed(1)} 筆</span></div>`).join("")
        : `<p class="muted">紀錄還不夠多，等大家多練幾個字再來看。</p>`}
    </div>
    <details class="box"><summary>每位學生的點數</summary>
      <table class="t-table t-points"><thead><tr><th>座號</th><th>姓名</th><th>點數</th><th>集點卡</th><th>最近練習</th></tr></thead><tbody>
      ${students.map(s => { const p = (points.get(key(s)) || new Set()).size, t = last.get(key(s));
        return `<tr><td>${esc(s.no)}</td><td>${esc(s.name)}</td><td>${p}</td><td>${Math.floor(p / card)} 張又 ${p % card} 點</td>
          <td class="${!t || now - t >= 7 * DAY ? "late" : ""}">${lastText(t)}</td></tr>`; }).join("")}
      </tbody></table>
      <p class="muted">寫完一個字得 1 點，同一個字一天只算 1 點，${card} 點集滿一張卡。</p>
    </details></div>`;
  document.getElementById("re").onclick = tabDash;
}

// ---------- 生字 ----------
async function tabWords() {
  if (!T.words) {
    const j = await (await fetch(recordsUrl() + "?words=1", { cache: "no-store" })).json().catch(() => null);
    if (!j || !j.ok) { tbody().innerHTML = `<p class="note">讀不到生字表，請重新整理。</p>`; return; }
    T.words = j.units;
  }
  drawWords();
}
function drawWords() {
  const W = T.words;
  tbody().innerHTML = `${saveBar("save")}
    ${W.length ? "" : `<div class="box t-empty"><h2>還沒有生字</h2><p>可以先匯入預設的康軒一年級字表（18 課、262 字），再增減。學生在你儲存之前，會先看到預設字表。</p>
      <button class="btn primary" id="import">匯入康軒一年級字表</button></div>`}
    <div id="units">${W.map((u, i) => `<div class="box t-unit" data-i="${i}">
      <div class="t-unit-head">
        <input class="t-sem" data-f="sem" value="${esc(u.sem)}" placeholder="學期" aria-label="學期">
        <input class="t-name" data-f="name" value="${esc(u.name)}" placeholder="課名，例如 第一課：拍拍手" aria-label="課名">
        <button class="t-icon" data-a="up" aria-label="往上移" ${i ? "" : "disabled"}>↑</button>
        <button class="t-icon" data-a="down" aria-label="往下移" ${i < W.length - 1 ? "" : "disabled"}>↓</button>
        <button class="t-icon danger" data-a="del" aria-label="刪除這一課">刪除</button>
      </div>
      <div class="t-words">${u.words.map((w, j) => `<span class="t-word${T.missing.has(w.ch) ? " miss" : ""}" data-j="${j}">
        <b>${esc(w.ch)}</b><input data-f="zy" value="${esc(w.zy)}" list="zy-${esc(w.ch)}" aria-label="${esc(w.ch)} 的注音" placeholder="注音">
        ${T.readings[w.ch] && T.readings[w.ch].length > 1 ? `<datalist id="zy-${esc(w.ch)}">${T.readings[w.ch].map(z => `<option value="${esc(z)}">`).join("")}</datalist>` : ""}
        <button data-a="x" aria-label="刪除 ${esc(w.ch)}">×</button>${T.missing.has(w.ch) ? `<em>沒有筆順資料</em>` : ""}</span>`).join("")}
        ${u.words.length ? "" : `<span class="muted">這一課還沒有字</span>`}</div>
      <div class="t-add"><input data-f="add" placeholder="輸入要加的字，可以一次打很多個" aria-label="加入生字"><button class="btn" data-a="add">加入</button></div>
    </div>`).join("")}</div>
    <button class="btn t-addunit" id="addunit">＋ 新增一課</button>
    <p class="muted">注音會自動帶入常用讀音，破音字請確認。標示「沒有筆順資料」的字，教育部沒有收錄，學生無法練習。</p>`;
  setDirty(T.dirty);

  const box = document.getElementById("units");
  box.addEventListener("input", e => {
    const f = e.target.dataset.f, u = W[+e.target.closest(".t-unit").dataset.i];
    if (f === "sem" || f === "name") { u[f] = e.target.value; setDirty(true); }
    if (f === "zy") { u.words[+e.target.closest(".t-word").dataset.j].zy = e.target.value.trim(); setDirty(true); }
  });
  box.addEventListener("keydown", e => { if (e.target.dataset.f === "add" && e.key === "Enter") addChars(e.target.closest(".t-unit")); });
  box.addEventListener("click", e => {
    const a = e.target.dataset.a; if (!a) return;
    const card = e.target.closest(".t-unit"), i = +card.dataset.i;
    if (a === "add") return addChars(card);
    if (a === "x") W[i].words.splice(+e.target.closest(".t-word").dataset.j, 1);
    if (a === "up") [W[i - 1], W[i]] = [W[i], W[i - 1]];
    if (a === "down") [W[i + 1], W[i]] = [W[i], W[i + 1]];
    if (a === "del" && !confirm(`確定要刪除「${W[i].name || "這一課"}」和裡面的 ${W[i].words.length} 個字嗎？`)) return;
    if (a === "del") W.splice(i, 1);
    setDirty(true); drawWords();
  });
  document.getElementById("addunit").onclick = () => {
    const last = W.at(-1);
    W.push({ sem: last ? last.sem : "", name: "", words: [] });
    setDirty(true); drawWords();
    [...document.querySelectorAll(".t-name")].at(-1).focus();
  };
  const imp = document.getElementById("import");
  if (imp) imp.onclick = async () => { T.words = groupUnits(await fetchCSV("words.csv")); setDirty(true); drawWords(); };
  document.getElementById("save").onclick = async () => {
    if (W.some(u => !u.name.trim())) return toast("每一課都要有課名", true);
    const j = await tapi({ action: "saveWords", units: W }).catch(() => ({ ok: false, error: "連不上，請確認網路後再按一次儲存" }));
    if (!j.ok) return toast(j.error, true);
    setDirty(false); await loadData();
    toast(`已儲存 ${j.count} 個字，學生重新整理就會看到`);
  };
}
// add typed characters to a lesson, then look up 注音 and check MOE has stroke data
async function addChars(card) {
  const u = T.words[+card.dataset.i], input = card.querySelector('[data-f="add"]');
  const chars = [...new Set([...input.value].filter(c => /\p{Script=Han}/u.test(c)))].filter(c => !u.words.some(w => w.ch === c));
  if (!chars.length) { input.value = ""; return; }
  chars.forEach(ch => u.words.push({ ch, zy: "" }));
  setDirty(true); drawWords();
  const lookup = chars.filter(c => !T.readings[c]);
  if (lookup.length) {
    const j = await tapi({ action: "zhuyin", chars: lookup.join("") }).catch(() => null);
    if (j && j.ok) Object.assign(T.readings, j.readings);
  }
  for (const w of u.words) if (chars.includes(w.ch) && !w.zy) w.zy = (T.readings[w.ch] || [])[0] || "";
  await Promise.all(chars.map(async c => { if (!(await loadStrokes(c))) T.missing.add(c); }));
  if (T.tab === "words") drawWords();
}

// ---------- 學生名單 ----------
async function tabKids() {
  if (!T.kids) {
    const j = await (await fetch(recordsUrl() + "?roster=1", { cache: "no-store" })).json().catch(() => null);
    if (!j || !j.ok) { tbody().innerHTML = `<p class="note">讀不到學生名單，請重新整理。</p>`; return; }
    T.kids = j.students;
  }
  drawKids();
}
function drawKids() {
  const K = T.kids;
  tbody().innerHTML = `${saveBar("save")}
    <div class="box"><table class="t-table t-kids"><thead><tr><th>座號</th><th>名字</th><th></th></tr></thead><tbody>
      ${K.map((k, i) => `<tr data-i="${i}"><td><input data-f="no" value="${esc(k.no)}" inputmode="numeric" aria-label="座號"></td>
        <td><input data-f="name" value="${esc(k.name)}" aria-label="名字"></td><td><button class="t-icon danger" data-a="del" aria-label="刪除 ${esc(k.name)}">刪除</button></td></tr>`).join("")}
      </tbody></table>
      ${K.length ? "" : `<p class="muted">還沒有學生。</p>`}
      <button class="btn" id="addkid">＋ 新增學生</button>
      <details class="t-paste"><summary>一次貼上整個名單</summary>
        <p class="muted">每行一位，座號和名字用空白或 Tab 隔開，例如「1 小明」。可以直接從 Excel 或 Google 試算表複製兩欄貼上。貼上會<b>取代</b>目前的名單。</p>
        <textarea id="paste" rows="8" placeholder="1 小明&#10;2 小華"></textarea><button class="btn" id="usepaste">用這份名單</button></details>
    </div>
    <p class="muted">名單會出現在學生的「你是誰？」畫面。建議只填名字、不填姓。</p>`;
  setDirty(T.dirty);
  const tb = $app.querySelector(".t-kids tbody");
  tb.addEventListener("input", e => { K[+e.target.closest("tr").dataset.i][e.target.dataset.f] = e.target.value.trim(); setDirty(true); });
  tb.addEventListener("click", e => {
    if (e.target.dataset.a !== "del") return;
    const i = +e.target.closest("tr").dataset.i;
    if (!confirm(`確定要把 ${K[i].no} ${K[i].name} 從名單刪除嗎？（練習紀錄會保留）`)) return;
    K.splice(i, 1); setDirty(true); drawKids();
  });
  document.getElementById("addkid").onclick = () => {
    K.push({ no: String(Math.max(0, ...K.map(k => Number(k.no) || 0)) + 1), name: "" });
    setDirty(true); drawKids();
    [...$app.querySelectorAll('.t-kids [data-f="name"]')].at(-1).focus();
  };
  document.getElementById("usepaste").onclick = () => {
    const rows = document.getElementById("paste").value.split("\n").map(l => l.trim().split(/[\s,，]+/)).filter(r => r[0]);
    if (!rows.length) return;
    T.kids = rows.map(r => r.length > 1 ? { no: r[0], name: r.slice(1).join("") } : { no: "", name: r[0] });
    setDirty(true); drawKids();
  };
  document.getElementById("save").onclick = async () => {
    const list = K.filter(k => k.name);
    const j = await tapi({ action: "saveStudents", students: list }).catch(() => ({ ok: false, error: "連不上，請確認網路後再按一次儲存" }));
    if (!j.ok) return toast(j.error, true);
    T.kids = list; setDirty(false); await loadData(); drawKids();
    toast(`已儲存 ${j.count} 位學生`);
  };
}

// ---------- QR Code ----------
function studentLink() {
  const w = getRoster().w;
  return new URL("./", location.href).href + "#w=" + (w.startsWith("http") ? encodeURIComponent(w) : w);
}
let qrLib = null;
const loadQR = () => qrLib ||= new Promise((ok, fail) => {
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  s.onload = ok; s.onerror = () => { qrLib = null; fail(); };
  document.head.append(s);
});
async function tabQR() {
  const link = studentLink();
  try { await loadQR(); } catch { tbody().innerHTML = `<p class="note">QR Code 工具載入失敗，請確認網路後重新整理。</p>`; return; }
  const qr = qrcode(0, "M"); qr.addData(link); qr.make();
  tbody().innerHTML = `<div class="box t-qrcard"><h2>筆順小練習</h2><div class="cls">${esc(T.cls)}</div>
      ${qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true })}<div class="scan">打開相機，掃我開始練習</div></div>
    <div class="t-center t-noprint"><button class="btn primary" onclick="print()">列印 QR Code</button><button class="btn" id="copy">複製連結</button></div>
    <div class="box t-narrow t-noprint"><b>怎麼用</b><ol>
      <li>把 QR Code 印出來或投影，全班共用一張。</li>
      <li>小朋友用 iPad 相機掃，點跳出來的連結，再點自己的名字。</li>
      <li>老師也用同一個連結打開網站，按右上角「老師」進後台。建議加入書籤。</li></ol>
      <p class="muted t-link">${esc(link)}</p></div>`;
  document.getElementById("copy").onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast("連結已複製"); } catch { toast("無法自動複製，請直接選取下方的連結", true); }
  };
}

// ---------- 設定 ----------
function tabSettings() {
  tbody().innerHTML = `${saveBar("save")}<div class="box t-narrow">
      <label for="scls">班級名稱</label><input id="scls" value="${esc(T.cls)}" maxlength="20">
      <label for="scard">幾點集滿一張集點卡</label><input id="scard" type="number" min="5" max="100" value="${T.card}">
      <p class="muted">老師密碼存在班級 Google 試算表的「設定」工作表，要改密碼請直接在那裡修改。</p>
    </div>
    <div class="box t-narrow"><h2>這台裝置</h2>
      <p class="muted">把這台 iPad 和班級資料的連線移除，例如要借給別班使用。移除後，需要重新掃 QR Code。</p>
      <button class="btn danger" id="disconnect">移除連線</button></div>`;
  setDirty(false);
  for (const id of ["scls", "scard"]) document.getElementById(id).oninput = () => setDirty(true);
  document.getElementById("save").onclick = async () => {
    const j = await tapi({ action: "saveSettings", cls: document.getElementById("scls").value, card: Number(document.getElementById("scard").value) })
      .catch(() => ({ ok: false, error: "連不上，請確認網路後再按一次儲存" }));
    if (!j.ok) return toast(j.error, true);
    T.cls = document.getElementById("scls").value.trim() || T.cls; T.card = Number(document.getElementById("scard").value);
    setDirty(false); toast("已儲存");
  };
  document.getElementById("disconnect").onclick = async () => {
    if (!confirm("確定要移除這台裝置的班級連線嗎？")) return;
    try { localStorage.removeItem("stroke.roster"); localStorage.removeItem("stroke.student"); } catch {}
    tpw.set(""); T.words = T.kids = null;
    await loadData(); location.hash = "";
  };
}
