/**
 * @fileoverview 웹장기 Cloud Functions (2세대 callable): 이메일 "다른 기기 승인형" 로그인.
 *  - startEmailLogin   : 이메일만 받아 로그인 요청을 만들고 승인 메일을 보낸다 (요청자에게 claimSecret·확인 숫자)
 *  - getEmailLogin     : 승인 페이지가 요청 시각·기기·숫자 보기 3개를 읽는다 (아무것도 바꾸지 않음)
 *  - approveEmailLogin : 고른 숫자가 맞으면 승인, 틀리면 거부·폐기
 *  - denyEmailLogin    : "내가 요청한 게 아님" → 거부·폐기
 *  - claimEmailLogin   : 요청자가 상태를 묻는다. 승인되었으면 custom token을 한 번만 내주고 요청을 지운다
 *  - revokeAllSessions : 모든 기기에서 로그아웃 (revokeRefreshTokens + users/{uid}.revokedAt)
 *  - noteLogin         : Google 로그인 직후 기기 기록, 처음 보는 기기면 알림 메일 (이메일 승인형은 claimEmailLogin 안에서)
 *  - revokeByLink      : 알림 메일의 "모든 기기에서 로그아웃" 링크 페이지에서 확인을 누르면 (7일, 한 번만)
 *  - syncLobby         : (Firestore 트리거) 방 문서가 바뀌면 공개 대국 요약 games/janggi/lobby/{roomId}를 쓰거나 지운다
 *  - cleanupLobby      : (예약, 10분마다) 마지막 활동 뒤 30분 지난 요약을 지운다. 흐름: functions/lobby.js, lobby-core.js
 * 흐름·규칙: functions/email-login-core.js, 연결: functions/handlers.js, 메일: functions/mailer.js
 *
 * 배포 설정 (docs/online-setup.md 7장):
 *  - 비밀값 MAIL_SECRET (Secret Manager): SMTP 앱 비밀번호 또는 메일 서비스 API 키
 *  - 매개변수 MAIL_PROVIDER, MAIL_FROM, APP_ORIGINS, SMTP_HOST, SMTP_PORT, SMTP_USER (functions/.env 또는 배포 때 입력)
 *  - custom token을 만들려면 함수 서비스 계정에 "서비스 계정 토큰 생성자" 권한이 필요할 수 있다 (문서 7장)
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret, defineString, defineInt } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { makeHandlers, adminUsers } = require("./handlers");
const { makeMailer } = require("./mailer");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { makeLobby } = require("./lobby");
const { ROOT: LOBBY_ROOT } = require("./lobby-core");

// 클라이언트(module/online/firebase-backend.js)의 getFunctions 지역과 같게
setGlobalOptions({ region: "asia-northeast3", maxInstances: 5 });

const MAIL_SECRET = defineSecret("MAIL_SECRET");
const MAIL_PROVIDER = defineString("MAIL_PROVIDER", { default: "smtp", description: "smtp | resend | sendgrid | trigger-email | log(에뮬레이터)" });
const MAIL_FROM = defineString("MAIL_FROM", { default: "", description: "보내는 사람, 예: 웹장기 <you@gmail.com>" });
const APP_ORIGINS = defineString("APP_ORIGINS", { default: "https://janggi.iseohyun.com", description: "승인 링크에 쓸 배포 주소(쉼표로 여러 개). localhost는 늘 허용" });
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const SMTP_PORT = defineInt("SMTP_PORT", { default: 465 });
const SMTP_USER = defineString("SMTP_USER", { default: "", description: "SMTP 계정 (Gmail 주소)" });

initializeApp();

let handlers = null;

/** 요청 기록은 만료 1일 뒤, 남용 방지 기록은 2일 뒤 지워도 된다 (TTL 정책을 켠 경우) */
function ttlField(data) {
  if (data && data.expiresAt) return { expireAt: new Date(data.expiresAt + 24 * 60 * 60 * 1000) };
  if (data && (data.lastAt || data.windowStart)) return { expireAt: new Date((data.lastAt || data.windowStart) + 2 * 24 * 60 * 60 * 1000) };
  return {};
}

function getHandlers() {
  if (handlers) return handlers;
  const db = getFirestore();
  // email-login-core.js의 저장소 모양: tx(읽기 먼저, 쓰기 나중)와 merge
  const store = {
    tx: fn => db.runTransaction(t => fn({
      get: async path => {
        const snap = await t.get(db.doc(path));
        return snap.exists ? snap.data() : null;
      },
      // expireAt: Firestore TTL 정책(선택, 문서 7장)이 지난 기록을 지우도록 붙인다
      set: (path, data) => t.set(db.doc(path), Object.assign({}, data, ttlField(data))),
      del: path => t.delete(db.doc(path))
    })),
    merge: (path, data) => db.doc(path).set(data, { merge: true })
  };
  const mailer = makeMailer({
    provider: MAIL_PROVIDER.value(),
    from: MAIL_FROM.value(),
    secret: () => MAIL_SECRET.value(),
    smtp: { host: SMTP_HOST.value(), port: SMTP_PORT.value(), user: SMTP_USER.value() },
    db,
    emulator: process.env.FUNCTIONS_EMULATOR === "true",
    log: logger
  });
  handlers = makeHandlers({
    store,
    users: adminUsers(getAuth()),
    mailer,
    allowedOrigins: APP_ORIGINS.value().split(",").map(v => v.trim()).filter(Boolean),
    fail: (code, message, details) => new HttpsError(code, message, details),
    log: logger
  });
  return handlers;
}

const callOpts = { secrets: [MAIL_SECRET], cors: true };

const plainOpts = { cors: true };

exports.startEmailLogin = onCall(callOpts, request => getHandlers().startEmailLogin(request));
exports.getEmailLogin = onCall(plainOpts, request => getHandlers().getEmailLogin(request));
exports.approveEmailLogin = onCall(plainOpts, request => getHandlers().approveEmailLogin(request));
exports.denyEmailLogin = onCall(plainOpts, request => getHandlers().denyEmailLogin(request));
exports.claimEmailLogin = onCall(callOpts, request => getHandlers().claimEmailLogin(request));
exports.revokeAllSessions = onCall(plainOpts, request => getHandlers().revokeAllSessions(request));
// 아래 둘과 claimEmailLogin은 알림 메일을 보낼 수 있다 (claim은 메일 비밀값이 필요)
exports.noteLogin = onCall(callOpts, request => getHandlers().noteLogin(request));
exports.revokeByLink = onCall(plainOpts, request => getHandlers().revokeByLink(request));

// ===== 공개 대국 목록 (games/janggi/lobby/{roomId}) =====
// 방 문서가 바뀔 때마다 요약을 다시 쓴다(클라이언트는 lobby에 쓸 수 없음, firestore.rules).
// Firestore 트리거는 데이터베이스와 같은 지역이어야 한다. 데이터베이스가 서울(asia-northeast3)이 아니면
// 아래 LOBBY_REGION을 데이터베이스 지역으로 바꾼다 (docs/online-setup.md 8장).
const LOBBY_REGION = "asia-northeast3";

let lobby = null;
function getLobby() {
  if (lobby) return lobby;
  const db = getFirestore();
  lobby = makeLobby({
    store: {
      set: (path, data) => db.doc(path).set(data),
      del: path => db.doc(path).delete(),
      staleIds: async (beforeMs, max) => {
        const snap = await db.collection(`${LOBBY_ROOT}/lobby`).where("activeAtMs", "<", beforeMs).limit(max).get();
        return snap.docs.map(d => d.id);
      }
    },
    now: () => Date.now(),
    log: logger
  });
  return lobby;
}

exports.syncLobby = onDocumentWritten({ document: `${LOBBY_ROOT}/rooms/{roomId}`, region: LOBBY_REGION }, event => {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  return getLobby().syncLobby(event.params.roomId, after);
});

exports.cleanupLobby = onSchedule({ schedule: "every 10 minutes", region: LOBBY_REGION, timeZone: "Asia/Seoul" },
  () => getLobby().cleanupLobby());
