// content script ↔ service worker 사이 메시지 타입.
// 모든 메시지를 여기 한 곳에 모아 타입 안전하게 주고받는다.

// service worker → content: 아이콘이 클릭됐으니 켜기/끄기 토글하라
export interface ToggleMessage {
  type: 'DOCUMATE_TOGGLE';
}

// 앞으로 추가될 메시지들(번역/해설 요청 등)은 이 유니온에 더한다.
export type Message = ToggleMessage;

// 타입 가드
export function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
