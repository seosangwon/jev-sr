import { z } from 'zod';
export const levels = ['level_1', 'level_2', 'level_3', 'level_4'] as const;
export type Level = typeof levels[number];
export const labels: Record<Level, string> = { level_1: '긴급', level_2: '높음', level_3: '보통', level_4: '낮음' };
export const scopeLabels = { individual: '개인 또는 극소수', team: '특정 팀', many_users: '여러 팀 또는 다수 사용자', organization_wide: '조직 전체', unknown: '판단 불가' };
export type PostInput = { targetInfo: string; title: string; content: string };
export const fields = [
  { key: 'targetInfo', label: '대상자 정보', max: 500, placeholder: '예: 인사팀 급여 담당자', hint: '누구의 업무에 영향을 주는지 알려 주세요.' },
  { key: 'title', label: '제목', max: 200, placeholder: '예: 급여 계산이 완료되지 않습니다', hint: '문제를 한 문장으로 요약해 주세요.' },
  { key: 'content', label: '내용', max: 5000, placeholder: '현재 상황, 업무 영향, 우회 방법 등을 구체적으로 작성해 주세요.', hint: '실제 업무 중단 여부가 우선순위 판단에 도움이 됩니다.' },
] as const;
export type FieldErrors = Partial<Record<keyof PostInput, string>>;
export const charCount = (s: string) => Array.from(s).length;
export function validate(post: PostInput): FieldErrors {
  return Object.fromEntries(fields.flatMap(f => !post[f.key].trim() ? [[f.key, `${f.label}를 입력해 주세요. 공백만 입력할 수 없습니다.`]] : charCount(post[f.key]) > f.max ? [[f.key, `${f.label}는 최대 ${f.max.toLocaleString()}자까지 입력할 수 있습니다.`]] : []));
}
const probability = z.number().finite().min(0).max(1);
const schema = z.object({
  priority: z.object({ level: z.enum(levels), label: z.string(), confidence: probability, probabilities: z.object({ level_1: probability, level_2: probability, level_3: probability, level_4: probability }) }),
  handlingPriority: z.object({ level: z.enum(levels), source: z.enum(['base', 'operating_rule']), ruleTopic: z.string().nullable(), matchProbability: probability.nullable() }),
  signals: z.object({ payrollDisrupted: probability, requiredFunctionUnavailable: probability, workBlocked: probability, impactScope: z.enum(['individual', 'team', 'many_users', 'organization_wide', 'unknown']), impactScopeConfidence: probability }),
  analyzedAt: z.string().datetime({ offset: true }), provider: z.enum(['mock', 'jev']),
}).refine(r => Math.abs(Object.values(r.priority.probabilities).reduce((a, b) => a + b, 0) - 1) < 0.01);
export type Analysis = z.infer<typeof schema>;
export const configSchema = z.object({ provider: z.enum(['mock', 'jev']), lowConfidenceThreshold: probability });
export type Config = z.infer<typeof configSchema>;
export class ApiError extends Error { constructor(message: string, public fields: FieldErrors = {}) { super(message); } }
export async function analyze(post: PostInput, signal: AbortSignal, operatingRuleTopic: string | null = null): Promise<Analysis> {
  const response = await fetch('/api/analyze-priority', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operatingRuleTopic ? {...post, operatingRuleTopic} : post), signal });
  let body: unknown;
  try { body = await response.json(); } catch { throw new ApiError('서버 응답을 읽을 수 없습니다. 다시 시도해 주세요.'); }
  if (!response.ok) {
    const error = z.object({ error: z.object({ message: z.string(), fields: z.record(z.string()).optional() }) }).safeParse(body);
    throw new ApiError(error.success ? error.data.error.message : '분석 요청에 실패했습니다. 다시 시도해 주세요.', error.success ? error.data.error.fields : {});
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError('분석 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  return parsed.data;
}
