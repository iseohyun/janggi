/**
 * @fileoverview 온라인 대국 가짜 백엔드 (개발·검증용).
 *  - 같은 브라우저의 두 탭이 한 판을 둔다. 데이터는 localStorage("janggiOnlineFake")에 두고,
 *    바뀌면 BroadcastChannel("janggi-online-fake")로 다른 탭에 알린다. 새로고침해도 남아 있으므로 복원도 시험할 수 있다.
 *  - 로그인은 탭마다 따로다(sessionStorage). Google 로그인은 가짜 사용자를 만든다. 이메일 계정은 이 브라우저 안에만 있다.
 *  - 이메일 승인형 로그인은 Cloud Functions와 같은 흐름(functions/email-login-core.js)을 그대로 돌린다.
 *    메일 대신 콘솔에 승인 링크를 찍고, 시험용으로 OnlineFakeBackend.peekLoginMail()이 마지막 메일을 돌려준다.
 *    승인 페이지(online-approve.html?backend=fake)도 이 파일을 읽어 같은 저장소로 승인한다.
 *  - "모든 기기에서 로그아웃"은 같은 계정으로 로그인한 다른 탭을 로그아웃시킨다.
 *  - Firebase 백엔드(firebase-backend.js)와 같은 모양의 함수를 내놓는다. 규칙 검사는 firestore.rules가 하는 것 중
 *    "차례·참가자·수 번호"만 흉내 낸다 (받은 수가 장기 규칙에 맞는지는 받는 쪽 online-core.js가 본다).
 * 공개: window.OnlineFakeBackend (online-core.js가 고른다)
 * @module online/fake-backend
 */

(function () {
  const DB_KEY = "janggiOnlineFake";
  const USER_KEY = "janggiFakeUser";
  const LATENCY_MS = 40; // 네트워크 흉내

  const chan = ("BroadcastChannel" in window) ? new BroadcastChannel("janggi-online-fake") : null;
  const listeners = new Set(); // {roomId, what, fire}
  const authListeners = new Set();

  function readDb() {
    try {
      const db = JSON.parse(localStorage.getItem(DB_KEY) || "null");
      if (db && db.rooms) return db;
    } catch (e) {
      console.warn("[fake-backend] 저장소를 읽지 못해 새로 시작합니다:", e);
    }
    return { rooms: {}, moves: {}, chat: {}, users: {}, docs: {}, devMail: {} };
  }

  function writeDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function later(fn) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      }, LATENCY_MS);
    });
  }

  function fail(code, message, details) {
    const err = new Error(message || code);
    err.code = code;
    if (details) err.details = details;
    return err;
  }

  function notify(roomId, what) {
    listeners.forEach(l => {
      if (l.roomId === roomId && l.what === what) l.fire();
    });
    if (chan) chan.postMessage({ roomId, what });
  }

  if (chan) {
    chan.onmessage = ev => {
      const { roomId, what } = ev.data || {};
      listeners.forEach(l => {
        if (l.roomId === roomId && l.what === what) l.fire();
      });
    };
  }

  function watch(roomId, what, read, cb) {
    const l = { roomId, what, fire: () => cb(read()) };
    listeners.add(l);
    setTimeout(l.fire, 0); // Firestore onSnapshot처럼 처음 한 번 바로 준다
    return () => listeners.delete(l);
  }

  const clone = v => JSON.parse(JSON.stringify(v));

  // ===== 로그인 =====

  function currentUser() {
    try {
      return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function setUser(user) {
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_KEY);
    authListeners.forEach(cb => cb(user));
    return user;
  }

  function newUid() {
    return "fake-" + Math.random().toString(36).slice(2, 10);
  }

  // 시험용 시계 (OnlineFakeBackend.advanceClock(ms)로 만료를 미리 볼 수 있다)
  let clockOffset = 0;
  const fakeNow = () => Date.now() + clockOffset;

  function randomId(n) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    return btoa(String.fromCharCode.apply(null, b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /** functions/email-login-core.js를 이 브라우저의 localStorage 위에서 돌린다 (서버와 같은 규칙) */
  let login = null;
  function emailLogin() {
    if (login) return login;
    login = window.EmailLoginCore.makeEmailLogin({
      store: {
        async tx(fn) {
          const db = readDb();
          const docs = db.docs || (db.docs = {});
          const writes = [];
          const r = await fn({
            get: async p => (p in docs ? clone(docs[p]) : null),
            set: (p, d) => writes.push([p, clone(d)]),
            del: p => writes.push([p, null])
          });
          const fresh = readDb(); // 기다리는 동안 다른 탭이 쓴 것 위에 얹는다
          const fdocs = fresh.docs || (fresh.docs = {});
          writes.forEach(([p, d]) => {
            if (d) fdocs[p] = d;
            else delete fdocs[p];
          });
          writeDb(fresh);
          return r;
        },
        async merge(p, d) {
          const db = readDb();
          const docs = db.docs || (db.docs = {});
          docs[p] = Object.assign({}, docs[p] || {}, clone(d));
          writeDb(db);
        }
      },
      users: {
        async findOrCreate(email, name) {
          const db = readDb();
          let acc = db.users[email];
          if (!acc) {
            acc = db.users[email] = { uid: newUid(), name: name || email.split("@")[0], email };
            writeDb(db);
          }
          return { uid: acc.uid, name: acc.name, isNew: false };
        },
        async token(uid) {
          return `fake-token:${uid}`;
        },
        async revoke(uid) {
          const at = Math.floor(fakeNow() / 1000);
          if (chan) chan.postMessage({ what: "revoked", uid, at });
          return at;
        }
      },
      mailer: {
        async send(m) {
          const db = readDb();
          db.devMail = db.devMail || {};
          db.devMail.last = clone(m);
          db.devMail.all = (db.devMail.all || []).concat([clone(m)]).slice(-30);
          writeDb(db);
          console.info(`[fake-backend] 메일 대신: ${m.to} 승인 링크 ${m.link}`);
        }
      },
      fail,
      allowedOrigins: [window.location.origin],
      now: fakeNow,
      randomId,
      randomInt: max => crypto.getRandomValues(new Uint32Array(1))[0] % max,
      hash: async text => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, "0")).join("");
      },
      log: { info() {}, error: (...a) => console.error(...a) }
    });
    return login;
  }

  const ctx = () => ({ ip: "fake-ip", ua: navigator.userAgent, auth: null });
  const call = (fn, data) => later(() => null).then(() => emailLogin()[fn](ctx(), data));

  // 다른 탭에서 "모든 기기에서 로그아웃"을 누르면 같은 계정의 이 탭도 로그아웃
  if (chan) {
    chan.addEventListener("message", ev => {
      const m = ev.data || {};
      const me = currentUser();
      if (m.what === "revoked" && me && me.uid === m.uid && (me.authTime || 0) < m.at) setUser(null);
    });
  }

  const auth = {
    onChange(cb) {
      authListeners.add(cb);
      setTimeout(() => cb(currentUser()), 0);
      return () => authListeners.delete(cb);
    },
    signInGoogle() {
      return later(() => {
        const n = Math.floor(Math.random() * 900 + 100);
        return setUser({ uid: newUid(), name: `구글사용자${n}`, email: `google${n}@example.test`, provider: "google", authTime: Math.floor(fakeNow() / 1000) });
      });
    },
    startEmailLogin(email, name, appUrl) {
      return call("start", { email, name, appUrl });
    },
    async claimEmailLogin(req, claimSecret, deviceId) {
      const r = await call("claim", { req, claimSecret, deviceId });
      if (r.status !== "approved") return r;
      const uid = String(r.token).replace(/^fake-token:/, "");
      const acc = Object.values(readDb().users).find(a => a.uid === uid);
      const user = setUser({ uid, name: acc ? acc.name : uid, email: acc ? acc.email : "", provider: "email", authTime: Math.floor(fakeNow() / 1000) + 1 });
      return { status: "approved", user };
    },
    noteLogin(deviceId, appUrl) {
      const me = currentUser();
      if (!me) return Promise.reject(fail("unauthenticated"));
      const auth = { uid: me.uid, token: { email: me.email, auth_time: me.authTime || Math.floor(fakeNow() / 1000) } };
      return later(() => null).then(() => emailLogin().noteLogin({ ip: "fake-ip", ua: navigator.userAgent, auth }, { deviceId, appUrl }));
    },
    listDevices() {
      return later(() => {
        const me = currentUser();
        const rec = me && (readDb().docs || {})[`games/janggi/users/${me.uid}`];
        const devices = (rec && rec.devices) || {};
        return Object.keys(devices).map(key => Object.assign({ key }, devices[key]));
      });
    },
    async signOutAll() {
      const me = currentUser();
      if (!me) throw fail("unauthenticated");
      await later(() => null);
      await emailLogin().revoke({ auth: { uid: me.uid, token: { auth_time: me.authTime || 0 } } });
      setUser(null);
    },
    signOut() {
      return later(() => setUser(null));
    }
  };

  /** 승인 페이지(online-approve.html)가 부르는 것 (Firebase에서는 callable getEmailLogin·approveEmailLogin·denyEmailLogin) */
  const approvePage = {
    info: (req, t) => call("info", { req, t }),
    approve: (req, t, pick) => call("approve", { req, t, pick }),
    deny: (req, t) => call("deny", { req, t }),
    /** 알림 메일의 로그아웃 링크 페이지(online-revoke.html)가 부른다 (Firebase에서는 callable revokeByLink) */
    revokeByLink: (id, t) => call("revokeByLink", { id, t })
  };

  // ===== 방 =====

  function isMember(room, uid) {
    return !!room && room.members.includes(uid);
  }

  const api = {
    kind: "fake",
    label: "가짜 백엔드 (이 브라우저의 탭끼리)",
    auth,
    approvePage,

    createRoom(id, room) {
      return later(() => {
        const db = readDb();
        const user = currentUser();
        if (!user || user.uid !== room.hostUid) throw fail("permission-denied");
        if (db.rooms[id]) throw fail("already-exists");
        db.rooms[id] = clone(room);
        db.moves[id] = {};
        db.chat[id] = [];
        writeDb(db);
        notify(id, "room");
        return id;
      });
    },

    getRoom(id) {
      return later(() => {
        const room = readDb().rooms[id];
        return room ? clone(room) : null;
      });
    },

    /** 빈 자리에 앉는다 (이미 참가자면 그대로). change(room)이 고친 방을 돌려주면 저장한다. */
    joinRoom(id, user, change) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!room) throw fail("not-found");
        const next = change(clone(room), user);
        if (next) {
          db.rooms[id] = next;
          writeDb(db);
          notify(id, "room");
        }
        return clone(db.rooms[id]);
      });
    },

    updateRoom(id, uid, patch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        Object.assign(room, clone(patch));
        writeDb(db);
        notify(id, "room");
      });
    },

    /** 수 하나 추가: 방의 수 번호가 move.ply와 같고 그 차례의 자리 주인일 때만 */
    addMove(id, uid, move, roomPatch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        if (room.status !== "playing") throw fail("failed-precondition", "대국 중이 아닙니다");
        if (room.ply !== move.ply) throw fail("aborted", "수 번호가 맞지 않습니다");
        const side = move.ply % 2 === 0 ? "cho" : "han";
        if (!room.seats[side] || room.seats[side].uid !== uid) throw fail("permission-denied", "차례가 아닙니다");
        db.moves[id][String(move.ply)] = clone(move);
        Object.assign(room, clone(roomPatch || {}), { ply: move.ply + 1 });
        writeDb(db);
        notify(id, "moves");
        notify(id, "room");
      });
    },

    /** 무르기 받아들이기: 마지막 수(번호 expectedPly - 1)를 지운다 */
    undoLast(id, uid, expectedPly, roomPatch) {
      return later(() => {
        const db = readDb();
        const room = db.rooms[id];
        if (!isMember(room, uid)) throw fail("permission-denied");
        if (room.ply !== expectedPly || expectedPly < 1) throw fail("aborted");
        if (!room.undo || room.undo.by === uid) throw fail("permission-denied");
        delete db.moves[id][String(expectedPly - 1)];
        Object.assign(room, clone(roomPatch || {}), { ply: expectedPly - 1, undo: null });
        writeDb(db);
        notify(id, "moves");
        notify(id, "room");
      });
    },

    sendChat(id, uid, msg) {
      return later(() => {
        const db = readDb();
        if (!isMember(db.rooms[id], uid)) throw fail("permission-denied");
        const list = db.chat[id] || (db.chat[id] = []);
        list.push(Object.assign({ id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }, clone(msg)));
        if (list.length > 500) list.splice(0, list.length - 500);
        writeDb(db);
        notify(id, "chat");
      });
    },

    watchRoom(id, cb) {
      return watch(id, "room", () => {
        const room = readDb().rooms[id];
        return room ? clone(room) : null;
      }, cb);
    },

    watchMoves(id, cb) {
      return watch(id, "moves", () => {
        const moves = readDb().moves[id] || {};
        return Object.values(moves).map(clone).sort((a, b) => a.ply - b.ply);
      }, cb);
    },

    watchChat(id, cb) {
      return watch(id, "chat", () => clone(readDb().chat[id] || []), cb);
    },

    /** 개발용: 저장소 비우기 (콘솔에서 OnlineFakeBackend.reset()) */
    reset() {
      localStorage.removeItem(DB_KEY);
    },

    /** 시험용: "보낸" 메일 전부 (최근 30통, kind: "login" | "new-device") */
    peekMails() {
      const db = readDb();
      return (db.devMail && db.devMail.all) || [];
    },

    /** 시험용: 마지막으로 "보낸" 메일 { kind, to, link, device, ... } */
    peekLoginMail() {
      const db = readDb();
      return (db.devMail && db.devMail.last) || null;
    },

    /** 시험용: 로그인 요청 시계를 앞으로 돌린다 (만료 확인). 승인 페이지 탭과 따로 돈다 */
    advanceClock(ms) {
      clockOffset += ms;
      return clockOffset;
    }
  };

  window.OnlineFakeBackend = api;
})();
