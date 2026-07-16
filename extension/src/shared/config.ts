// 확장 전역 설정.

// 프록시 기본 URL. 로컬 개발은 vercel dev(localhost:3000).
// 배포 시 이 값을 배포된 프록시 URL로 바꾸고, manifest host_permissions도 함께 갱신한다.
export const PROXY_BASE_URL = 'http://localhost:3000';

// 프록시 한 번에 보낼 최대 문단 수(프록시 LIMITS.MAX_BATCH와 일치시킨다).
export const TRANSLATE_BATCH = 25;
