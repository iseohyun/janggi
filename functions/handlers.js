/**
 * @fileoverview 이메일 승인형 로그인 callable 본체. Firebase 패키지에 기대지 않아 Node 테스트로 바로 돌릴 수 있다.
 * 흐름·규칙은 functions/email-login-core.js에 있고, 여기서는 Node crypto·Admin Auth·요청 정보(IP·User-Agent)를 이어 준다.
 * index.js가 Firestore 저장소·Admin Auth·메일·HttpsError를 넣어 준다.
 *  - 로그인 요청: games/janggi/loginRequests/{id}   (클라이언트는 규칙으로 읽기·쓰기 금지)
 *  - 남용 방지 기록: games/janggi/loginEmails/{이메일 해시}, games/janggi/loginIps/{IP 해시}   (클라이언트 금지)
 *  - 사용자: games/janggi/users/{uid}   (본인만 읽기, 쓰기는 이 함수만. revokedAt = 모든 기기 로그아웃 시각,
 *            devices = 로그인한 기기 {기기 ID 해시: {label, firstAt, lastAt}}, notify = 알림 메일 횟수)
 *  - 알림 메일의 로그아웃 링크: games/janggi/revokeLinks/{id}   (토큰 해시만, 7일, 한 번만. 클라이언트 금지)
 * @module functions/handlers
 */
const crypto = require("node:crypto");
const core = require("./email-login-core");

/**
 * Admin Auth로 사용자 찾기·만들기·토큰·로그아웃
 * @param {import("firebase-admin/auth").Auth} auth
 */
function adminUsers(auth) {
  return {
    async findOrCreate(email, name) {
      let u = null;
      try {
        u = await auth.getUserByEmail(email);
      } catch (e) {
        if (!e || e.code !== "auth/user-not-found") throw e;
      }
      if (!u) {
        const made = await auth.createUser({ email, emailVerified: true, displayName: name || undefined });
        return { uid: made.uid, name: made.displayName || name, isNew: true };
      }
      if (!u.emailVerified) {
        const patch = { emailVerified: true };
        // 인증 안 된 비밀번호 계정(남이 이 이메일로 먼저 만들었을 수 있음)은 비밀번호를 무작위로 바꿔 막는다
        if (u.providerData.some(p => p.providerId === "password")) patch.password = crypto.randomBytes(24).toString("base64url");
        await auth.updateUser(u.uid, patch);
      }
      return { uid: u.uid, name: u.displayName || name, isNew: false };
    },
    // 이메일 인증 여부는 사용자 기록(emailVerified=true)에 두므로 ID 토큰에 email_verified=true가 들어간다
    token: uid => auth.createCustomToken(uid),
    async revoke(uid) {
      await auth.revokeRefreshTokens(uid);
      const u = await auth.getUser(uid);
      return Math.floor(new Date(u.tokensValidAfterTime).getTime() / 1000);
    }
  };
}

/**
 * @param {Object} deps
 * @param {{tx: Function, merge: Function}} deps.store - email-login-core.js가 쓰는 저장소
 * @param {{findOrCreate: Function, token: Function, revoke: Function}} deps.users - adminUsers(auth) 또는 시험용
 * @param {{send: Function}} deps.mailer
 * @param {(code: string, message: string, details?: Object) => Error} deps.fail - HttpsError 만들기
 * @param {string[]} deps.allowedOrigins - 승인 링크에 쓸 수 있는 배포 주소 (localhost는 늘 허용)
 * @param {() => number} [deps.now]
 * @param {{info: Function, error: Function}} [deps.log]
 */
function makeHandlers(deps) {
  const login = core.makeEmailLogin({
    store: deps.store,
    users: deps.users,
    mailer: deps.mailer,
    fail: deps.fail,
    allowedOrigins: deps.allowedOrigins,
    log: deps.log || console,
    now: deps.now || (() => Date.now()),
    randomId: deps.randomId || (n => crypto.randomBytes(n).toString("base64url")),
    randomInt: deps.randomInt || (max => crypto.randomInt(0, max)),
    hash: async s => crypto.createHash("sha256").update(s).digest("hex")
  });

  function ctxOf(request) {
    const raw = (request && request.rawRequest) || {};
    const headers = raw.headers || {};
    return {
      auth: request && request.auth,
      ip: raw.ip || "",
      ua: headers["user-agent"] || ""
    };
  }

  const wrap = fn => request => fn(ctxOf(request), (request && request.data) || {});
  return {
    startEmailLogin: wrap(login.start),
    getEmailLogin: wrap(login.info),
    approveEmailLogin: wrap(login.approve),
    denyEmailLogin: wrap(login.deny),
    claimEmailLogin: wrap(login.claim),
    revokeAllSessions: wrap(login.revoke),
    noteLogin: wrap(login.noteLogin),
    revokeByLink: wrap(login.revokeByLink)
  };
}

module.exports = { makeHandlers, adminUsers, ROOT: core.ROOT };
