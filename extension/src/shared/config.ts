// 확장 전역 설정.

// 프록시 기본 URL. 프로덕션은 배포된 Vercel 프록시.
// 로컬에서 프록시를 고칠 땐 잠깐 'http://localhost:3000'으로 바꿔 쓴다(manifest host_permissions도 함께).
export const PROXY_BASE_URL =
  'https://documate-proxy-jo-eungyeongs-projects.vercel.app';

// 프록시 한 번에 보낼 최대 문단 수(프록시 LIMITS.MAX_BATCH와 일치시킨다).
export const TRANSLATE_BATCH = 25;
