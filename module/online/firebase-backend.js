/**
 * @fileoverview 온라인 대국 Firebase 백엔드 (Authentication + Firestore). ES 모듈이다.
 *  - online-core.js가 JANGGI_ONLINE_BACKEND === "firebase"일 때만 import()로 불러온다.
 *  - Firebase SDK는 gstatic CDN의 정확한 버전(JANGGI_FIREBASE_SDK)으로 불러온다. gstatic은 CORS와
 *    Cross-Origin-Resource-Policy: cross-origin을 보내므로 coi-sw.js의 COEP(credentialless·require-corp) 아래서도 막히지 않는다.
 *  - 이 페이지는 COOP: same-origin이라 Google 팝업이 이 창과 이야기할 수 없고, 인증 iframe도 COEP에 막힌다.
 *    그래서 Google 로그인은 격리하지 않는 도우미 창(online-auth.html, coi-sw.js가 헤더를 붙이지 않음)에서 하고,
 *    로그인 정보는 같은 출처의 IndexedDB를 거쳐 이 창으로 넘어온다. 이 창의 Auth는 iframe이 필요 없는
 *    initializeAuth(팝업·리다이렉트 해석기 없이)로 만든다. 이메일 로그인은 이 창에서 바로 한다.
 *  - 데이터 경로: games/janggi/rooms/{roomId}, 그 아래 moves/{ply}, chat/{자동 id}. 규칙은 firestore.rules.
 *  - 이메일 숫자 코드 인증: Cloud Functions sendEmailCode·verifyEmailCode(functions/, 지역 asia-northeast3)를 부른다.
 *    인증되면 ID 토큰을 새로 받아 규칙이 email_verified를 보게 한다. Google 로그인은 처음부터 인증된 사용자.
 * 공개: createFirebaseBackend(config, sdkVersion) → fake-backend.js와 같은 모양의 객체
 * @module online/firebase-backend
 */

const AUTH_CHANNEL = "janggi-online-auth";
const FUNCTIONS_REGION = "asia-northeast3"; // functions/index.js setGlobalOptions와 같게

export async function createFirebaseBackend(config, sdkVersion) {
  const base = `https://www.gstatic.com/firebasejs/${sdkVersion}`;
  const [appMod, authMod, fsMod, fnMod] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
    import(`${base}/firebase-functions.js`)
  ]);
  const { getFunctions, httpsCallable } = fnMod;
  const { initializeApp, getApps } = appMod;
  const {
    initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, onAuthStateChanged,
    signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
    updateProfile, signOut
  } = authMod;
  const {
    initializeFirestore, doc, collection, getDoc, onSnapshot, query, orderBy, limit,
    runTransaction, updateDoc, addDoc, serverTimestamp
  } = fsMod;

  const app = getApps().length ? getApps()[0] : initializeApp(config);
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  // 회사·학교 망처럼 스트리밍이 막힌 곳에서도 붙도록 자동으로 롱폴링을 고른다
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
  const functions = getFunctions(app, FUNCTIONS_REGION);
  const callSend = httpsCallable(functions, "sendEmailCode");
  const callVerify = httpsCallable(functions, "verifyEmailCode");

  const roomRef = id => doc(db, "games", "janggi", "rooms", id);
  const movesCol = id => collection(roomRef(id), "moves");
  const chatCol = id => collection(roomRef(id), "chat");

  const toUser = u => u && {
    uid: u.uid,
    name: u.displayName || (u.email ? u.email.split("@")[0] : "이름 없음"),
    email: u.email || "",
    provider: (u.providerData[0] && u.providerData[0].providerId) || "password",
    // 규칙과 같은 기준: Google 로그인이거나 이메일 인증을 마침
    verified: !!u.emailVerified || u.providerData.some(p => p.providerId === "google.com")
  };

  /** callable 오류 "functions/resource-exhausted" → { code: "resource-exhausted", details } */
  function fnError(e) {
    const err = new Error(e && e.message);
    err.code = String((e && e.code) || "internal").replace(/^functions\//, "");
    err.details = e && e.details;
    return err;
  }

  const authListeners = new Set();
  onAuthStateChanged(auth, u => authListeners.forEach(cb => cb(toUser(u))));

  function fail(code, message) {
    const err = new Error(message || code);
    err.code = code;
    return err;
  }

  /** 도우미 창에서 Google 로그인 → 이 창의 Auth가 같은 출처 저장소에서 사용자를 읽어 올 때까지 기다린다 */
  function signInGoogle() {
    return new Promise((resolve, reject) => {
      const popup = window.open("online-auth.html", "janggi-online-auth", "width=480,height=640");
      if (!popup) {
        reject(fail("auth/popup-blocked"));
        return;
      }
      const chan = new BroadcastChannel(AUTH_CHANNEL);
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        chan.close();
        clearTimeout(timer);
        fn(v);
      };
      const timer = setTimeout(() => finish(reject, fail("auth/timeout")), 5 * 60 * 1000);
      chan.onmessage = ev => {
        const msg = ev.data || {};
        if (msg.type === "error") {
          finish(reject, fail(msg.code || "auth/internal-error"));
          return;
        }
        if (msg.type !== "signed-in") return;
        // 다른 창의 로그인은 Auth가 저장소를 살펴 알아챈다. 늦으면 새로고침해서 읽는다.
        const waitStart = Date.now();
        const check = () => {
          if (auth.currentUser) {
            finish(resolve, toUser(auth.currentUser));
          } else if (Date.now() - waitStart > 4000) {
            window.location.reload();
          } else {
            setTimeout(check, 200);
          }
        };
        check();
      };
    });
  }

  const api = {
    kind: "firebase",
    label: `Firebase (${config.projectId})`,
    auth: {
      onChange(cb) {
        authListeners.add(cb);
        // 저장된 로그인을 다 읽은 뒤 한 번 알린다 (그 전에 "로그아웃"으로 깜빡이지 않게)
        auth.authStateReady().then(() => cb(toUser(auth.currentUser)));
        return () => authListeners.delete(cb);
      },
      signInGoogle,
      async signInEmail(email, pw) {
        const cred = await signInWithEmailAndPassword(auth, email, pw);
        return toUser(cred.user);
      },
      async signUpEmail(email, pw, name) {
        const cred = await createUserWithEmailAndPassword(auth, email, pw);
        if (name) await updateProfile(cred.user, { displayName: name });
        const user = toUser(cred.user);
        if (name) user.name = name;
        authListeners.forEach(cb => cb(user));
        return user;
      },
      resetPassword(email) {
        return sendPasswordResetEmail(auth, email).then(() => true);
      },
      signOut() {
        return signOut(auth);
      },
      async sendEmailCode() {
        try {
          return (await callSend({})).data;
        } catch (e) {
          throw fnError(e);
        }
      },
      async verifyEmailCode(code) {
        let res;
        try {
          res = (await callVerify({ code })).data;
        } catch (e) {
          throw fnError(e);
        }
        if (res && res.ok && auth.currentUser) {
          // 서버가 바꾼 emailVerified를 읽고, 규칙이 볼 ID 토큰도 새로 받는다
          await auth.currentUser.reload();
          await auth.currentUser.getIdToken(true);
          const user = toUser(auth.currentUser);
          authListeners.forEach(cb => cb(user));
        }
        return res;
      }
    },

    async createRoom(id, room) {
      await runTransaction(db, async tx => {
        const snap = await tx.get(roomRef(id));
        if (snap.exists()) throw fail("already-exists");
        tx.set(roomRef(id), Object.assign({}, room, { createdAt: serverTimestamp() }));
      });
      return id;
    },

    async getRoom(id) {
      const snap = await getDoc(roomRef(id));
      return snap.exists() ? snap.data() : null;
    },

    async joinRoom(id, user, change) {
      return runTransaction(db, async tx => {
        const snap = await tx.get(roomRef(id));
        if (!snap.exists()) throw fail("not-found");
        const room = snap.data();
        const next = change(JSON.parse(JSON.stringify(room)), user);
        if (!next) return room;
        // 바뀐 칸만 쓴다 (createdAt 같은 서버 시각은 건드리지 않음 → 규칙의 "바뀐 칸" 검사와 맞음)
        const patch = {};
        Object.keys(next).forEach(k => {
          if (k !== "createdAt" && JSON.stringify(next[k]) !== JSON.stringify(room[k])) patch[k] = next[k];
        });
        tx.update(roomRef(id), patch);
        return Object.assign({}, room, patch);
      });
    },

    updateRoom(id, uid, patch) {
      return updateDoc(roomRef(id), patch);
    },

    addMove(id, uid, move, roomPatch) {
      return runTransaction(db, async tx => {
        const snap = await tx.get(roomRef(id));
        if (!snap.exists()) throw fail("not-found");
        const room = snap.data();
        if (room.status !== "playing") throw fail("failed-precondition", "대국 중이 아닙니다");
        if (room.ply !== move.ply) throw fail("aborted", "수 번호가 맞지 않습니다");
        tx.set(doc(movesCol(id), String(move.ply)), Object.assign({}, move, { at: serverTimestamp() }));
        tx.update(roomRef(id), Object.assign({}, roomPatch || {}, { ply: move.ply + 1 }));
      });
    },

    undoLast(id, uid, expectedPly, roomPatch) {
      return runTransaction(db, async tx => {
        const snap = await tx.get(roomRef(id));
        if (!snap.exists()) throw fail("not-found");
        const room = snap.data();
        if (room.ply !== expectedPly || expectedPly < 1) throw fail("aborted");
        if (!room.undo || room.undo.by === uid) throw fail("permission-denied");
        tx.delete(doc(movesCol(id), String(expectedPly - 1)));
        tx.update(roomRef(id), Object.assign({}, roomPatch || {}, { ply: expectedPly - 1, undo: null }));
      });
    },

    sendChat(id, uid, msg) {
      return addDoc(chatCol(id), Object.assign({}, msg, { at: serverTimestamp() }));
    },

    watchRoom(id, cb) {
      return onSnapshot(roomRef(id), snap => cb(snap.exists() ? snap.data() : null),
        err => console.error("[online] 방 구독 오류:", err));
    },

    watchMoves(id, cb) {
      return onSnapshot(query(movesCol(id), orderBy("ply")), snap => cb(snap.docs.map(d => d.data())),
        err => console.error("[online] 수 구독 오류:", err));
    },

    watchChat(id, cb) {
      // 최근 300개 (내림차순으로 받아 뒤집는다)
      return onSnapshot(query(chatCol(id), orderBy("atMs", "desc"), limit(300)),
        snap => cb(snap.docs.map(d => Object.assign({ id: d.id }, d.data())).reverse()),
        err => console.error("[online] 채팅 구독 오류:", err));
    }
  };
  return api;
}
