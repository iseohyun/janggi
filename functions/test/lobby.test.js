/**
 * 공개 대국 목록(lobby-core.js 요약 규칙 + lobby.js 동기화·정리)을 메모리 저장소·가짜 시계로 시험한다.
 * 실행: functions 폴더에서 `npm test` 또는 `node --test` (Firebase 패키지 없이 돈다)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../lobby-core");
const { makeLobby } = require("../lobby");

const T0 = Date.parse("2026-11-21T03:00:00Z");

function room(over = {}) {
  return Object.assign({
    app: "janggi", v: 2, visibility: "public", hostUid: "host", status: "waiting", ready: false,
    seats: { cho: { uid: "host", name: "방장" }, han: null }, members: ["host"],
    charim: { cho: 2, han: 0 }, timeLimitMin: 10, sidePick: "cho", ply: 0, clock: { cho: 0, han: 0 },
    createdAtMs: T0, lastMoveAtMs: T0, startedAtMs: 0, undo: null, result: null
  }, over);
}

function setup() {
  const docs = new Map();
  const clock = { t: T0 };
  const lobby = makeLobby({
    store: {
      set: async (p, d) => docs.set(p, JSON.parse(JSON.stringify(d))),
      del: async p => docs.delete(p),
      staleIds: async (before, max) => [...docs.entries()]
        .filter(([p, d]) => p.startsWith(`${core.ROOT}/lobby/`) && d.activeAtMs < before)
        .slice(0, max).map(([p]) => p.split("/").pop())
    },
    now: () => clock.t
  });
  return { docs, clock, lobby };
}

test("공개 기다리는 방: 방장·빈 자리·제한 시간·방장 상차림·만든 시각만 담고 uid는 담지 않는다", () => {
  const s = core.summarize(room(), "ROOM1", T0 + 5);
  assert.equal(s.hostName, "방장");
  assert.equal(s.hostSide, "cho");
  assert.equal(s.openSide, "han");
  assert.equal(s.timeLimitMin, 10);
  assert.equal(s.charim[s.hostSide], 2);
  assert.equal(s.createdAtMs, T0);
  assert.equal(s.activeAtMs, T0 + 5);
  assert.ok(core.isOpen(s));
  assert.ok(!core.isLive(s));
  assert.ok(!JSON.stringify(s).includes("host\""), "uid가 요약에 들어가면 안 된다");
  assert.deepEqual(Object.keys(s).sort(), ["activeAtMs", "charim", "clock", "createdAtMs", "hostName", "hostSide", "hostTag", "lastMoveAtMs",
    "openSide", "players", "ply", "result", "roomId", "startedAtMs", "status", "tags", "timeLimitMin"]);
});

test("계정 구분표(가린 이메일)는 자리에서 그대로 옮기고, 없으면 빈 문자열이다", () => {
  const r = room();
  r.seats.cho.tag = "ise***@hanmail.net";
  const s = core.summarize(r, "ROOM1", T0);
  assert.equal(s.hostTag, "ise***@hanmail.net");
  assert.equal(s.tags.cho, "ise***@hanmail.net");
  assert.equal(s.tags.han, "");
  assert.equal(core.summarize(room(), "ROOM1", T0).hostTag, "");
});

test("비공개·닫힌 방·지워진 방은 요약이 없다", () => {
  assert.equal(core.summarize(room({ visibility: "private" }), "R", T0), null);
  assert.equal(core.summarize(room({ status: "closed" }), "R", T0), null);
  assert.equal(core.summarize(null, "R", T0), null);
  assert.equal(core.summarize(room({ visibility: undefined }), "R", T0), null, "예전(v1) 방은 비공개로 본다");
});

test("자리가 다 찬 방은 기다리는 방 목록에 없고, 대국 중이면 관전 목록에 있다", () => {
  const full = room({ seats: { cho: { uid: "host", name: "방장" }, han: { uid: "g", name: "손님" } }, members: ["host", "g"] });
  const s1 = core.summarize(full, "R", T0);
  assert.equal(s1.openSide, null);
  assert.ok(!core.isOpen(s1));
  const s2 = core.summarize(Object.assign(full, { status: "playing", ply: 7 }), "R", T0);
  assert.ok(core.isLive(s2));
  assert.deepEqual(s2.players, { cho: "방장", han: "손님" });
  assert.equal(s2.ply, 7);
});

test("syncLobby: 공개면 쓰고, 비공개로 바뀌거나 닫히면 지운다", async () => {
  const { docs, lobby } = setup();
  await lobby.syncLobby("R1", room());
  assert.ok(docs.has(core.paths.lobby("R1")));
  await lobby.syncLobby("R1", room({ status: "closed" }));
  assert.ok(!docs.has(core.paths.lobby("R1")));
  await lobby.syncLobby("R2", room({ visibility: "private" }));
  assert.ok(!docs.has(core.paths.lobby("R2")));
});

test("cleanupLobby: 마지막 활동 뒤 30분 지난 요약만 지운다", async () => {
  const { docs, clock, lobby } = setup();
  await lobby.syncLobby("OLD", room());
  clock.t += 20 * 60 * 1000;
  await lobby.syncLobby("NEW", room());
  clock.t += 11 * 60 * 1000; // OLD는 31분, NEW는 11분
  assert.ok(core.isStale(docs.get(core.paths.lobby("OLD")), clock.t));
  assert.ok(!core.isStale(docs.get(core.paths.lobby("NEW")), clock.t));
  const n = await lobby.cleanupLobby();
  assert.equal(n, 1);
  assert.ok(!docs.has(core.paths.lobby("OLD")));
  assert.ok(docs.has(core.paths.lobby("NEW")));
});

test("목록 크기 상수는 규칙(limit 50)과 같다", () => {
  assert.equal(core.PAGE_LIMIT, 50);
  assert.equal(core.STALE_MS, 30 * 60 * 1000);
});
