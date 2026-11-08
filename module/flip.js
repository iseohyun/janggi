/**
 * @fileoverview 장기판 좌우반전 및 상하 180도 회전 3단계 애니메이션 및 수순 좌표 변환 모듈.
 * @module flip
 * @depends state, rules, board
 */

/**
 * 장기판을 좌우로 반전시키는 3단계 애니메이션 및 상태 변환을 수행합니다.
 */
function flipBoardHorizontal() {
  const boardSvg = document.getElementById("janggi-svg");
  if (!boardSvg || boardAnimating) return;
  
  boardAnimating = true;
  
  const startPositions = [];
  for (let i = 0; i < 32; i++) {
    startPositions[i] = { x: pieces[i].x, y: pieces[i].y };
  }
  const oldKbCursorX = kbCursorX;
  const oldKbCursorY = kbCursorY;
  
  // Stage 1: Board flips horizontally (0ms -> 500ms)
  boardSvg.style.transformOrigin = `${boardWidth / 2}px ${boardHeight / 2}px`;
  boardSvg.classList.add("flip-h-anim");
  
  setTimeout(() => {
    // Stage 2: Pieces rotate 180deg in place (500ms -> 1000ms)
    flipActive = true;
    
    for (let i = 0; i < 32; i++) {
      if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
        const startPos = startPositions[i];
        const ratio = getPieceSizeRatio(i);
        const sizeVal = unitSize * ratio;
        const ax = getAxis(startPos.x, startPos.y).x - sizeVal / 2;
        const ay = getAxis(startPos.x, startPos.y).y - sizeVal / 2;
        
        pieces[i].e.style.transition = "none";
        pieces[i].e.style.transformOrigin = `${sizeVal / 2}px ${sizeVal / 2}px`;
        pieces[i].e.style.transform = `translate(${ax}px, ${ay}px) scaleX(1)`;
        pieces[i].e.classList.add("smooth-move-anim");
      }
    }
    
    const cursor = document.getElementById("kb-cursor");
    if (cursor && kbCursorActive) {
      const sizeVal = unitSize * 0.85;
      const ax = getAxis(oldKbCursorX, oldKbCursorY).x - sizeVal / 2;
      const ay = getAxis(oldKbCursorX, oldKbCursorY).y - sizeVal / 2;
      
      cursor.style.transition = "none";
      cursor.style.transformOrigin = `${sizeVal / 2}px ${sizeVal / 2}px`;
      cursor.style.transform = `translate(${ax}px, ${ay}px) scaleX(1)`;
      cursor.classList.add("smooth-move-anim");
    }
    
    document.body.offsetHeight; // Force reflow
    
    // Trigger Stage 2: Rotate 180deg in place
    for (let i = 0; i < 32; i++) {
      if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
        const startPos = startPositions[i];
        const ratio = getPieceSizeRatio(i);
        const sizeVal = unitSize * ratio;
        const ax = getAxis(startPos.x, startPos.y).x - sizeVal / 2;
        const ay = getAxis(startPos.x, startPos.y).y - sizeVal / 2;
        
        pieces[i].e.style.transition = "";
        pieces[i].e.style.transform = `translate(${ax}px, ${ay}px) scaleX(-1)`;
      }
    }
    
    if (cursor && kbCursorActive) {
      const sizeVal = unitSize * 0.85;
      const ax = getAxis(oldKbCursorX, oldKbCursorY).x - sizeVal / 2;
      const ay = getAxis(oldKbCursorX, oldKbCursorY).y - sizeVal / 2;
      
      cursor.style.transition = "";
      cursor.style.transform = `translate(${ax}px, ${ay}px) scaleX(-1)`;
    }
    
    setTimeout(() => {
      // Stage 3: Pieces slide to target positions (1000ms -> 1500ms)
      for (let i = 0; i < 32; i++) {
        if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
          const startPos = startPositions[i];
          const finalLogicalPos = { x: 10 - startPos.x, y: startPos.y };
          const axisStart = getAxis(startPos.x, startPos.y);
          const axisEnd = getAxis(finalLogicalPos.x, finalLogicalPos.y);
          
          const ratio = getPieceSizeRatio(i);
          const sizeVal = unitSize * ratio;
          const ax = axisStart.x - sizeVal / 2;
          const ay = axisStart.y - sizeVal / 2;
          
          const dx = (boardWidth - axisEnd.x - axisStart.x) / 2;
          const dy = 0;
          
          pieces[i].e.style.transform = `translate(${ax + 2 * dx}px, ${ay + 2 * dy}px) scaleX(-1)`;
        }
      }
      
      if (cursor && kbCursorActive) {
        const sizeVal = unitSize * 0.85;
        const axisStart = getAxis(oldKbCursorX, oldKbCursorY);
        const axisEnd = getAxis(10 - oldKbCursorX, oldKbCursorY);
        const ax = axisStart.x - sizeVal / 2;
        const ay = axisStart.y - sizeVal / 2;
        
        const dx = (boardWidth - axisEnd.x - axisStart.x) / 2;
        const dy = 0;
        
        cursor.style.transform = `translate(${ax + 2 * dx}px, ${ay + 2 * dy}px) scaleX(-1)`;
      }
      
      setTimeout(() => {
        executeFlipBoardHorizontal();
        
        boardSvg.classList.remove("flip-h-anim");
        boardSvg.style.transformOrigin = "";
        for (let i = 0; i < 32; i++) {
          pieces[i].e.style.transformOrigin = "";
          pieces[i].e.style.transform = "";
          pieces[i].e.classList.remove("smooth-move-anim");
        }
        if (cursor) {
          cursor.style.transformOrigin = "";
          cursor.style.transform = "";
          cursor.classList.remove("smooth-move-anim");
        }
        
        flipActive = false;
        
        initPositions();
        if (kbCursorActive) updateKeyboardCursor();
        
        boardAnimating = false;
      }, 500); // Phase 3 duration
      
    }, 500); // Phase 2 duration
    
  }, 500); // Phase 1 duration
}

/**
 * 좌우 반전 후 논리적 기물 위치, 기보 로그, URL 파라미터를 동기화합니다.
 */
function executeFlipBoardHorizontal() {
  // 1. Flip initPieces
  for (let i = 0; i < 32; i++) {
    if (initPieces[i].x !== 0) {
      initPieces[i].x = 10 - initPieces[i].x;
    }
  }
  // 2. Reset pieces to initPieces
  for (let i = 0; i < 32; i++) {
    pieces[i].x = initPieces[i].x;
    pieces[i].y = initPieces[i].y;
  }
  // 3. Flip log entries
  log.forEach(entry => {
    entry.x = 10 - entry.x;
  });
  // 4. Flip cursor position
  kbCursorX = 10 - kbCursorX;
  
  // 5. Clear select and candidates
  curSelect = NO_PIECE;
  clearCandiBox();
  
  // Mirror newGameState layouts horizontally (0 <-> 3, 1 <-> 1, 2 <-> 2)
  const mirrorMap = { 0: 3, 1: 1, 2: 2, 3: 0 };
  newGameState[0] = mirrorMap[newGameState[0]];
  newGameState[1] = mirrorMap[newGameState[1]];
  syncCharimButtonStyles();
  
  // 6. Redraw
  initPositions();
  
  // 7. Update URL search params to match new state
  const url = new URL(window.location.href);
  const pCodeArr = new Array(32);
  for (let i = 0; i < 32; i++) {
    pCodeArr[i] = `${initPieces[i].x}${initPieces[i].y}`;
  }
  url.searchParams.set("p", pCodeArr.join(""));
  
  const logStrArr = log.map(entry => {
    return `${entry.i}${coordToChar(entry.x)}${coordToChar(entry.y)}${entry.t !== NO_PIECE ? entry.t : ""}`;
  });
  if (logStrArr.length > 0) {
    url.searchParams.set("log", logStrArr.join(","));
  }
  window.history.replaceState({}, "", url.toString());

  // Update record textbox UI immediately
  updateRecordUI();

  showToast("판 좌우 반전 및 기존 수순 변환 완료");
}

/**
 * 장기판을 상하좌우(180도)로 회전시키는 3단계 애니메이션 및 상태 변환을 수행합니다.
 */
function flipBoardVertical() {
  const boardSvg = document.getElementById("janggi-svg");
  if (!boardSvg || boardAnimating) return;
  
  boardAnimating = true;
  
  const startPositions = [];
  for (let i = 0; i < 32; i++) {
    startPositions[i] = { x: pieces[i].x, y: pieces[i].y };
  }
  const oldKbCursorX = kbCursorX;
  const oldKbCursorY = kbCursorY;
  
  // Stage 1: Board spins (0ms -> 500ms)
  boardSvg.style.transformOrigin = `${boardWidth / 2}px ${boardHeight / 2}px`;
  boardSvg.classList.add("rotate-180-anim");
  
  setTimeout(() => {
    // Stage 2: Pieces rotate 180deg in place (500ms -> 1000ms)
    rotateActive = true;
    
    for (let i = 0; i < 32; i++) {
      if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
        const startPos = startPositions[i];
        const ratio = getPieceSizeRatio(i);
        const sizeVal = unitSize * ratio;
        const ax = getAxis(startPos.x, startPos.y).x - sizeVal / 2;
        const ay = getAxis(startPos.x, startPos.y).y - sizeVal / 2;
        
        pieces[i].e.style.transition = "none";
        pieces[i].e.style.transformOrigin = `${sizeVal / 2}px ${sizeVal / 2}px`;
        pieces[i].e.style.transform = `translate(${ax}px, ${ay}px) rotate(0deg)`;
        pieces[i].e.classList.add("smooth-move-anim");
      }
    }
    
    const cursor = document.getElementById("kb-cursor");
    if (cursor && kbCursorActive) {
      const sizeVal = unitSize * 0.85;
      const ax = getAxis(oldKbCursorX, oldKbCursorY).x - sizeVal / 2;
      const ay = getAxis(oldKbCursorX, oldKbCursorY).y - sizeVal / 2;
      
      cursor.style.transition = "none";
      cursor.style.transformOrigin = `${sizeVal / 2}px ${sizeVal / 2}px`;
      cursor.style.transform = `translate(${ax}px, ${ay}px) rotate(0deg)`;
      cursor.classList.add("smooth-move-anim");
    }
    
    document.body.offsetHeight; // Force reflow
    
    // Trigger Stage 2: Rotate 180deg in place
    for (let i = 0; i < 32; i++) {
      if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
        const startPos = startPositions[i];
        const ratio = getPieceSizeRatio(i);
        const sizeVal = unitSize * ratio;
        const ax = getAxis(startPos.x, startPos.y).x - sizeVal / 2;
        const ay = getAxis(startPos.x, startPos.y).y - sizeVal / 2;
        
        pieces[i].e.style.transition = "";
        pieces[i].e.style.transform = `translate(${ax}px, ${ay}px) rotate(-180deg)`;
      }
    }
    
    if (cursor && kbCursorActive) {
      const sizeVal = unitSize * 0.85;
      const ax = getAxis(oldKbCursorX, oldKbCursorY).x - sizeVal / 2;
      const ay = getAxis(oldKbCursorX, oldKbCursorY).y - sizeVal / 2;
      
      cursor.style.transition = "";
      cursor.style.transform = `translate(${ax}px, ${ay}px) rotate(-180deg)`;
    }
    
    setTimeout(() => {
      // Stage 3: Pieces slide to target positions (1000ms -> 1500ms)
      for (let i = 0; i < 32; i++) {
        if (pieces[i].x !== 0 && startPositions[i].x !== 0) {
          const startPos = startPositions[i];
          const finalLogicalPos = {
            x: 10 - startPos.x,
            y: flipYCoordinate(startPos.y)
          };
          const axisStart = getAxis(startPos.x, startPos.y);
          const axisEnd = getAxis(finalLogicalPos.x, finalLogicalPos.y);
          const ratio = getPieceSizeRatio(i);
          const sizeVal = unitSize * ratio;
          const ax = axisStart.x - sizeVal / 2;
          const ay = axisStart.y - sizeVal / 2;
          
          const dx = (boardWidth - axisEnd.x - axisStart.x) / 2;
          const dy = (boardHeight - axisEnd.y - axisStart.y) / 2;
          
          pieces[i].e.style.transform = `translate(${ax + 2 * dx}px, ${ay + 2 * dy}px) rotate(-180deg)`;
        }
      }
      
      if (cursor && kbCursorActive) {
        const sizeVal = unitSize * 0.85;
        const axisStart = getAxis(oldKbCursorX, oldKbCursorY);
        const axisEnd = getAxis(10 - oldKbCursorX, flipYCoordinate(oldKbCursorY));
        const ax = axisStart.x - sizeVal / 2;
        const ay = axisStart.y - sizeVal / 2;
        
        const dx = (boardWidth - axisEnd.x - axisStart.x) / 2;
        const dy = (boardHeight - axisEnd.y - axisStart.y) / 2;
        
        cursor.style.transform = `translate(${ax + 2 * dx}px, ${ay + 2 * dy}px) rotate(-180deg)`;
      }
      
      setTimeout(() => {
        executeFlipBoardVertical();
        
        boardSvg.classList.remove("rotate-180-anim");
        boardSvg.style.transformOrigin = "";
        for (let i = 0; i < 32; i++) {
          pieces[i].e.style.transformOrigin = "";
          pieces[i].e.style.transform = "";
          pieces[i].e.classList.remove("smooth-move-anim");
        }
        if (cursor) {
          cursor.style.transformOrigin = "";
          cursor.style.transform = "";
          cursor.classList.remove("smooth-move-anim");
        }
        rotateActive = false;
        
        initPositions();
        if (kbCursorActive) updateKeyboardCursor();
        
        boardAnimating = false;
      }, 500); // Phase 3 duration
      
    }, 500); // Phase 2 duration
    
  }, 500); // Phase 1 duration
}

/**
 * 180도 회전 후 논리적 기물 위치, 진영(iAmCho), 기보 로그, URL 파라미터를 동기화합니다.
 */
function executeFlipBoardVertical() {
  // 1. Flip and swap initPieces Y coordinates and X coordinates (0-15 <-> 16-31)
  for (let i = 0; i < 16; i++) {
    const p1 = initPieces[i];
    const p2 = initPieces[i + 16];
    
    const y1Flipped = (p1.x !== 0 || p1.y !== 0) ? flipYCoordinate(p1.y) : p1.y;
    const y2Flipped = (p2.x !== 0 || p2.y !== 0) ? flipYCoordinate(p2.y) : p2.y;
    
    const tempX = p1.x;
    const tempY = y1Flipped;
    
    p1.x = p2.x;
    p1.y = y2Flipped;
    
    p2.x = tempX;
    p2.y = tempY;
  }
  // 2. Reset pieces to initPieces
  for (let i = 0; i < 32; i++) {
    pieces[i].x = initPieces[i].x;
    pieces[i].y = initPieces[i].y;
  }
  // 3. Flip and swap log entries
  log.forEach(entry => {
    entry.y = flipYCoordinate(entry.y);
    entry.i = (entry.i + 16) % 32;
    if (entry.t !== NO_PIECE) {
      entry.t = (entry.t + 16) % 32;
    }
  });
  // 4. Flip cursor position
  kbCursorY = flipYCoordinate(kbCursorY);
  
  // 5. Clear select and candidates
  curSelect = NO_PIECE;
  clearCandiBox();
  
  // Swap newGameState layouts vertically (bottom <-> top)
  const tempLayout = newGameState[0];
  newGameState[0] = newGameState[1];
  newGameState[1] = tempLayout;
  
  // Mirror newGameState layouts horizontally (0 <-> 3, 1 <-> 1, 2 <-> 2)
  const mirrorMap = { 0: 3, 1: 1, 2: 2, 3: 0 };
  newGameState[0] = mirrorMap[newGameState[0]];
  newGameState[1] = mirrorMap[newGameState[1]];
  
  syncCharimButtonStyles();
  
  // 6. Toggle iAmCho (the human plays the other team now, bottom side)
  iAmCho = !iAmCho;
  changeNation(iAmCho);
  
  // 7. AI takes the top side
  if (aiMode !== 0) {
    aiMode = 1;
    localStorage.setItem("aiMode", aiMode);
    const aiModeSelect = document.getElementById("ai-mode-select");
    if (aiModeSelect) aiModeSelect.value = aiMode;
  }
  
  // 8. Flip X coords of initPieces (180deg = vertical flip + horizontal flip)
  for (let i = 0; i < 32; i++) {
    if (initPieces[i].x !== 0) {
      initPieces[i].x = 10 - initPieces[i].x;
    }
  }
  // Reset pieces to initPieces again
  for (let i = 0; i < 32; i++) {
    pieces[i].x = initPieces[i].x;
    pieces[i].y = initPieces[i].y;
  }
  // Flip log entries X coords
  log.forEach(entry => {
    entry.x = 10 - entry.x;
  });
  // Flip cursor X
  kbCursorX = 10 - kbCursorX;

  // 9. Redraw
  initPositions();
  
  // 10. Update URL search params to match new state
  const url = new URL(window.location.href);
  const pCodeArr = new Array(32);
  for (let i = 0; i < 32; i++) {
    pCodeArr[i] = `${initPieces[i].x}${initPieces[i].y}`;
  }
  url.searchParams.set("p", pCodeArr.join(""));
  url.searchParams.set("cho", iAmCho ? "Y" : "N");
  
  const logStrArr = log.map(entry => {
    return `${entry.i}${coordToChar(entry.x)}${coordToChar(entry.y)}${entry.t !== NO_PIECE ? entry.t : ""}`;
  });
  if (logStrArr.length > 0) {
    url.searchParams.set("log", logStrArr.join(","));
  }
  window.history.replaceState({}, "", url.toString());

  // Update record textbox UI immediately
  updateRecordUI();

  showToast("판 180도 회전 및 기존 수순 변환 완료 (AI 위쪽 자동 할당)");

  // 11. Run AI if it's now the AI's turn
  checkAndRunAI();
}
