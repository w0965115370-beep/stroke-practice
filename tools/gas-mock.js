// Runs apps-script/Code.gs locally against an in-memory spreadsheet.
//   node tools/gas-mock.js          → self-test (asserts)
//   node tools/gas-mock.js serve    → mock web app on http://127.0.0.1:8090/
//     ROSTER_CSV=<csv url>          → start with a real roster instead of three sample students
//     PASSWORD=<pw>                 → start with this teacher password already set
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert"), http = require("http");
const { execFileSync } = require("child_process");
const SRC = fs.readFileSync(path.join(__dirname, "../apps-script/Code.gs"), "utf8");

function load({ roster, settings, fetchText } = {}) {
  const sheet = (name, values) => ({
    name, values,
    getName() { return this.name; },
    appendRow(r) { this.values.push(r.slice()); },
    clearContents() { this.values.length = 0; },
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      const s = this;
      if (typeof r === "string") return { setNumberFormat() {} };
      return {
        setNumberFormat() {},
        setValue(v) { (s.values[r - 1] ||= [])[c - 1] = v; },
        setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { (s.values[r - 1 + i] ||= [])[c - 1 + j] = v; })); },
      };
    },
    getDataRange() { const v = this.values; return { getValues: () => v.map(r => r.slice()) }; },
  });
  const book = {
    sheets: [sheet("工作表1", roster || [["班級", "座號", "姓名"], ["一年乙班", "01", "小明"], ["一年乙班", "02", "小華"], ["一年乙班", "03", "小美"]])],
    getName: () => "測試試算表", getSheets() { return this.sheets; },
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; },
    insertSheet(n) { const s = sheet(n, []); this.sheets.push(s); return s; },
  };
  if (settings) book.sheets.push(sheet("設定", settings));
  const fetchT = fetchText || (url => execFileSync("curl", ["-sL", "--max-time", "20", url], { encoding: "utf8", maxBuffer: 1 << 24 }));
  const resp = url => ({ getContentText: () => fetchT(url) });
  const cache = new Map();
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => book },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
    UrlFetchApp: { fetch: url => resp(url), fetchAll: reqs => reqs.map(r => resp(r.url)) },
    Utilities: { formatDate: (d, tz) => new Intl.DateTimeFormat("sv-SE", { timeZone: tz }).format(d) },
    ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    JSON, Date, Number, String, Object, Math, Error, Array, Set, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const get = parameter => JSON.parse(ctx.doGet({ parameter }).s);
  const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s);
  return { get, post, book };
}

function selfTest() {
  const fake = url => url.includes("moedict") ? JSON.stringify({ heteronyms: [{ bopomofo: "ㄉㄧˋ" }, { bopomofo: "˙ㄉㄜ" }] })
    : url.includes("ID=19978") ? 'var xml=[];\nxml[19978]="<?xml version=\\"1.0\\"?><Word><Stroke></Stroke></Word>";\n' : "<html>no data</html>";
  const g = load({ fetchText: fake });

  // roster, words, stroke proxy
  assert.deepStrictEqual(g.get({ roster: "1" }).students.map(s => s.no + s.name), ["1小明", "2小華", "3小美"], "roster from first tab, seat numbers normalized");
  assert.strictEqual(g.get({ roster: "1" }).cls, "一年乙班");
  assert.deepStrictEqual(g.get({ words: "1" }).units, [], "no 生字 tab yet");
  assert.strictEqual(g.get({ stroke: "上" }).ok, true, "MOE stroke data passed through");
  assert.strictEqual(g.get({ stroke: "上" }).xml.includes("<Stroke>"), true);
  assert.strictEqual(g.get({ stroke: "龘" }).ok, false, "character MOE doesn't have");

  // points: 1 per character per day, retries not double-counted
  const t1 = "2026-11-12T01:00:00Z", t2 = "2026-11-12T05:00:00Z", t3 = "2026-11-13T01:00:00Z";
  let r = g.post({ no: "1", name: "小明", ch: "上", errors: 2, secs: 30, time: t1, id: "a" });
  assert.deepStrictEqual([r.ok, r.added, r.points], [true, true, 1]);
  r = g.post({ no: "1", name: "小明", ch: "上", time: t2, id: "b" });
  assert.deepStrictEqual([r.added, r.points], [false, 1], "same char same day: no extra point");
  g.post({ no: "1", name: "小明", ch: "上", time: t2, id: "b" });
  assert.strictEqual(g.book.getSheetByName("練習紀錄").values.length, 3, "retried record stored once");
  assert.strictEqual(g.post({ no: "1", name: "小明", ch: "上", time: t3, id: "c" }).points, 2, "next day earns again");
  assert.strictEqual(g.post({ no: "01", name: "小明", ch: "下", time: t3, id: "d" }).points, 3, "01 and 1 are the same seat");
  assert.strictEqual(g.post({ name: "小明" }).ok, false, "incomplete record refused");

  // teacher: first-time password, then auth on every action
  assert.strictEqual(g.post({ action: "login", password: "" }).noPassword, true, "no password yet");
  assert.strictEqual(g.post({ action: "setPassword", password: "12" }).ok, false, "too short");
  assert.strictEqual(g.post({ action: "setPassword", password: "abcd" }).ok, true);
  assert.strictEqual(g.post({ action: "setPassword", password: "evil" }).ok, false, "can't be overwritten from the web");
  assert.strictEqual(g.post({ action: "dashboard", password: "wrong" }).ok, false);
  assert.strictEqual(g.post({ action: "saveWords", password: "wrong", units: [] }).ok, false, "saving needs the password");
  const dash = g.post({ action: "dashboard", password: "abcd" });
  assert.deepStrictEqual([dash.ok, dash.card, dash.students.length, dash.records.length], [true, 20, 3, 4]);

  // words / students / settings round trip
  assert.strictEqual(g.post({ action: "saveWords", password: "abcd", units: [{ sem: "一上", name: "第一課：拍拍手", words: [{ ch: "拍", zy: "ㄆㄞ" }, { ch: "手", zy: "ㄕㄡˇ" }] }, { sem: "一上", name: "第二課", words: [{ ch: "的", zy: "˙ㄉㄜ" }] }] }).count, 3);
  assert.deepStrictEqual(g.get({ words: "1" }).units.map(u => u.name + ":" + u.words.map(w => w.ch).join("")), ["第一課：拍拍手:拍手", "第二課:的"]);
  assert.strictEqual(g.post({ action: "saveWords", password: "abcd", units: [{ name: " ", words: [] }] }).ok, false, "unit needs a name");
  assert.strictEqual(g.post({ action: "saveStudents", password: "abcd", students: [{ no: "1", name: "小明" }, { no: "2", name: "小華" }, { no: "3", name: "" }] }).count, 2);
  assert.deepStrictEqual(g.get({ roster: "1" }).students.map(s => s.name), ["小明", "小華"], "學生 tab now wins over the old tab");
  assert.strictEqual(g.post({ action: "saveStudents", password: "abcd", students: [{ no: "1", name: "小明" }, { no: "1", name: "小明" }] }).ok, false, "duplicates refused");
  assert.strictEqual(g.post({ action: "saveSettings", password: "abcd", cls: "一年乙班", card: 2 }).ok, false, "card size range");
  assert.strictEqual(g.post({ action: "saveSettings", password: "abcd", cls: "一年乙班", card: 10 }).ok, true);
  assert.strictEqual(g.get({ no: "1", name: "小明" }).card, 10);
  assert.deepStrictEqual(g.post({ action: "zhuyin", password: "abcd", chars: "的的" }).readings, { "的": ["˙ㄉㄜ", "ㄉㄧˋ"] }, "textbook reading first");
  console.log("gas-mock: all passed");
}

async function serve(port = 8090) {
  let roster;
  if (process.env.ROSTER_CSV) {
    const text = await (await fetch(process.env.ROSTER_CSV)).text();
    roster = text.trim().split("\n").map(l => (l.match(/"([^"]*)"/g) || []).map(c => c.slice(1, -1)));
  }
  const g = load({ roster, settings: process.env.PASSWORD ? [["班級名稱", ""], ["老師密碼", process.env.PASSWORD], ["每張點數卡", 20]] : undefined });
  http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c); req.on("end", () => {
      const out = req.method === "POST" ? g.post(JSON.parse(body)) : g.get(Object.fromEntries(new URL(req.url, "http://x").searchParams));
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(out));
    });
  }).listen(port, "127.0.0.1", () => console.log(`mock web app on http://127.0.0.1:${port}/`));
}

process.argv[2] === "serve" ? serve(+process.argv[3] || 8090) : selfTest();
