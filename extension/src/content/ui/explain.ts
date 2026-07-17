import type { Paragraph } from '../extract';
import {
  EXPLAIN_PORT,
  type ExplainEvent,
  type ExplainRequest,
  type ExplainTurn,
} from '../../shared/messages';

// 문단별 개념 해설(F2) + 후속질문(F3).
// "해설 보기" 버튼(기본 접힘) → 클릭 시 스트리밍으로 해설을 펼치고,
// 해설이 끝나면 입력창이 열려 탭 이동 없이 그 자리에서 더 물어볼 수 있다.
//
// 해설은 SW를 Port로 경유해 프록시에서 스트리밍으로 받아온다(제품의 심장).
// 대화 히스토리는 여기(content)가 들고 매 요청에 통째로 보낸다 — 프록시는 서버리스라
// 세션을 들고 있을 수 없다.
//
// UI는 Preact가 아니라 순수 DOM이다(PLAN.md §1 "주입 UI = 순수 DOM 아일랜드").
// 동적 텍스트(LLM 출력·사용자 입력)는 반드시 textContent/createTextNode로만 넣는다(XSS 방지).

const UI_MARKER = 'data-documate-ui'; // 옵저버가 무시하는 우리 요소 표식
const FOR_ATTR = 'data-documate-ex-for';

// 프록시 LIMITS.MAX_HISTORY_TURNS(12)보다 낮게 잡는다. 이번 질문 1턴이 더 붙기 때문.
const MAX_HISTORY_TURNS = 11;

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
    /* 후속질문(F3) */
    .q {
      margin: 2px 0 6px; padding: 8px 12px;
      border-left: 3px solid #9aa0a6;
      background: rgba(154,160,166,0.12); border-radius: 0 6px 6px 0;
      font: 13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #3c4043; white-space: pre-wrap;
    }
    .ask { display: none; gap: 6px; margin: 0 0 10px; }
    .ask.show { display: flex; }
    .ask-input {
      flex: 1; min-width: 0; padding: 6px 10px;
      border: 1px solid #dadce0; border-radius: 999px;
      background: #fff; color: #202124;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .ask-input:focus { outline: none; border-color: #8ab4f8; }
    .ask-send {
      padding: 6px 12px; border: 1px solid #8ab4f8; border-radius: 999px;
      background: transparent; color: #1a73e8;
      font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }
    .ask-send:hover:not(:disabled) { background: rgba(138,180,248,0.12); }
    .ask-input:disabled, .ask-send:disabled { opacity: 0.5; cursor: default; }
    @media (prefers-color-scheme: dark) {
      .body { color: #e6e6e6; }
      .q { color: #c8c8c8; }
      .ask-input { background: #202124; color: #e6e6e6; border-color: #5f6368; }
    }
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

// 펼친 상태: 패널을 열고 최초 해설 스트리밍 → 끝나면 후속질문 입력창을 연다.
function expand(root: ShadowRoot, p: Paragraph, ctx: ExplainContext): void {
  const btn = root.querySelector<HTMLButtonElement>('.toggle');

  const panel = document.createElement('div');
  panel.className = 'panel';
  const inner = document.createElement('div');
  inner.className = 'inner';
  const list = document.createElement('div'); // 대화(해설 + Q/A들)
  list.className = 'list';
  const ask = askRow();
  inner.append(list, ask.row);
  panel.append(inner);
  root.append(panel);

  // 다음 프레임에 open 클래스 → grid-rows 0fr→1fr 펼침 애니메이션.
  requestAnimationFrame(() => panel.classList.add('open'));

  // 이 문단의 대화. 최초 해설 답변('model')부터 쌓인다.
  const history: ExplainTurn[] = [];
  const base = {
    text: p.text,
    docTitle: ctx.docTitle,
    precedingText: ctx.precedingText,
    kind: ctx.kind ?? 'concept',
  } satisfies ExplainRequest;

  stream(base, addAnswer(list), {
    onDone: (full) => {
      if (btn) btn.textContent = '💡 해설';
      if (!full) return; // 빈 응답 → 후속질문을 열어도 이어갈 맥락이 없다
      history.push({ role: 'model', text: full });
      ask.show();
    },
  });

  ask.onSubmit((question) => {
    addQuestion(list, question);
    const answer = addAnswer(list);
    ask.disable();
    stream(
      { ...base, history: trimHistory(history), question },
      answer,
      {
        onDone: (full) => {
          ask.enable();
          // 실패(빈 응답)면 질문·답변 둘 다 히스토리에 넣지 않는다.
          // user/model 교대가 깨지면 이후 요청이 통째로 망가지기 때문.
          if (!full) return;
          history.push({ role: 'user', text: question });
          history.push({ role: 'model', text: full });
        },
        onError: () => ask.enable(),
      },
    );
  });
}

// 대화가 길어지면 가장 오래된 Q/A 쌍부터 버린다.
// 첫 해설(history[0])은 맥락의 기준점이라 남긴다. 결과는 [model, (user, model)*k] 형태라
// user/model 교대가 유지된다 (Gemini는 교대를 요구한다).
function trimHistory(h: ExplainTurn[]): ExplainTurn[] {
  if (h.length <= MAX_HISTORY_TURNS) return h;
  const keep = Math.floor((MAX_HISTORY_TURNS - 1) / 2) * 2; // 뒤에서 남길 턴 수(짝수)
  return [h[0], ...h.slice(h.length - keep)];
}

// 답변(모델) 블록을 하나 추가하고 그 요소를 돌려준다. 스트림이 여기에 쌓인다.
function addAnswer(list: HTMLElement): HTMLElement {
  const body = document.createElement('div');
  body.className = 'body loading';
  body.textContent = '해설 생성 중…';
  list.append(body);
  return body;
}

// 사용자가 던진 질문 블록.
function addQuestion(list: HTMLElement, question: string): void {
  const q = document.createElement('div');
  q.className = 'q';
  q.textContent = question; // 사용자 입력 → textContent로만
  list.append(q);
}

interface AskRow {
  row: HTMLElement;
  show(): void;
  enable(): void;
  disable(): void;
  onSubmit(handler: (question: string) => void): void;
}

// 후속질문 입력 행. 최초 해설이 끝나기 전엔 숨어 있다.
function askRow(): AskRow {
  const row = document.createElement('div');
  row.className = 'ask';

  const input = document.createElement('input');
  input.className = 'ask-input';
  input.type = 'text';
  input.placeholder = '더 물어보기…';

  const send = document.createElement('button');
  send.className = 'ask-send';
  send.textContent = '질문';

  row.append(input, send);

  let handler: ((question: string) => void) | undefined;
  const submit = () => {
    const question = input.value.trim();
    if (!question || input.disabled) return;
    input.value = '';
    handler?.(question);
  };

  send.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    // 페이지의 단축키(예: '/'로 검색 열기)가 우리 입력을 가로채지 않도록 막는다.
    e.stopPropagation();
    if (e.key === 'Enter') submit();
  });
  input.addEventListener('keyup', (e) => e.stopPropagation());
  input.addEventListener('keypress', (e) => e.stopPropagation());

  return {
    row,
    show: () => row.classList.add('show'),
    enable: () => {
      input.disabled = false;
      send.disabled = false;
    },
    disable: () => {
      input.disabled = true;
      send.disabled = true;
    },
    onSubmit: (h) => {
      handler = h;
    },
  };
}

interface StreamHandlers {
  onDone(full: string): void; // 실패·빈 응답이면 빈 문자열
  onError?(): void;
}

// SW Port로 해설을 스트리밍 받아 body에 이어붙인다.
// 요청 1건당 포트 1개 — 스트림이 끝나면 닫는다(포트를 열어두면 SW가 계속 살아있는다).
function stream(
  req: ExplainRequest,
  body: HTMLElement,
  handlers: StreamHandlers,
): void {
  const port = chrome.runtime.connect({ name: EXPLAIN_PORT });
  let first = true;
  let full = ''; // 히스토리에 넣을 전체 텍스트

  const fail = (message: string, reason: string) => {
    body.classList.remove('loading');
    body.classList.add('error');
    body.textContent = message;
    console.warn('[Documate] 해설 실패 · 원인:', reason);
    handlers.onError?.();
    handlers.onDone('');
  };

  port.onMessage.addListener((raw) => {
    const e = raw as ExplainEvent;
    if (e.type === 'chunk') {
      if (first) {
        body.classList.remove('loading');
        body.textContent = ''; // "해설 생성 중…" 지우고 실제 해설로
        first = false;
      }
      full += e.delta;
      body.appendChild(document.createTextNode(e.delta)); // 항상 textNode
    } else if (e.type === 'done') {
      if (first) {
        body.classList.remove('loading');
        body.textContent = '해설이 비어 있어요.';
        first = false;
        handlers.onDone('');
      } else {
        handlers.onDone(full);
      }
      port.disconnect();
    } else {
      first = false; // onDisconnect가 또 에러를 덮어쓰지 않도록
      fail('해설을 불러오지 못했어요.', e.reason);
      port.disconnect();
    }
  });

  port.onDisconnect.addListener(() => {
    if (first) fail('해설 연결이 끊겼어요.', 'port disconnected');
  });

  port.postMessage(req);
}
