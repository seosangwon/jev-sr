import { labels } from './api';
import { sortQueryRecords, type QueryRecord, type QuerySort } from './history';

type Props = {
  records: QueryRecord[];
  onAnalyze: () => void;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function QueryList({ records, onAnalyze }: Props) {
  const sort: QuerySort = 'newest';
  const sortedRecords = sortQueryRecords(records, sort);

  return <>
    <div className="intro list-intro">
      <p className="eyebrow">ANALYZED QUESTIONS</p>
      <div className="list-title-row">
        <div>
          <h1>분석한 질의를 모아보세요.</h1>
          <p>현재 브라우저 화면에서 분석한 결과를 최신순으로 확인할 수 있습니다.</p>
        </div>
        <button type="button" className="primary" onClick={onAnalyze}>새 질의 분석 <span aria-hidden="true">＋</span></button>
      </div>
    </div>

    <section className="card query-list-card" aria-labelledby="query-list-heading">
      <div className="section-heading list-heading">
        <div><span className="step">{String(records.length).padStart(2, '0')}</span><h2 id="query-list-heading">질의 목록</h2></div>
        <label className="sort-label">정렬 기준
          <select aria-label="질의 정렬 기준" defaultValue={sort}>
            <option value="newest">최신 분석순</option>
            <option value="priority" disabled>우선순위순 · 준비 중</option>
          </select>
        </label>
      </div>

      <p className="session-notice">목록은 현재 브라우저 메모리에만 유지되며 새로고침하면 초기화됩니다.</p>

      {sortedRecords.length === 0 ? <div className="empty-list">
        <span aria-hidden="true">◎</span>
        <h3>아직 분석한 질의가 없습니다.</h3>
        <p>질의를 분석하면 결과가 이곳에 최신순으로 쌓입니다.</p>
        <button type="button" className="secondary" onClick={onAnalyze}>첫 질의 분석하기</button>
      </div> : <ol className="query-items">
        {sortedRecords.map(record => {
          const { post, analysis } = record;
          const level = analysis.priority.level;
          return <li className="query-item" key={record.id}>
            <div className="query-time">
              <time dateTime={analysis.analyzedAt}>{new Date(analysis.analyzedAt).toLocaleString('ko-KR')}</time>
              <span>{analysis.provider === 'mock' ? 'Mock' : 'Jev'}</span>
            </div>
            <div className="query-copy">
              <div className="query-title-line">
                <h3>{post.title}</h3>
                <span className={`priority-badge ${level}`}>Level {level.slice(-1)} · {labels[level]}</span>
              </div>
              <p className="query-target">대상 · {post.targetInfo}</p>
              <p className="query-excerpt">{post.content}</p>
            </div>
            <div className="query-confidence"><span>판단 신뢰도</span><strong>{pct(analysis.priority.confidence)}</strong></div>
          </li>;
        })}
      </ol>}
    </section>
  </>;
}
