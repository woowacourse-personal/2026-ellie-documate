// Shadow DOM 호스트 생성 유틸.
// 남의 페이지에 UI를 주입할 때는 반드시 Shadow DOM 안에 넣는다.
//  - 문서 CSS가 우리 UI를 깨지 못하게
//  - 우리 CSS가 문서 레이아웃을 건드리지 못하게
// 이 프로젝트의 모든 주입 UI가 거쳐야 하는 진입점.

const HOST_ID = 'documate-root';

export interface ShadowHost {
  host: HTMLElement;
  root: ShadowRoot;
}

// 페이지에 단 하나의 shadow 호스트를 만든다(이미 있으면 재사용).
export function ensureShadowHost(): ShadowHost {
  const existing = document.getElementById(HOST_ID);
  if (existing?.shadowRoot) {
    return { host: existing, root: existing.shadowRoot };
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  // 호스트 자체는 레이아웃에 영향을 주지 않도록 최소 스타일만.
  host.style.all = 'initial';
  const root = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);

  return { host, root };
}

// 호스트를 완전히 제거(끄기).
export function removeShadowHost(): void {
  document.getElementById(HOST_ID)?.remove();
}
