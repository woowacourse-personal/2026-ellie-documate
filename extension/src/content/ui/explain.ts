import type { Paragraph } from '../extract';
import type { ExplainRequest } from '../../shared/messages';
import { CONVERSATION_CSS, createConversation } from './conversation';

// 문단별 개념 해설(F2) + 후속질문(F3).
// "해설 보기" 버튼(기본 접힘) → 클릭 시 스트리밍으로 해설을 펼치고,
// 해설이 끝나면 입력창이 열려 탭 이동 없이 그 자리에서 더 물어볼 수 있다.
//
// 대화 알맹이(히스토리·스트리밍·입력창)는 ui/conversation.ts가 갖고 있다.
// 여기는 "문단 옆에 붙는 접힘/펼침 껍데기"만 담당한다 — 드래그 팝업이 같은 알맹이를 쓴다.
//
// UI는 Preact가 아니라 순수 DOM이다(PLAN.md §1 "주입 UI = 순수 DOM 아일랜드").

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
    ${CONVERSATION_CSS}
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

// 펼친 상태: 패널을 열고 대화를 시작한다.
function expand(root: ShadowRoot, p: Paragraph, ctx: ExplainContext): void {
  const btn = root.querySelector<HTMLButtonElement>('.toggle');

  const panel = document.createElement('div');
  panel.className = 'panel';
  const inner = document.createElement('div');
  inner.className = 'inner';
  panel.append(inner);
  root.append(panel);

  // 다음 프레임에 open 클래스 → grid-rows 0fr→1fr 펼침 애니메이션.
  requestAnimationFrame(() => panel.classList.add('open'));

  const base = {
    text: p.text,
    docTitle: ctx.docTitle,
    precedingText: ctx.precedingText,
    kind: ctx.kind ?? 'concept',
    source: 'paragraph',
  } satisfies ExplainRequest;

  const convo = createConversation(base, {
    onFirstDone: () => {
      if (btn) btn.textContent = '💡 해설';
    },
  });
  inner.append(convo.list, convo.ask);
  convo.start();
}
