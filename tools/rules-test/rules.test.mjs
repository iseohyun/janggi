/**
 * firestore.rules 시험 (Firestore 에뮬레이터, 허용과 거부를 모두 본다).
 * 실행 (Java 11 이상 필요): 웹장기 폴더에서
 *   npm.cmd --prefix tools/rules-test install   (처음 한 번)
 *   firebase emulators:exec --only firestore --project demo-janggi "node --test tools/rules-test/rules.test.mjs"
 * 다루는 것: 방 만들기(공개/비공개), 입장, 시작 전 설정(상대: 자기 상차림·준비, 방장: 자기 설정·시작),
 *           시작 뒤 설정 금지, 상대 나가기, 공개 목록(lobby) 읽기·크기 제한·쓰기 금지, 관전(공개 방 수 읽기), 채팅 비공개.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";

const here = dirname(fileURLToPath(import.meta.url));
const RULES = readFileSync(resolve(here, "../../firestore.rules"), "utf8");
const ROOMS = "games/janggi/rooms";
const NOW = Date.parse("2026-11-21T03:00:00Z");
let env;

const seat = (uid, name) => ({ uid, name });

function waitingRoom(over = {}) {
  return Object.assign({
    app: "janggi", v: 2, visibility: "public", ready: false, hostUid: "host", createdAtMs: NOW, status: "waiting",
    seats: { cho: seat("host", "방장"), han: null }, members: ["host"], charim: { cho: 2, han: 0 },
    timeLimitMin: 10, sidePick: "cho", ply: 0, clock: { cho: 0, han: 0 }, lastMoveAtMs: NOW, startedAtMs: 0,
    undo: null, result: null
  }, over);
}

/** 상대가 앉은 시작 전 방 */
function seatedRoom(over = {}) {
  return waitingRoom(Object.assign({ seats: { cho: seat("host", "방장"), han: seat("guest", "손님") }, members: ["host", "guest"] }, over));
}

const user = uid => env.authenticatedContext(uid, { email_verified: true, auth_time: Math.floor(NOW / 1000) }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seed(path, data) {
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.firestore().doc(path).set(data);
  });
}

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({ projectId: "demo-janggi", firestore: { rules: RULES, host, port: Number(port) } });
});
after(async () => env && env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  // 실제처럼 사용자 문서가 있다 (notRevoked가 읽음 → 식 개수가 늘어난 상태로 시험)
  for (const uid of ["host", "guest", "third"]) await seed(`games/janggi/users/${uid}`, { revokedAt: 0, devices: {} });
});

// ----- 방 만들기 -----

test("방 만들기: 공개·비공개를 고르고 준비는 false로만 만든다", async () => {
  await assertSucceeds(user("host").doc(`${ROOMS}/ROOMAAAA`).set(waitingRoom()));
  await assertSucceeds(user("host").doc(`${ROOMS}/ROOMBBBB`).set(waitingRoom({ visibility: "private" })));
  await assertFails(user("host").doc(`${ROOMS}/ROOMCCCC`).set(waitingRoom({ visibility: "secret" })));
  const noVis = waitingRoom();
  delete noVis.visibility;
  await assertFails(user("host").doc(`${ROOMS}/ROOMDDDD`).set(noVis));
  await assertFails(user("host").doc(`${ROOMS}/ROOMEEEE`).set(waitingRoom({ ready: true })));
  await assertFails(anon().doc(`${ROOMS}/ROOMFFFF`).set(waitingRoom()));
});

// ----- 입장 -----

test("입장: 빈 자리에 자기만 앉는다 (시작은 하지 않음). 자리가 차면 다른 사람은 못 앉는다", async () => {
  await seed(`${ROOMS}/R1`, waitingRoom());
  const ref = user("guest").doc(`${ROOMS}/R1`);
  await assertFails(ref.update({ "seats.han": seat("guest", "손님"), members: ["host", "guest"], status: "playing" }));
  await assertSucceeds(ref.update({ "seats.han": seat("guest", "손님"), members: ["host", "guest"] }));
  // 다 찬 방: 세 번째 사람이 상대 자리를 덮어쓰지 못한다
  await assertFails(user("third").doc(`${ROOMS}/R1`).update({ "seats.han": seat("third", "셋째"), members: ["host", "guest", "third"] }));
});

// ----- 상대(손님) -----

test("상대: 자기 상차림과 준비만 쓸 수 있다", async () => {
  await seed(`${ROOMS}/R2`, seatedRoom());
  const ref = user("guest").doc(`${ROOMS}/R2`);
  await assertSucceeds(ref.update({ charim: { cho: 2, han: 3 }, ready: false })); // 자기(한) 상차림
  await assertSucceeds(ref.update({ ready: true }));
  await assertFails(ref.update({ charim: { cho: 2, han: 1 }, ready: true })); // 상차림을 바꾸면서 준비 유지 → 거부
  await assertSucceeds(ref.update({ charim: { cho: 2, han: 1 }, ready: false }));
  await assertFails(ref.update({ charim: { cho: 0, han: 1 }, ready: false })); // 방장(초) 상차림
  await assertFails(ref.update({ timeLimitMin: 30 }));
  await assertFails(ref.update({ sidePick: "han" }));
  await assertFails(ref.update({ seats: { cho: seat("guest", "손님"), han: seat("host", "방장") } }));
  await assertFails(ref.update({ ready: true, status: "playing", startedAtMs: NOW, lastMoveAtMs: NOW })); // 시작은 방장만
});

test("상대: 시작 전에 자리에서 나가면 방은 다시 상대를 기다린다", async () => {
  await seed(`${ROOMS}/R3`, seatedRoom({ ready: true }));
  const ref = user("guest").doc(`${ROOMS}/R3`);
  await assertFails(ref.update({ "seats.han": null, members: ["host"], ready: true }));
  await assertSucceeds(ref.update({ "seats.han": null, members: ["host"], ready: false }));
});

// ----- 방장 -----

test("방장: 자기 상차림·진영·제한 시간만, 바꾸면 상대 준비가 풀린다", async () => {
  await seed(`${ROOMS}/R4`, seatedRoom({ ready: true, charim: { cho: 2, han: 3 } }));
  const ref = user("host").doc(`${ROOMS}/R4`);
  await assertFails(ref.update({ timeLimitMin: 30 })); // 준비가 그대로 → 거부
  await assertSucceeds(ref.update({ timeLimitMin: 30, ready: false }));
  await assertSucceeds(ref.update({ charim: { cho: 1, han: 3 }, ready: false })); // 자기(초) 상차림
  await assertFails(ref.update({ charim: { cho: 1, han: 0 }, ready: false })); // 상대(한) 상차림
  await assertFails(ref.update({ timeLimitMin: 181, ready: false }));
  // 진영 맞바꾸기: 상대 자리와 상대 상차림(3)이 함께 옮겨 간다
  await assertSucceeds(ref.update({
    seats: { cho: seat("guest", "손님"), han: seat("host", "방장") }, charim: { cho: 3, han: 1 }, sidePick: "han", ready: false
  }));
  // 맞바꾸면서 상대 상차림을 바꾸면 거부
  await assertFails(ref.update({
    seats: { cho: seat("host", "방장"), han: seat("guest", "손님") }, charim: { cho: 1, han: 0 }, sidePick: "cho", ready: false
  }));
  // 상대를 다른 사람으로 바꾸기 거부
  await assertFails(ref.update({ seats: { cho: seat("guest2", "남"), han: seat("host", "방장") }, ready: false }));
  await assertFails(ref.update({ ready: true })); // 방장은 상대 준비를 켤 수 없다
  await assertFails(ref.update({ visibility: "private", ready: false })); // 공개 여부는 만든 뒤 못 바꿈
});

test("방장: 상대가 준비한 뒤에만 시작한다", async () => {
  await seed(`${ROOMS}/R5`, seatedRoom());
  const start = { status: "playing", startedAtMs: NOW, lastMoveAtMs: NOW };
  await assertFails(user("host").doc(`${ROOMS}/R5`).update(start)); // 준비 전
  await seed(`${ROOMS}/R5`, seatedRoom({ ready: true }));
  await assertFails(user("guest").doc(`${ROOMS}/R5`).update(start)); // 상대는 시작 못 함
  await assertSucceeds(user("host").doc(`${ROOMS}/R5`).update(start));
  await seed(`${ROOMS}/R6`, waitingRoom({ ready: true })); // 상대 없음
  await assertFails(user("host").doc(`${ROOMS}/R6`).update(start));
});

test("시작한 뒤에는 상차림·준비·제한 시간을 바꿀 수 없다", async () => {
  await seed(`${ROOMS}/R7`, seatedRoom({ status: "playing", ready: true }));
  await assertFails(user("guest").doc(`${ROOMS}/R7`).update({ charim: { cho: 2, han: 1 }, ready: false }));
  await assertFails(user("guest").doc(`${ROOMS}/R7`).update({ ready: false }));
  await assertFails(user("host").doc(`${ROOMS}/R7`).update({ charim: { cho: 0, han: 0 }, ready: false }));
  await assertFails(user("host").doc(`${ROOMS}/R7`).update({ timeLimitMin: 5, ready: false }));
  // 대국 중 기권은 그대로 된다
  await assertSucceeds(user("guest").doc(`${ROOMS}/R7`).update({
    status: "ended", result: { winner: "cho", reason: "resign", by: "guest", atMs: NOW }
  }));
});

// ----- 공개 목록·관전 -----

test("공개 목록(lobby): 로그인 없이 읽고, 한 번에 50개까지, 클라이언트는 쓰지 못한다", async () => {
  await seed("games/janggi/lobby/R8", { roomId: "R8", status: "waiting", activeAtMs: NOW });
  await assertSucceeds(anon().doc("games/janggi/lobby/R8").get());
  const col = anon().collection("games/janggi/lobby");
  await assertSucceeds(col.where("activeAtMs", ">=", NOW - 1800000).orderBy("activeAtMs", "desc").limit(50).get());
  await assertFails(col.limit(51).get());
  await assertFails(col.get()); // limit 없이 전부 읽기
  await assertFails(anon().doc("games/janggi/lobby/R9").set({ roomId: "R9" }));
  await assertFails(user("host").doc("games/janggi/lobby/R8").set({ roomId: "R8", status: "playing" }));
  await assertFails(user("host").doc("games/janggi/lobby/R8").delete());
});

test("관전: 공개 방의 수는 로그인 없이 읽고, 비공개 방의 수와 채팅·방 문서는 못 읽는다", async () => {
  await seed(`${ROOMS}/PUB1`, seatedRoom({ status: "playing", ply: 1 }));
  await seed(`${ROOMS}/PUB1/moves/0`, { ply: 0, by: "host", fx: 1, fy: 0, tx: 1, ty: 1 });
  await seed(`${ROOMS}/PUB1/chat/m1`, { uid: "host", name: "방장", text: "안녕", kind: "user", atMs: NOW });
  await seed(`${ROOMS}/PRV1`, seatedRoom({ status: "playing", ply: 1, visibility: "private" }));
  await seed(`${ROOMS}/PRV1/moves/0`, { ply: 0, by: "host", fx: 1, fy: 0, tx: 1, ty: 1 });

  await assertSucceeds(anon().collection(`${ROOMS}/PUB1/moves`).orderBy("ply").get());
  await assertSucceeds(user("third").collection(`${ROOMS}/PUB1/moves`).get());
  await assertFails(anon().collection(`${ROOMS}/PRV1/moves`).get());
  await assertFails(user("third").collection(`${ROOMS}/PRV1/moves`).get());
  await assertSucceeds(user("guest").collection(`${ROOMS}/PRV1/moves`).get()); // 참가자
  await assertFails(anon().collection(`${ROOMS}/PUB1/chat`).get()); // 관전자는 채팅을 못 읽음
  await assertFails(user("third").collection(`${ROOMS}/PUB1/chat`).get());
  await assertFails(user("third").collection(`${ROOMS}/PUB1/chat`).add({ uid: "third", name: "셋째", text: "훈수", kind: "user", atMs: NOW }));
  await assertFails(anon().doc(`${ROOMS}/PUB1`).get()); // 방 문서(uid 포함)는 요약으로만 본다
  await assertFails(anon().collection(`${ROOMS}/PUB1/moves`).doc("1").set({ ply: 1, by: "x", fx: 1, fy: 0, tx: 1, ty: 1 }));
});

test("대국 중: 수 두기·무르기 청하기·받아들이기·채팅이 식 개수 한도 안에서 허용된다", async () => {
  await seed(`${ROOMS}/G1`, seatedRoom({ status: "playing", ready: true, startedAtMs: NOW }));
  const host = user("host");
  const b1 = host.batch();
  b1.set(host.doc(`${ROOMS}/G1/moves/0`), { ply: 0, by: "host", fx: 1, fy: 0, tx: 1, ty: 1, clock: { cho: 3, han: 0 }, atMs: NOW });
  b1.update(host.doc(`${ROOMS}/G1`), { ply: 1, clock: { cho: 3, han: 0 }, lastMoveAtMs: NOW, undo: null });
  await assertSucceeds(b1.commit());
  // 차례가 아닌 사람(방장)이 또 두기 → 거부
  const b2 = host.batch();
  b2.set(host.doc(`${ROOMS}/G1/moves/1`), { ply: 1, by: "host", fx: 1, fy: 1, tx: 1, ty: 2, atMs: NOW });
  b2.update(host.doc(`${ROOMS}/G1`), { ply: 2, lastMoveAtMs: NOW, undo: null });
  await assertFails(b2.commit());
  // 무르기 청하기(방장) → 상대가 받아들이며 마지막 수를 지움
  await assertSucceeds(host.doc(`${ROOMS}/G1`).update({ undo: { by: "host", ply: 1, atMs: NOW } }));
  const guest = user("guest");
  const b3 = guest.batch();
  b3.delete(guest.doc(`${ROOMS}/G1/moves/0`));
  b3.update(guest.doc(`${ROOMS}/G1`), { ply: 0, undo: null, lastMoveAtMs: NOW });
  await assertSucceeds(b3.commit());
  await assertSucceeds(guest.collection(`${ROOMS}/G1/chat`).add({ uid: "guest", name: "손님", side: "han", text: "잘 부탁합니다", kind: "user", atMs: NOW }));
  // 시간패 기록
  await assertSucceeds(guest.doc(`${ROOMS}/G1`).update({
    status: "ended", result: { winner: "han", reason: "timeout", by: "guest", atMs: NOW }, clock: { cho: 600, han: 3 }
  }));
});

test("평가 순서가 가장 뒤인 경로도 허용된다: 무르기 거절, 기다리는 방 닫기", async () => {
  await seed(`${ROOMS}/G2`, seatedRoom({ status: "playing", ready: true, ply: 1, undo: { by: "host", ply: 1, atMs: NOW } }));
  await assertFails(user("host").doc(`${ROOMS}/G2`).update({ undo: null })); // 자기가 청한 것은 거절 못 함
  await assertSucceeds(user("guest").doc(`${ROOMS}/G2`).update({ undo: null }));
  await seed(`${ROOMS}/W1`, seatedRoom({ ready: true }));
  await assertFails(user("guest").doc(`${ROOMS}/W1`).update({ status: "closed" }));
  await assertSucceeds(user("host").doc(`${ROOMS}/W1`).update({ status: "closed" }));
});

test("모든 기기에서 로그아웃한 뒤의 옛 토큰은 방 설정도 못 쓴다", async () => {
  await seed(`${ROOMS}/W2`, seatedRoom());
  await seed("games/janggi/users/guest", { revokedAt: Math.floor(NOW / 1000) + 60 });
  await assertFails(user("guest").doc(`${ROOMS}/W2`).update({ ready: true }));
});

test("수 두기는 대국이 시작된 뒤에만 된다 (준비 단계에서는 거부)", async () => {
  await seed(`${ROOMS}/R10`, seatedRoom({ ready: true }));
  const db = user("host");
  const batch = db.batch();
  batch.set(db.doc(`${ROOMS}/R10/moves/0`), { ply: 0, by: "host", fx: 1, fy: 0, tx: 1, ty: 1, atMs: NOW });
  batch.update(db.doc(`${ROOMS}/R10`), { ply: 1, lastMoveAtMs: NOW, clock: { cho: 1, han: 0 }, undo: null });
  await assertFails(batch.commit());
  assert.ok(true);
});
