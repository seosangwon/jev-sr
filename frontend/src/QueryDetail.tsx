import { useEffect, useRef } from 'react';
import AnalysisResult from './AnalysisResult';
import type { QueryRecord } from './history';

type Props = {
  record: QueryRecord;
  lowConfidenceThreshold: number;
  onBack: () => void;
};

export default function QueryDetail({ record, lowConfidenceThreshold, onBack }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, [record.id]);

  return <>
    <div className="intro list-intro">
      <button type="button" className="detail-back" onClick={onBack}>← 목록으로 돌아가기</button>
      <p className="eyebrow">ANALYZED QUESTION</p>
      <h1 ref={headingRef} tabIndex={-1}>질의 상세</h1>
      <p>분석 당시의 입력과 결과를 확인할 수 있습니다.</p>
    </div>
    <section className="card" aria-labelledby="original-post-heading">
      <div className="section-heading"><div><span className="step">01</span><h2 id="original-post-heading">원본 질의</h2></div></div>
      <dl className="detail-fields">
        <div><dt>대상자 정보</dt><dd>{record.post.targetInfo}</dd></div>
        <div><dt>제목</dt><dd>{record.post.title}</dd></div>
        <div><dt>내용</dt><dd>{record.post.content}</dd></div>
      </dl>
    </section>
    <AnalysisResult analysis={record.analysis} lowConfidenceThreshold={lowConfidenceThreshold} />
  </>;
}
