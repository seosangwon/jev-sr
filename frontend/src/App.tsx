import { useEffect, useRef, useState, type FormEvent } from 'react';
import samples from '../../samples/posts.json';
import { analyze, ApiError, charCount, configSchema, fields, labels, levels, validate, type Analysis, type Config, type FieldErrors, type PostInput } from './api';
import AnalysisResult from './AnalysisResult';
import QueryDetail from './QueryDetail';
import QueryList from './QueryList';
import type { QueryRecord, QuerySort } from './history';
const emptyPost = { targetInfo: '', title: '', content: '' };
type View = 'analyze' | 'list' | 'detail';

export default function App() {
  const [post, setPost] = useState<PostInput>(emptyPost);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [sampleIndex, setSampleIndex] = useState('');
  const [view, setView] = useState<View>('analyze');
  const [queryRecords, setQueryRecords] = useState<QueryRecord[]>([]);
  const [querySort, setQuerySort] = useState<QuerySort>('newest');
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(null);
  const inFlight = useRef(false);
  const recordId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setConfigError(false);
    fetch('/api/config', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error();
      setConfig(configSchema.parse(await response.json()));
    }).catch(() => { if (!abort.signal.aborted) setConfigError(true); });
    return () => abort.abort();
  }, [configAttempt]);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !config) return;
    const invalid = validate(post);
    setErrors(invalid); setError(''); setResult(null);
    if (Object.keys(invalid).length) return;
    inFlight.current = true; setLoading(true);
    const abort = new AbortController(); controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 30000);
    try {
      const analysis = await analyze(post, abort.signal);
      setResult(analysis);
      setQueryRecords(records => [...records, { id: ++recordId.current, post: { ...post }, analysis }]);
    }
    catch (e) {
      if (e instanceof ApiError) { setError(e.message); setErrors(e.fields); }
      else setError(abort.signal.aborted ? '요청 시간이 초과되었습니다. 다시 시도해 주세요.' : '서버에 연결할 수 없습니다. 연결을 확인하고 다시 시도해 주세요.');
    } finally { window.clearTimeout(timeout); inFlight.current = false; setLoading(false); }
  }
  function reset() { setPost(emptyPost); setErrors({}); setError(''); setResult(null); setSampleIndex(''); }
  const selectedRecord = queryRecords.find(record => record.id === selectedRecordId);
  return <>
    <header className="topbar"><button type="button" className="brand" aria-label="Jev 홈" onClick={() => setView('analyze')}><span className="brand-icon">j.</span> Jev <span className="brand-divider">/</span><span className="brand-sub">Priority Lab</span></button><nav className="app-nav" aria-label="주요 화면"><button type="button" className={view === 'analyze' ? 'active' : ''} aria-current={view === 'analyze' ? 'page' : undefined} onClick={() => setView('analyze')}>새 분석</button><button type="button" className={view !== 'analyze' ? 'active' : ''} aria-current={view !== 'analyze' ? 'page' : undefined} onClick={() => setView('list')}>질의 목록 <span>{queryRecords.length}</span></button></nav><span className="mvp">MVP · 우선순위 분석</span></header>
    <main>
      {view === 'list' ? <QueryList records={queryRecords} sort={querySort} onSortChange={setQuerySort} onSelect={id => { setSelectedRecordId(id); setView('detail'); }} onAnalyze={() => setView('analyze')} /> : view === 'detail' && selectedRecord ? <QueryDetail record={selectedRecord} lowConfidenceThreshold={config?.lowConfidenceThreshold ?? 0.6} onBack={() => setView('list')} /> : <>
      <div className="intro"><p className="eyebrow">POST PRIORITY ANALYZER</p><h1>어떤 업무를 먼저<br className="mobile-break"/> 해결해야 할까요?</h1><p>게시글의 문맥을 읽고, 업무 긴급도를 네 단계의 확률로 확인하세요.</p></div>
      <section className="card" aria-labelledby="form-heading">
        <div className="section-heading"><div><span className="step">01</span><h2 id="form-heading">게시글 작성</h2></div><span className={`mode ${config?.provider === 'jev' ? 'live' : ''}`}>{config ? config.provider === 'mock' ? '● Mock 모드' : '● Jev 모드' : '설정 확인 중'}</span></div>
        {configError && <div role="alert" className="error-banner">서버 설정을 불러오지 못했습니다. 백엔드 실행 상태를 확인해 주세요. <button type="button" className="text-button" onClick={() => setConfigAttempt(n => n + 1)}>설정 다시 불러오기</button></div>}
        {config?.provider === 'mock' && <div className="demo-panel"><div><strong>API 키 없이 먼저 체험해 보세요.</strong><p>합성 예제는 고정 결과를 보여 줍니다. 다른 입력은 낮은 신뢰도의 시연 결과이며, 실제 AI 판단이 아닙니다.</p></div><label className="sample-label">시연 예제<select aria-label="시연 예제" value={sampleIndex} disabled={loading} onChange={e => { const value = e.target.value; setSampleIndex(value); setPost(value === '' ? emptyPost : samples[Number(value)].post); setResult(null); setError(''); setErrors({}); }}><option value="">예제 선택하기</option>{samples.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}</select></label></div>}
        <form onSubmit={submit} noValidate aria-busy={loading}>
          {fields.map(field => <div className="field" key={field.key}>
            <div className="label-line"><label htmlFor={field.key}>{field.label} <span className="required">필수</span></label><span className={charCount(post[field.key]) > field.max ? 'over-limit' : ''}>{charCount(post[field.key]).toLocaleString()} / {field.max.toLocaleString()}</span></div>
            {field.key === 'title' ? <input id={field.key} value={post[field.key]} disabled={loading} required aria-invalid={!!errors[field.key]} aria-describedby={`${field.key}-hint`} placeholder={field.placeholder} onChange={e => { setPost({ ...post, [field.key]: e.target.value }); setResult(null); }} /> : <textarea id={field.key} rows={field.key === 'content' ? 6 : 2} value={post[field.key]} disabled={loading} required aria-invalid={!!errors[field.key]} aria-describedby={`${field.key}-hint`} placeholder={field.placeholder} onChange={e => { setPost({ ...post, [field.key]: e.target.value }); setResult(null); }} />}
            <p id={`${field.key}-hint`} className={errors[field.key] ? 'field-error' : 'hint'} role={errors[field.key] ? 'alert' : undefined}>{errors[field.key] || field.hint}</p>
          </div>)}
          {error && <div className="error-banner" role="alert"><strong>분석을 완료하지 못했습니다.</strong><p>{error}</p><span>입력 내용은 유지됩니다. 아래 버튼으로 다시 시도하세요.</span></div>}
          <div className="form-actions"><span className="privacy">입력과 결과는 현재 화면에서만 유지됩니다.</span><div><button type="button" className="secondary" disabled={loading} onClick={reset}>초기화</button><button type="submit" className="primary" disabled={loading || !config}>{loading ? '분석 중…' : error ? '다시 시도' : 'Jev로 우선순위 분석'}<span aria-hidden="true">{loading ? ' ◌' : ' ↗'}</span></button></div></div>
          {loading && <p className="loading" role="status"><span className="spinner"/>Jev가 게시글을 분석하고 있습니다...</p>}
        </form>
      </section>
      {result && config && <AnalysisResult analysis={result} lowConfidenceThreshold={config.lowConfidenceThreshold} focusRef={resultRef} />}
      {!result && <div className="level-guide" aria-label="우선순위 기준">{levels.map((level, i) => <div key={level}><span className={`level-dot ${level}`}/><strong>Level {i + 1} · {labels[level]}</strong><p>{['즉시 대응이 필요한 업무 중단', '빠른 대응이 필요한 주요 장애', '일반 확인 또는 우회 가능한 문제', '문의 · 개선 요청 · 단순 불편'][i]}</p></div>)}</div>}
      </>}
      <footer>Jev Priority Lab <span>문맥을 판단하고, 확률로 확인합니다.</span></footer>
    </main>
  </>;
}
