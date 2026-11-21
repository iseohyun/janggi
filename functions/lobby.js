/**
 * @fileoverview 공개 대국 목록(lobby) 동기화·정리 본체. Firebase 패키지에 기대지 않아 Node 테스트로 바로 돌릴 수 있다.
 *  - syncLobby(roomId, after): 방 문서가 바뀐 뒤 요약을 쓰거나(공개·대국 전/중/끝) 지운다(비공개·닫힘·지워짐).
 *  - cleanupLobby(): 마지막 활동 뒤 30분이 지난 요약을 지운다 (예약 함수가 10분마다).
 * 요약 모양은 functions/lobby-core.js. index.js가 Firestore 저장소를 넣어 준다.
 *  store: { set(path, data), del(path), staleIds(beforeMs, max) → [roomId] }
 * @module functions/lobby
 */
const core = require("./lobby-core");

function makeLobby({ store, now, log }) {
  async function syncLobby(roomId, after) {
    const summary = core.summarize(after, roomId, now());
    if (summary) await store.set(core.paths.lobby(roomId), summary);
    else await store.del(core.paths.lobby(roomId));
    return summary;
  }

  async function cleanupLobby(max = 300) {
    const ids = await store.staleIds(now() - core.STALE_MS, max);
    for (const id of ids) await store.del(core.paths.lobby(id));
    if (ids.length && log) log.info(`[cleanupLobby] 오래된 요약 ${ids.length}개를 지웠습니다`);
    return ids.length;
  }

  return { syncLobby, cleanupLobby };
}

module.exports = { makeLobby };
