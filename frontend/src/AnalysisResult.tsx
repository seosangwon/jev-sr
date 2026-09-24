import type { Ref } from 'react';
import { labels, levels, scopeLabels, type Analysis } from './api';

type Props = {
  analysis: Analysis;
  lowConfidenceThreshold: number;
  focusRef?: Ref<HTMLElement>;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function AnalysisResult({ analysis, lowConfidenceThreshold, focusRef }: Props) {
  return <section ref={focusRef} tabIndex={-1} className="card results" aria-labelledby="result-heading">
    <div className="section-heading"><div><span className="step">02</span><h2 id="result-heading">분석 결과</h2></div><span className="mode">{analysis.provider === 'mock' ? 'Mock 분석 결과' : 'Jev 분석 결과'}</span></div>
    <div className="result-overview"><div><p className="eyebrow">최종 우선순위</p><h3 className={analysis.priority.level}>Level {analysis.priority.level.slice(-1)} · {labels[analysis.priority.level]}</h3></div><div className="confidence"><span>{analysis.provider === 'mock' ? 'Mock 판단 신뢰도' : 'Jev 판단 신뢰도'}</span><strong>{pct(analysis.priority.confidence)}</strong></div></div>
    {analysis.priority.confidence < lowConfidenceThreshold && <p role="status" className="warning">판단 신뢰도가 낮습니다. 사람이 내용을 추가로 확인하는 것이 좋습니다.</p>}
    <div className="result-grid"><div><h4>Level별 확률</h4><p className="hint">숫자가 낮을수록 긴급합니다.</p><div className="bars">{levels.map(level => <div className={`bar-row ${level}`} key={level}><div><span>Level {level.slice(-1)} · {labels[level]} {analysis.priority.level === level && <small>선택</small>}</span><strong>{pct(analysis.priority.probabilities[level])}</strong></div><div role="meter" aria-label={`Level ${level.slice(-1)} 확률`} aria-valuenow={analysis.priority.probabilities[level] * 100} aria-valuemin={0} aria-valuemax={100} className="bar-track"><span style={{ width: `${analysis.priority.probabilities[level] * 100}%` }}/></div></div>)}</div></div>
    <div className="signals"><h4>세부 분석</h4><p className="hint">게시글에서 감지한 업무 문맥입니다.</p><dl><div><dt>급여 업무 중단</dt><dd>{pct(analysis.signals.payrollDisrupted)}</dd></div><div><dt>필수 기능 장애</dt><dd>{pct(analysis.signals.requiredFunctionUnavailable)}</dd></div><div><dt>업무 진행 차단</dt><dd>{pct(analysis.signals.workBlocked)}</dd></div><div><dt>영향 범위</dt><dd>{scopeLabels[analysis.signals.impactScope]}</dd></div><div><dt>영향 범위 판단 신뢰도</dt><dd>{pct(analysis.signals.impactScopeConfidence)}</dd></div></dl></div></div>
    <p className="result-note">신뢰도는 확률 분포의 집중도를 나타내며, 정답률을 의미하지 않습니다. 세부 분석값으로 최종 Level을 다시 계산하지 않습니다.</p>
    <p className="timestamp">분석 시각 · {new Date(analysis.analyzedAt).toLocaleString('ko-KR')}</p>
  </section>;
}
