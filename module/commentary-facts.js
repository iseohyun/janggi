/**
 * @fileoverview LLM 해설용 "엔진 사실" 수집과 프롬프트 작성 모듈.
 * LLM은 장기 수읽기를 직접 잘하지 못하므로, 이 앱의 탐색 엔진(ai.js, 2수 읽기)이 계산한
 * 사실(판세 점수, 엔진 추천수, 장군 여부, 잡힌 기물, 국면 그림)을 만들어 건네고
 * LLM에게는 그 사실을 사람 말로 '설명'하는 일만 맡깁니다.
 * 모든 계산은 전역 pieces 좌표를 잠깐 바꿨다가 finally에서 되돌리는 방식이라 화면(SVG)은 건드리지 않습니다.
 * 2026-11-20: Fairy-Stockfish를 쓸 수 있으면 요청 만들기는 commentary-facts-fsf.js로 넘어가고,
 *             이 파일의 내장 2수 엔진 계산은 Fairy-Stockfish를 못 쓸 때만 쓴다.
 * @module commentary-facts
 * @depends state, rules, ai, record
 */

const CF_PIECE_NAMES = ["궁", "차", "차", "포", "포", "마", "마", "상", "상", "사", "사", "졸", "졸", "졸", "졸", "졸"];
const CF_MATE_THRESHOLD = 50000; // 평가 점수가 이보다 크면 궁이 잡히는(외통) 국면으로 본다
const CF_SCORE_SCALE = 10; // evaluateBoard 점수(차=130)를 점수판 기준(차=13)으로 환산하는 배율

/** @param {number} i @returns {"cho"|"han"} */
function cfTeamOf(i) {
  return ((i < 16) === iAmCho) ? "cho" : "han";
}

/** @param {"cho"|"han"} team @returns {string} */
function cfTeamName(team) {
  return team === "cho" ? "초" : "한";
}

/** @param {"cho"|"han"} team @returns {"cho"|"han"} */
function cfOpponent(team) {
  return team === "cho" ? "han" : "cho";
}

/** @param {number} i @returns {string} 기물 한글 이름 (한나라 졸은 '병') */
function cfPieceName(i) {
  const name = CF_PIECE_NAMES[i % 16];
  return (name === "졸" && cfTeamOf(i) === "han") ? "병" : name;
}

/** 기보 표기와 같은 '행열' 두 자리 좌표 (10번째 행은 0) */
function cfCoord(x, y) {
  return `${y}${x}`;
}

/** @param {number} step - 이 수까지 둔 국면 (0=첫 배치) @returns {"cho"|"han"} 둘 차례 */
function cfSideToMove(step) {
  return (step % 2 === 0) ? "cho" : "han";
}

// ===== 국면 바꿔 끼우기 =====

function cfSnapshot() {
  return pieces.map(p => ({ x: p.x, y: p.y }));
}

function cfRestore(snap) {
  for (let idx = 0; idx < 32; idx++) {
    pieces[idx].x = snap[idx].x;
    pieces[idx].y = snap[idx].y;
  }
}

/** 첫 배치에서 log[0..step-1]을 적용한 좌표를 pieces에 씁니다. */
function cfApplyStep(step) {
  for (let idx = 0; idx < 32; idx++) {
    pieces[idx].x = initPieces[idx].x;
    pieces[idx].y = initPieces[idx].y;
  }
  for (let s = 0; s < step && s < log.length; s++) {
    const m = log[s];
    if (m.t < NO_PIECE) {
      pieces[m.t].x = 0;
      pieces[m.t].y = 0;
    }
    pieces[m.i].x = m.x;
    pieces[m.i].y = m.y;
  }
}

/**
 * step수까지 둔 국면을 잠깐 만들어 fn을 실행하고 원래 좌표로 되돌립니다.
 * @template T
 * @param {number} step
 * @param {() => T} fn
 * @returns {T}
 */
function cfWithPositionAt(step, fn) {
  const snap = cfSnapshot();
  try {
    cfApplyStep(step);
    return fn();
  } finally {
    cfRestore(snap);
  }
}

/** 수 하나를 둡니다(좌표만). 되돌리기용 정보를 반환합니다. */
function cfDoMove(m) {
  const target = whoIsit(m.x, m.y);
  const undo = { i: m.i, x: pieces[m.i].x, y: pieces[m.i].y, t: NO_PIECE, tx: 0, ty: 0 };
  if (target < NO_PIECE && target !== m.i) {
    undo.t = target;
    undo.tx = pieces[target].x;
    undo.ty = pieces[target].y;
    pieces[target].x = 0;
    pieces[target].y = 0;
  }
  pieces[m.i].x = m.x;
  pieces[m.i].y = m.y;
  return undo;
}

function cfUndoMove(undo) {
  pieces[undo.i].x = undo.x;
  pieces[undo.i].y = undo.y;
  if (undo.t < NO_PIECE) {
    pieces[undo.t].x = undo.tx;
    pieces[undo.t].y = undo.ty;
  }
}

// ===== 점수 계산 =====

/**
 * 방금 수를 둔 쪽이 아닌 상대(team)가 최선으로 응수했을 때의 평가 점수.
 * getBestAIMove가 후보 수마다 매기는 점수와 같은 기준이라 서로 비교할 수 있습니다.
 * @param {"cho"|"han"} team - 이제 둘 차례인 쪽
 * @returns {number} 초 유리 +, 한 유리 -
 */
function cfReplyScore(team) {
  const replies = getFilteredLegalMoves(team);
  if (replies.length === 0) {
    // 둘 수가 없음: 장군이면 외통(team 패배), 아니면 판세 그대로
    if (isKingInCheck(team)) return team === "cho" ? -999999 : 999999;
    return evaluateBoard();
  }
  let best = team === "cho" ? -Infinity : Infinity;
  for (const r of replies) {
    const undo = cfDoMove(r);
    const score = evaluateBoard();
    cfUndoMove(undo);
    if (team === "cho" ? score > best : score < best) best = score;
  }
  return best;
}

/** 점수를 team 입장(유리 +)의 점수판 단위로 바꿉니다. */
function cfFor(team, score) {
  return (team === "cho" ? score : -score) / CF_SCORE_SCALE;
}

/** 판세 점수(초 기준)를 사람이 읽을 문장으로. */
function cfDescribeScore(score) {
  if (score > CF_MATE_THRESHOLD) return "초가 궁을 잡는 수가 보임(사실상 초 승리)";
  if (score < -CF_MATE_THRESHOLD) return "한이 궁을 잡는 수가 보임(사실상 한 승리)";
  const v = score / CF_SCORE_SCALE;
  if (Math.abs(v) < 1) {
    const shown = v.toFixed(1) === "-0.0" ? "0.0" : v.toFixed(1);
    return `거의 대등 (${shown.startsWith("-") ? "" : "+"}${shown})`;
  }
  return `${v > 0 ? "초" : "한"} 우세 ${Math.abs(v).toFixed(1)}점`;
}

/**
 * 엔진 추천수 대비 손실 점수(둔 쪽 입장)를 등급 문장으로 바꿉니다.
 * @param {number} loss - 점수판 단위, 0 이상
 */
function cfGradeLoss(loss) {
  if (loss >= CF_MATE_THRESHOLD / CF_SCORE_SCALE) return "결정적 실수(궁이 위험해짐)";
  if (loss < 0.5) return "엔진 추천과 같은 수준의 수";
  if (loss < 3) return "조금 아쉬운 수";
  if (loss < 7) return "실수";
  return "큰 실수";
}

// ===== 수와 국면 설명 =====

/**
 * 현재 pieces 좌표 기준으로 수 하나를 "초 79졸78 (한 병 잡음)" 꼴로 적습니다.
 * @param {{i:number,x:number,y:number}} m
 */
function cfDescribeMove(m) {
  const from = cfCoord(pieces[m.i].x, pieces[m.i].y);
  const target = whoIsit(m.x, m.y);
  let text = `${cfTeamName(cfTeamOf(m.i))} ${from}${cfPieceName(m.i)}${cfCoord(m.x, m.y)}`;
  if (target < NO_PIECE && target !== m.i) {
    text += ` (${cfTeamName(cfTeamOf(target))} ${cfPieceName(target)} 잡음)`;
  }
  return text;
}

/** 현재 pieces 좌표를 글자 판 그림으로 만듭니다. 위쪽이 화면 위쪽입니다. */
function cfBoardText() {
  const grid = {};
  for (let idx = 0; idx < 32; idx++) {
    const p = pieces[idx];
    if (p.x === 0) continue;
    grid[`${p.x},${p.y}`] = `${cfTeamName(cfTeamOf(idx))}${cfPieceName(idx)}`;
  }
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  const lines = ["행\\열  1    2    3    4    5    6    7    8    9"];
  for (const y of rows) {
    const cells = [];
    for (let x = 1; x <= 9; x++) cells.push(grid[`${x},${y}`] || "·· ");
    lines.push(`${String(y).padStart(2)}    ${cells.join("  ")}`);
  }
  return lines.join("\n");
}

/** 지금까지 잡힌 기물 목록. */
function cfCapturedText() {
  const lost = { cho: [], han: [] };
  for (let idx = 0; idx < 32; idx++) {
    if (pieces[idx].x === 0) lost[cfTeamOf(idx)].push(cfPieceName(idx));
  }
  const fmt = arr => arr.length ? arr.join(", ") : "없음";
  return `초가 잃은 기물: ${fmt(lost.cho)} / 한이 잃은 기물: ${fmt(lost.han)}`;
}

/** 아래 진영이 초인지 한인지 알려 줍니다. */
function cfOrientationText() {
  const bottom = iAmCho ? "초" : "한";
  const top = iAmCho ? "한" : "초";
  return `화면 아래쪽 진영: ${bottom}, 위쪽 진영: ${top}`;
}

/** 대국자 이름 등 메타데이터 */
function cfMetaText() {
  const parts = [];
  if (gameMetadata.choPlayer) parts.push(`초 대국자: ${gameMetadata.choPlayer}`);
  if (gameMetadata.hanPlayer) parts.push(`한 대국자: ${gameMetadata.hanPlayer}`);
  if (gameMetadata.tournament) parts.push(`대회: ${gameMetadata.tournament}`);
  return parts.join(" / ");
}

/** 현재 화면에 보이는 수순 번호(0=첫 배치) */
function cfCurrentStep() {
  const turn = document.getElementById("turn");
  const v = turn ? parseInt(turn.value, 10) : log.length;
  return isNaN(v) ? log.length : Math.min(v, log.length);
}

// ===== 사실 묶음 =====

/**
 * step번째 수(1부터)를 평가합니다. 엔진 추천수와 비교해 손실을 계산합니다.
 * @param {number} step
 * @param {boolean} withBest - 엔진 추천수(2수 탐색, 무거움)까지 계산할지
 */
function cfAnalyzeMove(step, withBest) {
  const m = log[step - 1];
  const mover = cfSideToMove(step - 1);
  const opponent = cfOpponent(mover);

  const info = cfWithPositionAt(step - 1, () => {
    const result = { moveText: cfDescribeMove(m), best: null };
    if (withBest) {
      const best = getBestAIMove(mover);
      if (best) {
        result.best = { text: cfDescribeMove(best), score: best.score, same: best.i === m.i && best.x === m.x && best.y === m.y };
      }
    }
    return result;
  });

  const after = cfWithPositionAt(step, () => ({
    playedScore: cfReplyScore(opponent),
    staticScore: evaluateBoard(),
    givesCheck: isKingInCheck(opponent),
    opponentMoves: getFilteredLegalMoves(opponent).length
  }));

  const analysis = {
    step,
    mover,
    moveText: info.moveText,
    playedScore: after.playedScore,
    givesCheck: after.givesCheck,
    mates: after.givesCheck && after.opponentMoves === 0,
    best: info.best,
    loss: null
  };
  if (info.best) {
    analysis.loss = info.best.same ? 0 : Math.max(0, cfFor(mover, info.best.score) - cfFor(mover, after.playedScore));
  }
  return analysis;
}

/** 현재 국면(step) 전체에 대한 공통 사실 */
function cfPositionFacts(step) {
  return cfWithPositionAt(step, () => {
    const side = cfSideToMove(step);
    const best = getFilteredLegalMoves(side).length ? getBestAIMove(side) : null;
    return {
      side,
      board: cfBoardText(),
      captured: cfCapturedText(),
      scoreText: cfDescribeScore(evaluateBoard()),
      inCheck: isKingInCheck(side),
      bestText: best ? `${cfDescribeMove(best)} → 그 뒤 판세: ${cfDescribeScore(best.score)}` : "둘 수 있는 수 없음"
    };
  });
}

/** 공통 머리말 (표기법·엔진 한계 안내) */
function cfCommonHeader(step) {
  const lines = [
    "[표기법] 좌표는 기보와 같은 '행열' 두 자리입니다. 행은 화면 위에서부터 1~9, 맨 아래 10번째 행은 0, 열은 왼쪽부터 1~9. 예: '79졸78'은 7행9열의 졸이 7행8열로 간 수.",
    "[엔진] 판세 점수는 기물 점수(차13 포7 마5 상3 사3 졸·병2, 한 덤 1.5)에 위치 가산점을 더한 값이며, 엔진은 2수(내 수와 상대 응수)까지만 읽습니다.",
    `[국면] ${cfOrientationText()} / 지금까지 ${step}수 진행`
  ];
  const meta = cfMetaText();
  if (meta) lines.push(`[대국 정보] ${meta}`);
  return lines.join("\n");
}

const CF_SYSTEM_PROMPT = [
  "당신은 한국 장기(Janggi) 해설가입니다.",
  "사용자 메시지의 [엔진 분석]은 이 앱의 탐색 엔진이 실제로 계산한 사실입니다. 이 사실을 근거로 설명하세요.",
  "직접 긴 수읽기를 새로 하지 마세요. 사실에 없는 수순을 말할 때는 '~할 수도 있다'처럼 가능성으로만 말하세요.",
  "엔진은 2수만 읽으므로, 장기적인 계획이나 형세 판단은 일반적인 장기 원리(궁 안전, 차·포의 길, 마·상의 활용, 졸의 전진 등)로 보충하세요.",
  "좌표를 말할 때는 '79졸78'처럼 기보 표기를 그대로 쓰세요.",
  "반드시 한국어로, 해설 본문만 쓰세요. 머리말·인사말·마크다운 제목은 쓰지 마세요."
].join("\n");

/**
 * "방금 둔 수 해설" 요청을 만듭니다.
 * @returns {{kind:string, step:number, title:string, system:string, user:string}|null}
 */
async function buildMoveCommentaryRequest(signal) {
  // Fairy-Stockfish를 쓸 수 있으면 그 엔진으로 사실을 만든다 (commentary-facts-fsf.js)
  if (typeof cfxUseFsf === "function" && await cfxUseFsf()) return cfxBuildMoveRequest(signal);
  const step = cfCurrentStep();
  if (step <= 0) return null;
  const a = cfAnalyzeMove(step, true);
  const pos = cfPositionFacts(step);

  const facts = [
    `- 해설할 수: ${step}수, ${a.moveText}`,
    a.best
      ? (a.best.same
        ? "- 엔진 추천수와 같은 수입니다."
        : `- 이 국면에서 엔진 추천수: ${a.best.text} (추천수 뒤 판세: ${cfDescribeScore(a.best.score)})`)
      : "- 엔진 추천수: 계산 불가",
    `- 둔 수 뒤 상대 최선 응수까지 본 판세: ${cfDescribeScore(a.playedScore)}`,
    a.loss !== null ? `- 엔진 기준 평가: ${cfGradeLoss(a.loss)} (추천수 대비 손실 ${a.loss.toFixed(1)}점)` : "",
    a.mates ? "- 이 수로 외통수(장군을 피할 수 없음)가 되었습니다." : (a.givesCheck ? "- 이 수는 장군입니다." : ""),
    `- 현재 판세(정적 평가): ${pos.scoreText}`,
    `- ${pos.captured}`,
    `- 이제 둘 차례: ${cfTeamName(pos.side)}${pos.inCheck ? " (장군 받는 중)" : ""}`,
    `- ${cfTeamName(pos.side)}의 엔진 추천 다음 수: ${pos.bestText}`
  ].filter(Boolean).join("\n");

  const user = [
    cfCommonHeader(step),
    "",
    "[현재 국면]",
    pos.board,
    "",
    "[엔진 분석]",
    facts,
    "",
    "[요청] 방금 둔 수의 의도와 좋고 나쁨을 3~5문장으로 해설하고, 다음에 무엇을 조심해야 하는지 한 문장 덧붙여 주세요."
  ].join("\n");

  return { kind: "move", step, title: `${step}수 해설 (${a.moveText})`, system: CF_SYSTEM_PROMPT, user };
}

/**
 * "전체 기보 복기" 요청을 만듭니다. 수가 많으면 시간이 걸리므로 중간중간 화면에 양보합니다.
 * @param {(done:number,total:number)=>void} [onProgress]
 * @param {AbortSignal} [signal]
 */
async function buildReviewCommentaryRequest(onProgress, signal) {
  if (typeof cfxUseFsf === "function" && await cfxUseFsf()) return cfxBuildReviewRequest(onProgress, signal);
  const total = log.length;
  if (total === 0) return null;

  // 1단계: 모든 수의 '응수 후 판세'(가벼운 1수 계산)
  const analyses = [];
  for (let step = 1; step <= total; step++) {
    if (signal && signal.aborted) throw new DOMException("중지됨", "AbortError");
    analyses.push(cfAnalyzeMove(step, false));
    if (onProgress) onProgress(step, total * 2);
    if (step % 5 === 0) await new Promise(r => setTimeout(r, 0));
  }

  // 2단계: 판세가 크게 흔들린 수만 골라 엔진 추천수와 비교(무거운 2수 계산)
  const swings = analyses.map((a, idx) => {
    const before = idx === 0 ? 0 : analyses[idx - 1].playedScore;
    return { idx, drop: cfFor(a.mover, before) - cfFor(a.mover, a.playedScore) };
  }).sort((p, q) => q.drop - p.drop).slice(0, Math.min(6, total));

  const keyMoves = [];
  for (let k = 0; k < swings.length; k++) {
    if (signal && signal.aborted) throw new DOMException("중지됨", "AbortError");
    const step = swings[k].idx + 1;
    keyMoves.push(cfAnalyzeMove(step, true));
    if (onProgress) onProgress(total + Math.round((k + 1) / swings.length * total), total * 2);
    await new Promise(r => setTimeout(r, 0));
  }
  keyMoves.sort((p, q) => p.step - q.step);

  const flow = analyses.map(a => {
    const flags = a.mates ? " [외통]" : (a.givesCheck ? " [장군]" : "");
    return `${a.step}. ${a.moveText}${flags} → ${cfDescribeScore(a.playedScore)}`;
  }).join("\n");

  const keyText = keyMoves.map(a => {
    const best = a.best && !a.best.same ? `엔진 추천: ${a.best.text}` : "엔진 추천과 같은 수";
    return `- ${a.step}수 ${a.moveText}: ${a.loss !== null ? cfGradeLoss(a.loss) : ""} (${best}, 손실 ${a.loss !== null ? a.loss.toFixed(1) : "?"}점)`;
  }).join("\n");

  const pos = cfPositionFacts(total);
  const user = [
    cfCommonHeader(total),
    "",
    "[마지막 국면]",
    pos.board,
    "",
    "[엔진 분석: 수순별 판세 흐름 (각 수 뒤 상대 최선 응수까지 본 판세)]",
    flow,
    "",
    "[엔진 분석: 판세가 크게 흔들린 수]",
    keyText || "- 없음",
    "",
    `[엔진 분석: 마지막 국면] ${pos.scoreText} / ${pos.captured}${gameEnded ? " / 대국 종료(외통)" : ""}`,
    "",
    "[요청] 이 대국을 복기해 주세요. ① 초반·중반·종반의 흐름, ② 승부처가 된 수 2~3개와 더 나았던 수, ③ 양쪽이 배울 점을 각각 한두 문장으로. 전체 10~15문장 이내."
  ].join("\n");

  return { kind: "review", step: total, title: `전체 기보 복기 (${total}수)`, system: CF_SYSTEM_PROMPT, user };
}

/**
 * 현재 국면에 대한 자유 질문 요청을 만듭니다.
 * @param {string} question
 */
async function buildQuestionCommentaryRequest(question, signal) {
  if (typeof cfxUseFsf === "function" && await cfxUseFsf()) return cfxBuildQuestionRequest(question, signal);
  const step = cfCurrentStep();
  const pos = cfPositionFacts(step);
  const lastMove = step > 0 ? cfAnalyzeMove(step, false) : null;
  const facts = [
    lastMove ? `- 마지막에 둔 수: ${step}수, ${lastMove.moveText}${lastMove.givesCheck ? " (장군)" : ""}` : "- 아직 아무 수도 두지 않은 첫 배치입니다.",
    `- 현재 판세: ${pos.scoreText}`,
    `- ${pos.captured}`,
    `- 이제 둘 차례: ${cfTeamName(pos.side)}${pos.inCheck ? " (장군 받는 중)" : ""}`,
    `- ${cfTeamName(pos.side)}의 엔진 추천 다음 수: ${pos.bestText}`
  ].join("\n");

  const user = [
    cfCommonHeader(step),
    "",
    "[현재 국면]",
    pos.board,
    "",
    "[엔진 분석]",
    facts,
    "",
    "[사용자 질문]",
    question.trim().slice(0, 500),
    "",
    "[요청] 위 질문에 현재 국면과 엔진 분석을 근거로 2~6문장으로 답해 주세요."
  ].join("\n");

  return { kind: "question", step, title: `질문 (${step}수 국면)`, question: question.trim(), system: CF_SYSTEM_PROMPT, user };
}
