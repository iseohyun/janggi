/**
 * @fileoverview Fairy-Stockfish(장기 변형) 연결 모듈. (프로토타입)
 * - 엔진(vendor/fairy-stockfish, GPL-3.0)은 고치지 않고, Web Worker로 띄운 엔진과 UCI 텍스트로만 주고받는다.
 * - 여러 스레드 WASM이라 페이지가 교차 출처 격리(crossOriginIsolated) 상태일 때만 쓸 수 있다.
 *   못 쓰는 환경이면 내장 엔진(ai.js getBestAIMove)으로 돌아간다.
 *
 * 좌표 변환
 *  - 웹장기: x 1~9(왼→오), y 1~9와 0(위→아래, 0이 맨 아래 10번째 줄). 화면 아래쪽이 초가 아닐 수도 있다.
 *  - 엔진: 파일 a~i, 랭크 1~10, 백(대문자)=초가 랭크 1 쪽, 흑(소문자)=한. 첫 수는 백(초).
 *  - 초가 화면 위쪽에 있으면 판을 180도 돌려서 넘기고, 받은 수도 다시 돌린다.
 *
 * 공개 API
 *   aiEnginePref(), setAIEnginePref(v), aiThinkMs(), setAIThinkMs(v)
 *   fsfStatus() → {state:"idle"|"loading"|"ready"|"unavailable", detail}
 *   fsfLoad() → Promise<boolean>
 *   fsfBestMove(team, {movetime}) → Promise<{i,x,y,score,mate,depth,pv}|null>
 *   fsfAnalyze(team, {multipv, movetime}) → Promise<[{rank,i,x,y,score,mate,depth,winRate,pv:[{i,x,y}]}]|null>  ← 추천수(recommend.js)
 *   fsfWinRate(scoreCp, mate) → 초의 어림 승률
 *   requestAIMove(team) → Promise<{i,x,y,score?, engine}|null>   ← AI 대국·훈수·두어보기가 쓰는 입구
 * @module engine-fsf
 * @depends state, rules, ai, commentary-facts(cfTeamOf, cfSideToMove)
 */

const FSF_BASE = "vendor/fairy-stockfish/";
const FSF_PIECE_LETTERS = ["k", "r", "r", "c", "c", "n", "n", "b", "b", "a", "a", "p", "p", "p", "p", "p"];
const FSF_THINK_CHOICES = [300, 1000, 3000];

let fsfModule = null; // Emscripten 엔진 인스턴스
let fsfLoading = null; // 불러오는 중인 Promise
let fsfState = { state: "idle", detail: "아직 불러오지 않았습니다." };
let fsfQueue = Promise.resolve(); // 한 번에 하나씩 묻기
let fsfListener = null; // 지금 질문의 줄 받기
let fsfCurrentKind = null; // 지금 엔진이 하는 일: "setup" | "move" | "analysis"
let fsfWaiting = 0; // 줄 서 있는 질문 수

// ===== 설정 =====

/** @returns {"fsf"|"builtin"} */
function aiEnginePref() {
  return localStorage.getItem("aiEngine") === "builtin" ? "builtin" : "fsf";
}

function setAIEnginePref(value) {
  localStorage.setItem("aiEngine", value === "builtin" ? "builtin" : "fsf");
  fsfSyncSettingsUI();
  if (value !== "builtin") fsfLoad();
}

function aiThinkMs() {
  const v = parseInt(localStorage.getItem("aiThinkMs"), 10);
  return FSF_THINK_CHOICES.includes(v) ? v : 1000;
}

function setAIThinkMs(value) {
  const v = parseInt(value, 10);
  if (FSF_THINK_CHOICES.includes(v)) localStorage.setItem("aiThinkMs", String(v));
  fsfSyncSettingsUI();
}

function fsfStatus() {
  return fsfState;
}

function fsfSetState(state, detail) {
  fsfState = { state, detail };
  fsfSyncSettingsUI();
}

/** 설정 패널의 엔진 고르기·생각 시간·상태 글자를 맞춥니다. */
function fsfSyncSettingsUI() {
  const sel = document.getElementById("ai-engine-select");
  if (sel) sel.value = aiEnginePref();
  const think = document.getElementById("ai-think-select");
  if (think) {
    think.value = String(aiThinkMs());
    think.disabled = aiEnginePref() !== "fsf";
  }
  const st = document.getElementById("ai-engine-status");
  if (st) {
    st.textContent = aiEnginePref() === "fsf" ? fsfState.detail : "내장 엔진: 2수 읽기 (빠르지만 약함)";
    st.dataset.state = aiEnginePref() === "fsf" ? fsfState.state : "ready";
  }
}

// ===== 불러오기 =====

function fsfLoadScript(src) {
  return new Promise((resolve, reject) => {
    if (typeof Stockfish === "function") return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`${src}를 불러오지 못했습니다.`));
    document.head.appendChild(s);
  });
}

/** 엔진을 한 번만 불러옵니다. 못 쓰는 환경이면 false. */
function fsfLoad() {
  if (fsfModule) return Promise.resolve(true);
  if (fsfLoading) return fsfLoading;
  if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
    fsfSetState("unavailable", "이 페이지는 교차 출처 격리가 아니라 Fairy-Stockfish를 쓸 수 없습니다. 내장 엔진으로 둡니다.");
    return Promise.resolve(false);
  }
  fsfSetState("loading", "Fairy-Stockfish를 불러오는 중… (처음 한 번 약 1.7MB)");
  const base = new URL(FSF_BASE, location.href).href;
  fsfLoading = fsfLoadScript(`${base}stockfish.js`)
    .then(() => Stockfish({
      locateFile: file => base + file,
      mainScriptUrlOrBlob: `${base}stockfish.js`
    }))
    .then(sf => {
      fsfModule = sf;
      sf.addMessageListener(line => {
        if (fsfListener) fsfListener(line);
      });
      return fsfAsk(["uci", "setoption name UCI_Variant value janggi", "isready"], line => line === "readyok");
    })
    .then(() => {
      fsfSetState("ready", "Fairy-Stockfish 준비됨 (GPL-3.0)");
      return true;
    })
    .catch(err => {
      console.error("[engine-fsf] 불러오기 실패:", err);
      fsfModule = null;
      fsfSetState("unavailable", `Fairy-Stockfish를 불러오지 못했습니다: ${err.message || err}`);
      return false;
    })
    .finally(() => {
      fsfLoading = null;
    });
  return fsfLoading;
}

/**
 * 명령들을 보내고 isDone(line)이 참인 줄이 올 때까지 받은 줄을 모읍니다. 질문은 차례로 처리합니다.
 * @param {string[]} commands
 * @param {(line: string) => boolean} isDone
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<string[]>}
 */
function fsfAsk(commands, isDone, timeoutMs, kind) {
  const myKind = kind || "setup";
  // 추천수 분석은 언제든 양보한다: 뒤에 다른 질문이 오면 지금 분석을 멈추게 한다
  if (fsfCurrentKind === "analysis" && fsfModule) fsfModule.postMessage("stop");
  fsfWaiting += 1;
  const job = fsfQueue.then(() => new Promise((resolve, reject) => {
    fsfWaiting -= 1;
    fsfCurrentKind = myKind;
    const lines = [];
    const finish = () => {
      clearTimeout(timer);
      fsfListener = null;
      fsfCurrentKind = null;
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("엔진 응답 시간 초과"));
    }, timeoutMs || 20000);
    fsfListener = line => {
      lines.push(line);
      if (isDone(line)) {
        finish();
        resolve(lines);
      }
    };
    commands.forEach(c => fsfModule.postMessage(c));
    // 줄 선 질문이 이미 있으면 분석은 바로 멈춘다
    if (myKind === "analysis" && fsfWaiting > 0) fsfModule.postMessage("stop");
  }));
  fsfQueue = job.catch(() => {});
  return job;
}

// ===== 좌표·FEN =====

/** 초가 화면 위쪽에 있으면 true (엔진에 넘길 때 판을 180도 돌린다) */
function fsfChoOnTop() {
  const choKing = iAmCho ? 0 : 16;
  const rowIndex = (pieces[choKing].y + 9) % 10; // 0=맨 위, 9=맨 아래
  return rowIndex <= 2;
}

/** 엔진 칸(파일 0~8, 랭크 1~10) → 웹장기 (x, y) */
function fsfToBoard(file, rank, flip) {
  let x = file + 1;
  let row = 10 - rank; // 0=맨 위
  if (flip) {
    x = 10 - x;
    row = 9 - row;
  }
  return { x, y: row === 9 ? 0 : row + 1 };
}

/** 지금 pieces 국면의 FEN. step은 둘 차례(짝수=초)를 정하는 수순. */
function fsfFen(step) {
  const flip = fsfChoOnTop();
  const ranks = [];
  for (let rank = 10; rank >= 1; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 9; file++) {
      const { x, y } = fsfToBoard(file, rank, flip);
      const i = whoIsit(x, y);
      if (i >= NO_PIECE) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      const letter = FSF_PIECE_LETTERS[i % 16];
      row += cfTeamOf(i) === "cho" ? letter.toUpperCase() : letter;
    }
    if (empty) row += empty;
    ranks.push(row);
  }
  const side = cfSideToMove(step) === "cho" ? "w" : "b";
  return `${ranks.join("/")} ${side} - - 0 1`;
}

/** 웹장기 수 {i,x,y} → UCI 문자열 */
function fsfMoveToUci(m) {
  const flip = fsfChoOnTop();
  const sq = (x, y) => {
    let fx = x;
    let row = (y + 9) % 10;
    if (flip) {
      fx = 10 - fx;
      row = 9 - row;
    }
    return String.fromCharCode(96 + fx) + (10 - row);
  };
  return sq(pieces[m.i].x, pieces[m.i].y) + sq(m.x, m.y);
}

/** UCI 문자열 → 웹장기 수 {i,x,y} (한수쉼 같은 같은 칸 수면 null) */
function fsfUciToMove(uci) {
  const mm = /^([a-i])(\d{1,2})([a-i])(\d{1,2})/.exec(uci || "");
  if (!mm) return null;
  const flip = fsfChoOnTop();
  const from = fsfToBoard(mm[1].charCodeAt(0) - 97, parseInt(mm[2], 10), flip);
  const to = fsfToBoard(mm[3].charCodeAt(0) - 97, parseInt(mm[4], 10), flip);
  if (from.x === to.x && from.y === to.y) return null;
  const i = whoIsit(from.x, from.y);
  return i < NO_PIECE ? { i, x: to.x, y: to.y } : null;
}

// ===== 수 고르기 =====

/**
 * 지금 pieces 국면에서 team이 둘 수를 엔진에 묻습니다.
 * 한수쉼은 웹장기 규칙에 없으므로, 웹장기가 만든 합법수만 searchmoves로 넘깁니다.
 * @param {"cho"|"han"} team
 * @param {{movetime?: number}} [opts]
 */
async function fsfBestMove(team, opts) {
  if (!(await fsfLoad())) return null;
  const legal = getFilteredLegalMoves(team);
  if (!legal.length) return null;
  const step = team === "cho" ? 0 : 1;
  const fen = fsfFen(step);
  const searchmoves = legal.map(fsfMoveToUci).join(" ");
  const movetime = (opts && opts.movetime) || aiThinkMs();
  const lines = await fsfAsk(
    ["setoption name MultiPV value 1", `position fen ${fen}`, `go movetime ${movetime} searchmoves ${searchmoves}`],
    line => line.startsWith("bestmove"),
    movetime + 15000,
    "move"
  );
  const best = lines[lines.length - 1].split(/\s+/)[1];
  const move = fsfUciToMove(best);
  if (!move || !legal.some(m => m.i === move.i && m.x === move.x && m.y === move.y)) {
    console.warn("[engine-fsf] 엔진 수를 웹장기 합법수로 바꾸지 못했습니다:", best, fen);
    return null;
  }
  const info = lines.filter(l => l.startsWith("info depth") && / pv /.test(l)).pop() || "";
  const cp = /score cp (-?\d+)/.exec(info);
  const mate = /score mate (-?\d+)/.exec(info);
  const depth = /depth (\d+)/.exec(info);
  const sign = team === "cho" ? 1 : -1; // 엔진 점수는 둘 차례 기준 → 초 기준(+)으로
  return {
    ...move,
    score: cp ? sign * parseInt(cp[1], 10) : null,
    mate: mate ? sign * parseInt(mate[1], 10) : null,
    depth: depth ? parseInt(depth[1], 10) : null,
    pv: (/ pv (.*)$/.exec(info) || [])[1] || ""
  };
}

/**
 * UCI 수순(문자열 배열)을 지금 국면부터 차례로 웹장기 수로 바꿉니다. pieces는 원래대로 돌려 놓습니다.
 * 바꿀 수 없는 수(한수쉼 등)를 만나면 거기서 멈춥니다.
 * @param {string[]} ucis
 * @returns {Array<{i:number,x:number,y:number}>}
 */
function fsfPvToMoves(ucis) {
  const snap = cfSnapshot();
  const out = [];
  try {
    for (const u of ucis) {
      const m = fsfUciToMove(u);
      if (!m) break;
      out.push(m);
      cfDoMove(m);
    }
  } finally {
    cfRestore(snap);
  }
  return out;
}

/** 형세 점수(cp, 초 기준) → 초의 어림 승률(0~1). 장기용으로 맞춘 값이 아니라 유불리를 읽기 쉽게 바꾼 값이다. */
function fsfWinRate(scoreCp, mate) {
  if (mate !== null && mate !== undefined) return mate > 0 ? 1 : 0;
  if (scoreCp === null || scoreCp === undefined) return 0.5;
  return 1 / (1 + Math.exp(-scoreCp / 400));
}

/**
 * 지금 pieces 국면에서 team의 좋은 수 여러 개를 분석합니다 (MultiPV).
 * 다른 질문(AI 착수 등)이 오면 분석을 멈추고 그때까지의 결과를 돌려줍니다.
 * @param {"cho"|"han"} team
 * @param {{multipv?: number, movetime?: number, position?: Array<{x:number,y:number}>, kind?: "analysis"|"facts"}} [opts]
 *   position: 물을 국면(cfSnapshot 꼴, 없으면 지금 pieces) / kind: "facts"면 다른 질문이 와도 멈추지 않는다
 * @returns {Promise<Array<{rank:number,i:number,x:number,y:number,score:number|null,mate:number|null,depth:number,winRate:number,pv:Array<{i:number,x:number,y:number}>}>|null>}
 */
async function fsfAnalyze(team, opts) {
  if (!(await fsfLoad())) return null;
  // 물을 국면: opts.position(cfSnapshot 꼴)이 있으면 그 국면, 없으면 지금 pieces
  const current = cfSnapshot();
  let legal;
  let fen;
  let searchmoves;
  let askedSnap; // 답을 받는 사이 판이 바뀌어도 물은 국면 기준으로 수를 바꾼다
  try {
    if (opts && opts.position) cfRestore(opts.position);
    legal = getFilteredLegalMoves(team);
    fen = fsfFen(team === "cho" ? 0 : 1);
    searchmoves = legal.map(fsfMoveToUci).join(" ");
    askedSnap = cfSnapshot();
  } finally {
    cfRestore(current);
  }
  if (!legal.length) return [];
  const multipv = Math.min((opts && opts.multipv) || 3, legal.length);
  const movetime = (opts && opts.movetime) || aiThinkMs();
  const lines = await fsfAsk(
    [`setoption name MultiPV value ${multipv}`, `position fen ${fen}`, `go movetime ${movetime} searchmoves ${searchmoves}`],
    line => line.startsWith("bestmove"),
    movetime + 15000,
    (opts && opts.kind) || "analysis" // "analysis"는 다른 질문에 양보, "facts"(해설)는 끝까지
  );
  const sign = team === "cho" ? 1 : -1;
  const byRank = new Map(); // multipv 번호 → 가장 깊은 정보
  lines.forEach(line => {
    if (!line.startsWith("info depth") || !/ pv /.test(line)) return;
    const k = parseInt((/ multipv (\d+)/.exec(line) || [0, 1])[1], 10);
    byRank.set(k, line);
  });
  const result = [];
  const nowSnap = cfSnapshot();
  cfRestore(askedSnap);
  try {
    [...byRank.keys()].sort((a, b) => a - b).forEach(k => {
      const line = byRank.get(k);
      const cp = /score cp (-?\d+)/.exec(line);
      const mate = /score mate (-?\d+)/.exec(line);
      const pv = fsfPvToMoves(((/ pv (.*)$/.exec(line) || [])[1] || "").trim().split(/\s+/));
      if (!pv.length) return;
      const score = cp ? sign * parseInt(cp[1], 10) : null;
      const mateIn = mate ? sign * parseInt(mate[1], 10) : null;
      result.push({
        rank: k,
        ...pv[0],
        score,
        mate: mateIn,
        depth: parseInt((/depth (\d+)/.exec(line) || [0, 0])[1], 10),
        winRate: fsfWinRate(score, mateIn),
        pv
      });
    });
  } finally {
    cfRestore(nowSnap);
  }
  return result;
}

/**
 * AI가 둘 수 하나를 고릅니다. Fairy-Stockfish를 고르고 쓸 수 있으면 그것을, 아니면 내장 엔진을 씁니다.
 * 엔진이 생각하는 동안 판이 바뀌면(사용자가 이동 등) null을 돌려 둘 수를 버리게 합니다.
 * @param {"cho"|"han"} team
 * @returns {Promise<{i:number,x:number,y:number,score?:number,engine:"fsf"|"builtin"}|null>}
 */
async function requestAIMove(team) {
  if (aiEnginePref() === "fsf") {
    const before = JSON.stringify(cfSnapshot());
    try {
      const m = await fsfBestMove(team);
      if (JSON.stringify(cfSnapshot()) !== before) return null; // 그사이 판이 바뀜
      if (m) return { ...m, engine: "fsf" };
    } catch (err) {
      console.error("[engine-fsf] 수 고르기 실패, 내장 엔진으로 둡니다:", err);
    }
  }
  const m = getBestAIMove(team);
  return m ? { ...m, engine: "builtin" } : null;
}

document.addEventListener("DOMContentLoaded", () => {
  fsfSyncSettingsUI();
  if (aiEnginePref() === "fsf") fsfLoad();
});
