/**
 * 이메일 승인형 로그인(handlers.js + email-login-core.js)을 메모리 저장소·가짜 시계·가짜 메일·가짜 Auth로 시험한다.
 * 실행: functions 폴더에서 `npm test` 또는 `node --test` (Firebase 패키지 없이 돈다)
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeHandlers } = require("../handlers");
const { LIMITS, approvePageUrl, deviceLabel } = require("../email-login-core");

const APP = "https://janggi.iseohyun.com/index.html";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

function setup(opts = {}) {
  const docs = new Map();
  const clock = { t: Date.parse("2026-11-20T03:00:00Z") };
  const mails = [];
  const accounts = new Map(); // email → {uid, name}
  const tokens = [];
  const clone = v => JSON.parse(JSON.stringify(v));
  let queue = Promise.resolve(); // Firestore 트랜잭션처럼 한 번에 하나씩 (겹치면 재시도되는 것과 결과가 같다)
  const store = {
    tx(fn) {
      const run = queue.then(() => runTx(fn));
      queue = run.catch(() => {});
      return run;
    },
    async merge(p, d) {
      docs.set(p, Object.assign({}, docs.get(p) || {}, clone(d)));
    }
  };
  async function runTx(fn) {
      const writes = [];
      let wrote = false;
      const r = await fn({
        get: async p => {
          if (wrote) throw new Error("트랜잭션: 쓰기 뒤에 읽음");
          return docs.has(p) ? clone(docs.get(p)) : null;
        },
        set: (p, d) => { wrote = true; writes.push([p, clone(d)]); },
        del: p => { wrote = true; writes.push([p, null]); }
      });
      writes.forEach(([p, d]) => (d ? docs.set(p, d) : docs.delete(p)));
      return r;
  }
  const users = {
    async findOrCreate(email, name) {
      if (opts.tokenFails) throw Object.assign(new Error("iam"), { code: "auth/insufficient-permission" });
      if (!accounts.has(email)) accounts.set(email, { uid: `u${accounts.size + 1}`, name });
      const a = accounts.get(email);
      return { uid: a.uid, name: a.name, isNew: false };
    },
    async token(uid) {
      tokens.push(uid);
      return `custom-token-for-${uid}`;
    },
    async revoke() {
      return Math.floor(clock.t / 1000);
    }
  };
  const mailer = {
    async send(m) {
      if (opts.mailFails) throw new Error("resend down");
      mails.push(m);
    }
  };
  const fail = (code, message, details) => Object.assign(new Error(message), { code, details });
  const h = makeHandlers({ store, users, mailer, fail, allowedOrigins: ["https://janggi.iseohyun.com"], now: () => clock.t, log: { info() {}, error() {} } });
  const call = (name, data, extra = {}) => h[name]({ data, rawRequest: { ip: extra.ip || "203.0.113.7", headers: { "user-agent": UA } }, auth: extra.auth });
  const start = (email = "Player@Test.local", extra) => call("startEmailLogin", { email, name: "대국자", appUrl: APP }, extra);
  const linkOf = m => {
    const hash = new URL(m.link).hash.slice(1);
    const q = new URLSearchParams(hash);
    return { req: q.get("req"), t: q.get("t"), page: m.link.split("#")[0] };
  };
  return { h, docs, clock, mails, accounts, tokens, call, start, linkOf };
}

const wrongOf = (choices, number) => choices.find(n => n !== number);

test("요청 → 승인 → 요청자 로그인 (토큰 한 번, 요청 문서 지움)", async () => {
  const s = setup();
  const r = await s.start();
  assert.match(String(r.number), /^\d{2}$/);
  assert.equal(s.mails.length, 1);
  const mail = s.mails[0];
  assert.equal(mail.to, "player@test.local");
  assert.equal(mail.device, "Chrome · Windows");
  assert.ok(!JSON.stringify(mail).includes(r.claimSecret), "메일에 claimSecret 없음");
  const { req, t, page } = s.linkOf(mail);
  assert.equal(page, "https://janggi.iseohyun.com/online-approve.html");
  assert.equal(req, r.req);
  // 저장된 요청에는 비밀값 원문이 없다
  const stored = JSON.stringify([...s.docs.values()]);
  assert.ok(!stored.includes(r.claimSecret) && !stored.includes(t), "비밀값은 해시로만 저장");

  const info = await s.call("getEmailLogin", { req, t });
  assert.equal(info.ok, true);
  assert.equal(info.status, "pending");
  assert.equal(info.choices.length, 3);
  assert.ok(info.choices.includes(r.number));
  assert.equal(new Set(info.choices).size, 3);
  assert.equal(info.email, "pl****@test.local");
  assert.equal(info.number, undefined, "정답 숫자는 알려 주지 않음");

  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "pending", expiresAt: r.expiresAt });
  assert.deepEqual(await s.call("approveEmailLogin", { req, t, pick: r.number }), { ok: true });
  const c = await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret });
  assert.deepEqual(c, { status: "approved", token: "custom-token-for-u1" });
  assert.equal(s.docs.has(`games/janggi/loginRequests/${req}`), false, "내준 뒤 요청 문서 지움");
  assert.equal(s.docs.get("games/janggi/users/u1").email, "player@test.local");
  // 대기 목록에서도 빠짐
  const emailRec = [...s.docs.entries()].find(([p]) => p.includes("/loginEmails/"))[1];
  assert.deepEqual(emailRec.pending, {});
});

test("토큰 두 번 받기 거부 (재사용)", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  await s.call("approveEmailLogin", { req, t, pick: r.number });
  const [a, b] = await Promise.all([
    s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }),
    s.call("claimEmailLogin", { req, claimSecret: r.claimSecret })
  ]);
  assert.equal([a, b].filter(x => x.status === "approved").length, 1, "동시에 물어도 한 번만");
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "gone" });
  assert.equal(s.tokens.length, 1);
  // 승인 링크도 다시 못 씀
  assert.equal((await s.call("approveEmailLogin", { req, t, pick: r.number })).reason, "not-found");
});

test("claimSecret 없이·틀린 값으로 토큰 받기 실패, 승인 토큰 틀리면 아무것도 못 함", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  await s.call("approveEmailLogin", { req, t, pick: r.number });
  assert.deepEqual(await s.call("claimEmailLogin", { req }), { status: "gone" });
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: "x".repeat(43) }), { status: "gone" });
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: t }), { status: "gone" }, "승인 토큰으로는 못 받음");
  assert.equal(s.tokens.length, 0);
  assert.equal((await s.call("getEmailLogin", { req, t: "nope" })).reason, "not-found");
  assert.equal((await s.call("denyEmailLogin", { req, t: "nope" })).reason, "not-found");
  // 진짜 요청자는 여전히 받을 수 있다
  assert.equal((await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret })).status, "approved");
});

test("링크만 열면(정보 읽기) 승인되지 않음", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  for (let k = 0; k < 3; k++) await s.call("getEmailLogin", { req, t });
  assert.equal((await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret })).status, "pending");
  assert.equal(s.tokens.length, 0);
});

test("숫자를 틀리면 거부·폐기 (다시 맞는 숫자를 골라도 안 됨)", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  const info = await s.call("getEmailLogin", { req, t });
  const bad = await s.call("approveEmailLogin", { req, t, pick: wrongOf(info.choices, r.number) });
  assert.deepEqual(bad, { ok: false, reason: "wrong-number" });
  assert.equal((await s.call("approveEmailLogin", { req, t, pick: r.number })).reason, "already-denied");
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "denied" });
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "gone" });
  assert.equal(s.tokens.length, 0);
});

test("\"내가 요청한 게 아님\" → 폐기", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  assert.deepEqual(await s.call("denyEmailLogin", { req, t }), { ok: true, status: "denied" });
  assert.equal((await s.call("getEmailLogin", { req, t })).status, "denied");
  assert.equal((await s.call("approveEmailLogin", { req, t, pick: r.number })).reason, "already-denied");
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "denied" });
  assert.equal(s.tokens.length, 0);
});

test("10분 지나면 만료 → 승인·토큰 모두 안 됨", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  s.clock.t += LIMITS.ttlMs;
  assert.equal((await s.call("getEmailLogin", { req, t })).status, "expired");
  assert.equal((await s.call("approveEmailLogin", { req, t, pick: r.number })).reason, "expired");
  assert.deepEqual(await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), { status: "expired" });
  assert.equal(s.docs.has(`games/janggi/loginRequests/${req}`), false);
});

test("승인한 뒤라도 10분 안에 받지 않으면? → 승인 상태는 남고 받을 수 있음, 그 뒤엔 deny로 막을 수 있음", async () => {
  const s = setup();
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  await s.call("approveEmailLogin", { req, t, pick: r.number });
  // 승인 직후 "내가 아님"을 누르면 (실수로 승인한 경우) 토큰을 내주기 전에 막힌다
  assert.deepEqual(await s.call("denyEmailLogin", { req, t }), { ok: true, status: "denied" });
  assert.equal((await s.call("claimEmailLogin", { req, claimSecret: r.claimSecret })).status, "denied");
});

test("요청 횟수 제한: 같은 이메일 60초·대기 3개·하루 10번, 같은 IP 1시간 30번", async () => {
  const s = setup();
  await s.start();
  await assert.rejects(s.start(), e => e.code === "resource-exhausted" && e.details.reason === "too-soon" && e.details.retryAfterMs > 0);
  // 대소문자·공백이 달라도 같은 이메일
  await assert.rejects(s.start("  PLAYER@test.LOCAL "), e => e.details.reason === "too-soon");
  s.clock.t += LIMITS.resendMs;
  await s.start();
  s.clock.t += LIMITS.resendMs;
  await s.start();
  s.clock.t += LIMITS.resendMs;
  await assert.rejects(s.start(), e => e.details.reason === "too-many-pending");
  // 대기 중인 요청이 만료되면 다시 됨
  s.clock.t += LIMITS.ttlMs;
  for (let k = 4; k <= LIMITS.dailyMax; k++) {
    await s.start();
    s.clock.t += LIMITS.ttlMs; // 대기 제한에 안 걸리게
  }
  await assert.rejects(s.start(), e => e.details.reason === "daily-limit");
  assert.equal(s.mails.length, LIMITS.dailyMax);

  // IP 제한: 다른 이메일 30개까지, 31번째 거부, 다른 IP는 됨
  const p = setup();
  for (let k = 0; k < LIMITS.ipMax; k++) await p.start(`p${k}@test.local`);
  await assert.rejects(p.start("p99@test.local"), e => e.details.reason === "ip-limit");
  await p.start("p99@test.local", { ip: "198.51.100.9" });
  p.clock.t += LIMITS.ipWindowMs;
  await p.start("p100@test.local");
});

test("잘못된 이메일·허용 안 된 화면 주소 거부, 메일 실패면 없던 일", async () => {
  const s = setup();
  await assert.rejects(s.call("startEmailLogin", { email: "nope", appUrl: APP }), e => e.code === "invalid-argument" && e.details.reason === "bad-email");
  await assert.rejects(s.call("startEmailLogin", { email: "a@b.cd", appUrl: "https://evil.example/" }), e => e.details.reason === "bad-app-url");
  const f = setup({ mailFails: true });
  await assert.rejects(f.start(), e => e.code === "unavailable");
  assert.equal(f.docs.size, 1, "IP 횟수 기록만 남고 요청·이메일 기록은 없음");
  // 메일을 못 보냈으면 60초 제한에 걸리지 않음 (다시 시도 가능)
  await assert.rejects(f.start(), e => e.code === "unavailable");
});

test("토큰 만들기 실패(서비스 계정 권한 없음) → 승인 상태로 되돌려 다시 받을 수 있게", async () => {
  const s = setup({ tokenFails: true });
  const r = await s.start();
  const { req, t } = s.linkOf(s.mails[0]);
  await s.call("approveEmailLogin", { req, t, pick: r.number });
  await assert.rejects(s.call("claimEmailLogin", { req, claimSecret: r.claimSecret }), e => e.code === "internal");
  assert.equal(s.docs.get(`games/janggi/loginRequests/${req}`).status, "approved");
});

test("모든 기기에서 로그아웃: revokedAt 기록, 그 전에 로그인한 토큰으로는 다시 못 부름", async () => {
  const s = setup();
  await assert.rejects(s.call("revokeAllSessions", {}), e => e.code === "unauthenticated");
  const authOld = { uid: "u1", token: { auth_time: Math.floor(s.clock.t / 1000) - 100 } };
  const res = await s.call("revokeAllSessions", {}, { auth: authOld });
  assert.equal(res.ok, true);
  assert.equal(s.docs.get("games/janggi/users/u1").revokedAt, Math.floor(s.clock.t / 1000));
  await assert.rejects(s.call("revokeAllSessions", {}, { auth: authOld }), e => e.details.reason === "revoked");
  s.clock.t += 5000;
  const authNew = { uid: "u1", token: { auth_time: Math.floor(s.clock.t / 1000) } };
  assert.equal((await s.call("revokeAllSessions", {}, { auth: authNew })).ok, true);
});

test("승인 페이지 주소·기기 이름", () => {
  const allow = ["https://janggi.iseohyun.com"];
  assert.equal(approvePageUrl("https://janggi.iseohyun.com/", allow), "https://janggi.iseohyun.com/online-approve.html");
  assert.equal(approvePageUrl("http://localhost:5193/index.html?room=AB&backend=fake", allow), "http://localhost:5193/online-approve.html?backend=fake");
  assert.equal(approvePageUrl("http://127.0.0.1:8080/janggi/", allow), "http://127.0.0.1:8080/janggi/online-approve.html");
  assert.equal(approvePageUrl("https://janggi.iseohyun.com.evil.example/", allow), "");
  assert.equal(approvePageUrl("javascript:alert(1)", allow), "");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), "Safari · iOS");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 SamsungBrowser/27.0 Chrome/125 Mobile Safari/537.36"), "삼성 인터넷 · Android");
  assert.equal(deviceLabel(""), "알 수 없는 기기");
});

// ===== 새 기기 알림·로그아웃 링크 =====

const DEV_A = "deviceAAAAAAAAAAAAAAAA";
const DEV_B = "deviceBBBBBBBBBBBBBBBB";

/** 이메일 승인형으로 한 번 로그인 (deviceId 포함). 60초 제한을 넘기려고 시계를 돌린다 */
async function loginWith(s, deviceId, email = "player@test.local") {
  s.clock.t += LIMITS.resendMs;
  const r = await s.start(email);
  const { req, t } = s.linkOf(s.mails[s.mails.length - 1]);
  await s.call("approveEmailLogin", { req, t, pick: r.number });
  return s.call("claimEmailLogin", { req, claimSecret: r.claimSecret, deviceId });
}

const alerts = s => s.mails.filter(m => m.kind === "new-device");
const revokeLinkOf = m => {
  const q = new URLSearchParams(new URL(m.link).hash.slice(1));
  return { id: q.get("id"), t: q.get("t"), page: m.link.split("#")[0] };
};

test("새 기기: 첫 기기는 메일 없음, 두 번째 새 기기는 알림 1통, 같은 기기 재로그인은 메일 없음", async () => {
  const s = setup();
  assert.equal((await loginWith(s, DEV_A)).status, "approved");
  assert.equal(alerts(s).length, 0, "계정의 첫 기기는 알림 없음");
  await loginWith(s, DEV_A);
  assert.equal(alerts(s).length, 0, "같은 기기 재로그인은 알림 없음");
  await loginWith(s, DEV_B);
  assert.equal(alerts(s).length, 1, "새 기기는 알림 1통");
  const m = alerts(s)[0];
  assert.equal(m.to, "player@test.local");
  assert.equal(m.device, "Chrome · Windows");
  assert.equal(m.linkDays, 7);
  assert.equal(revokeLinkOf(m).page, "https://janggi.iseohyun.com/online-revoke.html");
  await loginWith(s, DEV_B);
  assert.equal(alerts(s).length, 1);
  // 저장: 기기 ID 원문·IP 없음, 해시 키와 대략 기기·시각만
  const u = s.docs.get("games/janggi/users/u1");
  const devs = Object.entries(u.devices);
  assert.equal(devs.length, 2);
  devs.forEach(([k, v]) => {
    assert.match(k, /^[0-9a-f]{32}$/);
    assert.deepEqual(Object.keys(v).sort(), ["firstAt", "label", "lastAt"]);
  });
  const all = JSON.stringify([...s.docs.values()]);
  assert.ok(!all.includes(DEV_A) && !all.includes("203.0.113.7"), "기기 ID 원문·IP를 저장하지 않음");
  // 알림 링크 토큰도 해시로만
  assert.ok(!all.includes(revokeLinkOf(m).t));
});

test("로그아웃 링크: 열기만(아무 호출 없음)으론 무반응, 확인하면 모든 기기 로그아웃, 재사용 거부, 7일 뒤 만료", async () => {
  const s = setup();
  await loginWith(s, DEV_A);
  await loginWith(s, DEV_B);
  const { id, t } = revokeLinkOf(alerts(s)[0]);
  // 페이지를 여는 것은 서버 호출이 없다 → revokedAt 없음
  assert.equal(s.docs.get("games/janggi/users/u1").revokedAt, undefined);
  assert.equal((await s.call("revokeByLink", { id, t: "wrong" })).reason, "not-found");
  assert.equal((await s.call("revokeByLink", { id })).reason, "not-found");
  assert.deepEqual(await s.call("revokeByLink", { id, t }), { ok: true });
  assert.equal(s.docs.get("games/janggi/users/u1").revokedAt, Math.floor(s.clock.t / 1000));
  assert.deepEqual(await s.call("revokeByLink", { id, t }), { ok: false, reason: "used" }, "한 번만");
  // 만료
  await loginWith(s, "deviceCCCCCCCCCCCCCCCC");
  const second = revokeLinkOf(alerts(s)[1]);
  s.clock.t += LIMITS.revokeLinkTtlMs;
  assert.deepEqual(await s.call("revokeByLink", second), { ok: false, reason: "expired" });
});

test("알림 메일은 같은 사용자에게 1시간에 5통까지 (로그인은 계속 됨)", async () => {
  const s = setup();
  await loginWith(s, "device000000000000000000");
  for (let k = 1; k <= LIMITS.notifyMax + 2; k++) {
    const c = await loginWith(s, `device${String(k).padStart(18, "0")}`);
    assert.equal(c.status, "approved");
  }
  assert.equal(alerts(s).length, LIMITS.notifyMax);
  s.clock.t += LIMITS.notifyWindowMs;
  await loginWith(s, "deviceZZZZZZZZZZZZZZZZ");
  assert.equal(alerts(s).length, LIMITS.notifyMax + 1, "1시간 지나면 다시 보냄");
});

test("Google 로그인 noteLogin: 새 기기 알림, 같은 기기 무알림, 이메일 없으면 건너뜀, 오래된 토큰·로그아웃된 토큰 거부", async () => {
  const s = setup();
  const now = () => Math.floor(s.clock.t / 1000);
  const g = (uid, extra) => ({ uid, token: Object.assign({ email: "G@Gmail.test", auth_time: now(), firebase: { sign_in_provider: "google.com" } }, extra) });
  const note = (deviceId, auth) => s.call("noteLogin", { deviceId, appUrl: "http://localhost:5193/index.html" }, { auth });
  await assert.rejects(note(DEV_A), e => e.code === "unauthenticated");
  assert.deepEqual(await note(DEV_A, g("g1")), { ok: true, known: false, mailed: false });
  assert.deepEqual(await note(DEV_A, g("g1")), { ok: true, known: true, mailed: false });
  const r = await note(DEV_B, g("g1"));
  assert.equal(r.mailed, true);
  const m = alerts(s)[0];
  assert.equal(m.to, "g@gmail.test");
  assert.equal(revokeLinkOf(m).page, "http://localhost:5193/online-revoke.html");
  // 이메일 없는 계정
  await note(DEV_A, g("g2", { email: undefined }));
  assert.equal((await note(DEV_B, g("g2", { email: undefined }))).mailed, false);
  // 로그인한 지 오래된 토큰은 기록하지 않음 (아무 때나 불러 메일을 보내지 못하게)
  assert.deepEqual(await note("deviceOLDOLDOLDOLDOLDOLD", g("g1", { auth_time: now() - 3600 })), { ok: true, skipped: "stale" });
  // 모든 기기 로그아웃 뒤의 옛 토큰
  const old = g("g1", { auth_time: now() - 5 });
  await s.call("revokeAllSessions", {}, { auth: old });
  await assert.rejects(note("deviceXXXXXXXXXXXXXXXX", old), e => e.details && e.details.reason === "revoked");
  // 잘못된 기기 ID는 기록하지 않음
  assert.equal((await note("짧음", g("g3"))).known, false);
  assert.equal(s.docs.get("games/janggi/users/g3"), undefined);
});

test("알림 메일 실패해도 로그인은 됨", async () => {
  const s = setup();
  await loginWith(s, DEV_A);
  const realSend = s.mails.push.bind(s.mails);
  s.mails.push = m => {
    if (m.kind === "new-device") throw new Error("resend down");
    return realSend(m);
  };
  assert.equal((await loginWith(s, DEV_B)).status, "approved");
});
