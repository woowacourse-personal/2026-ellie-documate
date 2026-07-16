// content script ↔ service worker 사이 메시지 타입.
// 모든 메시지를 여기 한 곳에 모아 타입 안전하게 주고받는다.

// service worker → content: 아이콘이 클릭됐으니 켜기/끄기 토글하라
export interface ToggleMessage {
  type: 'DOCUMATE_TOGGLE';
}

// content → service worker: 이 문단들을 번역해줘 (SW가 캐시/프록시 중계)
export interface TranslateItem {
  id: string;
  text: string;
}
export interface TranslateRequest {
  type: 'DOCUMATE_TRANSLATE';
  items: TranslateItem[];
}

// service worker → content: 번역 결과 (id로 매칭)
export interface TranslateResult {
  id: string;
  translation: string;
  error?: boolean;
  reason?: string; // 실패 시 원인(콘솔 진단용). 예: 'proxy 502', 'network', 'quota'
}
export interface TranslateResponse {
  results: TranslateResult[];
  // 단계별 소요 시간(ms). 진단용 — content가 콘솔에 breakdown으로 찍는다.
  timing?: { cacheMs: number; proxyMs: number; geminiMs: number };
}

// 개념 해설(F2) — 스트리밍이라 request/response가 아니라 Port로 주고받는다.
// content가 이 이름으로 포트를 열고 ExplainRequest를 보내면 SW가 ExplainEvent를 흘려보낸다.
export const EXPLAIN_PORT = 'documate-explain';

export interface ExplainRequest {
  text: string; // 해설 대상(문단 원문 또는 코드)
  docTitle?: string; // 문서 제목(맥락)
  precedingText?: string; // 앞 문단(맥락)
  kind?: 'concept' | 'code'; // 개념 해설(기본) vs "이 코드가 무엇을 하는지" 해설
}

// SW → content 스트림 이벤트
export type ExplainEvent =
  | { type: 'chunk'; delta: string }
  | { type: 'done' }
  | { type: 'error'; reason: string };

export type Message = ToggleMessage | TranslateRequest;

// 타입 가드
export function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
