import type { Paragraph } from '../extract';

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
  return host.shadowRoot ?? host.attachShadow({ mode: 'open' });
}

function render(root: ShadowRoot, text: string, state: 'loading' | 'done' | 'error'): void {
  root.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `
    .tr {
      display: block;
      margin: 4px 0 10px;
      padding: 6px 10px;
      border-left: 3px solid #8ab4f8;
      background: rgba(138, 180, 248, 0.08);
      border-radius: 0 6px 6px 0;
      font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124;
    }
    .tag {
      display: inline-block; margin-right: 6px; padding: 0 5px;
      border-radius: 4px; background: #8ab4f8; color: #1b1b1f;
      font-size: 11px; font-weight: 700; vertical-align: 1px;
    }
    .loading { color: #9aa0a6; }
    .error { color: #d93025; border-left-color: #d93025; background: rgba(217,48,37,0.06); }
    @media (prefers-color-scheme: dark) {
      .tr { color: #e6e6e6; }
    }
  `;

  const box = document.createElement('div');
  box.className = `tr${state === 'loading' ? ' loading' : ''}${state === 'error' ? ' error' : ''}`;

  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = '번역';

  const body = document.createElement('span');
  body.className = 'body';
  body.textContent = text; // 항상 textContent

  box.append(tag, body);
  root.append(style, box);
}

export function showTranslationLoading(p: Paragraph): void {
  render(ensureHost(p), '번역 중…', 'loading');
}

export function showTranslation(p: Paragraph, text: string): void {
  render(ensureHost(p), text, 'done');
}

export function showTranslationError(p: Paragraph): void {
  render(ensureHost(p), '번역을 불러오지 못했어요.', 'error');
}

export function removeAllTranslations(): void {
  for (const host of document.querySelectorAll(`[${UI_MARKER}]`)) host.remove();
}
