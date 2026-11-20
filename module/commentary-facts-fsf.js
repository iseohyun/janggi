/**
 * @fileoverview LLM 해설용 "엔진 사실"을 Fairy-Stockfish로 계산합니다.
 * commentary-facts.js의 요청 만들기(buildMove/Review/QuestionCommentaryRequest)가 Fairy-Stockfish를 쓸 수 있으면
 * 이 파일의 cfxBuild…로 넘어오고, 못 쓰면(교차 출처 격리가 안 됨, 내장 엔진 선택) 기존 내장 2수 엔진 계산을 씁니다.
 *
 * 점수 기준
 *  - 판세 값은 초 기준(+ 초 유리)의 엔진 평가값(센티폰). 글로는 100으로 나눠 "초 우세 1.2"처럼 적는다.
 *  - 외통 수순은 ±CFX_MATE에 가까운 큰 값으로 바꿔 비교한다.
 *  - 둔 수의 손실 = (그 국면 엔진 1순위 뒤 판세) − (실제로 둔 수 뒤 판세), 둔 쪽 입장.
 * @module commentary-facts-fsf
 * @depends state, rules, ai, commentary-facts, engine-fsf
 */

const CFX_MATE = 100000;

/** 해설에 Fairy-Stockfish를 쓸 수 있는지 (엔진 선택이 Fairy-Stockfish이고 불러오기에 성공) */
async function cfxUseFsf() {
  if (typeof aiEnginePref !== "function" || aiEnginePref() !== "fsf") return false;
  return fsfLoad();
}

function cfxAbortCheck(signal) {
  if (signal && signal.aborted) throw new DOMException("중지됨", "AbortError");
}

/** 엔진 한 줄 결과 → 초 기준 비교용 값 */
function cfxValue(r) {
  if (r.mate !== null && r.mate !== undefined) return Math.sign(r.mate) * (CFX_MATE - Math.abs(r.mate) * 100);
  return r.score || 0;
}

/** 초 기준 값을 team 입장(유리 +)으로 */
function cfxFor(team, value) {
  return team === "cho" ? value : -value;
}

/**
 * step수 국면을 엔진으로 평가합니다.
 * @param {number} step - 0=첫 배치
 * @param {number} movetime - 밀리초
 * @param {number} [multipv=1]
 * @returns {Promise<{step:number, side:string, snap:Array, lines:Array, top:Object|null, value:number, mated:boolean, inCheck:boolean}>}
 */
async function cfxEvalAt(step, movetime, multipv) {
  const side = cfSideToMove(step);
  const snap = cfWithPositionAt(step, cfSnapshot);
  const flags = cfWithPositionAt(step, () => ({
    inCheck: isKingInCheck(side),
    noMoves: getFilteredLegalMoves(side).length === 0
  }));
  if (flags.noMoves) {
    // 둘 수가 없음: 장군이면 외통(side 패배), 아니면 대등으로 본다
    const value = flags.inCheck ? cfxFor(side, -CFX_MATE) : 0;
    return { step, side, snap, lines: [], top: null, value, mated: flags.inCheck, inCheck: flags.inCheck };
  }
  const lines = await fsfAnalyze(side, { position: snap, multipv: multipv || 1, movetime, kind: "facts" });
  if (!lines || !lines.length) throw new Error(`${step}수 국면을 엔진이 분석하지 못했습니다.`);
  return { step, side, snap, lines, top: lines[0], value: cfxValue(lines[0]), mated: false, inCheck: flags.inCheck };
}

/** 판세(평가 결과 또는 값)를 문장으로 */
function cfxDescribe(ev) {
  if (ev.mated) return `${cfTeamName(ev.side)}이 외통을 당한 국면`;
  const top = ev.top;
  if (top && top.mate !== null && top.mate !== undefined) {
    const winner = top.mate > 0 ? "초" : "한";
    return `${winner}가 ${Math.abs(top.mate)}수 안에 외통으로 이기는 수순이 보임`;
  }
  const v = ev.value;
  const shown = (Math.abs(v) / 100).toFixed(1);
  const rate = Math.round(fsfWinRate(v, null) * 100);
  if (Math.abs(v) < 50) return `거의 대등 (${v < 0 && shown !== "0.0" ? "-" : "+"}${shown}, 초 승률 약 ${rate}%)`;
  return `${v > 0 ? "초" : "한"} 우세 ${shown} (초 승률 약 ${rate}%)`;
}

/** 손실(둔 쪽 입장, 엔진 단위)을 등급 문장으로 */
function cfxGrade(loss) {
  if (loss >= CFX_MATE / 2) return "결정적 실수(외통 수순을 허용하거나 놓침)";
  if (loss < 30) return "엔진 추천과 같은 수준의 수";
  if (loss < 100) return "조금 아쉬운 수";
  if (loss < 250) return "실수";
  return "큰 실수";
}

/** 국면 snap에서 수순 moves를 "초 79졸78 → 한 …" 꼴로 (최대 max수) */
function cfxLineText(snap, moves, max) {
  const now = cfSnapshot();
  const parts = [];
  try {
    cfRestore(snap);
    for (const m of moves.slice(0, max || 6)) {
      parts.push(cfDescribeMove(m));
      cfDoMove(m);
    }
  } finally {
    cfRestore(now);
  }
  return parts.join(" → ") + (moves.length > (max || 6) ? " → …" : "");
}

/** step번째 수(1부터)의 기보 표기 */
function cfxMoveText(step) {
  return cfWithPositionAt(step - 1, () => cfDescribeMove(log[step - 1]));
}

/** 엔진 추천 1~N순위 목록 문장 */
function cfxCandidatesText(ev, maxMoves) {
  return ev.lines.map(r => {
    const one = { ...ev, top: r, value: cfxValue(r) };
    return `  ${r.rank}순위: ${cfxLineText(ev.snap, r.pv, maxMoves || 4)} (그 뒤 판세: ${cfxDescribe(one)}, 깊이 ${r.depth})`;
  }).join("\n");
}

function cfxSystemPrompt() {
  return [
    "당신은 한국 장기(Janggi) 해설가입니다.",
    "사용자 메시지의 [엔진 분석]은 강한 장기 엔진(Fairy-Stockfish)이 실제로 계산한 사실입니다. 판세와 수순은 엔진을 믿고, 그 이유를 장기 원리(궁 안전, 차·포의 길, 마·상의 활용, 졸의 전진, 기물 교환 등)로 풀어 설명하세요.",
    "엔진 예상 수순에 없는 수순을 새로 지어내지 마세요. 꼭 필요하면 '~할 수도 있다'처럼 가능성으로만 말하세요.",
    "승률은 엔진 평가값을 어림으로 바꾼 값이니 '약'을 붙여 말하세요.",
    "좌표를 말할 때는 '79졸78'처럼 기보 표기를 그대로 쓰세요.",
    "반드시 한국어로, 해설 본문만 쓰세요. 머리말·인사말·마크다운 제목은 쓰지 마세요."
  ].join("\n");
}

function cfxHeader(step, depthText) {
  const lines = [
    "[표기법] 좌표는 기보와 같은 '행열' 두 자리입니다. 행은 화면 위에서부터 1~9, 맨 아래 10번째 행은 0, 열은 왼쪽부터 1~9. 예: '79졸78'은 7행9열의 졸이 7행8열로 간 수.",
    `[엔진] Fairy-Stockfish(장기 변형) 분석입니다${depthText ? ` (${depthText})` : ""}. 판세의 +는 초 유리, 숫자 1.0은 엔진 평가 100(센티폰). 승률은 평가값을 어림으로 바꾼 값입니다.`,
    `[국면] ${cfOrientationText()} / 지금까지 ${step}수 진행`
  ];
  const meta = cfMetaText();
  if (meta) lines.push(`[대국 정보] ${meta}`);
  return lines.join("\n");
}

// ===== 요청 만들기 =====

/** "방금 둔 수 해설" (Fairy-Stockfish) */
async function cfxBuildMoveRequest(signal) {
  const step = cfCurrentStep();
  if (step <= 0) return null;
  const mt = aiThinkMs();
  const before = await cfxEvalAt(step - 1, mt, 3);
  cfxAbortCheck(signal);
  const after = await cfxEvalAt(step, mt, 3);
  cfxAbortCheck(signal);

  const played = log[step - 1];
  const mover = before.side;
  const moveText = cfxMoveText(step);
  const same = !!before.top && sameMove(before.top, played);
  const rankOfPlayed = before.lines.findIndex(r => sameMove(r, played));
  const loss = same ? 0 : (before.top ? Math.max(0, cfxFor(mover, before.value) - cfxFor(mover, after.value)) : null);

  const facts = [
    `- 해설할 수: ${step}수, ${moveText}`,
    same
      ? "- 엔진 1순위 추천과 같은 수입니다."
      : (rankOfPlayed > 0 ? `- 엔진 추천 ${rankOfPlayed + 1}순위에 든 수입니다.` : "- 엔진 추천 1~3순위에 없는 수입니다."),
    before.lines.length ? `- 이 수를 두기 전 국면의 엔진 추천 (예상 수순 포함):\n${cfxCandidatesText(before)}` : "",
    `- 둔 수 뒤 판세: ${cfxDescribe(after)}`,
    loss !== null ? `- 엔진 기준 평가: ${cfxGrade(loss)} (1순위 대비 손실 ${(loss / 100).toFixed(1)})` : "",
    after.mated ? "- 이 수로 외통수(장군을 피할 수 없음)가 되었습니다." : (after.inCheck ? "- 이 수는 장군입니다." : ""),
    `- ${cfWithPositionAt(step, cfCapturedText)}`,
    `- 이제 둘 차례: ${cfTeamName(after.side)}${after.inCheck ? " (장군 받는 중)" : ""}`,
    after.top ? `- ${cfTeamName(after.side)}의 엔진 예상 최선 수순: ${cfxLineText(after.snap, after.top.pv, 6)}` : ""
  ].filter(Boolean).join("\n");

  const depth = after.top ? `국면마다 약 ${(mt / 1000).toFixed(1)}초, 깊이 ${after.top.depth}` : "";
  const user = [
    cfxHeader(step, depth),
    "",
    "[현재 국면]",
    cfWithPositionAt(step, cfBoardText),
    "",
    "[엔진 분석]",
    facts,
    "",
    "[요청] 방금 둔 수의 의도와 좋고 나쁨을 3~5문장으로 해설하고, 다음에 무엇을 조심해야 하는지 한 문장 덧붙여 주세요."
  ].join("\n");

  return { kind: "move", step, title: `${step}수 해설 (${moveText}) · Fairy-Stockfish`, system: cfxSystemPrompt(), user };
}

/** "전체 기보 복기" (Fairy-Stockfish): 모든 국면을 짧게 평가해 수마다 손실을 구한다 */
async function cfxBuildReviewRequest(onProgress, signal) {
  const total = log.length;
  if (total === 0) return null;
  const mt = total > 80 ? 150 : (total > 40 ? 200 : 300);

  const evs = [];
  for (let p = 0; p <= total; p++) {
    cfxAbortCheck(signal);
    evs.push(await cfxEvalAt(p, mt, 1));
    if (onProgress) onProgress(p + 1, total + 1);
  }

  const moves = [];
  for (let k = 1; k <= total; k++) {
    const before = evs[k - 1];
    const after = evs[k];
    const played = log[k - 1];
    const same = !!before.top && sameMove(before.top, played);
    const loss = same ? 0 : (before.top ? Math.max(0, cfxFor(before.side, before.value) - cfxFor(before.side, after.value)) : 0);
    moves.push({ k, before, after, same, loss, text: cfxMoveText(k) });
  }

  const flow = moves.map(m => {
    const flags = m.after.mated ? " [외통]" : (m.after.inCheck ? " [장군]" : "");
    return `${m.k}. ${m.text}${flags} → ${cfxDescribe(m.after)}`;
  }).join("\n");

  const keyText = [...moves].filter(m => m.loss >= 30).sort((p, q) => q.loss - p.loss).slice(0, 6)
    .sort((p, q) => p.k - q.k)
    .map(m => `- ${m.k}수 ${m.text}: ${cfxGrade(m.loss)} (손실 ${(m.loss / 100).toFixed(1)}, 엔진 추천: ${cfxLineText(m.before.snap, m.before.top.pv, 3)})`)
    .join("\n");

  const last = evs[total];
  const user = [
    cfxHeader(total, `국면마다 약 ${(mt / 1000).toFixed(1)}초`),
    "",
    "[마지막 국면]",
    cfWithPositionAt(total, cfBoardText),
    "",
    "[엔진 분석: 수순별 판세 흐름 (각 수를 둔 뒤의 판세)]",
    flow,
    "",
    "[엔진 분석: 손실이 큰 수 (엔진 1순위 대비)]",
    keyText || "- 없음 (모두 엔진 추천에 가까운 수)",
    "",
    `[엔진 분석: 마지막 국면] ${cfxDescribe(last)} / ${cfWithPositionAt(total, cfCapturedText)}${gameEnded ? " / 대국 종료(외통)" : ""}`,
    "",
    "[요청] 이 대국을 복기해 주세요. ① 초반·중반·종반의 흐름, ② 승부처가 된 수 2~3개와 더 나았던 수, ③ 양쪽이 배울 점을 각각 한두 문장으로. 전체 10~15문장 이내."
  ].join("\n");

  return { kind: "review", step: total, title: `전체 기보 복기 (${total}수) · Fairy-Stockfish`, system: cfxSystemPrompt(), user };
}

/** 현재 국면 자유 질문 (Fairy-Stockfish) */
async function cfxBuildQuestionRequest(question, signal) {
  const step = cfCurrentStep();
  const mt = aiThinkMs();
  const ev = await cfxEvalAt(step, mt, 3);
  cfxAbortCheck(signal);
  const lastText = step > 0 ? cfxMoveText(step) : null;

  const facts = [
    lastText ? `- 마지막에 둔 수: ${step}수, ${lastText}${ev.inCheck ? " (장군)" : ""}` : "- 아직 아무 수도 두지 않은 첫 배치입니다.",
    `- 현재 판세: ${cfxDescribe(ev)}`,
    `- ${cfWithPositionAt(step, cfCapturedText)}`,
    `- 이제 둘 차례: ${cfTeamName(ev.side)}${ev.inCheck ? " (장군 받는 중)" : ""}`,
    ev.lines.length ? `- ${cfTeamName(ev.side)}의 엔진 추천 (예상 수순 포함):\n${cfxCandidatesText(ev)}` : "- 둘 수 있는 수가 없습니다."
  ].join("\n");

  const user = [
    cfxHeader(step, ev.top ? `약 ${(mt / 1000).toFixed(1)}초, 깊이 ${ev.top.depth}` : ""),
    "",
    "[현재 국면]",
    cfWithPositionAt(step, cfBoardText),
    "",
    "[엔진 분석]",
    facts,
    "",
    "[사용자 질문]",
    question.trim().slice(0, 500),
    "",
    "[요청] 위 질문에 현재 국면과 엔진 분석을 근거로 2~6문장으로 답해 주세요."
  ].join("\n");

  return { kind: "question", step, title: `질문 (${step}수 국면) · Fairy-Stockfish`, question: question.trim(), system: cfxSystemPrompt(), user };
}
