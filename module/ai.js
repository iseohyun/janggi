/**
 * @fileoverview AI 엔진, 장군(Check) 및 외통수 판정, 자살수 제외 합법수 필터링 모듈.
 * @module ai
 * @depends state, rules, board
 */

var aiThinking = false;

/**
 * AI의 차례인지 확인하고 필요 시 AI 착수를 비동기로 실행합니다.
 * @param {boolean} [immediate=false] - 딜레이 없이 즉시 실행 여부
 */
function checkAndRunAI(immediate = false) {
  if (aiMode === 0) return;
  if (aiThinking) return;
  if (gameEnded) return;
  
  const turn = document.getElementById("turn");
  if (!turn) return;
  const curTurn = parseInt(turn.value, 10);
  
  // 기보 리뷰 모드 등 과거를 돌려보는 중이면 AI 작동 차단 (단, 즉시 강제 실행 모드일 경우 그 시점부터 뒤를 자르고 실행)
  if (curTurn < log.length) {
    if (immediate) {
      log.length = curTurn;
      updateRecordUI();
    } else {
      return;
    }
  }
  
  const isChoTurn = (curTurn % 2 === 0);
  const aiIsCho = (aiMode === 1 && !iAmCho);
  const aiIsHan = (aiMode === 1 && iAmCho);
  
  if ((isChoTurn && aiIsCho) || (!isChoTurn && aiIsHan)) {
    aiThinking = true;
    
    const delay = immediate ? 0 : 500;
    
    // 약간의 딜레이를 주어 AI가 생각하는 척하는 자연스러운 연출 적용
    setTimeout(() => {
      try {
        const aiTeam = isChoTurn ? "cho" : "han";
        const bestMove = getBestAIMove(aiTeam);
        
        if (bestMove) {
          move(bestMove.i, bestMove.x, bestMove.y);
        } else {
          console.warn("[AI Move] No legal moves found for AI.");
        }
      } catch (err) {
        console.error("[AI Error] Error during AI move calculation:", err);
      } finally {
        aiThinking = false;
        checkAndRunAI();
      }
    }, delay);
  }
}

/**
 * 특정 진영의 궁(왕)이 현재 장군(Check) 상태인지 판정합니다.
 * @param {"cho"|"han"} team - 검사할 진영
 * @returns {boolean} 장군 여부
 */
function isKingInCheck(team) {
  const kingIdx = ((team === "cho") === iAmCho) ? 0 : 16;
  const kingX = pieces[kingIdx].x;
  const kingY = pieces[kingIdx].y;
  
  if (kingX === 0 && kingY === 0) return false;
  
  const opponentTeam = (team === "cho") ? "han" : "cho";
  const opponentMoves = getLegalMoves(opponentTeam);
  
  for (let m of opponentMoves) {
    if (m.x === kingX && m.y === kingY) {
      return true;
    }
  }
  return false;
}

/**
 * 자살수(착수 후 자신의 왕이 장군 상태가 되는 수)를 제외한 합법수 목록을 반환합니다.
 * In-place 좌표 백업/복원을 사용하여 불필요한 배열 복제(GC 부하)를 방지합니다.
 * @param {"cho"|"han"} team - 대상 진영
 * @returns {Array<{i: number, x: number, y: number}>} 합법수 배열
 */
function getFilteredLegalMoves(team) {
  const allMoves = getLegalMoves(team);
  const validMoves = [];
  
  for (let idx = 0; idx < allMoves.length; idx++) {
    const m = allMoves[idx];
    const origX = pieces[m.i].x;
    const origY = pieces[m.i].y;
    const targetPieceIdx = whoIsit(m.x, m.y);
    
    let capX = 0;
    let capY = 0;
    if (targetPieceIdx < NO_PIECE && targetPieceIdx !== m.i) {
      capX = pieces[targetPieceIdx].x;
      capY = pieces[targetPieceIdx].y;
      pieces[targetPieceIdx].x = 0;
      pieces[targetPieceIdx].y = 0;
    }
    
    pieces[m.i].x = m.x;
    pieces[m.i].y = m.y;
    
    const inCheck = isKingInCheck(team);
    
    pieces[m.i].x = origX;
    pieces[m.i].y = origY;
    if (targetPieceIdx < NO_PIECE && targetPieceIdx !== m.i) {
      pieces[targetPieceIdx].x = capX;
      pieces[targetPieceIdx].y = capY;
    }
    
    if (!inCheck) {
      validMoves.push(m);
    }
  }
  
  return validMoves;
}

/**
 * 현재 턴의 장군/외통수 여부를 검사하고 외통수일 경우 게임을 종료합니다.
 */
function checkGameStatus() {
  const turn = document.getElementById("turn");
  if (!turn) return;
  const curTurn = parseInt(turn.value, 10);
  
  const isChoTurn = (curTurn % 2 === 0);
  const currentTeam = isChoTurn ? "cho" : "han";
  
  const inCheck = isKingInCheck(currentTeam);
  const validMoves = getFilteredLegalMoves(currentTeam);
  
  if (validMoves.length === 0) {
    if (inCheck) {
      gameEnded = true;
      const winner = isChoTurn ? "한나라 (Red)" : "초나라 (Blue)";
      setTimeout(() => {
        alert(`외통수! ${winner}가 승리하였습니다!`);
      }, 100);
    }
  }
}

/**
 * 특정 진영의 모든 기물이 이동할 수 있는 기본 후보수 목록을 반환합니다.
 * @param {"cho"|"han"} team - 대상 진영
 * @returns {Array<{i: number, x: number, y: number}>} 후보수 목록
 */
function getLegalMoves(team) {
  const moves = [];
  
  const isCho = (team === "cho");
  const startIdx = (isCho === iAmCho) ? 0 : 16;
  const endIdx = (isCho === iAmCho) ? 15 : 31;
  
  for (let idx = startIdx; idx <= endIdx; idx++) {
    if (pieces[idx].x !== 0) {
      const pieceMoves = getCandidateMoves(idx);
      for (let k = 0; k < pieceMoves.length; k++) {
        moves.push({ i: idx, x: pieceMoves[k].x, y: pieceMoves[k].y });
      }
    }
  }
  
  return moves;
}

/**
 * 2-ply Minimax 탐색을 통해 AI의 최선 착수를 계산합니다.
 * @param {"cho"|"han"} aiTeam - AI 진영
 * @returns {{i: number, x: number, y: number}|null} 최선의 수 또는 null
 */
function getBestAIMove(aiTeam) {
  const isChoAI = (aiTeam === "cho");
  const aiMoves = getFilteredLegalMoves(aiTeam);
  
  if (aiMoves.length === 0) return null;
  
  let bestScore = isChoAI ? -Infinity : Infinity;
  let bestMoves = [];
  const opponentTeam = isChoAI ? "han" : "cho";
  
  for (let mIdx = 0; mIdx < aiMoves.length; mIdx++) {
    const aiMove = aiMoves[mIdx];
    // 1. AI 수 시뮬레이션 (In-place)
    const origX = pieces[aiMove.i].x;
    const origY = pieces[aiMove.i].y;
    const targetPieceIdx = whoIsit(aiMove.x, aiMove.y);
    
    let capX = 0;
    let capY = 0;
    if (targetPieceIdx < NO_PIECE && targetPieceIdx !== aiMove.i) {
      capX = pieces[targetPieceIdx].x;
      capY = pieces[targetPieceIdx].y;
      pieces[targetPieceIdx].x = 0;
      pieces[targetPieceIdx].y = 0;
    }
    
    pieces[aiMove.i].x = aiMove.x;
    pieces[aiMove.i].y = aiMove.y;
    
    // 2. 상대방의 최선 대응 수 예측 (Depth 2 Minimax)
    const opponentReplies = getFilteredLegalMoves(opponentTeam);
    
    let worstReplyScore = isChoAI ? Infinity : -Infinity;
    
    if (opponentReplies.length === 0) {
      worstReplyScore = isChoAI ? 999999 : -999999;
    } else {
      for (let rIdx = 0; rIdx < opponentReplies.length; rIdx++) {
        const reply = opponentReplies[rIdx];
        const replyOrigX = pieces[reply.i].x;
        const replyOrigY = pieces[reply.i].y;
        const replyTargetIdx = whoIsit(reply.x, reply.y);
        
        let replyCapX = 0;
        let replyCapY = 0;
        if (replyTargetIdx < NO_PIECE && replyTargetIdx !== reply.i) {
          replyCapX = pieces[replyTargetIdx].x;
          replyCapY = pieces[replyTargetIdx].y;
          pieces[replyTargetIdx].x = 0;
          pieces[replyTargetIdx].y = 0;
        }
        
        pieces[reply.i].x = reply.x;
        pieces[reply.i].y = reply.y;
        
        // 보드 점수 평가
        const score = evaluateBoard();
        
        // 상대방 수 롤백
        pieces[reply.i].x = replyOrigX;
        pieces[reply.i].y = replyOrigY;
        if (replyTargetIdx < NO_PIECE && replyTargetIdx !== reply.i) {
          pieces[replyTargetIdx].x = replyCapX;
          pieces[replyTargetIdx].y = replyCapY;
        }
        
        // 상대방(한/초)은 자신에게 가장 유리한 수(점수 최소화/최대화)를 선택함
        if (isChoAI) {
          if (score < worstReplyScore) {
            worstReplyScore = score;
          }
        } else {
          if (score > worstReplyScore) {
            worstReplyScore = score;
          }
        }
      }
    }
    
    // AI 수 롤백
    pieces[aiMove.i].x = origX;
    pieces[aiMove.i].y = origY;
    if (targetPieceIdx < NO_PIECE && targetPieceIdx !== aiMove.i) {
      pieces[targetPieceIdx].x = capX;
      pieces[targetPieceIdx].y = capY;
    }
    
    // 약간의 랜덤성(Jitter)을 주어 대국 양상의 다양성 확보 (동점일 때 다른 선택을 하도록 유도)
    const scoreWithJitter = worstReplyScore + (Math.random() - 0.5) * 0.1;
    
    if (isChoAI) {
      if (scoreWithJitter > bestScore) {
        bestScore = scoreWithJitter;
        bestMoves = [aiMove];
      } else if (Math.abs(scoreWithJitter - bestScore) < 0.01) {
        bestMoves.push(aiMove);
      }
    } else {
      if (scoreWithJitter < bestScore) {
        bestScore = scoreWithJitter;
        bestMoves = [aiMove];
      } else if (Math.abs(scoreWithJitter - bestScore) < 0.01) {
        bestMoves.push(aiMove);
      }
    }
  }
  
  if (bestMoves.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * bestMoves.length);
  return bestMoves[randomIndex];
}

/**
 * 현재 보드 상태의 정적 평가 점수(초 유리: 양수, 한 유리: 음수)를 계산합니다.
 * @returns {number} 보드 평가 점수
 */
function evaluateBoard() {
  let score = 0;
  
  for (let idx = 0; idx < 32; idx++) {
    if (pieces[idx].x !== 0) {
      const isChoPiece = (idx < 16) === iAmCho;
      const val = AI_PIECE_VALUES[idx % 16];
      score += isChoPiece ? val : -val;
      
      // 포지션 가치: X축은 중앙(x=5)에 가까울수록 가치 증가 (최대 2점)
      const xDist = Math.abs(pieces[idx].x - 5);
      const xBonus = (4 - xDist) * 0.5 * (isChoPiece ? 1 : -1);
      
      // Y축은 상대편 진영 방향으로 진격할수록 가치 증가 (최대 3점, 졸/병/마/상 전진성 유도)
      // rowIndex: 0(최상단, y=1) ~ 9(최하단, y=0)
      const rowIndex = (pieces[idx].y + 9) % 10;
      const dist = (idx < 16) ? (9 - rowIndex) : rowIndex;
      const yBonus = (dist / 3) * (isChoPiece ? 1 : -1);
      
      score += xBonus + yBonus;
    }
  }
  
  // 덤 (한나라 후수 1.5점 가중치 보정)
  score -= HAN_HANDICAP;
  
  return score;
}

/**
 * 상대 AI 모드를 토글합니다 (단축키 Z 등).
 */
function toggleOpponentAI() {
  if (aiMode !== 0) {
    aiMode = 0;
    showToast("상대 AI 모드 꺼짐");
  } else {
    aiMode = 1;
    showToast("상대 AI 모드 켜짐 (AI가 위쪽에서 플레이)");
  }
  localStorage.setItem("aiMode", aiMode);
  saveCurrentConfigToSlot();
  
  const aiModeSelect = document.getElementById("ai-mode-select");
  if (aiModeSelect) aiModeSelect.value = aiMode;
  
  checkAndRunAI(true);
}

/**
 * 현재 플레이어 턴에서 AI 훈수(최선수 추천 및 자동 착수)를 실행합니다 (단축키 X).
 */
function requestAIHint() {
  const turnEl = document.getElementById("turn");
  if (!turnEl) return;
  const curTurn = parseInt(turnEl.value, 10);
  const isChoTurn = (curTurn % 2 === 0);
  const isMyTurn = (isChoTurn === iAmCho);
  
  if (!isMyTurn) {
    showToast("내 턴이 아닙니다. (훈수는 내 턴에만 가능)");
    return;
  }
  
  const myTeam = iAmCho ? "cho" : "han";
  const bestMove = getBestAIMove(myTeam);
  if (bestMove) {
    showToast("AI 훈수 착수!");
    move(bestMove.i, bestMove.x, bestMove.y);
  } else {
    showToast("추천할 수 있는 합법적인 수가 없습니다.");
  }
}
