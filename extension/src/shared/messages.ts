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
