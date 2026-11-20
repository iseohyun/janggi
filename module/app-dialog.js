/**
 * @fileoverview 앱 안 팝업 (alert·confirm 대신). 닫을 때까지 사라지지 않는다.
 *  - showAppDialog({ title, message, buttons, cancelValue, tone }) → Promise<고른 버튼 value>
 *    buttons: [{ label, value, primary?, title? }]. 첫 primary 버튼에 초점이 간다 (Enter로 누름).
 *    Esc·닫기(X)는 cancelValue로 끝난다. 바깥(배경)을 눌러도 닫히지 않는다.
 *  - 쓰는 곳: 외통 안내(ai.js checkGameStatus), 지난 국면에서 다시 둘 때 무르기 확인(preview.js)
 *  - 팝업 요소는 처음 쓸 때 만들어 <html> 바로 아래에 붙인다 (body perspective 때문, 다른 fixed 요소와 같음).
 *  - 모양: css/app-dialog.css
 * 공개 함수: showAppDialog(opts), isAppDialogOpen(), closeAppDialog()
 * @module app-dialog
 * @depends (없음)
 */

let adResolve = null;
let adCancelValue = null;
let adLastFocus = null;

function adRoot() {
  let root = document.getElementById("app-dialog");
  if (root) return root;
  root = document.createElement("div");
  root.id = "app-dialog";
  root.className = "app-dialog";
  root.hidden = true;
  root.innerHTML = `
    <div class="app-dialog-box" role="alertdialog" aria-modal="true" aria-labelledby="app-dialog-title" aria-describedby="app-dialog-msg">
      <div class="app-dialog-head">
        <span id="app-dialog-title" class="app-dialog-title"></span>
        <button type="button" class="app-dialog-x" aria-label="닫기" title="닫기 (Esc)"><svg class="ico" aria-hidden="true"><use href="#i-x"/></svg></button>
      </div>
      <div id="app-dialog-msg" class="app-dialog-msg"></div>
      <div class="app-dialog-actions"></div>
    </div>`;
  document.documentElement.appendChild(root);
  root.querySelector(".app-dialog-x").addEventListener("click", () => closeAppDialog());
  return root;
}

function isAppDialogOpen() {
  const root = document.getElementById("app-dialog");
  return !!root && !root.hidden;
}

/**
 * 팝업을 띄운다. 이미 열려 있으면 앞 팝업은 cancelValue로 끝내고 새 팝업을 띄운다.
 * @param {{title: string, message: string, buttons?: Array<{label: string, value: *, primary?: boolean, title?: string}>,
 *          cancelValue?: *, tone?: "info"|"win"|"warn"}} opts
 * @returns {Promise<*>}
 */
function showAppDialog(opts) {
  if (isAppDialogOpen()) closeAppDialog();
  const root = adRoot();
  const o = opts || {};
  root.dataset.tone = o.tone || "info";
  root.querySelector(".app-dialog-title").textContent = o.title || "";
  root.querySelector(".app-dialog-msg").textContent = o.message || "";
  const actions = root.querySelector(".app-dialog-actions");
  actions.innerHTML = "";
  const buttons = o.buttons && o.buttons.length ? o.buttons : [{ label: "닫기", value: null, primary: true }];
  adCancelValue = o.cancelValue === undefined ? null : o.cancelValue;
  let focusBtn = null;
  buttons.forEach(b => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `app-dialog-btn${b.primary ? " primary" : ""}`;
    btn.textContent = b.label;
    if (b.title) btn.title = b.title;
    btn.addEventListener("click", () => adFinish(b.value));
    actions.appendChild(btn);
    if (b.primary && !focusBtn) focusBtn = btn;
  });
  adLastFocus = document.activeElement;
  root.hidden = false;
  (focusBtn || actions.querySelector("button")).focus();
  return new Promise(resolve => {
    adResolve = resolve;
  });
}

function adFinish(value) {
  const root = document.getElementById("app-dialog");
  if (root) root.hidden = true;
  const resolve = adResolve;
  adResolve = null;
  if (adLastFocus && typeof adLastFocus.focus === "function" && document.contains(adLastFocus)) adLastFocus.focus();
  adLastFocus = null;
  if (resolve) resolve(value);
}

/** Esc·닫기(X): cancelValue로 끝낸다 */
function closeAppDialog() {
  if (!isAppDialogOpen()) return;
  adFinish(adCancelValue);
}
