/**
 * @fileoverview 온라인 대국 중 기존 판 기능 감싸기.
 *  - move: 내 차례에 내 기물로 둔 수만 판에 두고 서버로 보낸다. 받은 수(olApplying)와 놓아보기(가지)는 그대로 통과.
 *  - selected: 상대 차례이거나 상대 기물이면 고르지 못하게 (놓아보기·지난 수 보기 중에는 그대로).
 *  - 판을 바꾸는 기능(새 대국·진영 바꾸기·기보 불러오기·유명 기보·AI 대국 켜기)은 방에 있는 동안 막는다.
 *  - 단, 시작 전(olInSetup) 오른쪽 서랍 '새 대국' 탭은 방 설정으로 이어진다:
 *    아래쪽 상차림 = 내 상차림(olSetMyCharim), 위쪽 상차림 = 상대 것(읽기 전용), 진영·제한 시간 = 방장만(olSetHostSettings),
 *    '새 대국 시작' 단추(N) = 방장은 시작(olStartGame), 상대는 준비/준비 풀기(olSetReady).
 *  - 관전 중에는 둘 수 없다 (놓아보기는 된다).
 *  - tickGameTimer: 온라인 대국 중에는 화면에 보이는 수순(#turn, 놓아보기 등)이 아니라 실제 기보 길이로 차례를 정해 시간을 잰다.
 * preview.js·threat-call.js가 DOMContentLoaded에서 감싼 뒤에 감싸야 하므로 그 파일들보다 뒤에 싣는다.
 * @module online/online-guard
 * @depends online/online-core, state, ai, main, ui, preview
 */

function olWrap(name, makeWrapper) {
  const orig = window[name];
  if (typeof orig !== "function") {
    console.warn(`[online] 감쌀 함수가 없습니다: ${name}`);
    return;
  }
  window[name] = makeWrapper(orig);
}

document.addEventListener("DOMContentLoaded", () => {
  olWrap("move", orig => function (i, x, y) {
    if (olApplying || olBypass || !olRoomId) return orig.apply(this, arguments);
    if (typeof isPreviewActive === "function" && isPreviewActive()) return orig.apply(this, arguments); // 놓아보기(가지)는 실제 대국과 상관없다
    if (typeof pvReviewingPast === "function" && pvReviewingPast()) {
      // 지난 국면에서 둔 수: preview.js는 "무르기"(본선 자르기)를 묻지만, 온라인 방에서는 본선을 서버만 바꾼다 → 바로 가지로
      if (typeof pvTakebackNow !== "undefined" && pvTakebackNow) return;
      if (typeof enterPreviewMode === "function" && enterPreviewMode("branch")) return previewPlayMove(i, x, y, "user");
      return;
    }
    if (olSpectating) {
      clearCandiBox();
      olToast("관전 중에는 둘 수 없습니다. 놓아보기로 수를 살펴볼 수 있습니다.");
      return;
    }
    if (!olGameActive()) {
      clearCandiBox();
      return;
    }
    if (!olIsMyTurn() || !olIsMyPiece(i)) {
      clearCandiBox();
      olToast("상대 차례입니다.");
      return;
    }
    if (olPending !== null) {
      clearCandiBox();
      olToast("앞 수를 보내는 중입니다.");
      return;
    }
    const before = log.length;
    const from = { x: pieces[i].x, y: pieces[i].y };
    const r = orig.apply(this, arguments);
    if (log.length === before + 1 && !olInPreview()) {
      if (olSynced.length === before) olSendMyMove(from, x, y);
      else olReconcile(); // 판과 서버가 어긋나 있으면 서버에 맞춘다
    }
    return r;
  });

  olWrap("selected", orig => function (i) {
    if (!olRoomId || olBypass || olInPreview()) return orig.apply(this, arguments);
    if (!olGameActive()) return;
    if (!olIsMyPiece(i)) return;
    if (!olIsMyTurn()) {
      olToast("상대 차례입니다.");
      return;
    }
    return orig.apply(this, arguments);
  });

  const lockMsg = "온라인 대국 방에 있는 동안은 쓸 수 없습니다. 왼쪽 서랍 온라인 대국에서 방을 나간 뒤에 해 주세요.";
  const setupFail = e => olToast(`방 설정을 바꾸지 못했습니다: ${olErrorText(e)}`, 3500);

  // ----- 시작 전 방 설정: '새 대국' 탭 → 방 -----
  olWrap("changeCharim", orig => function (group, type) {
    if (olBypass || !olLocked()) return orig.apply(this, arguments);
    if (!olInSetup()) {
      olToast(lockMsg, 3000);
      return;
    }
    if (Number(group) === 0) olSetMyCharim(Number(type)).catch(setupFail);
    else olToast("위쪽(상대) 상차림은 상대가 고릅니다.", 2600);
  });
  olWrap("toggleNation", orig => function () {
    if (olBypass || !olLocked()) return orig.apply(this, arguments);
    if (!olInSetup()) {
      olToast(lockMsg, 3000);
      return;
    }
    if (olAmHost()) olSetHostSettings({ side: olOther(olMySide) }).catch(setupFail);
    else olToast("진영은 방장이 정합니다. 방장이 고르고 남은 쪽이 내 진영입니다.", 3000);
  });
  olWrap("setTimeLimitMinutes", orig => function (value) {
    if (olBypass || !olLocked()) return orig.apply(this, arguments);
    const keep = () => olSyncTimeSelect(olRoom ? olRoom.timeLimitMin : timeLimitMinutes);
    if (olInSetup() && olAmHost()) {
      olSetHostSettings({ timeLimitMin: parseInt(value, 10) || 0 }).catch(e => {
        keep();
        setupFail(e);
      });
      return;
    }
    keep();
    olToast(olInSetup() ? "제한 시간은 방장이 정합니다." : lockMsg, 3000);
  });
  olWrap("startNewGame", orig => function () {
    if (olBypass || !olLocked()) return orig.apply(this, arguments);
    if (!olInSetup()) {
      olToast(lockMsg, 3000);
      return;
    }
    if (olAmHost()) {
      olStartGame().catch(e => olToast(`시작하지 못했습니다: ${olErrorText(e)}`, 3000));
    } else {
      olSetReady(!olRoom.ready).catch(setupFail);
    }
  });

  ["resetCategory1", "importRecordFromText", "loadSavedRecord", "loadFamousGame",
    "toggleOpponentAI", "changeAiMode", "setSideController", "startAutoplay"].forEach(name => {
    if (typeof window[name] !== "function") return;
    olWrap(name, orig => function () {
      if (olBypass || !olLocked()) return orig.apply(this, arguments);
      olToast(lockMsg, 3000);
      if (name === "setSideController" && typeof closeSideMenu === "function") closeSideMenu();
    });
  });

  olWrap("tickGameTimer", orig => function () {
    if (!olGameActive()) return orig.apply(this, arguments);
    if (gameEnded) return;
    if (olSideOfPly(log.length) === "cho") choTimeSpent++;
    else hanTimeSpent++;
    if (typeof hgUpdateTime === "function") hgUpdateTime();
  });
  // 이미 돌고 있는 타이머는 감싸기 전 함수를 붙잡고 있으므로 다시 건다
  if (typeof gameTimerInterval !== "undefined" && gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = setInterval(() => window.tickGameTimer(), 1000);
  }
});
