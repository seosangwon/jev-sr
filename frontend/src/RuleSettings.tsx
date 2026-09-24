import { useState, type FormEvent } from 'react';

export const mockRuleTopic = '종사자 변경보고 기능 관련 질의';

type Props = {
  topic: string | null;
  isMock: boolean;
  onSave: (topic: string) => void;
  onClear: () => void;
};

export default function RuleSettings({ topic, isMock, onSave, onClear }: Props) {
  const [draft, setDraft] = useState(topic ?? '');
  const [error, setError] = useState('');

  function save(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || Array.from(value).length > 200) {
      setError('주제 설명을 1~200자로 입력해 주세요.');
      return;
    }
    setError('');
    onSave(value);
  }

  function clear() {
    onClear();
    setDraft('');
    setError('');
  }

  return <>
    <div className="intro list-intro">
      <p className="eyebrow">OPERATING RULE</p>
      <h1>운영 규칙</h1>
      <p>지금 집중해서 살펴볼 주제를 하나 설정하세요.</p>
    </div>
    <section className="card" aria-labelledby="rule-heading">
      <div className="section-heading"><div><span className="step">01</span><h2 id="rule-heading">주제별 처리 우선순위</h2></div><span className="mode">{topic ? '● 적용 중' : '설정 없음'}</span></div>
      <p className="rule-description">새 질의가 설정한 주제와 관련될 확률이 80% 이상이면 처리 우선순위를 Level 1로 올립니다. Jev가 판단한 원래 긴급도와 확률은 그대로 보존합니다.</p>
      <form onSubmit={save} noValidate>
        <div className="field">
          <div className="label-line"><label htmlFor="rule-topic">주제 설명 <span className="required">필수</span></label><span>{Array.from(draft).length} / 200</span></div>
          <textarea id="rule-topic" rows={3} value={draft} aria-invalid={!!error} aria-describedby="rule-topic-hint" placeholder="예: 종사자 변경보고 기능 관련 질의" onChange={event => { setDraft(event.target.value); setError(''); }} />
          <p id="rule-topic-hint" className={error ? 'field-error' : 'hint'} role={error ? 'alert' : undefined}>{error || '명령문 대신 기능·업무 주제만 적어 주세요. Jev는 다음 질의의 제목과 내용을 이 주제와 비교합니다.'}</p>
        </div>
        {isMock && <button type="button" className="text-button rule-sample" onClick={() => { setDraft(mockRuleTopic); setError(''); }}>시연 주제 채우기</button>}
        <div className="form-actions"><span className="privacy">현재 탭에만 유지되며 새로고침하면 사라집니다.</span><div>{topic && <button type="button" className="secondary" onClick={clear}>규칙 해제</button>}<button type="submit" className="primary">{topic ? '규칙 수정' : '규칙 저장'}</button></div></div>
      </form>
      {topic && <p className="rule-current" role="status">적용 중인 주제: <strong>{topic}</strong><br/>수정·해제는 다음 분석부터 적용되며 기존 목록의 결과는 유지됩니다.</p>}
    </section>
  </>;
}
