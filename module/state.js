/**
 * @fileoverview 전역 상태 관리, 상수 정의 및 공통 유틸리티 (state.js)
 * - [UI] DOM 참조 및 보드 레이아웃/애니메이션 상태
 * - [CONSTANTS] 기물 가치, 상차림 초기 배치 코드, 단축키 기본값, 프리셋 색상
 * - [config] 사용자 커스터마이징 설정값
 * - [game] 대국 진행 상태 (기물 배열, 착수 로그, 진영, 메타데이터)
 */

/**
 * @typedef {Object} Piece - 장기 기물 객체 스키마
 * @property {number} x - 기물의 X 좌표 (1~9, 0이면 잡혀서 판 밖으로 나간 상태)
 * @property {number} y - 기물의 Y 좌표 (0~9, 세로 1~9행과 최하단 10번째 행을 0으로 표현)
 * @property {SVGElement} e - 기물에 해당하는 SVG 이미지 엘리먼트 객체
 * @property {number|null} [animId] - requestAnimationFrame ID
 */

/**
 * @typedef {Object} LogEntry - 착수 로그 기록 단일 항목 스키마
 * @property {number} i - 움직인 기물의 ID (0~31)
 * @property {number} x - 이동 대상 X 좌표 (1~9)
 * @property {number} y - 이동 대상 Y 좌표 (0~9)
 * @property {number} t - 포획된 기물의 ID (포획 대상이 없으면 NO_PIECE=32)
 * @property {string} [comment] - 착수별 해설 코멘트
 */

/**
 * @typedef {Object} GameMetadata - 대국 상세 메타데이터 스키마
 * @property {string} choPlayer - 초나라 대국자명
 * @property {string} hanPlayer - 한나라 대국자명
 * @property {string} tournament - 대회명
 * @property {string} round - 대국 정보 (예: 몇국, 일시)
 * @property {string} nickname - 기보 별명
 * @property {string} summary - 총평
 */

window.addEventListener("error", function (e) {
  console.error("[Janggi Runtime Error]", e.message, "at", e.filename, ":", e.lineno, ":", e.colno);
});

// highlightjs-line-numbers가 copy 이벤트 시 SVG 엘리먼트의 className(SVGAnimatedString)에서 indexOf가 없어서 터지는 에러를 방지합니다.
if (typeof SVGAnimatedString !== "undefined") {
  if (!SVGAnimatedString.prototype.indexOf) {
    SVGAnimatedString.prototype.indexOf = function (str, fromIndex) {
      return this.baseVal ? this.baseVal.indexOf(str, fromIndex) : -1;
    };
  }
  if (!SVGAnimatedString.prototype.includes) {
    SVGAnimatedString.prototype.includes = function (str, position) {
      return this.baseVal ? this.baseVal.includes(str, position) : false;
    };
  }
}

// ===== [UI] DOM 참조 및 뷰 상태 =====
const svg = document.getElementById("janggi-svg");
const board = document.getElementById("board");
const selectBox = document.getElementById("select-box");

// ===== [CONSTANTS] 불변 상수 =====
const boardMargin = 0; // 장기판의 외부 여백(margin)
const NO_PIECE = 32; // 선택된 기물 없음 또는 포획 기물 없음 식별 상수
const HAN_HANDICAP = 1.5; // 한나라 후수 덤 (1.5점)
const HIDDEN_COORD = -1000; // 선택 박스를 화면 밖으로 숨길 때 사용하는 좌표

// 기물 인덱스(0~15)별 점수판 기물 점수 (왕=0, 차=13, 포=7, 마=5, 상=3, 사=3, 졸/병=2)
const MATERIAL_SCORES = [0, 13, 13, 7, 7, 5, 5, 3, 3, 3, 3, 2, 2, 2, 2, 2];

// AI 평가 함수용 기물 절댓값 가치 (왕=100000, 차=130, 포=70, 마=50, 상=30, 사=30, 졸/병=20)
const AI_PIECE_VALUES = [
  100000, 130, 130, 70, 70, 50, 50, 30, 30, 30, 30, 20, 20, 20, 20, 20,
  100000, 130, 130, 70, 70, 50, 50, 30, 30, 30, 30, 20, 20, 20, 20, 20
];

// 설정창 프리셋 색상 목록
const PRESET_ACCENT_COLORS = ["#3b82f6", "#10b981", "#f97316", "#a855f7", "#eab308"];
const PRESET_BG_COLORS = ["#0f172a", "#1e293b", "#1e1b4b", "#022c22"];

// 단축키 초기 기본값 상수
const DEFAULT_SHORTCUT_KEYS = {
  newGame: {
    primary: { key: "n", ctrl: false, alt: false, shift: false },
    secondary: { key: "F2", ctrl: false, alt: false, shift: false }
  },
  autoplayToggle: {
    primary: { key: "p", ctrl: false, alt: false, shift: false },
    secondary: { key: "p", ctrl: false, alt: true, shift: false }
  },
  openShortcutSettings: {
    primary: { key: "?", ctrl: false, alt: false, shift: true },
    secondary: null
  },
  openCommentEdit: {
    primary: { key: "`", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  toggleOpponentAI: {
    primary: { key: "z", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  requestAIHint: {
    primary: { key: "x", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  flipHorizontal: {
    primary: { key: "[", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  flipVertical: {
    primary: { key: "]", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  toggleCoordinates: {
    primary: { key: "/", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  up: {
    primary: { key: "ArrowUp", ctrl: false, alt: false, shift: false },
    secondary: { key: "w", ctrl: false, alt: false, shift: false }
  },
  down: {
    primary: { key: "ArrowDown", ctrl: false, alt: false, shift: false },
    secondary: { key: "s", ctrl: false, alt: false, shift: false }
  },
  left: {
    primary: { key: "ArrowLeft", ctrl: false, alt: false, shift: false },
    secondary: { key: "a", ctrl: false, alt: false, shift: false }
  },
  right: {
    primary: { key: "ArrowRight", ctrl: false, alt: false, shift: false },
    secondary: { key: "d", ctrl: false, alt: false, shift: false }
  },
  select: {
    primary: { key: "Enter", ctrl: false, alt: false, shift: false },
    secondary: { key: " ", ctrl: false, alt: false, shift: false }
  },
  cursorLockToggle: {
    primary: { key: "CapsLock", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  cancel: {
    primary: { key: "Escape", ctrl: false, alt: false, shift: false },
    secondary: null
  },
  copyNotation: {
    primary: { key: "s", ctrl: false, alt: true, shift: false },
    secondary: { key: "s", ctrl: true, alt: false, shift: false }
  },
  loadNotation: {
    primary: { key: "v", ctrl: false, alt: true, shift: false },
    secondary: { key: "v", ctrl: true, alt: false, shift: false }
  },
  forwardStep: {
    primary: { key: "ArrowRight", ctrl: false, alt: true, shift: false },
    secondary: null
  },
  backwardStep: {
    primary: { key: "ArrowLeft", ctrl: false, alt: true, shift: false },
    secondary: null
  },
  goToStart: {
    primary: { key: "ArrowLeft", ctrl: true, alt: false, shift: false },
    secondary: { key: "Home", ctrl: false, alt: false, shift: false }
  },
  goToEnd: {
    primary: { key: "ArrowRight", ctrl: true, alt: false, shift: false },
    secondary: { key: "End", ctrl: false, alt: false, shift: false }
  }
};

const knownStart = [
  [
    "59109028882070308040601737577797",
    "59109028882080307040601737577797",
    "59109028883070208040601737577797",
    "59109028883080207040601737577797"
  ],
  [
    "52119123832171318141611434547494",
    "52119123832181317141611434547494",
    "52119123833171218141611434547494",
    "52119123833181217141611434547494"
  ]
];

// ===== [config] 사용자 설정값 =====
var showCoordinates = true; // 좌표선 표시 여부
var animDuration = 0.5; // 애니메이션 이동 시간 (초 단위)
var animHeight = 0.2; // 애니메이션 기물 들기 높이 배율 (기본 0.2, 범위 0~2.0)

// 장기알 크기 배율 (왕, 큰기물, 작은기물)
var sizeKing = 1.15;
var sizeMiddle = 0.90;
var sizeSmall = 0.70;

// 장기알 글씨 크기 배율 (왕, 큰기물, 작은기물)
var fontScaleKing = 1.25;
var fontScaleMiddle = 1.45;
var fontScaleSmall = 1.45;

// 좌표 라벨 글씨 크기 배율
var coordsTextScale = 0.18;

// 디자인 커스텀 상태값
var boardColorType = "wood";
var choColorType = "blue";
var hanColorType = "red";
var pieceShapeType = "octagon";
var candiShapeType = "empty_circle";
var candiColorType = "#3b82f6";
var aiMode = 0; // AI 모드: 0=사용 안함 (로컬 2인용), 1=사용함 (AI가 항상 위쪽에서 플레이)
var cursorLockMode = false; // 키보드 커서락 모드 여부
var gameEnded = false; // 외통수 등으로 대국이 종료되었는지 여부

// 설정창 비주얼 상태값
var settingsBgColor = "#0f172a";
var settingsOpacity = 0.55;
var settingsTextColorType = "auto";
var settingsTextColorCustom = "#f8fafc";
var settingsAccentColor = "#3b82f6";

// 점수판/자동재생/모달/코멘트 설정값
var currentLoadedRecordId = null; // 현재 불러와서 보여주고 있는 기보의 로컬스토리지 ID
var scoreAutoRotate = true; // 점수판 자동 순환 여부
var scoreRotateInterval = 5; // 점수판 순환 주기 (초)
var scoreShowSlide1 = true; // 점수판 슬라이드 1 (점수차) 표출 여부
var scoreShowSlide2 = true; // 점수판 슬라이드 2 (타이머) 표출 여부
var scoreShowSlide3 = true; // 점수판 슬라이드 3 (대회정보) 표출 여부
var autoplaySpeed = 2; // 자동재생 속도 (초)
var autoplayUseAnim = true; // 자동재생 시 애니메이션 사용 여부
var shortcutModalBgColor = "#5f80ce"; // 단축키 모달 배경색
var shortcutModalOpacity = 0.4; // 단축키 모달 투명도
var commentBoxBgColor = "#5f80ce"; // 코멘트 상자 배경색
var commentBoxOpacity = 0.4; // 코멘트 상자 투명도
var commentDisplayDuration = 0; // 코멘트 표시 시간 (초, 0=무제한)

// ===== [UI] 보드 레이아웃 및 애니메이션 상태 =====
var boardPaddingLeft = 45;
var boardPaddingRight = 20;
var boardPaddingTop = 45;
var boardPaddingBottom = 20;
var boardWidth;
var boardHeight;
var unitSize; // 한 칸의 크기 (그릴 수 있는 최대 크기)
var piecesSize = 0.8; // 장기말이 한칸당 차지하는 비율 (80%)
const candiBoxList = new Array(); // 생성된 이동가능 경로들을 관리합니다.
var kbCursorX = 5;
var kbCursorY = 4;
var kbCursorActive = false;
var boardAnimating = false;
var flipActive = false; // 판 좌우 반전 애니메이션 진행 중 여부
var rotateActive = false; // 판 180도 회전 애니메이션 진행 중 여부
var choTimeSpent = 0; // 초나라 누적 대국 시간(초)
var hanTimeSpent = 0; // 한나라 누적 대국 시간(초)
var commentBubbleTimeout = null; // 코멘트 말풍선 자동 숨김 타이머 ID

// ===== [game] 게임 진행 상태 =====
const pieces = new Array(32); // 장기말 현재 상태 (ID: 0~31)
const initPieces = new Array(32); // 장기말 초기 배치 좌표 (ID: 0~31)
var newGameState = [0, 0];
var iAmCho = false;
const log = new Array(); // 착수 로그를 기록합니다.
var curSelect = NO_PIECE;

var shortcutKeys = JSON.parse(JSON.stringify(DEFAULT_SHORTCUT_KEYS));

var gameMetadata = {
  choPlayer: "",
  hanPlayer: "",
  tournament: "",
  round: "",
  nickname: "",
  summary: ""
};

/**
 * 각 기물의 역할을 분석해 크기 배율을 반환합니다. (왕: 대형, 차포마상: 중형, 사졸병: 소형)
 * @param {number} i - 기물 ID (0~31)
 * @returns {number} 기물 크기 배율
 */
function getPieceSizeRatio(i) {
  if (i === 0 || i === 16) {
    return sizeKing;
  }
  if ((i >= 1 && i <= 8) || (i >= 17 && i <= 24)) {
    return sizeMiddle;
  }
  return sizeSmall;
}

/**
 * HEX 색상 문자열을 {r, g, b} 객체로 변환합니다.
 * @param {string} hex - HEX 색상 문자열 (예: "#0f172a" 또는 "#fff")
 * @returns {{r: number, g: number, b: number}}
 */
function parseHexRgb(hex) {
  let clean = (hex || "#0f172a").replace(/^\s*#|\s*$/g, "");
  if (clean.length === 3) {
    clean = clean.replace(/(.)/g, "$1$1");
  }
  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return { r: 15, g: 23, b: 42 };
  }
  return { r, g, b };
}

/**
 * HEX 색상과 투명도(alpha)를 rgba() 문자열로 변환합니다.
 * @param {string} hex - HEX 색상 문자열
 * @param {number} alpha - 투명도 (0.0 ~ 1.0)
 * @returns {string} rgba() CSS 색상 문자열
 */
function hexToRgba(hex, alpha) {
  const { r, g, b } = parseHexRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
