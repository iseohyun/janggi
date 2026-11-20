/**
 * @fileoverview 웹장기 Cloud Functions (2세대 callable).
 *  - sendEmailCode   : 이메일·비밀번호 가입자에게 6자리 인증 코드를 메일로 보낸다 (10분 만료, 60초에 1번·하루 10번)
 *  - verifyEmailCode : 코드를 확인한다 (5번 틀리면 15분 잠금). 맞으면 Auth의 emailVerified=true,
 *                      games/janggi/users/{uid}에 사용자 등록 → 보안 규칙이 "인증된 사용자"로 본다
 * 규칙: functions/email-code-core.js, 본체: functions/handlers.js, 메일: functions/mailer.js
 *
 * 배포 설정 (docs/online-setup.md 7장):
 *  - 비밀값 MAIL_SECRET (Secret Manager): SMTP 앱 비밀번호 또는 메일 서비스 API 키
 *  - 매개변수 MAIL_PROVIDER, MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER (functions/.env 또는 배포 때 입력)
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret, defineString, defineInt } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");
const { makeHandlers } = require("./handlers");
const { makeMailer } = require("./mailer");

// 클라이언트(module/online/firebase-backend.js)의 getFunctions 지역과 같게
setGlobalOptions({ region: "asia-northeast3", maxInstances: 5 });

const MAIL_SECRET = defineSecret("MAIL_SECRET");
const MAIL_PROVIDER = defineString("MAIL_PROVIDER", { default: "smtp", description: "smtp | resend | sendgrid | trigger-email | log(에뮬레이터)" });
const MAIL_FROM = defineString("MAIL_FROM", { default: "", description: "보내는 사람, 예: 웹장기 <you@gmail.com>" });
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const SMTP_PORT = defineInt("SMTP_PORT", { default: 465 });
const SMTP_USER = defineString("SMTP_USER", { default: "", description: "SMTP 계정 (Gmail 주소)" });

initializeApp();

let handlers = null;

function getHandlers() {
  if (handlers) return handlers;
  const db = getFirestore();
  const store = {
    runTransaction: fn => db.runTransaction(t => fn({
      get: async path => {
        const snap = await t.get(db.doc(path));
        return snap.exists ? snap.data() : null;
      },
      set: (path, data) => t.set(db.doc(path), data)
    })),
    set: (path, data) => db.doc(path).set(data, { merge: true })
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
    auth: getAuth(),
    mailer,
    fail: (code, message, details) => new HttpsError(code, message, details),
    log: logger
  });
  return handlers;
}

const callOpts = { secrets: [MAIL_SECRET], cors: true };

exports.sendEmailCode = onCall(callOpts, request => getHandlers().sendEmailCode(request));
exports.verifyEmailCode = onCall(callOpts, request => getHandlers().verifyEmailCode(request));
