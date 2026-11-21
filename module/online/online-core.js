/**
 * @fileoverview 온라인 대국 핵심: 백엔드 고르기, 로그인 상태, 방 만들기·입장, 수 동기화, 시계, 무르기·기권.
 *  - 백엔드: firebase-config.js의 JANGGI_ONLINE_BACKEND("fake" | "firebase"), 주소 ?backend= 로 잠깐 바꿀 수 있다.
 *  - 수는 "초가 아래쪽인 판" 기준 좌표(from·to)로 주고받는다. 두 사람 화면은 서로 180도 돌아가 있어
 *    기물 번호(0~31)가 다르기 때문이다 (olCanon).
 *  - 받은 수는 앱의 기존 규칙 검사(getFilteredLegalMoves: 장군 피하기까지 본 합법수)를 통과해야 판에 둔다 (olApplyRemote).
 *  - 맞추기(olReconcile): 서버 수 목록과 이 화면에 둔 수 목록(olSynced)의 같은 앞부분을 찾아, 다르면 되돌리고 나머지를 둔다.
 *    새로고침·재접속 복원, 무르기, 보내기 실패 되돌리기가 모두 이 한 곳에서 처리된다.
 *  - 시계: 두는 사람이 자기 화면에서 잰 생각 시간을 수와 함께 보낸다 (기기마다 시계가 달라도 어긋나지 않게).
 *    제한 시간을 넘기면 자기 화면이 시간패를 알리고, 상대 화면은 5초 더 기다린 뒤 알린다 (olTick).
 *  - 대국 중에는 판을 바꾸는 다른 기능(새 대국·진영 바꾸기·기보 불러오기·AI 대국)을 막는다. 놓아보기(가지)는 쓸 수 있다.
 *  - 시작 전(status "waiting") 방 설정: 방장은 자기 상차림·진영·제한 시간, 상대는 자기 상차림과 준비만 바꾼다.
 *    방장이 설정을 바꾸면 상대의 준비가 풀리고 채팅에 시스템 알림이 간다. 상대가 준비하면 방장이 시작한다.
 *    양쪽 판에는 지금 설정이 바로 차려진다(olSetupBoard). 오른쪽 서랍 '새 대국' 탭이 이 설정을 고친다(online-guard.js).
 *  - 공개 방은 열린 대국 목록(games/janggi/lobby, functions/lobby-core.js)에 올라간다. 목록 보기와 관전은 로그인 없이 된다.
 *    관전(olSpectate)은 요약과 수만 읽는다(채팅은 읽지도 쓰지도 못함). 관전 중 olSpectating = true, olMySide = null.
 * 공개: olBackend, olUser, olRoom, olRoomId, olMySide, olSpectating, olGameActive(), olLocked(), olIsMyTurn(), olSideName(side),
 *       olCreateRoom(opts), olJoinRoom(id), olLeaveRoom(), olSendChat(text), olSystem(text), olResign(),
 *       olRequestUndo(), olAnswerUndo(accept), olInviteLink(), olAuth (로그인 함수 모음),
 *       olAmHost(), olInSetup(), olGuestSeated(), olSetMyCharim(k), olSetHostSettings({side, timeLimitMin}),
 *       olSetReady(on), olStartGame(), olSpectate(id), olWatchLobby(cb)
 * @module online/online-core
 * @depends state, rules, board, ai, main, ui, header-graph, preview, firebase-config, online/fake-backend
 *          (online-ui.js가 화면을, online-ai.js가 AI 기능 끄고 켜기를 맡는다)
 */

const OL_SIDE_KO = { cho: "초", han: "한" };
const OL_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 헷갈리는 0·O·1·I 뺌
const OL_CODE_LEN = 8;
const OL_CHAT_MAX = 300; // 채팅 한 줄 최대 글자 수 (firestore.rules와 같게)
const OL_NAME_MAX = 40;
const OL_TIMEOUT_GRACE_S = 5; // 상대 시간패를 알리기 전에 더 기다리는 시간 (네트워크 늦음 대비)
const OL_REASON_KO = { checkmate: "외통수", resign: "기권", timeout: "시간패", doublePass: "연속 한수쉼" };
const OL_CHARIM_KO = ["마상마상", "마상상마", "상마마상", "상마상마"];

var olBackend = null;
var olBackendError = null;
var olUser = null;
var olRoomId = null;
var olRoom = null;
var olMySide = null; // "cho" | "han" (관전 중에는 null)
var olSpectating = false; // 공개 대국을 관전하는 중 (olRoomId = 관전하는 방)
var olMoves = []; // 서버의 수 목록 (ply 순)
var olChat = []; // 채팅 목록
let olSynced = []; // 이 화면 판에 둔 수 (초 기준 좌표) - log와 같은 길이
let olPending = null; // 보내는 중인 내 수의 번호
let olApplying = false; // 받은 수를 두는 중 (move 감싸기가 통과시킨다)
let olBypass = false; // 이 모듈이 막아 둔 함수를 직접 부르는 중
let olBoardReady = false;
let olPrevStatus = null;
let olSetupKey = ""; // 판을 차린 설정 (시작 전 설정이 바뀌면 다시 차린다)
let olPrevMembers = 0;
let olSaved = null; // 방에 들어가기 전 설정 {aiMode, iAmCho, timeLimitMinutes, newGameState}
let olUnsubs = [];
let olTimeoutSent = false;
let olRejected = new Set(); // 거부한 수 "번호:좌표" (같은 수를 여러 번 알리지 않게)
const olListeners = new Set(); // 화면 갱신 (online-ui.js)

// ===== 작은 도움 함수 =====

function olEmit(what) {
  olListeners.forEach(cb => {
    try {
      cb(what);
    } catch (e) {
      console.error("[online] 화면 갱신 오류:", e);
    }
  });
}

function olOnChange(cb) {
  olListeners.add(cb);
}

function olSideName(side) {
  return OL_SIDE_KO[side] || "";
}

function olOther(side) {
  return side === "cho" ? "han" : "cho";
}

/** 수 번호 ply를 둘 진영 (초가 먼저) */
function olSideOfPly(ply) {
  return ply % 2 === 0 ? "cho" : "han";
}

/** 앱 안 확인 창 (app-dialog.js가 있으면 그것, 없으면 confirm) → Promise<boolean> */
function olConfirm(title, message, okLabel, tone) {
  if (typeof showAppDialog !== "function") return Promise.resolve(window.confirm(`${title}
${message}`));
  return showAppDialog({
    title,
    message,
    tone: tone || "warn",
    cancelValue: false,
    buttons: [{ label: "취소", value: false }, { label: okLabel, value: true, primary: true }]
  }).then(v => v === true);
}

function olToast(msg, ms) {
  if (typeof showToast === "function") showToast(msg, ms || 2200);
}

/** 이 화면 좌표 ↔ 초가 아래쪽인 판 좌표 (180도 회전은 자기 자신의 역변환) */
function olCanon(x, y) {
  if (iAmCho) return { x, y };
  return { x: 10 - x, y: flipYCoordinate(y) };
}

function olTurnStep() {
  const el = document.getElementById("turn");
  const n = el ? parseInt(el.value, 10) : log.length;
  return isNaN(n) ? log.length : n;
}

function olNewCode() {
  const bytes = new Uint8Array(OL_CODE_LEN);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => OL_CODE_CHARS[b % OL_CODE_CHARS.length]).join("");
}

function olCleanCode(text) {
  const m = String(text || "").toUpperCase().match(/[A-Z0-9]{6,16}/);
  return m ? m[0] : "";
}

function olInviteLink(id) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", id || olRoomId || "");
  const backend = new URLSearchParams(window.location.search).get("backend");
  if (backend) url.searchParams.set("backend", backend);
  return url.toString();
}

function olSetUrlRoom(id, param) {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  url.searchParams.delete("watch");
  if (id) url.searchParams.set(param || "room", id);
  window.history.replaceState({}, "", url.toString());
}

function olErrorText(err) {
  const code = (err && err.code) || "";
  const map = {
    "auth/too-many-requests": "시도가 너무 많습니다. 잠시 뒤 다시 해 주세요.",
    "auth/popup-blocked": "로그인 창이 막혔습니다. 팝업을 허용해 주세요.",
    "auth/popup-closed-by-user": "로그인 창이 닫혔습니다.",
    "auth/unauthorized-domain": "이 주소가 Firebase 승인된 도메인에 없습니다 (docs/online-setup.md).",
    "auth/operation-not-allowed": "Firebase 콘솔에서 이 로그인 방식이 꺼져 있습니다.",
    "auth/timeout": "로그인을 기다리다 시간이 지났습니다.",
    "auth/invalid-custom-token": "로그인 토큰이 맞지 않습니다. 다시 로그인해 주세요.",
    "resource-exhausted": "지금은 로그인 메일을 보낼 수 없습니다.",
    "invalid-argument": "입력이 맞지 않습니다.",
    "internal": "서버에서 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.",
    "unauthenticated": "로그인이 필요합니다.",
    "not-found": "그런 방이 없습니다. 코드를 확인해 주세요.",
    "room-full": "이미 두 사람이 들어간 방입니다.",
    "room-closed": "닫힌 방입니다.",
    "permission-denied": "권한이 없습니다. 이미 두 사람이 있는 방이거나 보안 규칙에 막혔습니다.",
    "not-ready": "상대가 아직 준비하지 않았습니다.",
    "aborted": "다른 수가 먼저 들어왔습니다.",
    "unavailable": "서버에 닿지 않습니다. 인터넷 연결을 확인해 주세요."
  };
  return map[code] || (err && err.message) || "알 수 없는 오류";
}

// ===== 백엔드 =====

function olBackendKind() {
  const q = new URLSearchParams(window.location.search).get("backend");
  if (q === "fake" || q === "firebase") return q;
  return typeof JANGGI_ONLINE_BACKEND === "string" ? JANGGI_ONLINE_BACKEND : "fake";
}

async function olInitBackend() {
  const kind = olBackendKind();
  try {
    if (kind === "firebase") {
      const tag = typeof BUILD_TAG === "string" ? BUILD_TAG : "";
      const mod = await import(new URL(`module/online/firebase-backend.js?v=${tag}`, document.baseURI).href);
      olBackend = await mod.createFirebaseBackend(JANGGI_FIREBASE_CONFIG, JANGGI_FIREBASE_SDK);
    } else {
      olBackend = window.OnlineFakeBackend;
    }
    if (!olBackend) throw new Error("백엔드를 찾지 못했습니다");
  } catch (e) {
    console.error("[online] 백엔드를 시작하지 못했습니다:", e);
    olBackendError = e;
    olEmit("backend");
    return;
  }
  olEmit("backend");
  olBackend.auth.onChange(user => {
    const prev = olUser ? olUser.uid : null;
    olUser = user || null;
    olEmit("auth");
    if (olUser && olUser.uid !== prev) olAutoJoinFromUrl();
    if (!olUser && olRoomId && !olSpectating) olLeaveLocal();
  });
  // 관전 링크(?watch=)는 로그인 없이 바로 본다
  const watch = olCleanCode(new URLSearchParams(window.location.search).get("watch"));
  if (watch) olSpectate(watch).catch(e => olToast(`관전하지 못했습니다: ${olErrorText(e)}`, 3500));
}

/**
 * 이 브라우저의 무작위 기기 ID (localStorage "janggiDeviceId"). 새 기기 로그인 알림에 쓴다.
 * 서버에는 사용자별 해시로만 남는다 (functions/email-login-core.js noteDevice).
 */
function olDeviceId() {
  const KEY = "janggiDeviceId";
  try {
    let id = localStorage.getItem(KEY);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(id || "")) {
      const b = crypto.getRandomValues(new Uint8Array(16));
      id = btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return ""; // 저장소를 못 쓰면 기기 기록·알림 없이 로그인만
  }
}

/** 로그인 함수 모음 (online-ui.js·online-email-login.js가 부른다) */
const olAuth = {
  google: async () => {
    const user = await olBackend.auth.signInGoogle();
    // 기기 기록·새 기기 알림 (실패해도 로그인은 그대로)
    olBackend.auth.noteLogin(olDeviceId(), window.location.href)
      .then(() => olEmit("devices"))
      .catch(e => console.warn("[online] 기기 기록 실패:", e && (e.code || e.message)));
    return user;
  },
  /** 로그인한 기기 목록 [{key, label, firstAt, lastAt, current}] (본인만 읽을 수 있음) */
  devices: async () => {
    const list = await olBackend.auth.listDevices();
    const id = olDeviceId();
    const mine = id && olUser && window.EmailLoginCore
      ? await EmailLoginCore.deviceKeyOf(olUser.uid, id, olSha256Hex)
      : "";
    return list.map(d => Object.assign({}, d, { current: d.key === mine })).sort((a, b) => b.lastAt - a.lastAt);
  },
  // 이메일 승인형 로그인: 메일 보내기 → 승인됐는지 묻기(승인되면 백엔드가 로그인시킴)
  emailStart: (email, name, appUrl) => olBackend.auth.startEmailLogin(String(email || "").trim(), String(name || "").trim().slice(0, OL_NAME_MAX), appUrl),
  emailClaim: (req, claimSecret) => olBackend.auth.claimEmailLogin(req, claimSecret, olDeviceId()),
  signOut: async () => {
    if (olRoomId) await olLeaveRoom(true);
    return olBackend.auth.signOut();
  },
  /** 모든 기기에서 로그아웃 (이 기기 포함) */
  signOutAll: async () => {
    if (olRoomId) await olLeaveRoom(true);
    return olBackend.auth.signOutAll();
  }
};

async function olSha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
}

// ===== 상태 묻기 =====

/** 방에 들어가 있고 대국 중 */
function olGameActive() {
  return !!(olRoomId && olRoom && olRoom.status === "playing" && olBoardReady);
}

/** 방에서 대국을 기다리거나 두는 중 (판을 바꾸는 다른 기능을 막는다) */
function olLocked() {
  return !!(olRoomId && olRoom && (olRoom.status === "waiting" || olRoom.status === "playing"));
}

function olIsMyTurn() {
  return olGameActive() && !olSpectating && olSideOfPly(log.length) === olMySide && olTurnStep() === log.length;
}

/** 내가 방장 (관전 중이면 아님) */
function olAmHost() {
  return !!(olRoom && olUser && !olSpectating && olRoom.hostUid === olUser.uid);
}

/** 시작 전 방 설정 중 (참가자) */
function olInSetup() {
  return !!(olRoomId && olRoom && !olSpectating && olRoom.status === "waiting");
}

/** 두 자리가 다 찼다 */
function olGuestSeated() {
  return !!(olRoom && olRoom.seats.cho && olRoom.seats.han);
}

/** 판을 볼 진영 (관전은 초가 아래) */
function olViewSide() {
  return olSpectating ? "cho" : olMySide;
}

function olSideOfUid(room, uid) {
  return room.seats.cho && room.seats.cho.uid === uid ? "cho" : "han";
}

/** 기물 i(이 화면 번호)가 내 기물인지. 0~15는 아래쪽, 아래쪽은 iAmCho면 초 */
function olIsMyPiece(i) {
  const isCho = (i < 16) === iAmCho;
  return (isCho ? "cho" : "han") === olMySide;
}

function olInPreview() {
  return (typeof isPreviewActive === "function" && isPreviewActive()) ||
    (typeof pvReviewingPast === "function" && pvReviewingPast());
}

// ===== 방 만들기·입장·나가기 =====

function olPickSide(pick) {
  return pick === "random" ? (crypto.getRandomValues(new Uint8Array(1))[0] % 2 ? "han" : "cho") : pick;
}

/**
 * @param {{side: "cho"|"han"|"random", timeLimitMin: number, charim: number, visibility: "public"|"private"}} opts
 *   charim = 내 상차림 (상대 상차림은 상대가 들어와서 고른다)
 */
async function olCreateRoom(opts) {
  if (!olUser) throw Object.assign(new Error("로그인이 필요합니다"), { code: "auth/required" });
  if (olRoomId) await olLeaveRoom(true);
  const side = olPickSide(opts.side);
  const mine = Math.max(0, Math.min(3, opts.charim | 0));
  const me = { uid: olUser.uid, name: olUser.name.slice(0, OL_NAME_MAX), tag: olEmailTag(olUser.email) };
  const now = Date.now();
  const room = {
    app: "janggi",
    v: 2,
    visibility: opts.visibility === "public" ? "public" : "private",
    ready: false,
    hostUid: olUser.uid,
    createdAtMs: now,
    status: "waiting",
    seats: { cho: side === "cho" ? me : null, han: side === "han" ? me : null },
    members: [olUser.uid],
    charim: { cho: side === "cho" ? mine : 0, han: side === "han" ? mine : 0 },
    timeLimitMin: Math.max(0, Math.min(180, opts.timeLimitMin | 0)),
    sidePick: opts.side,
    ply: 0,
    clock: { cho: 0, han: 0 },
    lastMoveAtMs: now,
    startedAtMs: 0,
    undo: null,
    result: null
  };
  let id = null;
  for (let tries = 0; tries < 5 && !id; tries++) {
    const code = olNewCode();
    try {
      id = await olBackend.createRoom(code, room);
    } catch (e) {
      if (e.code !== "already-exists") throw e;
    }
  }
  if (!id) throw new Error("방 코드를 만들지 못했습니다");
  await olEnterRoom(id, room, "create");
  return id;
}

/**
 * 계정 구분표: 가린 이메일 (예: iseohyun@hanmail.net → ise***@hanmail.net).
 * 계정은 이메일마다 따로(uid)이므로, 이름이 같아도 이 표로 누구인지 구별한다. 전체 주소는 남에게 보이지 않는다.
 * @param {string} email
 * @returns {string} 이메일이 없으면 ""
 */
function olEmailTag(email) {
  const at = typeof email === "string" ? email.lastIndexOf("@") : -1;
  if (at < 1) return "";
  const local = email.slice(0, at);
  const keep = Math.min(3, Math.ceil(local.length / 2));
  return `${local.slice(0, keep)}***${email.slice(at)}`.slice(0, 80);
}

/** 링크·코드로 입장. 빈 자리가 있으면 앉고, 이미 참가자면 다시 들어간다. */
async function olJoinRoom(rawId) {
  const id = olCleanCode(rawId);
  if (!id) throw Object.assign(new Error("코드를 확인해 주세요"), { code: "not-found" });
  if (!olUser) throw Object.assign(new Error("로그인이 필요합니다"), { code: "auth/required" });
  if (olRoomId === id) return id;
  if (olRoomId) await olLeaveRoom(true);
  let how = "rejoin";
  const room = await olBackend.joinRoom(id, olUser, (r, user) => {
    if (r.members.includes(user.uid)) return null; // 다시 들어옴
    if (r.status === "closed") throw Object.assign(new Error("닫힌 방"), { code: "room-closed" });
    if (r.status !== "waiting" || (r.seats.cho && r.seats.han)) throw Object.assign(new Error("가득 찬 방"), { code: "room-full" });
    const side = r.seats.cho ? "han" : "cho";
    // 자리에만 앉는다. 상차림을 고르고 준비하면 방장이 시작한다 (firestore.rules joining·guestSetup·hostStart)
    r.seats[side] = { uid: user.uid, name: user.name.slice(0, OL_NAME_MAX), tag: olEmailTag(user.email) };
    r.members = r.members.concat([user.uid]);
    how = "join";
    return r;
  });
  await olEnterRoom(id, room, how);
  return id;
}

/** 방에 들어가기 전 상태를 비우고, 들어가기 전 설정을 한 번만 기억한다 */
function olResetRoomState(id, room) {
  olRoomId = id;
  olRoom = room;
  olMoves = [];
  olChat = [];
  olSynced = [];
  olPending = null;
  olBoardReady = false;
  olSetupKey = "";
  olPrevStatus = null;
  olPrevMembers = room ? room.members.length : 0;
  olTimeoutSent = false;
  olRejected = new Set();
  if (!olSaved) {
    olSaved = {
      aiMode,
      iAmCho,
      timeLimitMinutes: typeof timeLimitMinutes === "number" ? timeLimitMinutes : 0,
      newGameState: newGameState.slice()
    };
  }
  if (typeof olAiEnterRoom === "function") olAiEnterRoom(id);
}

async function olEnterRoom(id, room, how) {
  olSpectating = false;
  olResetRoomState(id, room);
  olMySide = olSideOfUid(room, olUser.uid);
  olSetUrlRoom(id);
  olUnsubs.push(olBackend.watchRoom(id, olOnRoom));
  olUnsubs.push(olBackend.watchMoves(id, list => {
    olMoves = list;
    olReconcile();
  }));
  olUnsubs.push(olBackend.watchChat(id, list => {
    olChat = list;
    olEmit("chat");
  }));
  olEmit("enter");
  const me = `${olSideName(olMySide)} 대국자 ${olUser.name}`;
  if (how === "create") olSystem(`${me}님이 방을 만들었습니다.`);
  else if (how === "join") olSystem(`${me}님이 들어왔습니다. 상차림을 고르고 준비를 누르면 방장이 대국을 시작합니다.`);
  else olSystem(`${me}님이 다시 들어왔습니다.`);
}

/**
 * 공개 대국 관전 (로그인 없이). 공개 요약과 수만 읽는다. 채팅은 읽지 않는다.
 * @param {string} rawId
 */
async function olSpectate(rawId) {
  const id = olCleanCode(rawId);
  if (!id) throw Object.assign(new Error("코드를 확인해 주세요"), { code: "not-found" });
  if (!olBackend || !olBackend.watchLobbyRoom) throw new Error("온라인 연결 준비 중입니다");
  if (olRoomId === id && olSpectating) return id;
  if (olRoomId) await olLeaveRoom(true);
  olSpectating = true;
  olMySide = null;
  olResetRoomState(id, null);
  olSetUrlRoom(id, "watch");
  olUnsubs.push(olBackend.watchLobbyRoom(id, s => olOnRoom(s ? olRoomFromSummary(s) : null)));
  olUnsubs.push(olBackend.watchPublicMoves(id, list => {
    olMoves = list;
    olReconcile();
  }));
  olEmit("enter");
  return id;
}

/** 공개 요약(functions/lobby-core.js) → 이 파일이 쓰는 방 모양 (uid 없음) */
function olRoomFromSummary(s) {
  const tags = s.tags || {};
  const seat = (n, side) => (n ? { uid: "", name: n, tag: tags[side] || "" } : null);
  return {
    app: "janggi",
    visibility: "public",
    status: s.status,
    hostUid: "",
    members: [],
    seats: { cho: seat(s.players.cho, "cho"), han: seat(s.players.han, "han") },
    charim: s.charim,
    timeLimitMin: s.timeLimitMin,
    sidePick: "",
    ready: false,
    ply: s.ply,
    clock: s.clock,
    lastMoveAtMs: s.lastMoveAtMs,
    startedAtMs: s.startedAtMs,
    createdAtMs: s.createdAtMs,
    undo: null,
    result: s.result
  };
}

/** 공개 대국 목록 구독 (로그인 없이). cb(list) → 끊는 함수 */
function olWatchLobby(cb) {
  if (!olBackend || !olBackend.watchLobby) return () => {};
  return olBackend.watchLobby(cb);
}

/** 방 문서가 바뀔 때 */
function olOnRoom(room) {
  if (!olRoomId) return;
  if (!room) {
    olToast(olSpectating ? "관전하던 대국이 열린 대국 목록에서 사라졌습니다." : "방이 없어졌습니다.");
    olLeaveLocal();
    return;
  }
  olRoom = room;
  if (!olSpectating && olUser) olMySide = olSideOfUid(room, olUser.uid); // 방장이 진영을 바꾸면 자리가 옮겨 간다
  const key = olSetupKeyOf(room);
  if (!olBoardReady) {
    olSetupBoard(room, false);
    olBoardReady = true;
    olReconcile();
    olRestoreClock(room);
  } else if (room.status === "waiting" && key !== olSetupKey) {
    olSetupBoard(room, true); // 시작 전 설정이 바뀌면 판을 다시 차린다 (상대 상차림을 실시간으로)
  }
  // 시작 전: 상대가 들어오거나 나가면 방장에게 알린다
  const n = room.members.length;
  if (!olSpectating && room.status === "waiting" && n !== olPrevMembers && olAmHost()) {
    olToast(n > olPrevMembers ? "상대가 들어왔습니다. 상대가 준비하면 시작할 수 있습니다." : "상대가 자리에서 나갔습니다.", 3000);
  }
  olPrevMembers = n;
  olSyncNames(room);
  const status = room.status;
  if (olPrevStatus !== status) {
    const was = olPrevStatus;
    olPrevStatus = status;
    if (status === "playing") {
      gameEnded = false;
      if (was === "waiting") {
        if (typeof initGameTimer === "function") initGameTimer();
        olToast("대국을 시작합니다. 초가 먼저 둡니다.");
      }
      if (typeof olAiStartGame === "function") olAiStartGame();
    } else {
      gameEnded = true;
      if (status === "ended" && typeof olAiEndGame === "function") olAiEndGame();
      if (status === "ended" && was === "playing") {
        olToast(`대국이 끝났습니다: ${olResultText(room)}`, 4000);
      }
      if (status === "closed") olToast("방장이 방을 닫았습니다.");
    }
  }
  olEmit("room");
}

function olResultText(room) {
  const r = room && room.result;
  if (!r) return "";
  const reason = OL_REASON_KO[r.reason] || r.reason || "";
  if (!r.winner) return `무승부 (${reason})`;
  return `${olSideName(r.winner)} 승 (${reason})`;
}

function olSetupKeyOf(room) {
  return `${olViewSide()}|${room.charim.cho}|${room.charim.han}|${room.timeLimitMin}`;
}

/** 제한 시간 고르기 칸을 방 값에 맞춘다 (저장하지 않음) */
function olSyncTimeSelect(min) {
  const sel = document.getElementById("time-limit-select");
  if (!sel) return;
  const v = String(min || 0);
  if (![...sel.options].some(o => o.value === v)) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = `${v}분`;
    sel.appendChild(o);
  }
  sel.value = v;
}

/**
 * 방 설정(내 진영·상차림·제한 시간)대로 판을 새로 차린다.
 * @param {Object} room
 * @param {boolean} light - 시작 전 설정만 바뀐 경우: 서랍·기보 정보는 그대로 두고 기물만 다시 놓는다
 */
function olSetupBoard(room, light) {
  olSetupKey = olSetupKeyOf(room);
  const view = olViewSide();
  const amCho = view === "cho";
  if (light) {
    olBypass = true;
    try {
      const flip = iAmCho !== amCho;
      if (flip) changeNation(amCho);
      newGameState[0] = room.charim[view] | 0;
      newGameState[1] = room.charim[olOther(view)] | 0;
      if (typeof syncCharimButtonStyles === "function") syncCharimButtonStyles();
      log.length = 0;
      const turnEl = document.getElementById("turn");
      if (turnEl) turnEl.value = 0;
      applyLayoutCode(getStartingLayoutCode());
      curSelect = NO_PIECE;
      clearCandiBox();
      if (typeof svg !== "undefined" && svg) svg.classList.add("no-transition");
      if (flip && typeof initBoard === "function") initBoard();
      initPositions();
      if (typeof svg !== "undefined" && svg) {
        svg.offsetHeight; // 바로 자리잡기
        svg.classList.remove("no-transition");
      }
      if (typeof updateScore === "function") updateScore();
    } finally {
      olBypass = false;
    }
    olSynced = [];
    timeLimitMinutes = room.timeLimitMin || 0;
    olSyncTimeSelect(timeLimitMinutes);
    if (typeof hgUpdateTime === "function") hgUpdateTime();
    return;
  }
  if (typeof isPreviewActive === "function" && isPreviewActive() && typeof exitPreviewMode === "function") exitPreviewMode();
  if (typeof isAutoplayActive !== "undefined" && isAutoplayActive && typeof stopAutoplay === "function") stopAutoplay();
  // 새 대국 차리기(startNewGame)가 오른쪽 서랍을 닫으므로, 열려 있었으면 채팅 영역으로 다시 연다
  const rightWasOpen = typeof isRightDrawerOpen === "function" && isRightDrawerOpen();
  const rightTab = typeof drawerActiveTab !== "undefined" ? drawerActiveTab.right : "";
  olBypass = true;
  try {
    if (iAmCho !== amCho) changeNation(amCho);
    newGameState[0] = room.charim[view] | 0;
    newGameState[1] = room.charim[olOther(view)] | 0;
    if (typeof syncCharimButtonStyles === "function") syncCharimButtonStyles();
    aiMode = 0;
    if (typeof aiSidePref !== "undefined") aiSidePref = null;
    startNewGame();
  } finally {
    olBypass = false;
  }
  timeLimitMinutes = room.timeLimitMin || 0; // 저장하지 않는다 (나가면 되돌림)
  olSyncTimeSelect(timeLimitMinutes);
  gameMetadata.tournament = olSpectating ? "온라인 대국 (관전)" : "온라인 대국";
  gameMetadata.round = `방 ${olRoomId}`;
  olSynced = [];
  gameEnded = room.status !== "playing";
  // 시작 전에 '새 대국' 탭을 보고 있었으면 그대로, 아니면 채팅으로 (관전자는 채팅이 없으므로 보던 탭 그대로)
  if (rightWasOpen && typeof jumpToDrawerSection === "function") {
    jumpToDrawerSection(olSpectating || (room.status === "waiting" && rightTab === "rd-sec-newgame") ? rightTab : "ol-sec-chat");
  }
}

function olSyncNames(room) {
  const cho = room.seats.cho ? room.seats.cho.name : "";
  const han = room.seats.han ? room.seats.han.name : "";
  if (gameMetadata.choPlayer === cho && gameMetadata.hanPlayer === han) return;
  gameMetadata.choPlayer = cho;
  gameMetadata.hanPlayer = han;
  if (typeof updateMetadataFormFromState === "function") updateMetadataFormFromState();
  if (typeof updateMetadataDisplay === "function") updateMetadataDisplay();
  if (typeof hgUpdateNames === "function") hgUpdateNames();
}

/** 다시 들어왔을 때 시계: 마지막 수 뒤로 흐른 시간은 지금 둘 사람에게 더한다 */
function olRestoreClock(room) {
  const c = room.clock || { cho: 0, han: 0 };
  choTimeSpent = c.cho | 0;
  hanTimeSpent = c.han | 0;
  if (room.status === "playing") {
    const elapsed = Math.max(0, Math.floor((Date.now() - (room.lastMoveAtMs || Date.now())) / 1000));
    if (olSideOfPly(room.ply) === "cho") choTimeSpent += elapsed;
    else hanTimeSpent += elapsed;
    if (typeof ensureGameTimer === "function") ensureGameTimer();
  }
  if (typeof hgUpdateTime === "function") hgUpdateTime();
}

/** 방에서 나가기. silent면 묻지 않는다 */
async function olLeaveRoom(silent) {
  if (!olRoomId) return;
  if (!silent && olRoom && olRoom.status === "playing" &&
      !(await olConfirm("방에서 나갈까요?", "대국 중입니다. 나가도 초대 링크로 다시 들어와 이어 둘 수 있습니다.", "나가기"))) return;
  if (olSpectating) {
    olLeaveLocal();
    return;
  }
  const id = olRoomId;
  const room = olRoom;
  try {
    await olSystem(`${olSideName(olMySide)} 대국자 ${olUser ? olUser.name : ""}님이 나갔습니다.`);
    if (room && room.status === "waiting" && olUser && room.hostUid === olUser.uid) {
      await olBackend.updateRoom(id, olUser.uid, { status: "closed" });
    } else if (room && room.status === "waiting" && olUser) {
      // 시작 전 상대가 나가면 자리를 비운다 (방은 다시 상대를 기다림, firestore.rules guestLeave)
      const seats = Object.assign({}, room.seats, { [olMySide]: null });
      await olBackend.updateRoom(id, olUser.uid, { seats, members: [room.hostUid], ready: false });
    }
  } catch (e) {
    console.warn("[online] 나가기 알림을 보내지 못했습니다:", e);
  }
  olLeaveLocal();
}

/** 구독을 끊고 방에 들어가기 전 설정으로 되돌린다 (서버에는 쓰지 않음) */
function olLeaveLocal() {
  olUnsubs.forEach(u => {
    try {
      u();
    } catch (e) {
      // 이미 끊김
    }
  });
  olUnsubs = [];
  olRoomId = null;
  olRoom = null;
  olMySide = null;
  olSpectating = false;
  olMoves = [];
  olChat = [];
  olBoardReady = false;
  olSetupKey = "";
  olPending = null;
  olSetUrlRoom(null);
  if (typeof olAiLeaveRoom === "function") olAiLeaveRoom();
  if (olSaved) {
    aiMode = olSaved.aiMode;
    timeLimitMinutes = olSaved.timeLimitMinutes;
    olSyncTimeSelect(timeLimitMinutes);
    newGameState[0] = olSaved.newGameState[0];
    newGameState[1] = olSaved.newGameState[1];
    if (typeof syncCharimButtonStyles === "function") syncCharimButtonStyles();
    if (typeof hgUpdateTime === "function") hgUpdateTime();
    olSaved = null;
  }
  gameEnded = true; // 두던 판은 그대로 두고 살펴보기만 (새 대국으로 다시 시작)
  olEmit("room");
  olEmit("chat");
}

/** 주소에 ?room= 이 있으면 로그인한 뒤 바로 들어간다 */
function olAutoJoinFromUrl() {
  const id = olCleanCode(new URLSearchParams(window.location.search).get("room"));
  if (!id || olRoomId === id || !olUser) return;
  olJoinRoom(id).catch(err => {
    olToast(`방에 들어가지 못했습니다: ${olErrorText(err)}`, 3500);
    if (err && (err.code === "not-found" || err.code === "room-full" || err.code === "room-closed")) olSetUrlRoom(null);
    olEmit("join-error");
  });
}

function olUrlRoom() {
  return olCleanCode(new URLSearchParams(window.location.search).get("room"));
}

// ===== 수 동기화 =====

function olSameMove(a, b) {
  return a && b && a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
}

function olValidShape(m, ply) {
  const ok = v => Number.isInteger(v) && v >= 0 && v <= 9;
  return m && m.ply === ply && ok(m.fx) && ok(m.fy) && ok(m.tx) && ok(m.ty) && m.fx >= 1 && m.tx >= 1;
}

/** 서버 수 목록에 이 화면 판을 맞춘다 */
function olReconcile() {
  if (!olBoardReady || !olRoomId) return;
  let k = 0;
  while (k < olSynced.length && k < olMoves.length && olSameMove(olSynced[k], olMoves[k])) k++;
  if (k < olSynced.length) {
    // 보내는 중인 내 수 하나만 더 있는 것은 정상
    if (olPending === k && k === olSynced.length - 1 && olMoves.length === k) return;
    olRevertTo(k);
  }
  const todo = olMoves.length - k;
  if (todo <= 0) return;
  if (todo === 1 && k === log.length) {
    olApplyRemote(olMoves[k], k, true);
  } else {
    for (let j = k; j < olMoves.length; j++) {
      if (!olApplyRemote(olMoves[j], j, false)) break;
    }
    olRedrawAfterSilent();
  }
  olEmit("moves");
}

/** 이 화면 판을 k수까지 되돌린다 (무르기·보내기 실패) */
function olRevertTo(k) {
  if (typeof isPreviewActive === "function" && isPreviewActive() && typeof exitPreviewMode === "function") exitPreviewMode();
  log.length = k;
  olSynced.length = k;
  olPending = null;
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.value = k;
  if (olRoom && olRoom.status === "playing") gameEnded = false;
  olRedrawAfterSilent();
}

function olRedrawAfterSilent() {
  const turnEl = document.getElementById("turn");
  if (turnEl) turnEl.value = log.length;
  curSelect = NO_PIECE;
  clearCandiBox();
  if (typeof svg !== "undefined" && svg) svg.classList.add("no-transition");
  initPositions();
  if (typeof svg !== "undefined" && svg) {
    svg.offsetHeight; // 바로 자리잡기
    svg.classList.remove("no-transition");
  }
  if (log.length > 0) moveSelectBox(log[log.length - 1].i);
  else moveSelectBox(0, false);
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  if (prevBtn) prevBtn.disabled = log.length === 0;
  if (nextBtn) nextBtn.disabled = true;
  const recordBox = document.getElementById("record-box");
  if (recordBox && recordBox.style.display === "flex" && typeof updateRecordUI === "function") updateRecordUI();
  if (typeof updateCommentBubble === "function") updateCommentBubble();
  if (typeof pvRefresh === "function") pvRefresh();
}

/**
 * 받은 수 하나를 규칙 검사 뒤 둔다.
 * @param {Object} m - 서버 수 {ply, fx, fy, tx, ty, clock}
 * @param {number} ply - 이 수가 있어야 할 번호
 * @param {boolean} animate - true면 move()로 움직이는 모습까지 (한 수만 새로 왔을 때)
 * @returns {boolean} 두었는지
 */
function olApplyRemote(m, ply, animate) {
  const rejectKey = m ? `${ply}:${m.fx}${m.fy}${m.tx}${m.ty}` : `${ply}:?`;
  if (olRejected.has(rejectKey)) return false;
  const side = olSideOfPly(ply);
  // 규칙 검사는 판의 실제 마지막 국면에서 해야 한다: 놓아보기 중이면 끝내고, 과거를 보는 중이면 끝으로
  if (animate) {
    if (typeof isPreviewActive === "function" && isPreviewActive() && typeof exitPreviewMode === "function") {
      exitPreviewMode();
      olToast("상대가 두어 놓아보기를 끝냈습니다.");
    }
    if (olTurnStep() !== log.length) olRedrawAfterSilent();
  }
  let reason = "";
  if (!olValidShape(m, ply)) reason = "수 모양이 잘못됨";
  let i = NO_PIECE;
  let to = null;
  if (!reason) {
    const from = olCanon(m.fx, m.fy);
    to = olCanon(m.tx, m.ty);
    i = whoIsit(from.x, from.y);
    if (i >= NO_PIECE) reason = "출발 칸에 기물이 없음";
    else if (((i < 16) === iAmCho ? "cho" : "han") !== side) reason = `${olSideName(side)} 차례에 상대 기물을 움직임`;
    else if (from.x === to.x && from.y === to.y) {
      // 한수쉼 (pass-turn.js): 궁만, 장군을 받고 있지 않을 때만
      if (i !== 0 && i !== 16) reason = "궁이 아닌 기물의 제자리 수";
      else if (isKingInCheck(side)) reason = "장군을 받는 중의 한수쉼";
    } else if (!getFilteredLegalMoves(side).some(mm => mm.i === i && mm.x === to.x && mm.y === to.y)) reason = "규칙에 어긋난 수";
  }
  if (reason) {
    olRejected.add(rejectKey);
    console.warn(`[online] 받은 ${ply + 1}수를 거부했습니다: ${reason}`, m);
    olToast(`받은 ${ply + 1}수(${olSideName(side)})를 판에 두지 않았습니다: ${reason}.`, 4000);
    olEmit("rejected", { ply, reason });
    return false;
  }
  if (animate) {
    olApplying = true;
    try {
      move(i, to.x, to.y);
    } finally {
      olApplying = false;
    }
  } else {
    const found = whoIsit(to.x, to.y);
    const t = found === i ? NO_PIECE : found; // 한수쉼은 자기를 잡지 않는다
    if (t < NO_PIECE) {
      pieces[t].x = 0;
      pieces[t].y = 0;
    }
    pieces[i].x = to.x;
    pieces[i].y = to.y;
    log.push({ i, x: to.x, y: to.y, t });
  }
  olSynced.push({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty });
  // 상대가 잰 상대 시간을 받아 쓴다 (내 시간은 내 화면 값 그대로)
  if (m.clock && side !== olMySide) {
    if (side === "cho") choTimeSpent = m.clock.cho | 0;
    else hanTimeSpent = m.clock.han | 0;
    if (typeof hgUpdateTime === "function") hgUpdateTime();
  }
  return true;
}

/** 내가 판에서 둔 수를 보낸다 (online-ai.js의 move 감싸기가 부른다) */
function olSendMyMove(fromLocal, x, y) {
  const ply = olSynced.length;
  const f = olCanon(fromLocal.x, fromLocal.y);
  const t = olCanon(x, y);
  const now = Date.now();
  const mv = { ply, by: olUser.uid, fx: f.x, fy: f.y, tx: t.x, ty: t.y, clock: { cho: choTimeSpent, han: hanTimeSpent }, atMs: now };
  olSynced.push({ fx: f.x, fy: f.y, tx: t.x, ty: t.y });
  olPending = ply;
  const patch = { clock: mv.clock, lastMoveAtMs: now, undo: null };
  // move() 안의 checkGameStatus(와 game-rules.js)가 대국을 끝냈으면 까닭을 가려 서버에 남긴다
  const opp = olOther(olMySide);
  const n = log.length;
  const doublePass = gameEnded && typeof isPassMove === "function" && n >= 2 && isPassMove(n - 1) && isPassMove(n - 2);
  const mate = gameEnded && !doublePass && isKingInCheck(opp) && getFilteredLegalMoves(opp).length === 0;
  let passWinner = null;
  if (doublePass) {
    patch.status = "ended";
    const rules = typeof getGameRules === "function" ? getGameRules() : {};
    if (rules.doublePass !== "draw") {
      const s = calculateTeamScores();
      passWinner = s.scoreCho > s.scoreHan ? "cho" : s.scoreHan > s.scoreCho ? "han" : null;
    }
    patch.result = { winner: passWinner, reason: "doublePass", by: olUser.uid, atMs: now };
  } else if (mate) {
    patch.status = "ended";
    patch.result = { winner: olMySide, reason: "checkmate", by: olUser.uid, atMs: now };
  }
  olBackend.addMove(olRoomId, olUser.uid, mv, patch).then(() => {
    if (olPending === ply) olPending = null;
    olEmit("room"); // 무르기 요청 단추 등은 보내기가 끝난 뒤에 쓸 수 있다
    if (mate) olSystem(`외통수! ${olSideName(olMySide)} 대국자가 이겼습니다.`);
    if (doublePass) olSystem(`연속 한수쉼으로 대국이 끝났습니다. ${passWinner ? `${olSideName(passWinner)} 승 (기물 점수)` : "무승부"}.`);
  }).catch(err => {
    console.error("[online] 수를 보내지 못했습니다:", err);
    if (olPending === ply) olPending = null;
    olToast(`수를 보내지 못해 되돌립니다: ${olErrorText(err)}`, 3500);
    olReconcile();
  });
  olEmit("moves");
}

// ===== 채팅·시스템 메시지 =====

function olSendChat(text, kind) {
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, OL_CHAT_MAX);
  if (!clean || !olRoomId || !olUser || olSpectating) return Promise.resolve(false);
  const msg = {
    uid: olUser.uid,
    name: olUser.name.slice(0, OL_NAME_MAX),
    side: olMySide || "",
    text: clean,
    kind: kind === "system" ? "system" : "user",
    atMs: Date.now()
  };
  return olBackend.sendChat(olRoomId, olUser.uid, msg).then(() => true).catch(err => {
    console.error("[online] 채팅을 보내지 못했습니다:", err);
    olToast(`메시지를 보내지 못했습니다: ${olErrorText(err)}`);
    return false;
  });
}

function olSystem(text) {
  return olSendChat(text, "system");
}

// ===== 시작 전 방 설정 (방장: 자기 상차림·진영·제한 시간, 상대: 자기 상차림·준비) =====

function olNeedSetup() {
  if (!olInSetup() || !olUser) throw Object.assign(new Error("대국을 시작하기 전에만 바꿀 수 있습니다."), { code: "failed-precondition" });
}

/** 내 상차림 (방장·상대 모두). 바꾸면 준비가 풀린다 */
async function olSetMyCharim(k) {
  olNeedSetup();
  const type = Math.max(0, Math.min(3, k | 0));
  if (olRoom.charim[olMySide] === type) return;
  const wasReady = !!olRoom.ready;
  const charim = Object.assign({}, olRoom.charim, { [olMySide]: type });
  const host = olAmHost();
  await olBackend.updateRoom(olRoomId, olUser.uid, { charim, ready: false });
  if (host && olGuestSeated()) {
    olSystem(`방장이 상차림을 ${OL_CHARIM_KO[type]}로 바꿨습니다.${wasReady ? " 상대의 준비가 풀렸습니다." : ""}`);
  } else if (!host && wasReady) {
    olSystem(`${olSideName(olMySide)} 대국자가 상차림을 ${OL_CHARIM_KO[type]}로 바꿔 준비가 풀렸습니다.`);
  }
}

/**
 * 방장 설정: 진영(자리 맞바꾸기, 상대 자리·상차림이 함께 옮겨 감)과 제한 시간. 바꾸면 상대의 준비가 풀린다.
 * @param {{side?: "cho"|"han"|"random", timeLimitMin?: number}} opts
 */
async function olSetHostSettings(opts) {
  olNeedSetup();
  if (!olAmHost()) throw Object.assign(new Error("방장만 바꿀 수 있습니다."), { code: "permission-denied" });
  const o = olRoom;
  const pick = opts.side || o.sidePick || olMySide;
  const side = opts.side ? olPickSide(pick) : olMySide;
  const time = opts.timeLimitMin === undefined ? o.timeLimitMin : Math.max(0, Math.min(180, opts.timeLimitMin | 0));
  const swap = side !== olMySide;
  if (!swap && time === o.timeLimitMin && pick === o.sidePick) return;
  const seats = swap ? { cho: o.seats.han, han: o.seats.cho } : o.seats;
  const charim = swap ? { cho: o.charim.han, han: o.charim.cho } : o.charim;
  const wasReady = !!o.ready;
  await olBackend.updateRoom(olRoomId, olUser.uid, { seats, charim, timeLimitMin: time, sidePick: pick, ready: false });
  if (olGuestSeated()) {
    const parts = [];
    if (swap) parts.push(`방장 진영 ${olSideName(side)}${pick === "random" ? "(무작위)" : ""}`);
    if (time !== o.timeLimitMin) parts.push(`제한 시간 ${time ? `${time}분` : "없음"}`);
    if (parts.length) olSystem(`방장이 설정을 바꿨습니다: ${parts.join(" · ")}.${wasReady ? " 상대의 준비가 풀렸습니다." : ""}`);
  }
}

/** 상대: 준비 / 준비 풀기 */
async function olSetReady(on) {
  olNeedSetup();
  if (olAmHost()) return;
  if (!!olRoom.ready === !!on) return;
  await olBackend.updateRoom(olRoomId, olUser.uid, { ready: !!on });
  olSystem(on ? `${olSideName(olMySide)} 대국자가 준비했습니다. 방장이 판을 확인하고 시작합니다.` : `${olSideName(olMySide)} 대국자가 준비를 풀었습니다.`);
}

/** 방장: 상대가 준비한 뒤 대국 시작 */
async function olStartGame() {
  olNeedSetup();
  if (!olAmHost()) throw Object.assign(new Error("방장만 시작할 수 있습니다."), { code: "permission-denied" });
  if (!olGuestSeated() || !olRoom.ready) throw Object.assign(new Error("상대가 준비하지 않았습니다"), { code: "not-ready" });
  const now = Date.now();
  await olBackend.updateRoom(olRoomId, olUser.uid, { status: "playing", startedAtMs: now, lastMoveAtMs: now });
  olSystem("방장이 대국을 시작했습니다. 초가 먼저 둡니다.");
}

// ===== 대국 끝·무르기 =====

async function olEndGame(winner, reason) {
  if (!olRoom || olRoom.status !== "playing") return;
  const now = Date.now();
  try {
    await olBackend.updateRoom(olRoomId, olUser.uid, {
      status: "ended",
      result: { winner, reason, by: olUser.uid, atMs: now },
      clock: { cho: choTimeSpent, han: hanTimeSpent },
      undo: null
    });
  } catch (e) {
    olToast(`대국 결과를 보내지 못했습니다: ${olErrorText(e)}`);
  }
}

async function olResign() {
  if (!olGameActive()) return;
  if (!(await olConfirm("기권할까요?", "상대가 이깁니다. 기권한 대국은 되돌릴 수 없습니다.", "기권", "warn"))) return;
  await olEndGame(olOther(olMySide), "resign");
  olSystem(`${olSideName(olMySide)} 대국자가 기권했습니다. ${olSideName(olOther(olMySide))} 승.`);
}

/** 내가 방금 둔 수(지금 상대 차례)만 무르기를 청할 수 있다 */
function olCanRequestUndo() {
  return olGameActive() && olRoom.ply > 0 && !olRoom.undo && olPending === null &&
    olSideOfPly(olRoom.ply - 1) === olMySide;
}

async function olRequestUndo() {
  if (!olCanRequestUndo()) {
    olToast("방금 둔 내 수만 무르기를 청할 수 있습니다.");
    return;
  }
  try {
    await olBackend.updateRoom(olRoomId, olUser.uid, { undo: { by: olUser.uid, ply: olRoom.ply, atMs: Date.now() } });
    olSystem(`${olSideName(olMySide)} 대국자가 ${olRoom.ply}수 무르기를 청했습니다.`);
  } catch (e) {
    olToast(`무르기를 청하지 못했습니다: ${olErrorText(e)}`);
  }
}

async function olAnswerUndo(accept) {
  const u = olRoom && olRoom.undo;
  if (!u || u.by === olUser.uid) return;
  try {
    if (accept) {
      await olBackend.undoLast(olRoomId, olUser.uid, olRoom.ply, { lastMoveAtMs: Date.now() });
      olSystem(`${olSideName(olMySide)} 대국자가 무르기를 받아들였습니다.`);
    } else {
      await olBackend.updateRoom(olRoomId, olUser.uid, { undo: null });
      olSystem(`${olSideName(olMySide)} 대국자가 무르기를 거절했습니다.`);
    }
  } catch (e) {
    olToast(`무르기 처리에 실패했습니다: ${olErrorText(e)}`);
  }
}

// ===== 시간패 =====

function olTick() {
  if (!olGameActive() || olTimeoutSent || olSpectating) return;
  const limit = (olRoom.timeLimitMin || 0) * 60;
  if (limit <= 0) return;
  const side = olSideOfPly(log.length);
  const spent = side === "cho" ? choTimeSpent : hanTimeSpent;
  if (side === olMySide && spent >= limit) {
    olTimeoutSent = true;
    olEndGame(olOther(side), "timeout").then(() =>
      olSystem(`${olSideName(side)} 대국자의 제한 시간이 끝났습니다. ${olSideName(olOther(side))} 승 (시간패).`));
  } else if (side !== olMySide && spent >= limit + OL_TIMEOUT_GRACE_S) {
    olTimeoutSent = true;
    olEndGame(olMySide, "timeout").then(() =>
      olSystem(`${olSideName(side)} 대국자의 제한 시간이 끝났습니다. ${olSideName(olMySide)} 승 (시간패).`));
  }
}

// ===== 시작 =====

document.addEventListener("DOMContentLoaded", () => {
  setInterval(olTick, 1000);
  olInitBackend();
});
