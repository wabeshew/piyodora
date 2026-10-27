// ぴよドラ スモークテスト（ブラウザなしで動く）
// 使い方: node tests/smoke.test.js
// index.html の <script> を取り出し、canvas / DOM / localStorage をスタブして実行する。
// 最後の "})();" の直前にデバッグ用フック window.__dbg を差し込んでいる点に注意。
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
js = js.replace(/\}\)\(\);\s*$/, 'window.__dbg={P,state,chick,joy,MAPS,DUNGEONS,ISLANDS,get cur(){return cur},get enemies(){return enemies},findTiles,tileCenter,primaryAction,advanceDialog,buy,loadMap,hurt,openMap,totalDia,genChests,ITEMS};\n})();');

function mkCtx() {
  const t = {};
  return new Proxy(t, {
    get(o, p) {
      if (p in o) return o[p];
      if (p === 'measureText') return () => ({ width: 100 });
      return (...a) => { for (const v of a) if (typeof v === 'number' && !isFinite(v)) throw new Error('非有限の値: ' + String(p)); return { addColorStop() {} }; };
    },
    set(o, p, v) { if (typeof v === 'number' && !isFinite(v)) throw new Error('非有限の値: ' + p); o[p] = v; return true; }
  });
}
const els = {};
function mkEl(id) {
  const handlers = {}, cl = new Set(['endScreen', 'dialog', 'shop', 'party'].includes(id) ? ['hidden'] : []);
  return {
    id, handlers, children: [], style: { setProperty() {} },
    classList: { add: c => cl.add(c), remove: c => cl.delete(c), toggle: (c, f) => { if (f === undefined) f = !cl.has(c); f ? cl.add(c) : cl.delete(c); return f; }, contains: c => cl.has(c) },
    addEventListener(t, f) { (handlers[t] = handlers[t] || []).push(f); },
    getBoundingClientRect() { return id === 'base' ? { left: 40, top: 600, width: 98, height: 98 } : { left: 0, top: 0, width: 366, height: 520 }; },
    getContext: () => mkCtx(), querySelectorAll: () => [mkEl(), mkEl(), mkEl(), mkEl(), mkEl()], querySelector: () => mkEl('base'),
    setAttribute() {}, setPointerCapture() {}, appendChild(c) { this.children.push(c); },
    get childElementCount() { return this.children.length; }, set innerHTML(v) { this.children = []; this._h = v; }, get innerHTML() { return this._h || ''; },
    clientWidth: 200, clientHeight: 96, width: 0, height: 0, hidden: true, textContent: '', className: '', disabled: false,
    click() { (handlers.click || []).forEach(f => f({ preventDefault() {} })); },
    fire(t, e) { (handlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, stopPropagation() {}, pointerId: 1, clientX: 100, clientY: 100, key: '', repeat: false }, e || {}))); }
  };
}
let raf = null, now = 0;
const store = {};
global.document = { getElementById: id => els[id] || (els[id] = mkEl(id)), createElement: () => mkEl('x'), addEventListener() {}, hidden: false };
global.window = { devicePixelRatio: 2, addEventListener() {}, matchMedia: () => ({ matches: false }) };
global.requestAnimationFrame = f => { raf = f; };
global.performance = { now: () => now };
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem(k, v) { store[k] = String(v); } };
global.navigator = { maxTouchPoints: 5 };
global.setTimeout = () => 0;
global.Image = class { constructor() { this.complete = true; this.naturalWidth = 264; this.naturalHeight = 236; } };
eval(js);

const D = window.__dbg;
const step = n => { for (let i = 0; i < n; i++) { now += 16.7; raf(now); } };
const tp = (x, y) => { D.chick.x = D.chick.tx = x; D.chick.y = D.chick.ty = y; };
const dlgDone = () => { for (let i = 0; i < 60 && D.state.mode === 'dialog'; i++) { D.advanceDialog(); D.advanceDialog(); step(1); } };
let fails = 0;
const ok = (c, m) => { if (!c) { console.log('NG', m); fails++; } else console.log('OK', m); };

// 1. すべてのタイルマップがつながっているか
const solid = new Set(['#', 'w', '~', 'o', 'b', 't', 'k', 'f', 'c', 'p', 'h', 'T', 's']);
for (const id in D.MAPS) {
  const m = D.MAPS[id]; if (!m.grid) continue;
  const ex = D.findTiles(m, m.kind === 'dungeon' ? 'S' : 'D')[0], seen = new Set([ex.tx + ',' + ex.ty]), q = [ex];
  while (q.length) { const c = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c.tx + dx, y = c.ty + dy; if (x < 0 || y < 0 || x >= m.cols || y >= m.rows) continue; const k = x + ',' + y; if (seen.has(k) || solid.has(m.grid[y][x])) continue; seen.add(k); q.push({ tx: x, ty: y }); } }
  const bad = []; for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) { const ch = m.grid[y][x]; if (!solid.has(ch) && !seen.has(x + ',' + y)) bad.push(x + ',' + y); }
  if (bad.length) ok(false, 'マップの行き止まり ' + id + ' ' + bad.join(' '));
}
ok(true, 'マップ数 ' + Object.keys(D.MAPS).length);

// 2. タイトル → スタート
step(20); els.startBtn.click(); step(5);
ok(D.cur.id === 'field_hiyoko', 'ゲーム開始');

// 3. すべてのマップを描画・更新してエラーが出ないか
for (const id in D.MAPS) {
  const m = D.MAPS[id];
  let x, y;
  if (m.grid) { const ex = D.findTiles(m, m.kind === 'dungeon' ? 'S' : 'D')[0], c = D.tileCenter(ex.tx, ex.ty - 1); x = c.x; y = c.y; }
  else { const v = D.ISLANDS[m.island].villages[0]; x = v.respawn.x; y = v.respawn.y; }
  D.loadMap(id, x, y); D.state.mode = 'playing'; D.state.fade = null; D.chick.inv = 0.5;
  for (let i = 0; i < 120; i++) { if (i % 20 === 0) { const a = Math.random() * 6.28; D.joy.id = 1; D.joy.x = Math.cos(a) * 0.6; D.joy.y = Math.sin(a) * 0.6; } step(1); if (D.state.mode === 'dialog') dlgDone(); if (D.state.mode === 'shop') els.shopClose.click(); if (D.state.fade) step(80); }
  D.joy.id = null;
}
ok(true, '全マップの描画');

// 4. すべてのダンジョンでボスを倒してダイヤを取る
for (const k in D.DUNGEONS) {
  const m = D.MAPS['dg_' + k], ex = D.findTiles(m, 'S')[0], c = D.tileCenter(ex.tx, ex.ty - 1);
  D.loadMap(m.id, c.x, c.y); D.state.mode = 'playing'; D.state.fade = null;
  const B = D.findTiles(m, 'B')[0], bc = D.tileCenter(B.tx, B.ty); tp(bc.x, bc.y + 70); D.chick.inv = 999; step(20);
  const boss = D.enemies.find(e => e.boss); if (boss) { boss.hp = 1; step(200); }
  const T = D.findTiles(m, 'T')[0], tc = D.tileCenter(T.tx, T.ty); tp(tc.x, tc.y + 60); step(3);
  D.primaryAction(); step(3); dlgDone();
  ok(D.P.dia[k], 'ダイヤ ' + k);
}

// 5. ポータルで島を移動
D.loadMap('field_hiyoko', 2380, 3200); D.state.mode = 'playing'; D.chick.inv = 0; step(2);
tp(2380, 3060); step(130);
ok(D.cur.id === 'field_dragon', 'ドラゴンの島へ移動');

// 6. やられたら村で復活
D.P.hearts = 1; D.chick.inv = 0; D.hurt(D.chick.x + 5, D.chick.y); step(250);
ok(D.state.mode === 'playing', 'やられた後に復活');

// 7. かくし たからばこ：どの たねでも ぜんぶ おけて、たてものや いりぐちに めりこまない
for (const seed of [1, 7, 12345, 987654321]) {
  D.genChests(seed);
  for (const id in D.ISLANDS) {
    const I = D.ISLANDS[id], cs = I.chests, sol = D.MAPS['field_' + id].solids;
    if (cs.length !== I.cols * I.rows * 2) ok(false, 'たからばこの かず ' + id + ' たね' + seed + ': ' + cs.length);
    for (const c of cs) if (sol.some(s => c.x > s.x - 30 && c.x < s.x + s.w + 30 && c.y > s.y - 30 && c.y < s.y + s.h + 30)) ok(false, 'たからばこが かべの なか ' + c.id);
    for (const k of I.treasure.finds) if (!cs.some(c => c.find === k)) ok(false, 'きせかえが ない ' + id + ' ' + k);
  }
}
ok(true, 'たからばこの はいち');
D.genChests(D.P.flags.tseed);

// 8. たからばこを あけると きせかえが てに はいって つけられる
const hc = D.ISLANDS.hiyoko.chests.find(c => c.find === 'ribbon');
D.loadMap('field_hiyoko', hc.x, hc.y + 40); D.state.mode = 'playing'; D.state.fade = null; D.chick.inv = 999; step(3);
D.primaryAction(); step(2); dlgDone();
ok(D.P.gear.ribbon && D.P.flags.head === 'ribbon' && D.P.opened[hc.id], 'たからばこから リボン');
const gc = D.ISLANDS.hiyoko.chests.find(c => !c.find), g0 = D.P.gold;
tp(gc.x, gc.y + 40); step(3); D.primaryAction(); step(2); dlgDone();
ok(D.P.gold === g0 + gc.gold, 'たからばこから ゴールド');

// 9. おみせで ちずと きせかえを かう → ちずと なかまパネルが うごく
D.P.gold = 5000; D.buy('tmap_h'); D.buy('dgold'); D.buy('sunglass');
ok(D.P.gear.tmap_h && D.P.flags.body === 'dgold' && D.P.flags.face === 'sunglass', 'ちずと きせかえを かう');
step(30); D.openMap(); step(5); D.state.mode = 'playing'; step(5);
els.partyBtn.click(); step(1);
const rows = els.partyList.children, rib = rows.find(r => r.children[0] && r.children[0].textContent === '🎀');
ok(rows.some(r => r.className === 'sect') && rib, 'なかまパネルに きせかえ');
rib.children[2].click();
ok(!D.P.flags.head, 'きせかえを はずす');
els.partyList.children.find(r => r.children[0] && r.children[0].textContent === '🎀').children[2].click();
els.partyClose.click(); step(5);

// 10. セーブから つづけても たからばこの ばしょと きせかえが のこる
const before = D.ISLANDS.hiyoko.chests.map(c => c.x + ',' + c.y).join(' ');
els.continueBtn.click(); step(5);
ok(D.ISLANDS.hiyoko.chests.map(c => c.x + ',' + c.y).join(' ') === before && D.P.flags.head === 'ribbon' && D.P.opened[hc.id], 'セーブから つづける');

console.log(fails ? '\n失敗 ' + fails + ' 件' : '\nすべて OK');
process.exitCode = fails ? 1 : 0;
