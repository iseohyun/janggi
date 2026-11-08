/**
 * @fileoverview 전면 이벤트 위임(Event Delegation) 디스패처 모듈.
 * HTML 내 모든 data-action 속성을 감지하여 요소 타입에 맞는 이벤트(click, change, input)만 라우팅합니다.
 * @module dispatcher
 * @depends state, rules, board, ai, flip, record, keyboard, settings, ui, main
 */

(function () {
  /**
   * 액션 이름에 해당하는 전역 핸들러 함수를 조회합니다.
   * @param {string} actionName - 호출할 함수 이름
   * @returns {Function|null}
   */
  function getActionHandler(actionName) {
    if (!actionName) return null;

    if (typeof window[actionName] === "function") {
      return window[actionName];
    }

    try {
      if (typeof globalThis[actionName] === "function") {
        return globalThis[actionName];
      }
    } catch (e) {
      console.error("[dispatcher] 핸들러 조회 중 오류 발생:", e);
    }

    return null;
  }

  /**
   * 엘리먼트의 data-* 속성(data-action, data-stop-propagation 제외)을 카멜케이스 인자 객체로 변환합니다.
   * @param {HTMLElement} el - 대상 엘리먼트
   * @returns {Object} 파싱된 인자 객체
   */
  function getActionArgs(el) {
    const args = {};
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-") && attr.name !== "data-action" && attr.name !== "data-stop-propagation") {
        const key = attr.name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        const num = Number(attr.value);
        args[key] = (attr.value !== "" && !isNaN(num)) ? num : attr.value;
      }
    }
    return args;
  }

  /**
   * 엘리먼트 종류에 따라 어떤 DOM 이벤트 타입(click, change, input)에서 실행되어야 하는지 결정합니다.
   * (폼 컨트롤을 클릭했을 때 click 이벤트로 인해 중복 호출되는 현상을 방지합니다)
   * @param {HTMLElement} el - 대상 엘리먼트
   * @returns {"click"|"change"|"input"}
   */
  function getExpectedEventType(el) {
    const tag = el.tagName;
    if (tag === "SELECT") return "change";
    if (tag === "TEXTAREA") return "input";
    if (tag === "INPUT") {
      const type = (el.type || "").toLowerCase();
      if (type === "checkbox" || type === "radio" || type === "number") {
        return "change";
      }
      return "input";
    }
    return "click";
  }

  /**
   * 대상 엘리먼트의 data-action 핸들러를 인자 패턴에 맞춰 실행합니다.
   * @param {HTMLElement} el - data-action이 지정된 엘리먼트
   * @param {Event} event - 발생한 DOM 이벤트
   */
  function dispatch(el, event) {
    const actionName = el.dataset.action;
    if (!actionName) return;

    const handler = getActionHandler(actionName);
    if (!handler) {
      console.warn(`[dispatcher] 등록되지 않은 액션 또는 핸들러 미정의: ${actionName}`);
      return;
    }

    if (el.hasAttribute("data-stop-propagation")) {
      event.stopPropagation();
    }

    const args = getActionArgs(el);

    if (Object.keys(args).length === 0) {
      if (
        el.tagName === "SELECT" ||
        el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "button")
      ) {
        handler(el.value);
      } else if (el.tagName === "INPUT" && el.type === "checkbox") {
        handler(el.checked);
      } else {
        const eventHandlers = new Set([
          "handleModalOverlayClick",
          "handleCommentModalOverlayClick",
          "toggleMetadataCategory"
        ]);
        handler(eventHandlers.has(actionName) ? event : el);
      }
    } else if ("recordId" in args) {
      handler(args.recordId, event);
    } else if ("type" in args && "delta" in args) {
      handler(args.type, args.delta);
    } else if ("delta" in args) {
      handler(args.delta);
    } else if ("amount" in args) {
      handler(args.amount);
    } else if ("group" in args && "pieceType" in args) {
      handler(args.group, args.pieceType, el);
    } else if ("num" in args) {
      handler(args.num);
    } else if ("index" in args) {
      handler(args.index);
    } else if ("categoryId" in args) {
      handler(args.categoryId);
    } else if ("value" in args) {
      handler(args.value);
    } else {
      handler(event);
    }
  }

  // ===== 이벤트 리스너 등록 =====
  document.addEventListener("click", function (e) {
    const stopEl = e.target.closest("[data-stop-propagation]");
    if (stopEl && !stopEl.dataset.action) {
      e.stopPropagation();
    }
    const el = e.target.closest("[data-action]");
    if (el && getExpectedEventType(el) === "click") {
      dispatch(el, e);
    }
  });

  document.addEventListener("change", function (e) {
    const el = e.target.closest("[data-action]");
    if (el && getExpectedEventType(el) === "change") {
      dispatch(el, e);
    }
  });

  document.addEventListener("input", function (e) {
    const el = e.target.closest("[data-action]");
    if (el && getExpectedEventType(el) === "input") {
      dispatch(el, e);
    }
  });
})();
