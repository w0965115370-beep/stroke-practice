/**
 * 筆順小練習：班級資料服務（Google Apps Script）
 * 存學生名單、生字表、練習紀錄與點數，並代替網站向教育部取得筆順資料。
 *
 * 安裝（只要做一次）：
 *   1. 在一份 Google 試算表按「擴充功能 → Apps Script」，把這整份貼上（取代原本內容），存檔。
 *   2. 「部署 → 新增部署作業」→ 齒輪選「網頁應用程式」→ 執行身分「我」、誰可以存取「所有人」→ 部署 → 授權。
 *   3. 複製「網頁應用程式」網址，到練習網站按「老師」貼上，設定老師密碼。
 * 更新程式碼後：「部署 → 管理部署作業 → 編輯（鉛筆）→ 版本選『新版本』→ 部署」，網址不變。
 *
 * 試算表裡的工作表（沒有的話會自動建立）：學生、生字、練習紀錄、設定
 */
const 時區 = "Asia/Taipei";
const 紀錄欄位 = ["時間", "座號", "姓名", "字", "單元", "錯誤次數", "秒數", "編號"];
const 預設設定 = [["班級名稱", ""], ["老師密碼", ""], ["每張點數卡", 20]];
// 萌典的第一個讀音不是課本常用讀音的字
const 常用讀音 = { "的": "˙ㄉㄜ", "了": "˙ㄌㄜ", "啊": "˙ㄚ", "麼": "˙ㄇㄜ", "著": "˙ㄓㄜ", "呢": "˙ㄋㄜ", "吧": "˙ㄅㄚ",
  "什": "ㄕㄣˊ", "都": "ㄉㄡ", "更": "ㄍㄥˋ", "給": "ㄍㄟˇ", "們": "˙ㄇㄣ", "嗎": "˙ㄇㄚ", "得": "˙ㄉㄜ" };

// ================= web app =================
// GET  ?boot=1[&no=&name=] 開網站時要的全部資料（名單＋生字＋點數，一次拿）
//      ?roster=1 學生名單 · ?words=1 生字表 · ?stroke=字 筆順 · ?no=&name= 點數
// POST {…}                    一筆練習紀錄（學生 iPad）
// POST {action, password, …}  老師後台
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.boot) {
    const out = Object.assign({ ok: true }, boot_());
    if (p.name) out.me = points_(rows_(), norm_(p.no), p.name);
    return json_(out);
  }
  if (p.roster) return json_({ ok: true, cls: className_(), students: roster_().map(s => ({ no: s.no, name: s.name })) });
  if (p.words) return json_({ ok: true, units: units_() });
  if (p.stroke) return json_(stroke_(p.stroke));
  if (p.name) return json_(Object.assign({ ok: true }, points_(rows_(), norm_(p.no), p.name)));
  return json_({ ok: true, ping: "筆順小練習" });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "資料格式不對" }); }
  const action = d.action || "record";
  try {
    if (action === "record") return json_(record_(d));
    if (action === "setPassword") return json_(setPassword_(d.password));
    const denied = auth_(d.password);
    if (denied) return json_({ ok: false, error: denied, noPassword: denied === 未設密碼 });
    if (action === "login") return json_({ ok: true, cls: className_(), card: card_() });
    if (action === "dashboard") return json_({ ok: true, cls: className_(), card: card_(), students: roster_(), records: rows_() });
    if (action === "saveWords") return json_(saveWords_(d.units));
    if (action === "saveStudents") return json_(saveStudents_(d.students));
    if (action === "saveSettings") return json_(saveSettings_(d));
    if (action === "zhuyin") return json_({ ok: true, readings: zhuyin_(d.chars) });
    return json_({ ok: false, error: "不認得的動作" });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

// roster + words + class name for the student site; cached 10 minutes, cleared whenever the teacher saves
function boot_() {
  const cache = CacheService.getScriptCache(), hit = cache.get("boot");
  if (hit) return JSON.parse(hit);
  const b = { cls: className_(), card: card_(), students: roster_().map(s => ({ no: s.no, name: s.name })), units: units_() };
  const text = JSON.stringify(b);
  if (text.length < 95000) cache.put("boot", text, 600);
  return b;
}
function clearBoot_() { CacheService.getScriptCache().remove("boot"); }

// ================= teacher =================
const 未設密碼 = "還沒有設定老師密碼";
function auth_(password) {
  const real = String(settings_()["老師密碼"] || "").trim();
  if (!real) return 未設密碼;
  return String(password || "") === real ? "" : "密碼不對";
}
// only allowed while no password exists (first-time setup)
function setPassword_(password) {
  const pw = String(password || "").trim();
  if (String(settings_()["老師密碼"] || "").trim()) return { ok: false, error: "已經設定過密碼了；要更改請到試算表的「設定」工作表" };
  if (pw.length < 4) return { ok: false, error: "密碼至少 4 個字" };
  setSetting_("老師密碼", pw);
  return { ok: true };
}

function saveWords_(units) {
  if (!Array.isArray(units)) throw new Error("生字資料不對");
  const rows = [];
  units.forEach(u => {
    const name = String(u.name || "").trim();
    if (!name) throw new Error("有一課沒有名稱");
    (u.words || []).forEach(w => {
      const ch = Array.from(String(w.ch || "").trim())[0];
      if (ch) rows.push([String(u.sem || "").trim(), name, ch, String(w.zy || "").trim()]);
    });
  });
  writeTable_("生字", ["學期", "單元", "字", "注音"], rows);
  clearBoot_();
  return { ok: true, count: rows.length };
}

function saveStudents_(students) {
  if (!Array.isArray(students)) throw new Error("名單資料不對");
  const rows = students.map(s => [norm_(s.no), String(s.name || "").trim()]).filter(r => r[1]);
  const seen = {};
  rows.forEach(r => { const k = r[0] + "|" + r[1]; if (seen[k]) throw new Error(`名單裡有重複的學生：${r[0]} ${r[1]}`); seen[k] = 1; });
  writeTable_("學生", ["座號", "姓名"], rows);
  clearBoot_();
  return { ok: true, count: rows.length };
}

function saveSettings_(d) {
  const card = Math.round(Number(d.card));
  if (!(card >= 5 && card <= 100)) throw new Error("每張點數卡要在 5 到 100 點之間");
  setSetting_("班級名稱", String(d.cls || "").trim().slice(0, 20));
  setSetting_("每張點數卡", card);
  clearBoot_();
  return { ok: true };
}

// 萌典 readings for each character; common textbook reading first
function zhuyin_(chars) {
  const list = Array.from(new Set(Array.from(String(chars || "")))).filter(c => /\S/.test(c)).slice(0, 40);
  const res = UrlFetchApp.fetchAll(list.map(c => ({ url: "https://www.moedict.tw/uni/" + encodeURIComponent(c), muteHttpExceptions: true })));
  const out = {};
  list.forEach((c, i) => {
    let r = [];
    try { r = JSON.parse(res[i].getContentText()).heteronyms.map(h => h.bopomofo).filter(Boolean); } catch (err) {}
    r = Array.from(new Set(r));
    if (常用讀音[c]) r = [常用讀音[c]].concat(r.filter(x => x !== 常用讀音[c]));
    out[c] = r;
  });
  return out;
}

// ================= student side =================
function record_(d) {
  if (!d.name || !d.ch) return { ok: false, error: "資料不完整" };
  const no = norm_(d.no), time = d.time ? new Date(d.time) : new Date();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = rows_();
    // the iPad retries unsent records; never store the same one twice
    if (d.id && rows.some(r => r.id === String(d.id))) return Object.assign({ ok: true, added: false }, points_(rows, no, d.name));
    const day = Utilities.formatDate(time, 時區, "yyyy-MM-dd");
    const added = !rows.some(r => r.no === no && r.name === d.name && r.ch === d.ch && r.day === day);
    recordSheet_().appendRow([time, no, d.name, d.ch, d.unit || "", Number(d.errors) || 0, Number(d.secs) || 0, String(d.id || "")]);
    rows.push({ no: no, name: d.name, ch: d.ch, day: day });
    return Object.assign({ ok: true, added: added }, points_(rows, no, d.name));
  } finally {
    lock.releaseLock();
  }
}

// MOE stroke XML, passed through unchanged (CC BY-NC-ND 3.0 TW), cached for 6 hours
function stroke_(ch) {
  const c = Array.from(String(ch))[0];
  if (!c) return { ok: false };
  const cache = CacheService.getScriptCache(), key = "stroke_" + c.codePointAt(0);
  const hit = cache.get(key);
  if (hit) return { ok: true, xml: hit };
  const res = UrlFetchApp.fetch("https://stroke-order.learningweb.moe.edu.tw/dictView.jsp?ID=" + c.codePointAt(0), { muteHttpExceptions: true });
  const m = res.getContentText().match(/xml\[\d+\]=(".*?");\s*$/m);
  if (!m) return { ok: false };
  const xml = JSON.parse(m[1]).trim();
  if (xml.indexOf("<Stroke>") < 0) return { ok: false };
  if (xml.length < 95000) cache.put(key, xml, 21600);
  return { ok: true, xml: xml };
}

// ================= data =================
function points_(rows, no, name) { // 1 point per character per day
  const seen = {};
  rows.forEach(r => { if (r.no === no && r.name === name) seen[r.day + "|" + r.ch] = true; });
  return { points: Object.keys(seen).length, card: card_() };
}

function rows_() {
  const v = recordSheet_().getDataRange().getValues();
  return v.slice(1).filter(r => r[2]).map(r => {
    const t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    return { time: t.toISOString(), day: Utilities.formatDate(t, 時區, "yyyy-MM-dd"), no: norm_(r[1]), name: String(r[2]),
             ch: String(r[3]), unit: String(r[4]), errors: Number(r[5]) || 0, secs: Number(r[6]) || 0, id: String(r[7] || "") };
  });
}

// roster: the 學生 tab, or else the first tab that has a 姓名 column
function roster_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const tabs = [book.getSheetByName("學生")].concat(book.getSheets()).filter(Boolean);
  for (const sh of tabs) {
    if (["練習紀錄", "設定", "生字"].indexOf(sh.getName()) >= 0) continue;
    const v = sh.getDataRange().getValues(), head = (v[0] || []).map(x => String(x).trim());
    const iNo = head.indexOf("座號"), iName = head.indexOf("姓名"), iCls = head.indexOf("班級");
    if (iName < 0) continue;
    return v.slice(1).filter(r => String(r[iName]).trim()).map(r => ({
      no: iNo < 0 ? "" : norm_(r[iNo]), name: String(r[iName]).trim(), cls: iCls < 0 ? "" : String(r[iCls]).trim() }));
  }
  return [];
}

function units_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("生字");
  if (!sh) return [];
  const units = [];
  sh.getDataRange().getValues().slice(1).forEach(r => {
    const sem = String(r[0]).trim(), name = String(r[1]).trim() || "練習", ch = Array.from(String(r[2]).trim())[0];
    if (!ch) return;
    let u = units[units.length - 1];
    if (!u || u.sem !== sem || u.name !== name) units.push(u = { sem: sem, name: name, words: [] });
    if (!u.words.some(w => w.ch === ch)) u.words.push({ ch: ch, zy: String(r[3]).trim() });
  });
  return units;
}

function className_() {
  return String(settings_()["班級名稱"] || "").trim() || (roster_().find(s => s.cls) || {}).cls || SpreadsheetApp.getActiveSpreadsheet().getName();
}
function card_() { return Math.max(1, Number(settings_()["每張點數卡"]) || 20); }

function settings_() {
  const out = {};
  settingsSheet_().getDataRange().getValues().forEach(r => { out[String(r[0]).trim()] = r[1]; });
  return out;
}
function setSetting_(name, value) {
  const sh = settingsSheet_(), v = sh.getDataRange().getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]).trim() === name) { sh.getRange(i + 1, 2).setValue(value); return; }
  sh.appendRow([name, value]);
}
function settingsSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sh = book.getSheetByName("設定");
  if (!sh) { sh = book.insertSheet("設定"); 預設設定.forEach(r => sh.appendRow(r)); }
  return sh;
}
function recordSheet_() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sh = book.getSheetByName("練習紀錄");
  if (!sh) {
    sh = book.insertSheet("練習紀錄");
    sh.appendRow(紀錄欄位);
    sh.setFrozenRows(1);
    sh.getRange("B:B").setNumberFormat("@"); // keep 座號 as text
  }
  return sh;
}
// replace a whole tab with header + rows, everything stored as text
function writeTable_(name, header, rows) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const sh = book.getSheetByName(name) || book.insertSheet(name);
  sh.clearContents();
  const values = [header].concat(rows);
  const range = sh.getRange(1, 1, values.length, header.length);
  range.setNumberFormat("@");
  range.setValues(values);
  sh.setFrozenRows(1);
}

// 第一次安裝時在編輯器執行一次，讓 Google 詢問並取得需要的權限
function 授權() {
  settings_();
  UrlFetchApp.fetch("https://www.moedict.tw/uni/%E4%B8%80", { muteHttpExceptions: true });
  Logger.log("授權完成");
}

function norm_(no) { return String(no == null ? "" : no).trim().replace(/^0+(?=\d)/, ""); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
