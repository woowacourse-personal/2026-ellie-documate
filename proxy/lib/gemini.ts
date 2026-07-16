import { GoogleGenAI } from '@google/genai';

// Gemini 클라이언트. API 키는 오직 이 프록시 환경변수에만 존재한다(확장에는 절대 두지 않는다).
// GEMINI_API_KEY 를 Vercel 환경변수 또는 로컬 .env.local 에 둔다.
export const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 모델 선택.
//  - 번역: 대량 호출이라 비용/지연 중요 → 경량·빠른 Flash. thinking 끔.
//  - 해설: 이 제품의 심장. 이상적으론 상위 Pro지만 gemini-2.5-pro는 무료 티어
//    한도가 0(결제 필요)이라, 무료로 도는 Flash를 기본으로 둔다.
//    결제 활성화 후 품질을 더 원하면 EXPLAIN_MODEL을 'gemini-2.5-pro'로 올린다.
// 번역·해설 모두 flash-lite: flash-latest(gemini-3.5-flash)는 무료 티어에서 10~20초로 느리고
// 하루 20요청 한도라 실사용에 부적합. flash-lite는 빠르고 별도 quota. 해설 품질은 실측상 충분.
// 결제 활성화 시 해설을 상위 모델(pro 등)로 올릴지는 열려 있음.
export const TRANSLATE_MODEL = 'gemini-flash-lite-latest';
export const EXPLAIN_MODEL = 'gemini-flash-lite-latest';
