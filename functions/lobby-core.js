/**
 * @fileoverview 공개 대국 목록(열린 대국) 요약 규칙 (Cloud Functions와 가짜 백엔드·화면이 함께 쓴다).
 *  - 방 문서 games/janggi/rooms/{roomId}가 바뀔 때마다 요약 games/janggi/lobby/{roomId}를 다시 만든다
 *    (Cloud Functions syncLobby, 가짜 백엔드는 방을 쓸 때마다 같은 함수를 부른다).
 *  - 요약은 누구나(로그인 없이) 읽는다. 그래서 uid·이메일·채팅은 넣지 않고, 목록·관전에 필요한 칸만 둔다.
 *  - 비공개 방, 닫힌 방, 지워진 방은 요약이 없다(null → 지움).
 *  - 마지막 활동(activeAtMs, 방 문서가 마지막으로 바뀐 시각) 뒤 30분이 지나면 목록에서 빼고
 *    정리 함수(cleanupLobby)가 지운다. 목록은 최근 50개만 읽는다 (firestore.rules가 limit을 확인).
 * 브라우저에서는 window.LobbyCore, Node에서는 module.exports.
 * @module functions/lobby-core
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LobbyCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ROOT = "games/janggi";
  const STALE_MS = 30 * 60 * 1000; // 마지막 활동 뒤 30분이면 오래된 방
  const PAGE_LIMIT = 50; // 목록은 최근 50개만 읽는다 (firestore.rules lobby list와 같게)

  const paths = {
    room: id => `${ROOT}/rooms/${id}`,
    lobby: id => `${ROOT}/lobby/${id}`
  };

  const int = (v, min, max) => {
    const n = Number.isInteger(v) ? v : 0;
    return Math.max(min, Math.min(max, n));
  };
  const name = seat => (seat && typeof seat.name === "string" ? seat.name.slice(0, 40) : null);
  // 계정 구분표 (가린 이메일, online-core.js olEmailTag). 이름이 같은 다른 계정을 목록에서 구별한다
  const tag = seat => (seat && typeof seat.tag === "string" ? seat.tag.slice(0, 80) : "");

  /**
   * 방 문서 → 공개 요약. 목록에 둘 방이 아니면 null.
   * @param {Object|null} room - 방 문서 (없으면 null)
   * @param {string} roomId
   * @param {number} nowMs - 요약을 만드는 시각 (= 마지막 활동 시각)
   * @returns {Object|null}
   */
  function summarize(room, roomId, nowMs) {
    if (!room || room.app !== "janggi" || room.visibility !== "public") return null;
    if (!["waiting", "playing", "ended"].includes(room.status)) return null; // closed
    const seats = room.seats || {};
    const hostSide = seats.cho && seats.cho.uid === room.hostUid ? "cho" : "han";
    const openSide = !seats.cho ? "cho" : !seats.han ? "han" : null;
    const charim = room.charim || {};
    const clock = room.clock || {};
    const r = room.result;
    return {
      roomId,
      status: room.status,
      hostName: name(seats[hostSide]) || "",
      hostTag: tag(seats[hostSide]),
      hostSide,
      openSide,
      players: { cho: name(seats.cho), han: name(seats.han) },
      tags: { cho: tag(seats.cho), han: tag(seats.han) },
      charim: { cho: int(charim.cho, 0, 3), han: int(charim.han, 0, 3) },
      timeLimitMin: int(room.timeLimitMin, 0, 180),
      ply: int(room.ply, 0, 100000),
      clock: { cho: int(clock.cho, 0, 1e7), han: int(clock.han, 0, 1e7) },
      lastMoveAtMs: Number(room.lastMoveAtMs) || 0,
      startedAtMs: Number(room.startedAtMs) || 0,
      createdAtMs: Number(room.createdAtMs) || 0,
      result: r ? { winner: r.winner === "cho" || r.winner === "han" ? r.winner : null, reason: String(r.reason || "") } : null,
      activeAtMs: nowMs
    };
  }

  function isStale(summary, nowMs) {
    return !summary || !(summary.activeAtMs >= nowMs - STALE_MS);
  }

  /** 들어갈 수 있는 방 (기다리는 중, 빈 자리 있음) */
  function isOpen(summary) {
    return !!summary && summary.status === "waiting" && !!summary.openSide;
  }

  /** 관전할 수 있는 방 (공개, 대국 중) */
  function isLive(summary) {
    return !!summary && summary.status === "playing";
  }

  return { ROOT, STALE_MS, PAGE_LIMIT, paths, summarize, isStale, isOpen, isLive };
});
