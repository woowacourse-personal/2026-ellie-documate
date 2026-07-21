import {
  EXPLAIN_PORT,
  type ExplainEvent,
  type ExplainRequest,
  type ExplainTurn,
} from '../../shared/messages';

// 해설 대화(F2 해설 + F3 후속질문)의 공용 알맹이.
// 문단 인라인 해설(ui/explain.ts)과 드래그 팝업(ui/drag-popup.ts)이 같이 쓴다.
//
// 왜 프록시가 아니라 여기가 대화를 들고 있나: 프록시는 서버리스라 세션을 못 들고 있는다.
// 히스토리는 클라이언트가 보관하고 매 요청에 통째로 보낸다. 설계 전문은 PLAN.md §3 "F3 설계".
//
// 동적 텍스트(LLM 출력·사용자 입력)는 반드시 textContent/createTextNode로만 넣는다(XSS 방지).

// 프록시 LIMITS.MAX_HISTORY_TURNS(12)보다 낮게 잡는다. 이번 질문 1턴이 더 붙기 때문.
const MAX_HISTORY_TURNS = 11;

// 대화 블록 스타일. shadow root마다 상속이 끊기므로 쓰는 쪽에서 <style>에 넣는다.
export const CONVERSATION_CSS = `
  .body {
    margin: 2px 0 10px; padding: 10px 12px;
    border-left: 3px solid #34a853;
    background: rgba(52,168,83,0.09); border-radius: 0 6px 6px 0;
    font: 14px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #202124; white-space: pre-wrap;
  }
  .loading { color: #9aa0a6; }
  .error { color: #d93025; border-left-color: #d93025; background: rgba(217,48,37,0.06); }
  .q {
    margin: 2px 0 6px; padding: 8px 12px;
    border-left: 3px solid #9aa0a6;
    background: rgba(154,160,166,0.14); border-radius: 0 6px 6px 0;
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
  /* 다크 테마: OS가 아니라 감지된 배경 기준(:host의 data-theme). */
  :host([data-theme="dark"]) .body { color: #e9eaed; background: rgba(52,168,83,0.16); }
  :host([data-theme="dark"]) .error { color: #f28b82; }
  :host([data-theme="dark"]) .q { color: #c8c8c8; background: rgba(154,160,166,0.20); }
  :host([data-theme="dark"]) .ask-input { background: #202124; color: #e9eaed; border-color: #5f6368; }
  :host([data-theme="dark"]) .ask-send { color: #8ab4f8; }
`;

export interface Conversation {
  list: HTMLElement; // 대화(해설 + Q/A)가 쌓이는 컨테이너
  ask: HTMLElement; // 후속질문 입력 행 (최초 해설이 끝나면 나타남)
  start(): void; // 최초 해설 스트리밍 시작
}

export interface ConversationOptions {
  onFirstDone?(full: string): void; // 최초 해설 완료(실패·빈 응답이면 빈 문자열)
}

// 해설 대화 하나를 만든다. list/ask를 원하는 곳에 붙이고 start()를 부르면 된다.
export function createConversation(
  base: ExplainRequest,
  opts: ConversationOptions = {},
): Conversation {
  const list = document.createElement('div');
  list.className = 'list';
  const ask = askRow();

  // 이 대화의 히스토리. 최초 해설 답변('model')부터 쌓인다.
  const history: ExplainTurn[] = [];

  function start(): void {
    stream(base, addAnswer(list), {
      onDone: (full) => {
        opts.onFirstDone?.(full);
        if (!full) return; // 빈 응답 → 후속질문을 열어도 이어갈 맥락이 없다
        history.push({ role: 'model', text: full });
        ask.show();
      },
    });
  }

  ask.onSubmit((question) => {
    addQuestion(list, question);
    const answer = addAnswer(list);
    ask.disable();
    stream({ ...base, history: trimHistory(history), question }, answer, {
      onDone: (full) => {
        ask.enable();
        // 실패(빈 응답)면 질문·답변 둘 다 히스토리에 넣지 않는다.
        // user/model 교대가 깨지면 이후 요청이 통째로 망가지기 때문.
        if (!full) return;
        history.push({ role: 'user', text: question });
        history.push({ role: 'model', text: full });
      },
      onError: () => ask.enable(),
    });
  });

  return { list, ask: ask.row, start };
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
    // 페이지 단축키(예: '/'로 검색 열기)가 우리 입력을 가로채지 않도록 막는다.
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
