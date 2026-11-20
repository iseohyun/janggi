/**
 * @fileoverview 이메일 "다른 기기 승인형" 로그인의 규칙과 흐름 (Cloud Functions와 가짜 백엔드가 함께 쓴다).
 *
 *  1. 요청(start): 요청한 브라우저가 이메일만 넣는다. 서버는 로그인 요청 문서를 만들고(10분 만료)
 *     요청자에게만 claimSecret과 확인 숫자(2자리)를 돌려준다. 메일에는 승인 페이지 링크(요청 id + 승인 토큰)만 보낸다.
 *     claimSecret·승인 토큰은 해시로만 저장한다. 메일에는 확인 숫자를 넣지 않는다 (요청자 화면에만 보인다).
 *  2. 승인 페이지(info → approve | deny): 링크를 열기만 해서는 아무것도 바뀌지 않는다(메일 보안 검사기가 미리 열어 봄).
 *     사용자가 보기 3개 중 요청자 화면의 숫자를 골라야 승인된다. 틀리면 그 요청은 거부되고 다시 쓸 수 없다.
 *     "내가 요청한 게 아님"(deny)도 요청을 거부한다.
 *  3. 받기(claim): 요청자는 claimSecret으로 상태를 묻는다(polling). 승인되었으면 그때 한 번만 로그인 토큰을 내주고 문서를 지운다.
 *     처음 오는 이메일이면 사용자를 만든다(이메일 인증됨으로). 거부·만료면 그 사실만 알려 주고 지운다.
 *  4. 남용 방지: 같은 이메일은 60초에 1번·하루(UTC) 10번, 대기 중인 요청 3개까지. 같은 IP는 1시간에 30번.
 *     이메일·IP는 문서 id로 쓰지 않고 해시로만 쓴다. 응답은 계정이 있든 없든 같다(가입 여부를 알 수 없게).
 *  5. 모든 기기에서 로그아웃(revoke): 갱신 토큰을 무효로 하고 users 문서에 revokedAt(초)을 남긴다.
 *     firestore.rules와 이 함수가 ID 토큰의 auth_time을 이 값과 비교한다.
 *  6. 새 기기 알림(noteDevice): 브라우저마다 무작위 기기 ID(localStorage)를 두고, 로그인할 때(claim, Google은 noteLogin)
 *     users/{uid}.devices에 그 해시·브라우저/OS 대략·처음·마지막 로그인 시각만 남긴다(IP는 저장하지 않음).
 *     처음 보는 기기면 알림 메일(로그인 시각·기기, "본인이 아니면 모든 기기에서 로그아웃" 단추)을 보낸다.
 *     계정에 기기가 하나도 기록되지 않은 첫 로그인은 메일을 보내지 않는다. 같은 사용자에게 1시간에 5통까지.
 *     단추 링크(online-revoke.html#id=…&t=…)는 7일 동안 한 번만 쓸 수 있고, 열기만 해서는 아무 일도 없다(revokeByLink).
 *
 * 저장소·시계·난수·해시·메일·Auth는 밖에서 넣는다 (functions/handlers.js는 Admin SDK, module/online/fake-backend.js는 localStorage).
 * 브라우저에서는 window.EmailLoginCore, Node에서는 module.exports.
 * @module functions/email-login-core
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EmailLoginCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ROOT = "games/janggi";

  const LIMITS = Object.freeze({
    ttlMs: 10 * 60 * 1000,
    resendMs: 60 * 1000,
    dailyMax: 10,
    maxPending: 3,
    ipWindowMs: 60 * 60 * 1000,
    ipMax: 30,
    nameMax: 40,
    revokeLinkTtlMs: 7 * 24 * 60 * 60 * 1000,
    notifyWindowMs: 60 * 60 * 1000,
    notifyMax: 5,
    maxDevices: 20,
    noteFreshSec: 10 * 60, // noteLogin은 로그인한 지 10분 안의 토큰만 받는다
    pollMs: 3000 // 요청자 화면이 상태를 묻는 간격 (화면 쪽 기준값)
  });

  /** 실패 이유 (화면 문구는 module/online/online-email-login.js, online-approve.html) */
  const REASONS = Object.freeze({
    BAD_EMAIL: "bad-email",
    BAD_APP_URL: "bad-app-url",
    TOO_SOON: "too-soon",
    DAILY_LIMIT: "daily-limit",
    TOO_MANY_PENDING: "too-many-pending",
    IP_LIMIT: "ip-limit",
    NOT_FOUND: "not-found",
    EXPIRED: "expired",
    WRONG_NUMBER: "wrong-number",
    ALREADY_APPROVED: "already-approved",
    ALREADY_DENIED: "already-denied",
    REVOKED: "revoked",
    USED: "used"
  });

  const paths = {
    request: id => `${ROOT}/loginRequests/${id}`,
    email: key => `${ROOT}/loginEmails/${key}`,
    ip: key => `${ROOT}/loginIps/${key}`,
    user: uid => `${ROOT}/users/${uid}`,
    revokeLink: id => `${ROOT}/revokeLinks/${id}`
  };

  /** 기기 ID → users/{uid}.devices의 키 (화면도 같은 식으로 "이 기기"를 찾는다) */
  async function deviceKeyOf(uid, deviceId, hash) {
    return (await hash(`janggi-device:${uid}:${deviceId}`)).slice(0, 32);
  }

  function cleanDeviceId(v) {
    const s = String(v == null ? "" : v);
    return /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : "";
  }

  function dayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function sameText(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let k = 0; k < a.length; k++) diff |= a.charCodeAt(k) ^ b.charCodeAt(k);
    return diff === 0;
  }

  function cleanEmail(v) {
    const e = String(v == null ? "" : v).trim().toLowerCase();
    return e.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : "";
  }

  function cleanName(v) {
    return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, LIMITS.nameMax);
  }

  function maskEmail(e) {
    const [local, domain] = String(e).split("@");
    if (!domain) return "";
    const keep = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
    return `${keep}${"*".repeat(Math.max(1, local.length - keep.length))}@${domain}`;
  }

  /** 대략의 브라우저·OS (전체 User-Agent는 저장하지 않는다) */
  function deviceLabel(ua) {
    const s = String(ua || "");
    const os = /iPhone|iPad|iPod/.test(s) ? "iOS"
      : /Android/.test(s) ? "Android"
        : /Windows/.test(s) ? "Windows"
          : /Mac OS X|Macintosh/.test(s) ? "macOS"
            : /CrOS/.test(s) ? "ChromeOS"
              : /Linux/.test(s) ? "Linux" : "";
    const br = /Whale\//.test(s) ? "Whale"
      : /SamsungBrowser\//.test(s) ? "삼성 인터넷"
        : /Edg\//.test(s) ? "Edge"
          : /OPR\//.test(s) ? "Opera"
            : /Firefox\//.test(s) ? "Firefox"
              : /(Chrome|CriOS)\//.test(s) ? "Chrome"
                : /Safari\//.test(s) ? "Safari" : "";
    if (!os && !br) return "알 수 없는 기기";
    return [br || "브라우저", os].filter(Boolean).join(" · ");
  }

  /**
   * 승인 페이지 주소를 만든다. 출처는 허용 목록(배포 주소)이거나 localhost·127.0.0.1(개발)만.
   * 경로는 요청한 화면의 폴더를 따른다. ?backend= 는 그대로 넘긴다(개발용 가짜 백엔드 시험).
   * @returns {string} "" 이면 허용 안 됨
   */
  function approvePageUrl(appUrl, allowedOrigins) {
    return pageUrl(appUrl, allowedOrigins, "online-approve.html");
  }

  /** 웹장기 폴더 안의 page 주소 (출처·경로 검사는 approvePageUrl과 같다) */
  function pageUrl(appUrl, allowedOrigins, page) {
    let u;
    try {
      u = new URL(String(appUrl || ""));
    } catch (e) {
      return "";
    }
    const local = (u.hostname === "localhost" || u.hostname === "127.0.0.1") && (u.protocol === "http:" || u.protocol === "https:");
    if (!local && !(allowedOrigins || []).includes(u.origin)) return "";
    const dir = u.pathname.replace(/[^/]*$/, "");
    if (!/^\/[A-Za-z0-9/_.-]*$/.test(dir)) return "";
    const backend = u.searchParams.get("backend");
    const q = backend === "fake" || backend === "firebase" ? `?backend=${backend}` : "";
    return `${u.origin}${dir}${page}${q}`;
  }

  /**
   * @param {Object} deps
   * @param {{tx: (fn: (t: {get: Function, set: Function, del: Function}) => Promise<any>) => Promise<any>,
   *          merge: (path: string, data: Object) => Promise<void>}} deps.store
   *        tx 안에서는 읽기를 모두 마친 뒤 쓴다 (Firestore 트랜잭션과 같은 제약). set은 문서 통째로 바꾼다.
   * @param {() => number} deps.now
   * @param {(bytes: number) => string} deps.randomId - URL에 넣을 수 있는 무작위 문자열
   * @param {(max: number) => number} deps.randomInt - 0 이상 max 미만
   * @param {(text: string) => Promise<string>} deps.hash - SHA-256 16진수
   * @param {{send: (m: Object) => Promise<void>}} deps.mailer
   * @param {{findOrCreate: (email: string, name: string) => Promise<{uid: string, name: string, isNew: boolean}>,
   *          token: (uid: string) => Promise<string>, revoke: (uid: string) => Promise<number>}} deps.users
   * @param {(code: string, message: string, details?: Object) => Error} deps.fail
   * @param {string[]} [deps.allowedOrigins]
   * @param {{info: Function, error: Function}} [deps.log]
   */
  function makeEmailLogin(deps) {
    const log = deps.log || console;
    const fail = deps.fail;
    const keyOf = async (kind, v) => (await deps.hash(`janggi-login-${kind}:${v}`)).slice(0, 40);
    const secretHash = (kind, id, secret) => deps.hash(`janggi-login-${kind}:${id}:${String(secret || "")}`);

    function statusOf(rec, now) {
      if (!rec) return "gone";
      if (rec.status === "pending" && rec.expiresAt <= now) return "expired";
      return rec.status;
    }

    function prunePending(emailRec, now) {
      const p = Object.assign({}, (emailRec && emailRec.pending) || {});
      Object.keys(p).forEach(id => {
        if (!(p[id] > now)) delete p[id];
      });
      return p;
    }

    function pickChoices(number) {
      const set = [number];
      while (set.length < 3) {
        const n = 10 + deps.randomInt(90);
        if (!set.includes(n)) set.push(n);
      }
      for (let k = set.length - 1; k > 0; k--) {
        const j = deps.randomInt(k + 1);
        [set[k], set[j]] = [set[j], set[k]];
      }
      return set;
    }

    /** 요청 문서를 토큰(승인 페이지) 또는 claimSecret(요청자)으로 연다. 틀리면 "없음"과 똑같이 보인다. */
    async function openWith(t, id, kind, secret) {
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) return null;
      const rec = await t.get(paths.request(id));
      if (!rec) return null;
      const want = kind === "approve" ? rec.tokenHash : rec.claimHash;
      return sameText(await secretHash(kind, id, secret), want) ? rec : null;
    }

    async function dropPending(t, rec, id) {
      const emailRec = await t.get(paths.email(rec.emailKey));
      return () => {
        if (!emailRec || !emailRec.pending || !(id in emailRec.pending)) return;
        const pending = Object.assign({}, emailRec.pending);
        delete pending[id];
        t.set(paths.email(rec.emailKey), Object.assign({}, emailRec, { pending }));
      };
    }

    /** ① 요청 (로그인 안 한 브라우저) */
    async function start(ctx, data) {
      const d = data || {};
      const email = cleanEmail(d.email);
      if (!email) throw fail("invalid-argument", "이메일 주소 형식이 맞지 않습니다.", { reason: REASONS.BAD_EMAIL });
      const link = approvePageUrl(d.appUrl, deps.allowedOrigins);
      if (!link) throw fail("invalid-argument", "허용되지 않은 화면 주소입니다.", { reason: REASONS.BAD_APP_URL });
      const name = cleanName(d.name);
      const now = deps.now();
      const id = deps.randomId(16);
      const claimSecret = deps.randomId(32);
      const token = deps.randomId(32);
      const number = 10 + deps.randomInt(90);
      const emailKey = await keyOf("email", email);
      const ipKey = await keyOf("ip", (ctx && ctx.ip) || "unknown");
      const claimHash = await secretHash("claim", id, claimSecret);
      const tokenHash = await secretHash("approve", id, token);
      const device = deviceLabel(ctx && ctx.ua);
      let before = null;

      await deps.store.tx(async t => {
        const emailRec = await t.get(paths.email(emailKey));
        const ipRec = await t.get(paths.ip(ipKey));
        before = emailRec;
        const e = emailRec || {};
        const ipFresh = ipRec && now - ipRec.windowStart < LIMITS.ipWindowMs;
        const ipCount = ipFresh ? ipRec.count : 0;
        if (ipCount >= LIMITS.ipMax) {
          throw fail("resource-exhausted", "요청이 너무 많습니다.", { reason: REASONS.IP_LIMIT, retryAfterMs: ipRec.windowStart + LIMITS.ipWindowMs - now });
        }
        if (e.lastAt && now - e.lastAt < LIMITS.resendMs) {
          throw fail("resource-exhausted", "조금 뒤에 다시 해 주세요.", { reason: REASONS.TOO_SOON, retryAfterMs: LIMITS.resendMs - (now - e.lastAt) });
        }
        const today = dayKey(now);
        const sentToday = e.day === today ? (e.dayCount || 0) : 0;
        if (sentToday >= LIMITS.dailyMax) {
          const tomorrow = Date.parse(`${today}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
          throw fail("resource-exhausted", "오늘은 더 보낼 수 없습니다.", { reason: REASONS.DAILY_LIMIT, retryAfterMs: tomorrow - now });
        }
        const pending = prunePending(e, now);
        if (Object.keys(pending).length >= LIMITS.maxPending) {
          const soonest = Math.min.apply(null, Object.values(pending));
          throw fail("resource-exhausted", "기다리는 요청이 너무 많습니다.", { reason: REASONS.TOO_MANY_PENDING, retryAfterMs: soonest - now });
        }
        pending[id] = now + LIMITS.ttlMs;
        t.set(paths.request(id), {
          emailKey,
          email,
          name,
          claimHash,
          tokenHash,
          number,
          choices: pickChoices(number),
          device,
          createdAt: now,
          expiresAt: now + LIMITS.ttlMs,
          status: "pending",
          approvedAt: 0,
          revokePage: pageUrl(d.appUrl, deps.allowedOrigins, "online-revoke.html")
        });
        t.set(paths.email(emailKey), { lastAt: now, day: today, dayCount: sentToday + 1, pending });
        t.set(paths.ip(ipKey), { windowStart: ipFresh ? ipRec.windowStart : now, count: ipCount + 1 });
      });

      try {
        await deps.mailer.send({
          kind: "login",
          to: email,
          link: `${link}#req=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`,
          device,
          requestedAt: now,
          ttlMinutes: LIMITS.ttlMs / 60000
        });
      } catch (err) {
        log.error("[startEmailLogin] 메일 발송 실패", err && err.message);
        // 보내지 못했으면 없던 일로 (다시 보내기 제한도 풀림)
        await deps.store.tx(async t => {
          t.del(paths.request(id));
          if (before) t.set(paths.email(emailKey), before);
          else t.del(paths.email(emailKey));
        });
        throw fail("unavailable", "로그인 메일을 보내지 못했습니다. 잠시 뒤 다시 해 주세요.");
      }
      return { req: id, claimSecret, number, expiresAt: now + LIMITS.ttlMs, resendAt: now + LIMITS.resendMs };
    }

    /** ② 승인 페이지가 보여 줄 내용 (아무것도 바꾸지 않는다) */
    async function info(ctx, data) {
      const d = data || {};
      const now = deps.now();
      let out = null;
      await deps.store.tx(async t => {
        const rec = await openWith(t, d.req, "approve", d.t);
        if (!rec) {
          out = { ok: false, reason: REASONS.NOT_FOUND };
          return;
        }
        out = {
          ok: true,
          status: statusOf(rec, now),
          email: maskEmail(rec.email),
          device: rec.device,
          createdAt: rec.createdAt,
          expiresAt: rec.expiresAt,
          choices: rec.choices.slice()
        };
      });
      return out;
    }

    /** ② 승인: 요청자 화면의 숫자를 골라야 한다. 틀리면 거부하고 폐기 */
    async function approve(ctx, data) {
      const d = data || {};
      const now = deps.now();
      let out = null;
      await deps.store.tx(async t => {
        const rec = await openWith(t, d.req, "approve", d.t);
        if (!rec) {
          out = { ok: false, reason: REASONS.NOT_FOUND };
          return;
        }
        const st = statusOf(rec, now);
        if (st !== "pending") {
          out = { ok: false, reason: { expired: REASONS.EXPIRED, approved: REASONS.ALREADY_APPROVED, claimed: REASONS.ALREADY_APPROVED }[st] || REASONS.ALREADY_DENIED };
          return;
        }
        const pick = Number(d.pick);
        if (pick === rec.number) {
          t.set(paths.request(d.req), Object.assign({}, rec, { status: "approved", approvedAt: now }));
          out = { ok: true };
          return;
        }
        const drop = await dropPending(t, rec, d.req);
        t.set(paths.request(d.req), Object.assign({}, rec, { status: "denied", deniedBy: "wrong-number" }));
        drop();
        out = { ok: false, reason: REASONS.WRONG_NUMBER };
      });
      if (out.ok) log.info("[approveEmailLogin] 승인", d.req);
      return out;
    }

    /** ② "내가 요청한 게 아님" */
    async function deny(ctx, data) {
      const d = data || {};
      const now = deps.now();
      let out = null;
      await deps.store.tx(async t => {
        const rec = await openWith(t, d.req, "approve", d.t);
        if (!rec) {
          out = { ok: false, reason: REASONS.NOT_FOUND };
          return;
        }
        const st = statusOf(rec, now);
        if (st !== "pending" && st !== "approved") {
          out = { ok: true, status: st };
          return;
        }
        const drop = await dropPending(t, rec, d.req);
        t.set(paths.request(d.req), Object.assign({}, rec, { status: "denied", deniedBy: "user" }));
        drop();
        out = { ok: true, status: "denied" };
      });
      return out;
    }

    /**
     * ③ 요청자가 상태를 묻는다. 승인되었으면 로그인 토큰을 한 번만 내주고 요청 문서를 지운다.
     * @returns {Promise<{status: "pending"|"approved"|"denied"|"expired"|"gone", token?: string, expiresAt?: number}>}
     */
    async function claim(ctx, data) {
      const d = data || {};
      const now = deps.now();
      let out = null;
      let rec = null;
      await deps.store.tx(async t => {
        rec = await openWith(t, d.req, "claim", d.claimSecret);
        const st = statusOf(rec, now);
        if (st === "pending") {
          out = { status: "pending", expiresAt: rec.expiresAt };
          return;
        }
        if (st === "approved") {
          // 먼저 "내주는 중"으로 바꿔 두 번 내주지 않게 한다
          t.set(paths.request(d.req), Object.assign({}, rec, { status: "claimed", claimedAt: now }));
          out = { status: "approved" };
          return;
        }
        if (st === "expired" || st === "denied") {
          const drop = await dropPending(t, rec, d.req);
          t.del(paths.request(d.req));
          drop();
          out = { status: st };
          return;
        }
        out = { status: "gone" };
      });
      if (out.status !== "approved") return out;

      let token;
      let user;
      try {
        user = await deps.users.findOrCreate(rec.email, rec.name || rec.email.split("@")[0]);
        token = await deps.users.token(user.uid);
      } catch (err) {
        log.error("[claimEmailLogin] 로그인 토큰을 만들지 못함", err && (err.code || err.message));
        await deps.store.tx(async t => {
          const now2 = await t.get(paths.request(d.req));
          if (now2 && now2.status === "claimed") t.set(paths.request(d.req), Object.assign({}, now2, { status: "approved" }));
        });
        throw fail("internal", "로그인 토큰을 만들지 못했습니다. 잠시 뒤 다시 해 주세요.");
      }
      await deps.store.tx(async t => {
        const r = await t.get(paths.request(d.req));
        const drop = r ? await dropPending(t, r, d.req) : () => {};
        t.del(paths.request(d.req));
        drop();
      });
      await deps.store.merge(paths.user(user.uid), {
        uid: user.uid,
        email: rec.email,
        name: user.name,
        provider: "email-approve",
        lastLoginAt: now,
        app: "janggi"
      });
      log.info("[claimEmailLogin] 로그인", user.uid, user.isNew ? "(새 사용자)" : "");
      await noteDeviceSafe({ uid: user.uid, email: rec.email, deviceId: d.deviceId, device: rec.device, revokePage: rec.revokePage });
      return { status: "approved", token };
    }

    /** ⑤ 모든 기기에서 로그아웃 (로그인한 사용자) */
    async function revoke(ctx) {
      const a = ctx && ctx.auth;
      if (!a || !a.uid) throw fail("unauthenticated", "로그인이 필요합니다.");
      let rec = null;
      await deps.store.tx(async t => {
        rec = await t.get(paths.user(a.uid));
      });
      const authTime = Number(a.token && a.token.auth_time) || 0;
      if (rec && rec.revokedAt && authTime < rec.revokedAt) throw fail("unauthenticated", "이미 로그아웃된 기기입니다.", { reason: REASONS.REVOKED });
      const revokedAt = await deps.users.revoke(a.uid);
      await deps.store.merge(paths.user(a.uid), { uid: a.uid, revokedAt, app: "janggi" });
      log.info("[revokeAllSessions]", a.uid);
      return { ok: true, revokedAt };
    }

    /**
     * 로그인한 기기를 기록하고, 처음 보는 기기면 알림 메일을 보낸다.
     * @returns {Promise<{known: boolean, mailed: boolean, reason?: string}>}
     */
    async function noteDevice(o) {
      const deviceId = cleanDeviceId(o.deviceId);
      if (!deviceId) return { known: false, mailed: false, reason: "no-device-id" };
      const now = deps.now();
      const key = await deviceKeyOf(o.uid, deviceId, deps.hash);
      const linkId = deps.randomId(16);
      const linkToken = deps.randomId(32);
      const linkHash = await secretHash("revoke", linkId, linkToken);
      let res = null;
      await deps.store.tx(async t => {
        const rec = (await t.get(paths.user(o.uid))) || { uid: o.uid, app: "janggi" };
        const devices = Object.assign({}, rec.devices || {});
        const known = !!devices[key];
        const first = Object.keys(devices).length === 0;
        devices[key] = { label: o.device || "알 수 없는 기기", firstAt: known ? devices[key].firstAt : now, lastAt: now };
        // 오래 안 쓴 기기부터 지워 maxDevices개만 둔다
        const keys = Object.keys(devices).sort((a, b) => devices[b].lastAt - devices[a].lastAt);
        keys.slice(LIMITS.maxDevices).forEach(k => delete devices[k]);
        const next = Object.assign({}, rec, { devices });
        res = { known, mailed: false };
        if (!known && first) res.reason = "first-device";
        if (!known && !first && !o.email) res.reason = "no-email";
        if (!known && !first && o.email) {
          const n = rec.notify && now - rec.notify.windowStart < LIMITS.notifyWindowMs ? rec.notify : { windowStart: now, count: 0 };
          if (n.count >= LIMITS.notifyMax) {
            res.reason = "notify-limit";
          } else {
            next.notify = { windowStart: n.windowStart, count: n.count + 1 };
            t.set(paths.revokeLink(linkId), { uid: o.uid, tokenHash: linkHash, createdAt: now, expiresAt: now + LIMITS.revokeLinkTtlMs, used: false });
            res.mailed = true;
          }
        }
        t.set(paths.user(o.uid), next);
      });
      if (res.mailed) {
        const base = o.revokePage || pageUrl(`${(deps.allowedOrigins || [])[0] || ""}/`, deps.allowedOrigins, "online-revoke.html");
        try {
          await deps.mailer.send({
            kind: "new-device",
            to: o.email,
            device: o.device || "알 수 없는 기기",
            loginAt: now,
            link: `${base}#id=${encodeURIComponent(linkId)}&t=${encodeURIComponent(linkToken)}`,
            linkDays: LIMITS.revokeLinkTtlMs / 86400000
          });
        } catch (err) {
          log.error("[noteDevice] 알림 메일 실패", err && err.message);
          res.mailed = false;
          res.reason = "mail-failed";
        }
      }
      return res;
    }

    // 기기 기록·알림이 실패해도 로그인은 막지 않는다
    async function noteDeviceSafe(o) {
      try {
        return await noteDevice(o);
      } catch (err) {
        log.error("[noteDevice] 실패", err && (err.code || err.message));
        return { known: false, mailed: false, reason: "error" };
      }
    }

    /** Google 로그인 직후 화면이 부른다 (이메일 승인형은 claim 안에서 기록) */
    async function noteLogin(ctx, data) {
      const a = ctx && ctx.auth;
      if (!a || !a.uid) throw fail("unauthenticated", "로그인이 필요합니다.");
      const token = a.token || {};
      const d = data || {};
      const nowSec = Math.floor(deps.now() / 1000);
      const authTime = Number(token.auth_time) || 0;
      if (nowSec - authTime > LIMITS.noteFreshSec) return { ok: true, skipped: "stale" };
      let urec = null;
      await deps.store.tx(async t => {
        urec = await t.get(paths.user(a.uid));
      });
      if (urec && urec.revokedAt && authTime < urec.revokedAt) throw fail("unauthenticated", "이미 로그아웃된 기기입니다.", { reason: REASONS.REVOKED });
      const email = token.email ? String(token.email).toLowerCase() : "";
      const r = await noteDevice({
        uid: a.uid,
        email,
        deviceId: d.deviceId,
        device: deviceLabel(ctx.ua),
        revokePage: pageUrl(d.appUrl, deps.allowedOrigins, "online-revoke.html")
      });
      return { ok: true, known: r.known, mailed: r.mailed };
    }

    /** 알림 메일의 "모든 기기에서 로그아웃" 확인 단추 (링크를 열기만 해서는 부르지 않는다) */
    async function revokeByLink(ctx, data) {
      const d = data || {};
      const now = deps.now();
      let out = null;
      let uid = null;
      await deps.store.tx(async t => {
        if (typeof d.id !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(d.id)) {
          out = { ok: false, reason: REASONS.NOT_FOUND };
          return;
        }
        const rec = await t.get(paths.revokeLink(d.id));
        if (!rec || !sameText(await secretHash("revoke", d.id, d.t), rec.tokenHash)) {
          out = { ok: false, reason: REASONS.NOT_FOUND };
          return;
        }
        if (rec.used) {
          out = { ok: false, reason: REASONS.USED };
          return;
        }
        if (rec.expiresAt <= now) {
          out = { ok: false, reason: REASONS.EXPIRED };
          return;
        }
        t.set(paths.revokeLink(d.id), Object.assign({}, rec, { used: true, usedAt: now }));
        uid = rec.uid;
        out = { ok: true };
      });
      if (!out.ok) return out;
      try {
        const revokedAt = await deps.users.revoke(uid);
        await deps.store.merge(paths.user(uid), { revokedAt });
        log.info("[revokeByLink]", uid);
        return { ok: true };
      } catch (err) {
        log.error("[revokeByLink] 실패", err && (err.code || err.message));
        await deps.store.tx(async t => {
          const rec = await t.get(paths.revokeLink(d.id));
          if (rec) t.set(paths.revokeLink(d.id), Object.assign({}, rec, { used: false }));
        });
        throw fail("internal", "로그아웃하지 못했습니다. 잠시 뒤 다시 해 주세요.");
      }
    }

    return { start, info, approve, deny, claim, revoke, noteLogin, revokeByLink, noteDevice };

  }

  return { ROOT, LIMITS, REASONS, paths, makeEmailLogin, approvePageUrl, pageUrl, deviceLabel, deviceKeyOf, maskEmail, cleanEmail, dayKey };
});
