/**
 * @fileoverview 점수판(Scoreboard) 순환, 대국 타이머, 수순 코멘트 말풍선, 자동 재생(Autoplay), 토스트 알림 모듈.
 * @module ui
 * @depends state, rules, board, ai, settings
 */

var scoreRotationInterval = null;
var scoreboardTimerInterval = null;
var currentScoreSlideIndex = 0;
var toastHideTimeout = null;

/**
 * 화면 상단에 1초간 토스트 알림 메시지를 표시합니다.
 * @param {string} message - 표시할 메시지
 */
function showToast(message) {
  let toast = document.getElementById("janggi-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "janggi-toast";
    toast.className = "janggi-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.offsetHeight; // Force reflow
  toast.classList.add("visible");
  
  if (toastHideTimeout) {
    clearTimeout(toastHideTimeout);
  }
  toastHideTimeout = setTimeout(() => {
    toast.classList.remove("visible");
  }, 1000);
}

/**
 * 점수판 슬라이드 순환 및 대국 타이머를 초기화합니다.
 */
function initScoreboardRotation() {
  applyScoreboardConfig();
  
  if (scoreboardTimerInterval) clearInterval(scoreboardTimerInterval);
  scoreboardTimerInterval = setInterval(() => {
    updateScoreboardTimer();
  }, 1000);
  
  choTimeSpent = 0;
  hanTimeSpent = 0;
}

/**
 * 활성화된 점수판 슬라이드 인덱스 목록(0~2)을 반환합니다.
 * @returns {number[]} 활성 슬라이드 번호 배열
 */
function getActiveSlides() {
  const active = [];
  if (scoreShowSlide1) active.push(0);
  if (scoreShowSlide2) active.push(1);
  if (scoreShowSlide3) active.push(2);
  if (active.length === 0) active.push(0);
  return active;
}

/**
 * 점수판 슬라이드 표시 여부 및 자동 순환 타이머 설정을 반영합니다.
 */
function applyScoreboardConfig() {
  const activeSlides = getActiveSlides();
  
  const dots = document.querySelectorAll(".score-dot");
  if (dots.length === 3) {
    dots[0].style.display = scoreShowSlide1 ? "inline-block" : "none";
    dots[1].style.display = scoreShowSlide2 ? "inline-block" : "none";
    dots[2].style.display = scoreShowSlide3 ? "inline-block" : "none";
  }
  
  if (!activeSlides.includes(currentScoreSlideIndex)) {
    setScoreSlide(activeSlides[0]);
  } else {
    setScoreSlide(currentScoreSlideIndex);
  }
}

/**
 * 점수판을 다음 활성 슬라이드로 전환합니다.
 */
function rotateScorePanel() {
  const activeSlides = getActiveSlides();
  if (activeSlides.length <= 1) {
    if (activeSlides.length === 1) {
      setScoreSlide(activeSlides[0]);
    }
    return;
  }
  const currIdxInActive = activeSlides.indexOf(currentScoreSlideIndex);
  const nextIdxInActive = (currIdxInActive + 1) % activeSlides.length;
  setScoreSlide(activeSlides[nextIdxInActive]);
}

/**
 * 지정한 인덱스의 점수판 슬라이드를 표시합니다.
 * @param {number} index - 슬라이드 인덱스 (0, 1, 2)
 */
function setScoreSlide(index) {
  currentScoreSlideIndex = index;
  const slides = document.querySelectorAll(".score-slide");
  const dots = document.querySelectorAll(".score-dot");
  
  slides.forEach((slide, i) => {
    if (i === index) {
      slide.classList.add("active");
    } else {
      slide.classList.remove("active");
    }
  });
  
  dots.forEach((dot, i) => {
    if (i === index) {
      dot.classList.add("active");
    } else {
      dot.classList.remove("active");
    }
  });
  
  const activeSlides = getActiveSlides();
  if (scoreRotationInterval) clearInterval(scoreRotationInterval);
  if (scoreAutoRotate && activeSlides.length > 1) {
    scoreRotationInterval = setInterval(() => {
      rotateScorePanel();
    }, scoreRotateInterval * 1000);
  }
}

/**
 * 설정창의 점수판 순환 옵션을 읽어 적용하고 저장합니다.
 */
function updateScoreboardSettings() {
  const autoRotateEl = document.getElementById("score-auto-rotate");
  const rotateIntervalEl = document.getElementById("score-rotate-interval");
  const showSlide1El = document.getElementById("score-show-slide1");
  const showSlide2El = document.getElementById("score-show-slide2");
  const showSlide3El = document.getElementById("score-show-slide3");
  
  if (autoRotateEl) scoreAutoRotate = (autoRotateEl.value === "true");
  if (rotateIntervalEl) scoreRotateInterval = parseInt(rotateIntervalEl.value, 10);
  if (showSlide1El) scoreShowSlide1 = showSlide1El.checked;
  if (showSlide2El) scoreShowSlide2 = showSlide2El.checked;
  if (showSlide3El) scoreShowSlide3 = showSlide3El.checked;
  
  applyScoreboardConfig();
  saveCurrentConfigToSlot();
}

/**
 * 매초 현재 턴 진영의 누적 대국 시간을 갱신하고 UI에 표시합니다.
 */
function updateScoreboardTimer() {
  if (gameEnded) return;
  
  const turnInput = document.getElementById("turn");
  if (!turnInput) return;
  const curTurn = parseInt(turnInput.value, 10);
  const isChoTurn = (curTurn % 2 === 0);
  
  if (isChoTurn) {
    choTimeSpent++;
  } else {
    hanTimeSpent++;
  }
  
  const formatTime = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
    const s = (totalSeconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };
  
  const choTimerVal = document.getElementById("cho-timer-val");
  const hanTimerVal = document.getElementById("han-timer-val");
  if (choTimerVal) choTimerVal.textContent = formatTime(choTimeSpent);
  if (hanTimerVal) hanTimerVal.textContent = formatTime(hanTimeSpent);
  
  const activeTurnDesc = document.getElementById("active-turn-timer-desc");
  if (activeTurnDesc) {
    activeTurnDesc.textContent = isChoTurn ? "초나라 (Blue) 차례" : "한나라 (Red) 차례";
    activeTurnDesc.style.color = isChoTurn ? "#60a5fa" : "#f87171";
  }
}

/**
 * 기보 관리 창의 메타데이터 입력 폼 값을 읽어 gameMetadata에 반영합니다.
 */
function updateMetadataFromForm() {
  const choEl = document.getElementById("meta-cho-player");
  const hanEl = document.getElementById("meta-han-player");
  const tourEl = document.getElementById("meta-tournament");
  const roundEl = document.getElementById("meta-round");
  const nickEl = document.getElementById("meta-nickname");
  const sumEl = document.getElementById("meta-summary");
  
  if (choEl) gameMetadata.choPlayer = choEl.value;
  if (hanEl) gameMetadata.hanPlayer = hanEl.value;
  if (tourEl) gameMetadata.tournament = tourEl.value;
  if (roundEl) gameMetadata.round = roundEl.value;
  if (nickEl) gameMetadata.nickname = nickEl.value;
  if (sumEl) gameMetadata.summary = sumEl.value;
  
  updateMetadataDisplay();
}

/**
 * gameMetadata 객체의 값을 기보 관리 창의 메타데이터 입력 폼에 동기화합니다.
 */
function updateMetadataFormFromState() {
  const choEl = document.getElementById("meta-cho-player");
  const hanEl = document.getElementById("meta-han-player");
  const tourEl = document.getElementById("meta-tournament");
  const roundEl = document.getElementById("meta-round");
  const nickEl = document.getElementById("meta-nickname");
  const sumEl = document.getElementById("meta-summary");
  
  if (choEl) choEl.value = gameMetadata.choPlayer || "";
  if (hanEl) hanEl.value = gameMetadata.hanPlayer || "";
  if (tourEl) tourEl.value = gameMetadata.tournament || "";
  if (roundEl) roundEl.value = gameMetadata.round || "";
  if (nickEl) nickEl.value = gameMetadata.nickname || "";
  if (sumEl) sumEl.value = gameMetadata.summary || "";
}

/**
 * 점수판 슬라이드 2의 대국자 및 대회명 표시 텍스트를 갱신합니다.
 */
function updateMetadataDisplay() {
  const tourDisp = document.getElementById("meta-tournament-display");
  const choDisp = document.getElementById("meta-cho-player-display");
  const hanDisp = document.getElementById("meta-han-player-display");
  
  if (tourDisp) {
    tourDisp.textContent = gameMetadata.tournament || (gameMetadata.nickname ? gameMetadata.nickname : "대회명 미지정");
  }
  if (choDisp) {
    choDisp.textContent = gameMetadata.choPlayer || "초나라";
  }
  if (hanDisp) {
    hanDisp.textContent = gameMetadata.hanPlayer || "한나라";
  }
}

/**
 * 기보 관리 창 내 현재 수순 코멘트 입력란의 변경사항을 log 배열에 저장합니다.
 */
function updateCurrentStepComment() {
  const turnInput = document.getElementById("turn");
  if (!turnInput) return;
  const curTurn = parseInt(turnInput.value, 10);
  if (curTurn <= 0) return;
  
  const commentInput = document.getElementById("current-step-comment");
  if (!commentInput) return;
  
  if (log[curTurn - 1]) {
    log[curTurn - 1].comment = commentInput.value;
    updateCommentBubble();
  }
}

/**
 * 현재 수순에 코멘트가 있으면 말풍선 오버레이를 표시하고 자동 숨김 타이머를 설정합니다.
 */
function updateCommentBubble() {
  const turnInput = document.getElementById("turn");
  if (!turnInput) return;
  const curTurn = parseInt(turnInput.value, 10);
  
  const bubble = document.getElementById("comment-bubble");
  const bubbleText = document.getElementById("comment-bubble-text");
  const commentFormInput = document.getElementById("current-step-comment");
  const commentTitle = document.getElementById("current-step-comment-title");
  
  if (commentTitle) {
    commentTitle.textContent = `현재 수순 (${curTurn}수) 코멘트`;
  }
  
  if (curTurn <= 0) {
    if (bubble) bubble.style.display = "none";
    if (commentFormInput) commentFormInput.value = "";
    return;
  }
  
  const currentMove = log[curTurn - 1];
  if (currentMove) {
    const comment = currentMove.comment || "";
    if (commentFormInput) {
      commentFormInput.value = comment;
    }
    
    if (comment.trim()) {
      if (bubbleText) bubbleText.textContent = comment;
      if (bubble) bubble.style.display = "block";
      applyCommentBoxTheme();
      
      // 코멘트 말풍선 자동 숨김 시간 설정 (0은 무제한)
      if (commentBubbleTimeout) {
        clearTimeout(commentBubbleTimeout);
        commentBubbleTimeout = null;
      }
      if (commentDisplayDuration > 0) {
        commentBubbleTimeout = setTimeout(() => {
          if (bubble) bubble.style.display = "none";
        }, commentDisplayDuration * 1000);
      }
    } else {
      if (bubble) bubble.style.display = "none";
      if (commentBubbleTimeout) {
        clearTimeout(commentBubbleTimeout);
        commentBubbleTimeout = null;
      }
    }
  } else {
    if (commentFormInput) commentFormInput.value = "";
    if (bubble) bubble.style.display = "none";
    if (commentBubbleTimeout) {
      clearTimeout(commentBubbleTimeout);
      commentBubbleTimeout = null;
    }
  }
}

/**
 * 기보 관리 창의 메타데이터 아코디언 섹션을 접거나 펼칩니다.
 * @param {Event} event - 클릭 이벤트
 */
function toggleMetadataCategory(event) {
  if (event && event.target && event.target.closest("button")) return;
  
  const category = document.getElementById("metadata-category");
  const content = document.getElementById("metadata-category-content");
  const arrow = document.getElementById("accordion-arrow");
  
  if (!category || !content) return;
  
  const isCollapsed = category.classList.contains("collapsed");
  
  if (isCollapsed) {
    category.classList.remove("collapsed");
    content.style.display = "block";
    if (arrow) arrow.style.transform = "rotate(180deg)";
  } else {
    category.classList.add("collapsed");
    content.style.display = "none";
    if (arrow) arrow.style.transform = "rotate(0deg)";
  }
}

/**
 * 설정창의 각 카테고리 아코디언 섹션을 접거나 펼칩니다.
 * @param {string} categoryId - 카테고리 DOM ID
 */
function toggleSettingCategory(categoryId) {
  const category = document.getElementById(categoryId);
  const content = document.getElementById(categoryId + "-content");
  let arrowId = "";
  if (categoryId === "board-view-category") arrowId = "board-view-arrow";
  else if (categoryId === "anim-category") arrowId = "anim-arrow";
  else if (categoryId === "settings-category") arrowId = "settings-arrow";
  
  const arrow = document.getElementById(arrowId);
  
  if (!category || !content) return;
  
  const isCollapsed = category.classList.contains("collapsed");
  
  if (isCollapsed) {
    category.classList.remove("collapsed");
    content.style.display = "block";
    if (arrow) arrow.style.transform = "rotate(180deg)";
  } else {
    category.classList.add("collapsed");
    content.style.display = "none";
    if (arrow) arrow.style.transform = "rotate(0deg)";
  }
}

var autoplayInterval = null;
var isAutoplayActive = false;

/**
 * 기보 자동 재생(Autoplay)을 켜거나 끕니다.
 */
function toggleAutoplay() {
  if (isAutoplayActive) {
    stopAutoplay();
  } else {
    startAutoplay();
  }
}

/**
 * 기보 자동 재생을 시작합니다.
 */
function startAutoplay() {
  if (isAutoplayActive) return;
  const turnEl = document.getElementById("turn");
  if (!turnEl) return;
  const curTurn = parseInt(turnEl.value, 10);
  if (curTurn >= log.length) {
    showToast("이미 마지막 수순입니다.");
    return;
  }
  isAutoplayActive = true;
  showToast("자동 재생 시작");
  updateAutoplayUI();
  
  autoplayInterval = setInterval(() => {
    const turnNow = parseInt(turnEl.value, 10);
    if (turnNow < log.length) {
      if (!autoplayUseAnim) {
        svg.classList.add("no-transition");
      }
      next();
      if (!autoplayUseAnim) {
        svg.offsetHeight; // force reflow
        svg.classList.remove("no-transition");
      }
    } else {
      stopAutoplay();
      showToast("자동 재생 완료");
    }
  }, autoplaySpeed * 1000);
}

/**
 * 기보 자동 재생을 정지합니다.
 */
function stopAutoplay() {
  if (!isAutoplayActive) return;
  isAutoplayActive = false;
  if (autoplayInterval) {
    clearInterval(autoplayInterval);
    autoplayInterval = null;
  }
  showToast("자동 재생 정지");
  updateAutoplayUI();
}

/**
 * 자동 재생 버튼의 아이콘(재생/일시정지)을 상태에 맞게 업데이트합니다.
 */
function updateAutoplayUI() {
  const playBtn = document.getElementById("nav-play-btn");
  if (playBtn) {
    if (isAutoplayActive) {
      playBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      `;
      playBtn.title = "자동 재생 일시정지 (P)";
    } else {
      playBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6,4 20,12 6,20"/>
        </svg>
      `;
      playBtn.title = "자동 재생 시작 (P)";
    }
  }
}

/**
 * 대국의 맨 처음(0수) 상태로 이동합니다.
 */
function goToStart() {
  clearCandiBox();
  const startingLayoutCode = getStartingLayoutCode();
  applyLayoutCode(startingLayoutCode);
  curSelect = NO_PIECE;
  const selectBox = document.getElementById("select-box");
  if (selectBox) {
    selectBox.setAttribute("x", HIDDEN_COORD);
    selectBox.setAttribute("y", HIDDEN_COORD);
  }
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.value = 0;
  updateScore();
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") {
    updateRecordUI();
  }
  updateCommentBubble();
  document.getElementById("prev").disabled = true;
  document.getElementById("next").disabled = (log.length === 0);
  
  svg.classList.add("no-transition");
  initPositions();
  svg.offsetHeight; // Force reflow
  svg.classList.remove("no-transition");
  
  checkAndRunAI();
}

/**
 * 대국의 마지막 수순 상태로 즉시 이동합니다.
 */
function goToEnd() {
  clearCandiBox();
  const turnEl = document.getElementById("turn");
  if (!turnEl) return;
  
  turnEl.value = log.length;
  curSelect = NO_PIECE;
  
  svg.classList.add("no-transition");
  initPositions();
  
  const lastMove = log[log.length - 1];
  if (lastMove) {
    moveSelectBox(lastMove.i);
  }
  document.getElementById("next").disabled = true;
  if (log.length > 0) {
    document.getElementById("prev").disabled = false;
  }
  updateScore();
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex") {
    updateRecordUI();
  }
  svg.offsetHeight; // Force reflow
  svg.classList.remove("no-transition");
  
  checkGameStatus();
  updateCommentBubble();
  checkAndRunAI();
}

/**
 * 자동 재생 간격(초)을 변경합니다.
 * @param {string|number} val - 재생 간격(초)
 */
function changeAutoplaySpeed(val) {
  autoplaySpeed = parseFloat(val);
  const valEl = document.getElementById("autoplay-speed-val");
  if (valEl) valEl.textContent = autoplaySpeed.toFixed(1);
  
  if (isAutoplayActive) {
    stopAutoplay();
    startAutoplay();
  }
  saveCurrentConfigToSlot();
}

/**
 * 자동 재생 시 착수 애니메이션 사용 여부를 변경합니다.
 * @param {boolean} checked - 애니메이션 사용 여부
 */
function changeAutoplayUseAnim(checked) {
  autoplayUseAnim = checked;
  saveCurrentConfigToSlot();
}

/**
 * 현재 수순 코멘트 편집 모달을 엽니다.
 */
function openCommentModal() {
  const turnInput = document.getElementById("turn");
  if (!turnInput) return;
  const curTurn = parseInt(turnInput.value, 10);
  if (curTurn <= 0) {
    showToast("코멘트를 입력할 수순이 없습니다. (0수 상태)");
    return;
  }
  
  const title = document.getElementById("comment-modal-title");
  if (title) title.textContent = `현재 수순 (${curTurn}수) 코멘트 편집`;
  
  const currentMove = log[curTurn - 1];
  const textarea = document.getElementById("comment-modal-textarea");
  if (textarea && currentMove) {
    textarea.value = currentMove.comment || "";
  }
  
  const commentBgPicker = document.getElementById("comment-bg-picker");
  if (commentBgPicker) commentBgPicker.value = commentBoxBgColor;
  
  const commentOpacitySlider = document.getElementById("comment-opacity-slider");
  if (commentOpacitySlider) commentOpacitySlider.value = commentBoxOpacity;
  
  const commentOpacityVal = document.getElementById("comment-opacity-val");
  if (commentOpacityVal) commentOpacityVal.textContent = commentBoxOpacity.toFixed(2);
  
  const commentModal = document.getElementById("comment-modal");
  if (commentModal) {
    commentModal.style.display = "flex";
    applyCommentBoxTheme();
    setTimeout(() => {
      commentModal.classList.add("open");
      if (textarea) textarea.focus();
    }, 10);
  }
}

/**
 * 코멘트 편집 모달을 닫습니다.
 */
function closeCommentModal() {
  const commentModal = document.getElementById("comment-modal");
  if (commentModal) {
    commentModal.classList.remove("open");
    setTimeout(() => {
      commentModal.style.display = "none";
    }, 300);
  }
}

/**
 * 코멘트 편집 모달에서 입력한 내용을 현재 수순에 저장하고 닫습니다.
 */
function saveCommentModal() {
  const turnInput = document.getElementById("turn");
  if (!turnInput) return;
  const curTurn = parseInt(turnInput.value, 10);
  if (curTurn <= 0) return;
  
  const textarea = document.getElementById("comment-modal-textarea");
  if (textarea && log[curTurn - 1]) {
    log[curTurn - 1].comment = textarea.value;
    
    // 동기화: 메타데이터 창의 입력 필드도 갱신
    const commentFormInput = document.getElementById("current-step-comment");
    if (commentFormInput) {
      commentFormInput.value = textarea.value;
    }
    
    updateCommentBubble();
    showToast(`${curTurn}수 코멘트가 저장되었습니다.`);
  }
  closeCommentModal();
}

/**
 * 코멘트 모달 오버레이 배경 클릭 시 모달을 닫습니다.
 * @param {MouseEvent} e - 클릭 이벤트
 */
function handleCommentModalOverlayClick(e) {
  if (e.target.id === "comment-modal") {
    closeCommentModal();
  }
}

/**
 * 코멘트 창 배경색을 변경합니다.
 * @param {string} color - HEX 색상
 */
function changeCommentBgColor(color) {
  commentBoxBgColor = color;
  const picker = document.getElementById("comment-bg-picker");
  if (picker) picker.value = color;
  applyCommentBoxTheme();
  saveCurrentConfigToSlot();
}

/**
 * 코멘트 창 불투명도를 변경합니다.
 * @param {string|number} opacity - 0.1 ~ 1.0 불투명도
 */
function changeCommentOpacity(opacity) {
  commentBoxOpacity = parseFloat(opacity);
  const slider = document.getElementById("comment-opacity-slider");
  if (slider) slider.value = opacity;
  const valDisp = document.getElementById("comment-opacity-val");
  if (valDisp) valDisp.textContent = commentBoxOpacity.toFixed(2);
  applyCommentBoxTheme();
  saveCurrentConfigToSlot();
}

/**
 * 코멘트 모달 및 말풍선 오버레이에 배경색과 불투명도 테마를 적용합니다.
 */
function applyCommentBoxTheme() {
  const rgba = hexToRgba(commentBoxBgColor, commentBoxOpacity);
  const commentModalContent = document.querySelector("#comment-modal .modal-content");
  if (commentModalContent) {
    commentModalContent.style.background = rgba;
    commentModalContent.style.backdropFilter = "blur(12px)";
  }
  
  const commentBubble = document.getElementById("comment-bubble");
  if (commentBubble) {
    commentBubble.style.background = rgba;
    commentBubble.style.backdropFilter = "blur(12px)";
    commentBubble.style.border = `1px solid ${commentBoxBgColor}`;
  }
}

/**
 * 코멘트 말풍선 자동 숨김 시간(초)을 변경합니다.
 * @param {string|number} val - 표시 시간(초, 0=무제한)
 */
function changeCommentDuration(val) {
  commentDisplayDuration = parseInt(val, 10);
  if (isNaN(commentDisplayDuration) || commentDisplayDuration < 0) {
    commentDisplayDuration = 0;
  }
  const input = document.getElementById("comment-duration-input");
  if (input) input.value = commentDisplayDuration;
  saveCurrentConfigToSlot();
  
  updateCommentBubble();
  showToast(`코멘트 표시 시간이 ${commentDisplayDuration === 0 ? "무제한" : commentDisplayDuration + "초"}으로 설정되었습니다.`);
}

/**
 * 코멘트 말풍선을 즉시 숨깁니다.
 */
function hideCommentBubble() {
  const bubble = document.getElementById("comment-bubble");
  if (bubble) bubble.style.display = "none";
  if (commentBubbleTimeout) {
    clearTimeout(commentBubbleTimeout);
    commentBubbleTimeout = null;
  }
}
