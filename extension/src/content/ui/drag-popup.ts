import type { ExplainRequest } from '../../shared/messages';
import { translateOnce } from '../translate';
import { CONVERSATION_CSS, createConversation } from './conversation';
import { applyTheme } from './theme';

// 드래그 선택 팝업(F4 폴백). 번역 → 해설 → 후속질문 3단.
//
// 왜 있나: 문단 추출·매핑은 페이지마다 깨질 수 있다(Readability 실패, SPA, 사내 위키).
// 그때도 드래그만 하면 동작해 "안 되는 페이지는 없다"를 보장한다 (PLAN.md §1).
// 그래서 이 팝업은 문단·추출 결과에 전혀 기대지 않는다 — 선택한 텍스트만 있으면 된다.
//
// 대화 알맹이는 문단 해설과 같은 ui/conversation.ts를 쓴다.

const UI_MARKER = 'data-documate-ui'; // 옵저버가 무시하는 우리 요소 표식
const TAG = 'documate-drag';
const WIDTH = 380;
const MARGIN = 8; // 뷰포트 가장자리 여백

export interface DragPopup {
  remove(): void;
}

export interface DragPopupOptions {
  text: string; // 선택한 텍스트
  docTitle: string;
  precedingText?: string; // 선택 텍스트를 감싼 블록(문서 맥락)
  rect: DOMRect; // 선택 영역(뷰포트 좌표)
}

let current: DragPopup | undefined;

// 팝업을 띄운다. 이미 떠 있으면 닫고 새로 만든다(항상 하나만).
export function showDragPopup(opts: DragPopupOptions): DragPopup {
  current?.remove();

  const host = document.createElement(TAG);
  host.setAttribute(UI_MARKER, '');
  // 페이지 좌표로 절대배치 → 스크롤하면 선택 영역과 같이 움직인다.
  host.style.position = 'absolute';
  host.style.zIndex = '2147483647'; // 페이지 최상단
  document.body.appendChild(host);
  place(host, opts.rect);

  const popup: DragPopup = {
    remove: () => {
      host.remove();
      if (current === popup) current = undefined;
    },
  };

  // 팝업은 불투명 카드지만, 페이지가 다크면 다크 카드로 맞춘다(감지 기준: 페이지 배경).
  applyTheme(host, document.body);

  const root = host.attachShadow({ mode: 'open' });
  root.append(styleEl(), shell(opts, popup.remove));

  current = popup;
  return popup;
}

export function removeDragPopup(): void {
  current?.remove();
}

// 현재 팝업이 이 이벤트 경로 안에 있나(팝업 내부 클릭이면 닫지 않는다).
// Shadow DOM 안의 클릭은 composedPath()로만 보인다.
export function isInsideDragPopup(e: Event): boolean {
  return e.composedPath().some((t) => t instanceof Element && t.tagName.toLowerCase() === TAG);
}

// 선택 영역 아래에 두되, 화면 밖으로 나가지 않게 보정한다.
function place(host: HTMLElement, rect: DOMRect): void {
  const left = Math.min(
    Math.max(MARGIN, rect.left),
    Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN),
  );
  // 아래 공간이 부족하면 선택 영역 위로 올린다(대략치 — 스트리밍으로 자라므로 완벽할 순 없다).
  const spaceBelow = window.innerHeight - rect.bottom;
  const below = spaceBelow > 220 || rect.top < 220;
  const top = below ? rect.bottom + MARGIN : Math.max(MARGIN, rect.top - 220);

  host.style.left = `${left + window.scrollX}px`;
  host.style.top = `${top + window.scrollY}px`;
  host.style.width = `${WIDTH}px`;
}

function styleEl(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    .pop {
      box-sizing: border-box; width: 100%;
      max-height: 60vh; overflow-y: auto;
      padding: 10px 12px;
      border: 1px solid #dadce0; border-radius: 10px;
      background: #fff;
      box-shadow: 0 6px 24px rgba(0,0,0,0.18);
      font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124;
    }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 6px;
    }
    .label { font-size: 11px; color: #9aa0a6; }
    .close {
      border: none; background: transparent; cursor: pointer;
      color: #9aa0a6; font-size: 14px; line-height: 1; padding: 2px 4px;
    }
    .close:hover { color: #202124; }
    .src {
      margin: 0 0 8px; padding: 6px 10px;
      border-left: 3px solid #dadce0; background: rgba(0,0,0,0.03);
      border-radius: 0 6px 6px 0;
      color: #5f6368; font-size: 12px;
      max-height: 4.8em; overflow: hidden;
    }
    .tr {
      margin: 0 0 8px; padding: 6px 10px;
      border-left: 3px solid #8ab4f8; background: rgba(138,180,248,0.08);
      border-radius: 0 6px 6px 0; color: #202124;
    }
    .toggle {
      display: inline-flex; align-items: center; gap: 4px;
      margin: 0 0 8px; padding: 3px 9px;
      border: 1px solid #8ab4f8; border-radius: 999px;
      background: transparent; color: #1a73e8;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .toggle:hover { background: rgba(138,180,248,0.12); }
    ${CONVERSATION_CSS}
    /* 다크 테마: OS가 아니라 감지된 페이지 배경 기준(:host의 data-theme). */
    :host([data-theme="dark"]) .pop { background: #292a2d; border-color: #5f6368; color: #e9eaed; }
    :host([data-theme="dark"]) .src { color: #9aa0a6; background: rgba(255,255,255,0.05); border-left-color: #5f6368; }
    :host([data-theme="dark"]) .tr { color: #e9eaed; }
    :host([data-theme="dark"]) .toggle { color: #8ab4f8; }
    :host([data-theme="dark"]) .close:hover { color: #e9eaed; }
  `;
  return style;
}

function shell(opts: DragPopupOptions, close: () => void): HTMLElement {
  const pop = document.createElement('div');
  pop.className = 'pop';

  const head = document.createElement('div');
  head.className = 'head';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = 'DocuMate';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close';
  closeBtn.textContent = '✕';
  closeBtn.title = '닫기';
  closeBtn.addEventListener('click', close);
  head.append(label, closeBtn);

  // 선택한 원문(길면 CSS로 잘림). 페이지 텍스트 → textContent로만.
  const src = document.createElement('div');
  src.className = 'src';
  src.textContent = opts.text;

  // 1단: 번역 (바로 시작)
  const tr = document.createElement('div');
  tr.className = 'tr loading';
  tr.textContent = '번역 중…';

  // 2단: 해설 버튼 → 3단: 대화(후속질문 포함)
  const toggle = document.createElement('button');
  toggle.className = 'toggle';
  toggle.textContent = '💡 해설 보기';

  const convoBox = document.createElement('div');

  pop.append(head, src, tr, toggle, convoBox);

  // 선택이 문단(문맥)보다 충분히 짧을 때(단어·구절)만 문맥을 붙여 번역한다.
  // 선택이 곧 문단 전체면 문맥 없이 번역 → 전체 번역과 **동일한 결과**가 나오고 공용 캐시도
  // 적중한다(같은 문장이므로). 문맥은 단어의 다의성을 잡는 용도지, 문장 전체엔 불필요하다.
  // (해설(convoBox)은 문장 전체여도 문서 맥락이 필요하므로 precedingText를 그대로 쓴다.)
  const trContext =
    opts.precedingText && opts.text.length <= opts.precedingText.length * 0.85
      ? opts.precedingText
      : undefined;

  translateOnce(opts.text, trContext)
    .then((translation) => {
      tr.classList.remove('loading');
      tr.textContent = translation; // LLM 출력 → textContent로만
    })
    .catch((e) => {
      const reason = e instanceof Error ? e.message : String(e);
      tr.classList.remove('loading');
      tr.classList.add('error');
      tr.textContent = '번역을 불러오지 못했어요.';
      console.warn('[Documate] 드래그 번역 실패 · 원인:', reason);
    });

  const base = {
    text: opts.text,
    docTitle: opts.docTitle,
    precedingText: opts.precedingText,
    kind: 'concept',
    source: 'drag',
  } satisfies ExplainRequest;

  toggle.addEventListener(
    'click',
    () => {
      const convo = createConversation(base, {
        onFirstDone: () => {
          toggle.textContent = '💡 해설';
        },
      });
      convoBox.append(convo.list, convo.ask);
      convo.start();
    },
    { once: true },
  );

  return pop;
}
