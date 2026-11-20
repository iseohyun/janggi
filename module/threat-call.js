/**
 * @fileoverview 기물 위협 알림 콜 (threat-call.js)
 * 한 수가 두어질 때마다 그 수로 생긴 위협을 판 위 말풍선("포달라", "포장에 차잡")과 음성으로 알려 준다.
 *
 * - 알릴 것 (여러 개): ① 둔 기물이 노리는 상대 기물  ② 둔 기물을 노리는 상대 기물
 *                      ③ 이 수로 새로 위협하게 된 기물(길이 열린 차·포 등)  ④ 이 수로 새로 위협당하게 된 내 기물
 * - 범위: 위협받는 기물 종류 (차포마 / 대기물 / +사 / 모든 기물). 궁은 범위와 따로 "장군" 말풍선으로만 알린다
 *   (판 위에 따로 장군 표시가 없어서 겹칠 것이 없다).
 * - 몇 수 앞: 1수(바로 잡힘), 2수(장군 → 어떻게 받아도 잡힘), 3수(장군 → 장군 → 잡힘). 말풍선 색으로 구분.
 * - 가짜 위협 거르기: 잡은 뒤 되잡히는 손익(SEE, 기물 교환 계산)이 0 이하이면 위협으로 보지 않는다.
 *   2·3수는 장군 친 기물을 내주는 손해까지 빼고도 이득일 때만 센다.
 *
 * 탐색은 내장 수 생성기(rules.js getCandidateMoves)를 그대로 쓴다. 탐색하는 동안만 pieces[] 칸에 가벼운 복제본을
 * 넣고 whoIsit을 칸 배열 조회로 바꿔 빠르게 돌린 뒤 반드시 되돌린다(동기 실행이라 그리기와 섞이지 않는다).
 * 수를 둔 직후가 아니라 기물 애니메이션이 끝난 뒤 계산하고, 시간 한도(TC_BUDGET_MS)를 넘으면 깊은 탐색을 멈춘다.
 *
 * 설정은 localStorage("threatCallConfig")에 JSON으로 저장하고, 설정 화면은 오른쪽 서랍 AI 영역(#rd-sec-ai)에
 * 이 모듈이 직접 붙인다.
 * @module threat-call
 * @depends state, rules, board, ai, main, preview
 */

const TC_STORAGE_KEY = "threatCallConfig";
const TC_LAYER_ID = "threat-call-layer";
const TC_BUDGET_MS = 220; // 2·3수 탐색 시간 한도
const TC_VALUES = [1000, 13, 13, 7, 7, 5, 5, 3, 3, 3, 3, 2, 2, 2, 2, 2]; // 기물 가치 (점수판 기준, 궁은 매우 큼)
const TC_NAMES = ["궁", "차", "차", "포", "포", "마", "마", "상", "상", "사", "사", "졸", "졸", "졸", "졸", "졸"];
const TC_SCOPE_MAX = { cpm: 6, big: 8, guard: 10, all: 15 }; // 범위별로 알릴 기물 번호(i % 16)의 최댓값
// 말풍선 색 = 말한 쪽(위협한 쪽) 진영색. 초 파랑 · 한 빨강, 깊이(1·2·3수)가 깊을수록 진하게
const TC_SIDE_COLORS = {
  cho: { 1: "#2563eb", 2: "#1d4ed8", 3: "#1e3a8a" },
  han: { 1: "#dc2626", 2: "#b91c1c", 3: "#7f1d1d" }
};
const TC_DEPTH_COLORS = TC_SIDE_COLORS.han; // 예전 이름 (진영을 모를 때)

/** 위협받는 기물 t를 노린 쪽(말한 쪽) 진영 */
function tcSpeakerSide(t) {
  const tIsCho = (t < 16) === iAmCho;
  return tIsCho ? "han" : "cho";
}

const TC_DEFAULTS = {
  kinds: { attack: true, attacked: false, discovered: true, exposed: false },
  scope: "cpm",
  bubble: true,
  voice: false,
  movers: { opp: true, mine: false },
  depth: 1
};

var threatCallConfig = JSON.parse(JSON.stringify(TC_DEFAULTS));
var tcCalls = []; // 지금 판에 띄운 알림 [{t, depth, text, kind}]
var tcToken = 0; // 늦게 끝난 계산 결과를 버리기 위한 번호
var tcInHook = 0; // move → previewPlayMove 처럼 겹쳐 불릴 때 바깥 한 번만 처리

// ===== 설정 =====

function tcLoadConfig() {
  try {
    const raw = localStorage.getItem(TC_STORAGE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    const d = TC_DEFAULTS;
    threatCallConfig = {
      kinds: Object.assign({}, d.kinds, c.kinds || {}),
      scope: TC_SCOPE_MAX[c.scope] ? c.scope : d.scope,
      bubble: c.bubble !== undefined ? !!c.bubble : d.bubble,
      voice: !!c.voice,
      movers: Object.assign({}, d.movers, c.movers || {}),
      depth: [1, 2, 3].includes(Number(c.depth)) ? Number(c.depth) : d.depth
    };
  } catch (e) {
    console.warn("[threat-call] 설정을 읽지 못해 기본값을 씁니다:", e);
  }
}

function tcSaveConfig() {
  try {
    localStorage.setItem(TC_STORAGE_KEY, JSON.stringify(threatCallConfig));
  } catch (e) {
    console.warn("[threat-call] 설정 저장 실패:", e);
  }
}

// ===== 탐색용 가벼운 판 =====

const tcGrid = new Uint8Array(100); // x*10+y → 기물 번호 (32 = 빈 칸)
const tcSim = Array.from({ length: 32 }, () => ({ x: 0, y: 0 }));

function tcFastWho(x, y) {
  if (x < 1 || x > 9 || y < 0 || y > 9) return NO_PIECE;
  return tcGrid[x * 10 + y];
}

function tcLoad(snap) {
  tcGrid.fill(NO_PIECE);
  for (let k = 0; k < 32; k++) {
    tcSim[k].x = snap[k].x;
    tcSim[k].y = snap[k].y;
    if (snap[k].x !== 0) tcGrid[snap[k].x * 10 + snap[k].y] = k;
  }
}

/** 탐색하는 동안만 pieces[]·whoIsit을 복제본으로 바꿔 끼운다. 끝나면 반드시 되돌린다. */
function tcWithSim(fn) {
  const saved = pieces.slice();
  const origWho = window.whoIsit;
  try {
    for (let k = 0; k < 32; k++) pieces[k] = tcSim[k];
    window.whoIsit = tcFastWho;
    return fn();
  } finally {
    for (let k = 0; k < 32; k++) pieces[k] = saved[k];
    window.whoIsit = origWho;
  }
}

const tcSide = i => (i < 16 ? 0 : 1); // 0: 아래쪽 기물(0~15), 1: 위쪽 기물(16~31)
const tcVal = i => TC_VALUES[i % 16];
const tcAlive = i => tcSim[i].x !== 0;

function tcMake(i, x, y) {
  const p = tcSim[i];
  const cap = tcGrid[x * 10 + y];
  const u = { i, fx: p.x, fy: p.y, cap };
  if (cap < NO_PIECE) {
    tcSim[cap].x = 0;
    tcSim[cap].y = 0;
  }
  tcGrid[p.x * 10 + p.y] = NO_PIECE;
  p.x = x;
  p.y = y;
  tcGrid[x * 10 + y] = i;
  return u;
}

function tcUnmake(u) {
  const p = tcSim[u.i];
  tcGrid[p.x * 10 + p.y] = u.cap;
  if (u.cap < NO_PIECE) {
    tcSim[u.cap].x = p.x;
    tcSim[u.cap].y = p.y;
  }
  p.x = u.fx;
  p.y = u.fy;
  tcGrid[u.fx * 10 + u.fy] = u.i;
}

function tcMovesOf(i) {
  return tcAlive(i) ? getCandidateMoves(i) : [];
}

/** side 기물 중 (x, y)로 갈 수 있는 것이 있는지 */
function tcAttacks(side, x, y) {
  const s = side * 16;
  for (let i = s; i < s + 16; i++) {
    if (!tcAlive(i)) continue;
    const ms = getCandidateMoves(i);
    for (let k = 0; k < ms.length; k++) if (ms[k].x === x && ms[k].y === y) return true;
  }
  return false;
}

function tcInCheck(side) {
  const k = tcSim[side * 16];
  if (k.x === 0) return false;
  return tcAttacks(1 - side, k.x, k.y);
}

/** 두고 나서 자기 궁이 장군을 받지 않는지 */
function tcIsLegal(i, x, y) {
  const u = tcMake(i, x, y);
  const ok = !tcInCheck(tcSide(i));
  tcUnmake(u);
  return ok;
}

function tcLegalMoves(side) {
  const out = [];
  const s = side * 16;
  for (let i = s; i < s + 16; i++) {
    const ms = tcMovesOf(i);
    for (let k = 0; k < ms.length; k++) if (tcIsLegal(i, ms[k].x, ms[k].y)) out.push({ i, x: ms[k].x, y: ms[k].y });
  }
  return out;
}

/** 장군이 되는 side의 합법수 */
function tcCheckingMoves(side) {
  const out = [];
  const king = tcSim[(1 - side) * 16];
  if (king.x === 0) return out;
  const s = side * 16;
  for (let i = s; i < s + 16; i++) {
    const ms = tcMovesOf(i);
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      if (m.x === king.x && m.y === king.y) continue; // 궁을 바로 잡는 수는 장군이 아니라 이미 끝난 판
      const u = tcMake(i, m.x, m.y);
      if (!tcInCheck(side) && tcAttacks(side, king.x, king.y)) out.push({ i, x: m.x, y: m.y });
      tcUnmake(u);
    }
  }
  return out;
}

/** (x, y)의 기물을 side가 가장 싼 기물부터 번갈아 잡을 때 side가 얻는 이득 (SEE). 안 잡으면 0 */
function tcSee(x, y, side) {
  const target = tcGrid[x * 10 + y];
  if (target >= NO_PIECE || tcSide(target) === side) return 0;
  let best = -1;
  const s = side * 16;
  for (let i = s; i < s + 16; i++) {
    if (!tcAlive(i) || (best >= 0 && tcVal(i) >= tcVal(best))) continue;
    const ms = getCandidateMoves(i);
    for (let k = 0; k < ms.length; k++) {
      if (ms[k].x === x && ms[k].y === y) {
        if (tcIsLegal(i, x, y)) best = i;
        break;
      }
    }
  }
  if (best < 0) return 0;
  const u = tcMake(best, x, y);
  const g = tcVal(target) - tcSee(x, y, 1 - side);
  tcUnmake(u);
  return Math.max(0, g);
}

/** 기물 a가 (x, y)를 잡을 때의 손익 (되잡힘까지 계산) */
function tcGainBy(a, x, y) {
  const target = tcGrid[x * 10 + y];
  if (!tcIsLegal(a, x, y)) return -Infinity;
  const u = tcMake(a, x, y);
  const g = tcVal(target) - tcSee(x, y, 1 - tcSide(a));
  tcUnmake(u);
  return g;
}

/**
 * side가 지금 바로 잡아 이득을 보는 (공격 기물, 목표) 짝 목록. 궁을 노리는 짝(장군)은 따로 표시한다.
 * @returns {Array<{a:number, t:number, gain:number}>}
 */
function tcThreatPairs(side) {
  const out = [];
  const s = side * 16;
  for (let a = s; a < s + 16; a++) {
    const ms = tcMovesOf(a);
    for (let k = 0; k < ms.length; k++) {
      const t = tcGrid[ms[k].x * 10 + ms[k].y];
      if (t >= NO_PIECE || tcSide(t) === side) continue;
      if (t % 16 === 0) {
        out.push({ a, t, gain: Infinity, check: true });
        continue;
      }
      const gain = tcGainBy(a, ms[k].x, ms[k].y);
      if (gain > 0) out.push({ a, t, gain });
    }
  }
  return out;
}

/** 목표별 가장 큰 이득 Map(t → gain), 궁 제외 */
function tcBestGains(side) {
  const map = new Map();
  for (const p of tcThreatPairs(side)) {
    if (p.check) continue;
    if (!map.has(p.t) || map.get(p.t) < p.gain) map.set(p.t, p.gain);
  }
  return map;
}

/**
 * 장군을 거쳐 잡히는 위협 (2수·3수). side가 장군을 치면 상대가 어떻게 받아도 목표를 이득 보고 잡는다.
 * @param {number} side - 노리는 쪽
 * @param {number} maxDepth - 2 또는 3
 * @param {Set<number>} skip - 이미 더 얕은 수로 위협인 목표
 * @param {Function} inScope - 목표 기물이 알릴 범위인지
 * @param {number} deadline - performance.now() 한도
 * @returns {Map<number, {depth:number, checkers:number[]}>}
 */
function tcForcedThreats(side, maxDepth, skip, inScope, deadline) {
  const found = new Map();
  const opp = 1 - side;
  const candidates = () => {
    const out = [];
    for (let t = opp * 16 + 1; t < opp * 16 + 16; t++) if (tcAlive(t) && inScope(t) && !skip.has(t) && !found.has(t)) out.push(t);
    return out;
  };
  const lostBy = u => (u.cap < NO_PIECE ? tcVal(u.cap) : 0);

  // 2수: 장군 c → 모든 응수 r 뒤에 목표 t를 이득 보고 잡음 (장군 기물 등을 내준 손해를 뺌)
  const checks = tcCheckingMoves(side);
  for (const c of checks) {
    if (performance.now() > deadline) return found;
    let cands = candidates();
    if (!cands.length) break;
    const uc = tcMake(c.i, c.x, c.y);
    const replies = tcLegalMoves(opp);
    if (replies.length) {
      for (const r of replies) {
        const ur = tcMake(r.i, r.x, r.y);
        const gains = tcBestGains(side);
        const lost = lostBy(ur); // 응수로 내준 기물(장군 친 기물 등)의 손해. 장군 수가 잡은 것은 보수적으로 세지 않는다
        cands = cands.filter(t => tcAlive(t) && (gains.get(t) || 0) - lost > 0);
        tcUnmake(ur);
        if (!cands.length) break;
      }
      for (const t of cands) found.set(t, { depth: 2, checkers: [c.i] });
    }
    tcUnmake(uc);
  }
  if (maxDepth < 3) return found;

  // 3수: 장군 c1 → 모든 응수 r1 뒤에 다시 장군 c2가 있어, 그 뒤 모든 응수 r2에도 목표를 잡음
  for (const c1 of checks) {
    if (performance.now() > deadline) return found;
    let cands = candidates();
    if (!cands.length) break;
    const u1 = tcMake(c1.i, c1.x, c1.y);
    const replies1 = tcLegalMoves(opp);
    let secondChecker = null;
    if (replies1.length) {
      for (const r1 of replies1) {
        if (performance.now() > deadline) { cands = []; break; }
        const ur1 = tcMake(r1.i, r1.x, r1.y);
        const lost1 = lostBy(ur1);
        const reach = new Set(); // 이 응수 뒤에 두 번째 장군으로 잡을 수 있는 목표
        for (const c2 of tcCheckingMoves(side)) {
          const u2 = tcMake(c2.i, c2.x, c2.y);
          const replies2 = tcLegalMoves(opp);
          if (replies2.length) {
            let ok = cands.filter(t => tcAlive(t) && !reach.has(t));
            for (const r2 of replies2) {
              const ur2 = tcMake(r2.i, r2.x, r2.y);
              const gains = tcBestGains(side);
              const lost = lost1 + lostBy(ur2);
              ok = ok.filter(t => tcAlive(t) && (gains.get(t) || 0) - lost > 0);
              tcUnmake(ur2);
              if (!ok.length) break;
            }
            ok.forEach(t => reach.add(t));
            if (ok.length && secondChecker === null) secondChecker = c2.i;
          }
          tcUnmake(u2);
        }
        tcUnmake(ur1);
        cands = cands.filter(t => reach.has(t));
        if (!cands.length) break;
      }
      for (const t of cands) found.set(t, { depth: 3, checkers: [c1.i, secondChecker === null ? c1.i : secondChecker] });
    }
    tcUnmake(u1);
  }
  return found;
}

// ===== 알림 만들기 =====

/** 기물 이름 (한나라 졸은 '병') */
function tcName(i) {
  const n = TC_NAMES[i % 16];
  if (n !== "졸") return n;
  const isCho = (i < 16) === iAmCho;
  return isCho ? "졸" : "병";
}

function tcText(t, info) {
  if (info.check) return "장군";
  if (info.depth === 1) return `${tcName(t)}달라`;
  if (info.depth === 2) return `${tcName(info.checkers[0])}장에 ${tcName(t)}잡`;
  return `${tcName(info.checkers[0])}장 ${tcName(info.checkers[1])}장에 ${tcName(t)}잡`;
}

/** 내 쪽(0: 아래, 1: 위). AI 대국이면 AI가 아닌 쪽, 아니면 아래쪽 */
function tcMySide() {
  if (aiMode === 1 && typeof aiPlaysSide === "function") {
    const aiBottom = (aiPlaysSide() === "cho") === iAmCho;
    return aiBottom ? 1 : 0;
  }
  return 0;
}

/**
 * 수 하나(before → after)로 생긴 위협을 계산합니다.
 * @param {Array<{x,y}>} before - 두기 전 32개 기물 좌표
 * @param {Array<{x,y}>} after - 둔 뒤 32개 기물 좌표
 * @param {number} m - 움직인 기물 번호
 * @param {Object} [cfg] - 설정 (기본: threatCallConfig)
 * @returns {Array<{t:number, depth:number, text:string, kind:string}>}
 */
function threatCallAnalyze(before, after, m, cfg) {
  const c = cfg || threatCallConfig;
  const S = tcSide(m);
  const O = 1 - S;
  const maxIdx = TC_SCOPE_MAX[c.scope] || 6;
  const inScope = t => t % 16 !== 0 && t % 16 <= maxIdx;
  const deadline = performance.now() + TC_BUDGET_MS;
  const calls = new Map(); // t → call (얕은 수가 우선)
  const add = (t, info, kind) => {
    const prev = calls.get(t);
    const depth = info.check ? 1 : info.depth;
    if (prev && prev.depth <= depth) return;
    calls.set(t, { t, depth, text: tcText(t, Object.assign({ depth }, info)), kind });
  };

  return tcWithSim(() => {
    // 둔 뒤 국면
    tcLoad(after);
    const pairsS = tcThreatPairs(S); // 둔 쪽이 (한 번 더 둔다면) 잡을 수 있는 것
    const gainsO = tcBestGains(O); // 상대가 지금 잡을 수 있는 것
    const deepS = c.depth >= 2 && (c.kinds.attack || c.kinds.discovered) ? tcForcedThreats(S, c.depth, new Set(pairsS.map(p => p.t)), inScope, deadline) : new Map();
    const deepO = c.depth >= 2 && (c.kinds.attacked || c.kinds.exposed) ? tcForcedThreats(O, c.depth, new Set(gainsO.keys()), inScope, deadline) : new Map();

    // 두기 전 국면 (③·④ "새로 생긴" 판단용)
    tcLoad(before);
    const beforePairsS = c.kinds.discovered ? new Set(tcThreatPairs(S).map(p => `${p.a}:${p.t}`)) : new Set();
    const beforeGainsO = c.kinds.exposed ? tcBestGains(O) : new Map();
    let beforeDeepS = new Map();
    let beforeDeepO = new Map();
    if (c.kinds.discovered && deepS.size) beforeDeepS = tcForcedThreats(S, c.depth, new Set(), t => deepS.has(t), deadline);
    if (c.kinds.exposed && deepO.size) beforeDeepO = tcForcedThreats(O, c.depth, new Set(), t => deepO.has(t) && t !== m, deadline);

    // ① 둔 기물이 노리는 상대 기물 / ③ 새로 노리게 된 기물 (궁이면 "장군")
    for (const p of pairsS) {
      if (p.check) {
        if (p.a === m ? c.kinds.attack : (c.kinds.discovered && !beforePairsS.has(`${p.a}:${p.t}`))) add(p.t, { check: true }, p.a === m ? "attack" : "discovered");
        continue;
      }
      if (!inScope(p.t)) continue;
      if (p.a === m && c.kinds.attack) add(p.t, { depth: 1 }, "attack");
      else if (p.a !== m && c.kinds.discovered && !beforePairsS.has(`${p.a}:${p.t}`)) add(p.t, { depth: 1 }, "discovered");
    }
    for (const [t, info] of deepS) {
      const byMover = info.checkers.includes(m);
      if (byMover && c.kinds.attack) add(t, info, "attack");
      else if (c.kinds.discovered && !beforeDeepS.has(t)) add(t, info, "discovered");
    }
    // ② 둔 기물을 노리는 상대 기물 / ④ 새로 위협받게 된 내 기물
    for (const [t] of gainsO) {
      if (t === m) {
        if (c.kinds.attacked && inScope(t)) add(t, { depth: 1 }, "attacked");
      } else if (inScope(t) && c.kinds.exposed && !beforeGainsO.has(t)) {
        add(t, { depth: 1 }, "exposed");
      }
    }
    for (const [t, info] of deepO) {
      if (t === m) {
        if (c.kinds.attacked && inScope(t)) add(t, info, "attacked");
      } else if (inScope(t) && c.kinds.exposed && !beforeDeepO.has(t)) {
        add(t, info, "exposed");
      }
    }
    return [...calls.values()].sort((a, b) => a.depth - b.depth || tcVal(b.t) - tcVal(a.t));
  });
}

// ===== 그리기 =====

function tcClear() {
  tcToken++;
  tcCalls = [];
  const layer = document.getElementById(TC_LAYER_ID);
  if (layer) layer.remove();
}

function tcDraw() {
  const old = document.getElementById(TC_LAYER_ID);
  if (old) old.remove();
  if (!threatCallConfig.bubble || !tcCalls.length || typeof svg === "undefined" || !svg) return;
  const ns = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(ns, "g");
  layer.id = TC_LAYER_ID;
  layer.setAttribute("pointer-events", "none");
  const fs = Math.max(10, unitSize * 0.25);
  const h = fs * 1.5;
  const maxX = typeof boardWidth === "number" ? boardWidth : Infinity;
  for (const call of tcCalls) {
    const p = pieces[call.t];
    if (!p || (p.x === 0 && p.y === 0)) continue;
    const c = getAxis(p.x, p.y);
    const w = fs * (call.text.length * 1.02) + fs * 0.9;
    let cx = Math.min(Math.max(c.x, w / 2 + 2), maxX - w / 2 - 2);
    let top = c.y - unitSize * 0.48 - h - fs * 0.35;
    let below = false;
    if (top < 2) {
      top = c.y + unitSize * 0.48 + fs * 0.35;
      below = true;
    }
    const side = tcSpeakerSide(call.t);
    const palette = TC_SIDE_COLORS[side];
    const color = palette[call.depth] || palette[1];
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", `tc-bubble tc-depth-${call.depth} tc-kind-${call.kind} tc-side-${side}`);
    g.setAttribute("data-target", String(call.t));
    const tailY = below ? top : top + h;
    const tipY = below ? top - fs * 0.35 : top + h + fs * 0.35;
    const tail = document.createElementNS(ns, "path");
    tail.setAttribute("d", `M ${c.x - fs * 0.3} ${tailY} L ${c.x} ${tipY} L ${c.x + fs * 0.3} ${tailY} Z`);
    tail.setAttribute("fill", color);
    g.appendChild(tail);
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", cx - w / 2);
    rect.setAttribute("y", top);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", h / 2);
    rect.setAttribute("fill", color);
    rect.setAttribute("class", "tc-bubble-box");
    g.appendChild(rect);
    const text = document.createElementNS(ns, "text");
    text.setAttribute("x", cx);
    text.setAttribute("y", top + h / 2);
    text.setAttribute("font-size", fs);
    text.setAttribute("class", "tc-bubble-text");
    text.textContent = call.text;
    g.appendChild(text);
    layer.appendChild(g);
  }
  svg.appendChild(layer);
}

function tcSpeak(calls) {
  if (!threatCallConfig.voice || !calls.length || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(calls.slice(0, 3).map(c => c.text).join(", "));
    u.lang = "ko-KR";
    const voice = synth.getVoices().find(v => /^ko/i.test(v.lang));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    synth.speak(u);
  } catch (e) {
    console.warn("[threat-call] 음성 알림 실패:", e);
  }
}

// ===== 수 감지 =====

function tcSnapshot() {
  return pieces.map(p => ({ x: p.x, y: p.y }));
}

/**
 * 둔 수 하나를 처리합니다. 애니메이션이 끝난 뒤 계산·표시합니다.
 * @param {Array} before - 두기 전 좌표
 * @param {number} i @param {number} x @param {number} y - 둔 수
 * @param {boolean} byAI - AI가 둔 수인지
 */
function tcOnMove(before, i, x, y, byAI) {
  const after = tcSnapshot();
  if (after[i].x !== x || after[i].y !== y || (before[i].x === x && before[i].y === y)) return; // 실제로 두어지지 않음
  tcClear();
  const mine = !byAI && tcSide(i) === tcMySide();
  const cfg = threatCallConfig;
  if (mine ? !cfg.movers.mine : !cfg.movers.opp) return;
  if (!cfg.bubble && !cfg.voice) return;
  const token = tcToken;
  const delay = Math.max(0, (typeof animDuration === "number" ? animDuration : 0) * 1000) + 40;
  setTimeout(() => {
    if (token !== tcToken) return;
    // 그사이 판이 바뀌었으면 버린다
    const now = tcSnapshot();
    for (let k = 0; k < 32; k++) if (now[k].x !== after[k].x || now[k].y !== after[k].y) return;
    let calls = [];
    try {
      calls = threatCallAnalyze(before, after, i);
    } catch (e) {
      console.error("[threat-call] 위협 계산 실패:", e);
      return;
    }
    if (token !== tcToken) return;
    tcCalls = calls;
    tcDraw();
    tcSpeak(calls);
  }, delay);
}

function tcWrap(name, makeWrapper) {
  const orig = window[name];
  if (typeof orig !== "function") {
    console.warn(`[threat-call] 감쌀 함수가 없습니다: ${name}`);
    return;
  }
  window[name] = makeWrapper(orig);
}

// ===== 설정 화면 (오른쪽 서랍 AI 영역) =====

function tcBuildSettings() {
  const host = document.getElementById("rd-sec-ai");
  if (!host || document.getElementById("threat-call-settings")) return;
  const c = threatCallConfig;
  const chk = (key, label, checked, title) =>
    `<label class="tc-opt" title="${title || ""}"><input type="checkbox" data-tc="${key}" ${checked ? "checked" : ""}> ${label}</label>`;
  const box = document.createElement("details");
  box.id = "threat-call-settings";
  box.className = "tc-settings";
  box.innerHTML = `
    <summary>위협 알림</summary>
    <div class="tc-settings-body">
      <div class="tc-group"><div class="tc-group-title">무엇을 알릴지</div>
        ${chk("kinds.attack", "① 둔 기물이 노리는 상대 기물", c.kinds.attack)}
        ${chk("kinds.attacked", "② 둔 기물을 노리는 상대 기물", c.kinds.attacked)}
        ${chk("kinds.discovered", "③ 이 수로 새로 노리게 된 기물 (길이 열린 차·포 등)", c.kinds.discovered)}
        ${chk("kinds.exposed", "④ 이 수로 새로 위협받게 된 기물", c.kinds.exposed)}
      </div>
      <label class="tc-row"><span>알릴 기물 범위</span>
        <select data-tc="scope">
          <option value="cpm">차·포·마</option>
          <option value="big">대기물 (차·포·마·상)</option>
          <option value="guard">대기물 + 사</option>
          <option value="all">모든 기물 (졸·병 포함)</option>
        </select>
      </label>
      <label class="tc-row"><span>몇 수 앞까지</span>
        <select data-tc="depth">
          <option value="1">1수 (바로 잡힘)</option>
          <option value="2">2수 (장군 거쳐 잡힘)</option>
          <option value="3">3수 (장군 두 번 거쳐 잡힘)</option>
        </select>
      </label>
      <div class="tc-group"><div class="tc-group-title">알림 형태</div>
        ${chk("bubble", "말풍선", c.bubble)}
        ${chk("voice", "음성 (브라우저 음성 합성)", c.voice)}
      </div>
      <div class="tc-group"><div class="tc-group-title">누가 둔 수에</div>
        ${chk("movers.opp", "상대 수 (상대·AI)", c.movers.opp)}
        ${chk("movers.mine", "내 수", c.movers.mine)}
      </div>
      <div class="tc-legend" aria-label="말풍선 색">
        <span class="tc-chip tc-side-cho">초가 알림</span><span class="tc-chip tc-side-han">한이 알림</span>
        <span class="tc-legend-note">말풍선 색은 노린 쪽 진영색이고, 2수·3수 위협일수록 진합니다.</span>
        <span class="tc-legend-note">잡아도 되잡혀 손해면 알리지 않습니다. 궁은 "장군"으로 알립니다.</span>
      </div>
    </div>`;
  const anchor = host.querySelector(".ai-mate-alert");
  if (anchor && anchor.parentNode === host) anchor.insertAdjacentElement("afterend", box);
  else host.appendChild(box);
  box.querySelector('[data-tc="scope"]').value = c.scope;
  box.querySelector('[data-tc="depth"]').value = String(c.depth);
  box.addEventListener("change", e => {
    const el = e.target.closest("[data-tc]");
    if (!el) return;
    const key = el.getAttribute("data-tc");
    const val = el.type === "checkbox" ? el.checked : el.value;
    const parts = key.split(".");
    if (parts.length === 2) threatCallConfig[parts[0]][parts[1]] = val;
    else threatCallConfig[key] = key === "depth" ? Number(val) : val;
    tcSaveConfig();
    if (key === "bubble") tcDraw();
    if (key === "voice" && !val && "speechSynthesis" in window) window.speechSynthesis.cancel();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  tcLoadConfig();
  tcBuildSettings();

  // preview.js가 감싼 move보다 바깥에서 감싼다 (이 파일이 preview.js 뒤에 실린다)
  tcWrap("move", orig => function (i, x, y) {
    if (tcInHook) return orig.apply(this, arguments);
    const before = tcSnapshot();
    const byAI = typeof aiThinking !== "undefined" && aiThinking === true;
    tcInHook++;
    let r;
    try {
      r = orig.apply(this, arguments);
    } finally {
      tcInHook--;
    }
    tcOnMove(before, i, x, y, byAI);
    return r;
  });
  // 두어보기에서 둔 수 (AI 수 포함). 가지 국면 기준이며 본선 기보는 건드리지 않는다.
  tcWrap("previewPlayMove", orig => function (i, x, y, source) {
    if (tcInHook) return orig.apply(this, arguments);
    const before = tcSnapshot();
    tcInHook++;
    let r;
    try {
      r = orig.apply(this, arguments);
    } finally {
      tcInHook--;
    }
    tcOnMove(before, i, x, y, source === "ai");
    return r;
  });
  // 수순 이동·새 대국·뒤집기 → 지난 알림 지우기
  ["next", "prev", "performSinglePrev", "goToStart", "goToEnd", "startNewGame", "importRecordFromText",
    "previewRender", "exitPreviewMode", "flipBoardHorizontal", "flipBoardVertical", "toggleNation"].forEach(name => {
    if (typeof window[name] !== "function") return;
    tcWrap(name, orig => function () {
      if (!tcInHook) tcClear();
      return orig.apply(this, arguments);
    });
  });
  // 판 크기가 바뀌어 기물이 다시 놓이면 말풍선도 다시 그린다
  tcWrap("initPositions", orig => function () {
    tcInHook++; // 두어보기 국면을 다시 얹는 previewRender가 알림을 지우지 않게
    let r;
    try {
      r = orig.apply(this, arguments);
    } finally {
      tcInHook--;
    }
    if (tcCalls.length) tcDraw();
    return r;
  });
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.addEventListener("change", () => tcClear());
  if ("speechSynthesis" in window) window.speechSynthesis.getVoices(); // 목소리 목록 미리 불러오기
});
