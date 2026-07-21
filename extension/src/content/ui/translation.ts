import type { Paragraph } from '../extract';
import { applyTheme } from './theme';

// 원본 문단 바로 아래에 한국어 번역 블록을 인라인 주입한다.
// 각 블록은 자체 Shadow DOM 안에 렌더 → 페이지 CSS와 상호 비파괴.
// 동적 텍스트(번역=LLM 출력)는 반드시 textContent로만 넣는다(XSS 방지).

const UI_MARKER = 'data-documate-ui'; // 우리 주입 요소 표식(옵저버가 무시)
const FOR_ATTR = 'data-documate-tr-for';

function ensureHost(p: Paragraph): ShadowRoot {
  let host = document.querySelector<HTMLElement>(
    `documate-tr[${FOR_ATTR}="${p.id}"]`,
  );
  if (!host) {
    host = document.createElement('documate-tr');
    host.setAttribute(UI_MARKER, '');
    host.setAttribute(FOR_ATTR, p.id);
    p.node.insertAdjacentElement('afterend', host);
  }
  // 테마는 OS가 아니라 문단이 얹힌 실제 배경 밝기로 정한다(매 렌더마다 재감지 → SPA 테마 토글 대응).
  applyTheme(host, p.node);
  return host.shadowRoot ?? host.attachShadow({ mode: 'open' });
}

function render(
  p: Paragraph,
  text: string,
  state: 'loading' | 'done' | 'error',
): void {
  const root = ensureHost(p);
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    .tr {
      display: block;
      margin: 4px 0 10px;
      padding: 6px 10px;
      border-left: 3px solid #8ab4f8;
      background: rgba(138, 180, 248, 0.10);
      border-radius: 0 6px 6px 0;
      color: #202124;
    }
    .loading { color: #9aa0a6; }
    .error { color: #d93025; border-left-color: #d93025; background: rgba(217,48,37,0.06); }
    /* 다크 테마: OS가 아니라 감지된 배경 기준(:host의 data-theme). */
    :host([data-theme="dark"]) .tr { color: #e9eaed; background: rgba(138,180,248,0.16); }
    :host([data-theme="dark"]) .error { color: #f28b82; }
  `;

  const box = document.createElement('div');
  box.className = `tr${state === 'loading' ? ' loading' : ''}${state === 'error' ? ' error' : ''}`;

  // 번역문 글자 크기·행높이·굵기·글꼴을 원문 문단과 동일하게 맞춘다.
  // (Shadow DOM은 스타일 상속이 끊기므로 명시적으로 지정. 페이지 값 주입은
  //  CSS 파싱이 아닌 element.style 대입이라 주입 위험 없음 — 잘못된 값은 무시됨.)
  const cs = getComputedStyle(p.node);
  box.style.fontSize = cs.fontSize;
  box.style.lineHeight = cs.lineHeight;
  box.style.fontWeight = cs.fontWeight;
  box.style.fontFamily = cs.fontFamily;

  box.textContent = text; // 항상 textContent
  root.append(style, box);
}

export function showTranslationLoading(p: Paragraph): void {
  render(p, '번역 중…', 'loading');
}

export function showTranslation(p: Paragraph, text: string): void {
  render(p, text, 'done');
}

export function showTranslationError(p: Paragraph): void {
  render(p, '번역을 불러오지 못했어요.', 'error');
}

// 문단에 붙인 주입 UI(번역 블록 + 해설 패널)를 전부 제거한다. 재추출·비활성화 때 호출.
// 문단에 매인 것만 지운다 — 드래그 팝업(documate-drag)은 문단과 무관하게 살아있어야 하므로
// `[data-documate-ui]` 전체가 아니라 이 두 엘리먼트만 노린다.
// (SPA 재추출이 진행 중인 드래그 대화를 날려버리면 안 된다.)
export function removeAllParagraphUI(): void {
  for (const host of document.querySelectorAll('documate-tr, documate-ex')) {
    host.remove();
  }
}
