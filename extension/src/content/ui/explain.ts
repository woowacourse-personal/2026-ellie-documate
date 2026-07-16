import type { Paragraph } from '../extract';
import {
  EXPLAIN_PORT,
  type ExplainEvent,
  type ExplainRequest,
} from '../../shared/messages';

// 문단별 개념 해설(F2). "해설 보기" 버튼(기본 접힘) → 클릭 시 스트리밍으로 해설을 펼친다.
// 해설은 SW를 Port로 경유해 프록시에서 스트리밍으로 받아온다(제품의 심장).
// 동적 텍스트(LLM 출력)는 반드시 textContent/createTextNode로만 넣는다(XSS 방지).

const UI_MARKER = 'data-documate-ui'; // 옵저버가 무시하는 우리 요소 표식
const FOR_ATTR = 'data-documate-ex-for';

export interface ExplainContext {
  docTitle: string;
  precedingText?: string;
  kind?: 'concept' | 'code'; // 개념 해설(기본) vs 코드 해설
}

export function mountExplain(p: Paragraph, ctx: ExplainContext): void {
  if (document.querySelector(`documate-ex[${FOR_ATTR}="${p.id}"]`)) return; // 이미 있음

  // 번역 블록 바로 뒤(없으면 원문 문단 뒤)에 삽입.
  const trBlock = document.querySelector(
    `documate-tr[data-documate-tr-for="${p.id}"]`,
  );
  const host = document.createElement('documate-ex');
  host.setAttribute(UI_MARKER, '');
  host.setAttribute(FOR_ATTR, p.id);
  (trBlock ?? p.node).insertAdjacentElement('afterend', host);

  const root = host.attachShadow({ mode: 'open' });
  root.append(styleEl(), collapsed(root, p, ctx));
}

function styleEl(): HTMLStyleElement {
  const style = document.createElement('style');
  style.textContent = `
    .toggle {
      display: inline-flex; align-items: center; gap: 4px;
      margin: 2px 0 8px; padding: 3px 9px;
      border: 1px solid #8ab4f8; border-radius: 999px;
      background: transparent; color: #1a73e8;
      font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .toggle:hover { background: rgba(138,180,248,0.12); }
    .panel {
      display: grid; grid-template-rows: 0fr;
      transition: grid-template-rows 220ms cubic-bezier(0.4,0,0.2,1);
    }
    .panel.open { grid-template-rows: 1fr; }
    .panel > .inner { overflow: hidden; }
    .body {
      margin: 2px 0 10px; padding: 10px 12px;
      border-left: 3px solid #34a853;
      background: rgba(52,168,83,0.07); border-radius: 0 6px 6px 0;
      font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #202124; white-space: pre-wrap;
    }
    .loading { color: #9aa0a6; }
    .error { color: #d93025; border-left-color: #d93025; background: rgba(217,48,37,0.06); }
    @media (prefers-color-scheme: dark) { .body { color: #e6e6e6; } }
  `;
  return style;
}

// 접힌 상태: "해설 보기" 버튼만.
function collapsed(
  root: ShadowRoot,
  p: Paragraph,
  ctx: ExplainContext,
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'toggle';
  btn.textContent = ctx.kind === 'code' ? '💡 코드 해설' : '💡 해설 보기';
  btn.addEventListener('click', () => expand(root, p, ctx), { once: true });
  return btn;
}

// 펼친 상태: 패널을 열고 스트리밍 시작.
function expand(root: ShadowRoot, p: Paragraph, ctx: ExplainContext): void {
  const btn = root.querySelector<HTMLButtonElement>('.toggle');

  const panel = document.createElement('div');
  panel.className = 'panel';
  const inner = document.createElement('div');
  inner.className = 'inner';
  const body = document.createElement('div');
  body.className = 'body loading';
  body.textContent = '해설 생성 중…';
  inner.append(body);
  panel.append(inner);
  root.append(panel);

  // 다음 프레임에 open 클래스 → grid-rows 0fr→1fr 펼침 애니메이션.
  requestAnimationFrame(() => panel.classList.add('open'));

  stream(
    {
      text: p.text,
      docTitle: ctx.docTitle,
      precedingText: ctx.precedingText,
      kind: ctx.kind ?? 'concept',
    },
    body,
    btn,
  );
}

// SW Port로 해설을 스트리밍 받아 body에 이어붙인다.
function stream(
  req: ExplainRequest,
  body: HTMLElement,
  btn: HTMLButtonElement | null,
): void {
  const port = chrome.runtime.connect({ name: EXPLAIN_PORT });
  let first = true;

  port.onMessage.addListener((raw) => {
    const e = raw as ExplainEvent;
    if (e.type === 'chunk') {
      if (first) {
        body.classList.remove('loading');
        body.textContent = ''; // "해설 생성 중…" 지우고 실제 해설로
        first = false;
      }
      body.appendChild(document.createTextNode(e.delta)); // 항상 textNode
    } else if (e.type === 'done') {
      if (first) {
        body.classList.remove('loading');
        body.textContent = '해설이 비어 있어요.';
      }
      if (btn) btn.textContent = '💡 해설';
      port.disconnect();
    } else {
      body.classList.remove('loading');
      body.classList.add('error');
      body.textContent = '해설을 불러오지 못했어요.';
      console.warn('[Documate] 해설 실패 · 원인:', e.reason);
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (first) {
      body.classList.remove('loading');
      body.classList.add('error');
      body.textContent = '해설 연결이 끊겼어요.';
    }
  });

  port.postMessage(req);
}
