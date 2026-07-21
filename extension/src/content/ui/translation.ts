import type { Paragraph } from '../extract';
import { applyTheme } from './theme';
import { insertBlock } from './inject';

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
    // 표 셀·flex/grid 컨테이너면 노드 안쪽에, 그 외엔 원문 뒤에 삽입(레이아웃 보호).
    insertBlock(p.node, host);
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
    /* 원문의 인라인 코드를 번역문에서도 코드 칩으로 되살린다(고정폭·옅은 배경). */
    .ci {
      font-family: "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.9em; background: rgba(0,0,0,0.06);
      padding: 1px 5px; border-radius: 4px; word-break: break-all;
    }
    /* 다크 테마: OS가 아니라 감지된 배경 기준(:host의 data-theme). */
    :host([data-theme="dark"]) .tr { color: #e9eaed; background: rgba(138,180,248,0.16); }
    :host([data-theme="dark"]) .error { color: #f28b82; }
    :host([data-theme="dark"]) .ci { background: rgba(255,255,255,0.12); }
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

  // 번역 완료 상태에서, 원문의 인라인 코드 조각을 코드 칩으로 되살린다. 그 외엔 평문.
  if (state === 'done' && p.codeSpans.length > 0) {
    renderWithCodeSpans(box, text, p.codeSpans);
  } else {
    box.textContent = text; // 항상 textContent
  }
  root.append(style, box);
}

// text 안에서 codeSpans에 해당하는 조각을 <code> 칩으로 감싸고 나머지는 텍스트 노드로 넣는다.
// 전부 textContent/createTextNode만 쓴다(innerHTML 금지 — LLM·페이지 텍스트는 신뢰 불가).
function renderWithCodeSpans(box: HTMLElement, text: string, spans: string[]): void {
  // 긴 조각부터 처리해 부분 문자열 겹침을 막는다. 2자 미만·중복 제거.
  const uniq = [...new Set(spans.filter((s) => s.length >= 2))].sort((a, b) => b.length - a.length);
  let parts: { code: boolean; s: string }[] = [{ code: false, s: text }];
  for (const span of uniq) {
    const next: { code: boolean; s: string }[] = [];
    for (const part of parts) {
      if (part.code) {
        next.push(part);
        continue;
      }
      let rest = part.s;
      let idx = rest.indexOf(span);
      while (idx !== -1) {
        if (idx > 0) next.push({ code: false, s: rest.slice(0, idx) });
        next.push({ code: true, s: span });
        rest = rest.slice(idx + span.length);
        idx = rest.indexOf(span);
      }
      if (rest) next.push({ code: false, s: rest });
    }
    parts = next;
  }
  for (const part of parts) {
    if (part.code) {
      const c = document.createElement('code');
      c.className = 'ci';
      c.textContent = part.s;
      box.appendChild(c);
    } else {
      box.appendChild(document.createTextNode(part.s));
    }
  }
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
