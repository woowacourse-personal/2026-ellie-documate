import { defineManifest } from '@crxjs/vite-plugin';

// Documate 크롬 확장 매니페스트 (MV3)
// 활성화 모델(B안): 사용자가 아이콘을 클릭한 탭에서만 동작한다.
//   - default_popup을 두지 않아 아이콘 클릭이 background의 action.onClicked로 전달된다.
//   - content script는 모든 웹페이지에 주입되지만, 클릭 메시지를 받기 전까지는
//     리스너 등록만 하고 UI를 그리거나 LLM을 호출하지 않는다(유휴 상태).
export default defineManifest({
  manifest_version: 3,
  name: 'DocuMate',
  version: '0.0.0',
  description:
    '개발 용어와 기술 문맥을 고려해 영어 개발 문서를 자연스럽게 번역하고, 어려운 개념은 해설과 후속 질문으로 이해할 수 있도록 돕는 Chrome 확장 프로그램',

  action: {
    default_title: 'DocuMate 켜기 / 끄기',
  },

  background: {
    // content/index.ts 와 파일명이 겹치면 CRXJS 청크가 충돌해 SW가 엉뚱한 번들을
    // 로드한다(onClicked 미등록 버그). 진입점 파일명을 반드시 구분한다.
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  // 모든 웹페이지(http/https). 클릭 전엔 유휴 상태라 특정 사이트 제한을 두지 않는다.
  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],

  // storage: 번역 결과 로컬 캐시(같은 문단 재번역 방지).
  permissions: ['activeTab', 'storage'],

  // 우리 프록시 호출 허용. 프로덕션 프록시 URL. 로컬에서 프록시를 고칠 땐
  // 'http://localhost:3000/*'를 잠깐 추가한다(PROXY_BASE_URL도 함께).
  host_permissions: ['https://documate-proxy-jo-eungyeongs-projects.vercel.app/*'],
});
