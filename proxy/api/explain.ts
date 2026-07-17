import type { VercelRequest, VercelResponse } from '@vercel/node';
import { genai, EXPLAIN_MODEL } from '../lib/gemini.js';
import { codeExplanationSystem, explanationSystem } from '../lib/prompts.js';
import { guard, LIMITS, validateHistory } from '../lib/security.js';

// 개념 해설(F2) + 후속질문(F3) 엔드포인트 (스트리밍). 이 제품의 심장.
// 입력: { text, docTitle?, precedingText?, kind?, history?, question? }
//   - history/question 없음 → 최초 해설
//   - history/question 있음 → 후속질문(멀티턴)
// 출력: text/plain 스트림 (해설 텍스트가 도착하는 대로 흘려보냄)
// 해설은 첫 글자 체감 속도가 중요하므로 스트리밍한다.
//
// 멀티턴인데 왜 세션이 없나: 이 프록시는 서버리스(stateless)라 대화를 들고 있을 수 없다.
// 히스토리는 content가 보관하고 매 요청에 통째로 보낸다 → 프록시는 그대로 Gemini에 넘긴다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!guard(req, res)) return; // CORS·메서드·Origin 검증

  const text: unknown = req.body?.text;
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > LIMITS.MAX_TEXT_CHARS) {
    return res.status(400).json({ error: 'text too long' });
  }

  // 후속질문(F3). 클라이언트가 보낸 배열이므로 role·길이를 전부 검증한다.
  const history: { role: 'user' | 'model'; text: string }[] = [];
  if (req.body?.history !== undefined) {
    const bad = validateHistory(req.body.history);
    if (bad) return res.status(400).json({ error: bad.error });
    history.push(...req.body.history);
  }
  const question: unknown = req.body?.question;
  if (question !== undefined) {
    if (typeof question !== 'string' || question.length === 0) {
      return res.status(400).json({ error: 'question must be a non-empty string' });
    }
    if (question.length > LIMITS.MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: 'question too long' });
    }
  }
  // 후속질문은 앞선 해설(=model 턴)이 있어야 성립한다.
  if (question !== undefined && history.length === 0) {
    return res.status(400).json({ error: 'question requires history' });
  }
  // 선택 맥락도 길이 상한을 걸고 잘라 쓴다.
  const docTitle =
    typeof req.body?.docTitle === 'string'
      ? req.body.docTitle.slice(0, LIMITS.MAX_TITLE_CHARS)
      : undefined;
  const precedingText =
    typeof req.body?.precedingText === 'string'
      ? req.body.precedingText.slice(0, LIMITS.MAX_CONTEXT_CHARS)
      : undefined;

  const isCode = req.body?.kind === 'code';

  // 검증 지표(PLAN §5 "드래그 vs 문단 버튼 중 뭘 더 자연스럽게 쓰는가").
  // 클라이언트가 보낸 값이므로 아는 값만 통과시킨다. 프롬프트에는 넣지 않는다 — 세는 데만 쓴다.
  const source =
    req.body?.source === 'drag' || req.body?.source === 'paragraph'
      ? req.body.source
      : 'unknown';
  // 남기는 건 열거값뿐이다. 페이지 텍스트·제목·사용자 식별자는 절대 로그에 넣지 않는다
  // (신뢰 불가 데이터인 데다, 사내 문서를 드래그했을 수도 있다).
  console.log(
    `explain source=${source} kind=${isCode ? 'code' : 'concept'} followup=${req.body?.question !== undefined}`,
  );

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');

  // 대화 구성: [최초 요청] + [지금까지의 대화] + [이번 후속질문]
  // 최초 프롬프트는 서버가 만든다(프롬프트는 제품의 차별점이라 클라이언트에 맡기지 않는다).
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: isCode
            ? `다음 코드가 무엇을 하는지 초급자에게 설명해줘:\n\n${text}`
            : `다음 내용을 초급자에게 해설해줘:\n\n${text}`,
        },
      ],
    },
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
    ...(question !== undefined
      ? [{ role: 'user', parts: [{ text: question as string }] }]
      : []),
  ];

  try {
    const stream = await genai.models.generateContentStream({
      model: EXPLAIN_MODEL,
      contents,
      config: {
        systemInstruction: isCode
          ? codeExplanationSystem({ docTitle, precedingText })
          : explanationSystem({ docTitle, precedingText }),
      },
    });

    for await (const chunk of stream) {
      const delta = chunk.text;
      if (delta) res.write(delta);
    }
    return res.end();
  } catch (err) {
    console.error('explain error', err);
    if (!res.headersSent) res.status(502).json({ error: 'upstream_error' });
    return res.end();
  }
}
