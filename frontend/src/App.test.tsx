import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { analyze, validate, type Analysis } from './api';
import { sortQueryRecords, type QueryRecord } from './history';
import samples from '../../samples/posts.json';
const result: Analysis = {
  priority: {level:'level_1',label:'긴급',confidence:.91,probabilities:{level_1:.87,level_2:.1,level_3:.02,level_4:.01}},
  handlingPriority: {level:'level_1',source:'base',ruleTopic:null,matchProbability:null},
  signals:{payrollDisrupted:.94,requiredFunctionUnavailable:.86,workBlocked:.92,impactScope:'team',impactScopeConfidence:.82},
  analyzedAt:'2026-09-21T12:00:00Z',provider:'mock',
};
const ok = (body:unknown) => new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
function mockFetch(analysis: () => Promise<Response> = async () => ok(result), provider='mock', threshold=.6) {
  return vi.spyOn(globalThis,'fetch').mockImplementation(async input => input==='/api/config' ? ok({provider,lowConfidenceThreshold:threshold}) : analysis());
}
async function start() {
  render(<App/>);
  await screen.findByText('● Mock 모드');
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),'0');
}
afterEach(() => vi.restoreAllMocks());

describe('input validation', () => {
  it.each([['targetInfo',500],['title',200],['content',5000]] as const)('%s required and length boundaries match backend',(field,max) => {
    for (const value of ['', ' \n\t', '가'.repeat(max+1)]) expect(validate({...samples[0].post,[field]:value})).toHaveProperty(field);
    expect(validate({...samples[0].post,[field]:'😀'.repeat(max)})).toEqual({});
  });
  it('blocks empty submission without requesting analysis', async () => {
    const fetch=mockFetch(); render(<App/>); await screen.findByText('● Mock 모드');
    await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
    expect(screen.getAllByRole('alert')).toHaveLength(3); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
it('submits all three fields and renders four probabilities, confidence, signals and resets',async () => {
  const fetch=mockFetch(); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  const heading=await screen.findByRole('heading',{name:'분석 결과'});
  expect(heading).toBeInTheDocument(); expect(screen.getByText('Mock 분석 결과')).toBeInTheDocument();
  expect(screen.getAllByRole('meter')).toHaveLength(4);
  expect(screen.getByText('91%')).toBeInTheDocument(); expect(screen.getByText('94%')).toBeInTheDocument();
  expect(screen.getByText('특정 팀')).toBeInTheDocument(); expect(screen.getByText('영향 범위 판단 신뢰도')).toBeInTheDocument();
  expect(fetch.mock.calls[1][1]?.body).toBe(JSON.stringify(samples[0].post));
  await userEvent.click(screen.getByRole('button',{name:'초기화'}));
  expect(screen.queryByRole('heading',{name:'분석 결과'})).not.toBeInTheDocument();
  expect(screen.getByLabelText(/대상자 정보/)).toHaveValue('');
});
it('prevents duplicate submission and shows loading',async () => {
  let resolve!: (r:Response) => void;
  const fetch=mockFetch(() => new Promise(r => {resolve=r;})); await start();
  const button=screen.getByRole('button',{name:/Jev로 우선순위 분석/});
  fireEvent.submit(button.closest('form')!); fireEvent.submit(button.closest('form')!);
  expect(button).toBeDisabled(); expect(screen.getByText('Jev가 게시글을 분석하고 있습니다...')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'초기화'})).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolve(ok(result)));
  expect(await screen.findByText('Mock 분석 결과')).toBeInTheDocument();
});
it.each([.59,.79])('uses configured low confidence threshold (%s)',async confidence => {
  mockFetch(async () => ok({...result,priority:{...result.priority,confidence}}),'mock',.8); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  expect(await screen.findByText('판단 신뢰도가 낮습니다. 사람이 내용을 추가로 확인하는 것이 좋습니다.')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Level 1 · 긴급'})).toBeInTheDocument();
});
it('does not warn at the configured threshold',async () => {
  mockFetch(async () => ok({...result,priority:{...result.priority,confidence:.6}})); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText('Mock 분석 결과'); expect(screen.queryByText(/판단 신뢰도가 낮습니다/)).not.toBeInTheDocument();
});
it('shows Jev provenance',async () => {
  mockFetch(async () => ok({...result,provider:'jev'}),'jev'); render(<App/>); await screen.findByText('● Jev 모드');
  for(const [key,value] of Object.entries(samples[0].post)) fireEvent.change(document.getElementById(key)!,{target:{value}});
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  expect(await screen.findByText('Jev 분석 결과')).toBeInTheDocument(); expect(screen.getByText('Jev 판단 신뢰도')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
it('keeps input on error and retries without inventing a result',async () => {
  let calls=0; mockFetch(async () => ++calls===1 ? new Response(JSON.stringify({error:{code:'JEV_TIMEOUT',message:'Jev 요청 시간이 초과되었습니다.'}}),{status:504}) : ok(result)); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Jev 요청 시간이 초과되었습니다.');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument(); expect(screen.getByLabelText(/제목/)).toHaveValue(samples[0].post.title);
  await userEvent.click(screen.getByRole('button',{name:/다시 시도/})); expect(await screen.findByText('Mock 분석 결과')).toBeInTheDocument();
});
it('clears old results on edit and failed reanalysis',async () => {
  let calls=0; mockFetch(async () => ++calls===1 ? ok(result) : Promise.reject(new Error('network'))); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/})); await screen.findByText('Mock 분석 결과');
  await userEvent.type(screen.getByLabelText(/제목/),'!'); expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/})); expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});
it('handles malformed successful responses',async () => {
  mockFetch(async () => ok({provider:'jev'})); await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('분석 응답 형식이 올바르지 않습니다'); expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});
it('can recover configuration failure',async () => {
  const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error()).mockResolvedValueOnce(ok({provider:'mock',lowConfidenceThreshold:.6}));
  render(<App/>); await screen.findByRole('alert'); expect(screen.getByRole('button',{name:/Jev로 우선순위 분석/})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'설정 다시 불러오기'})); await screen.findByText('● Mock 모드'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('handles non-JSON errors safely',async () => {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('<html>bad gateway</html>',{status:502}));
  await expect(analyze(samples[0].post,new AbortController().signal)).rejects.toThrow('서버 응답을 읽을 수 없습니다');
});

it('shows an empty query list and returns to analysis', async () => {
  mockFetch(); render(<App/>); await screen.findByText('● Mock 모드');
  await userEvent.click(screen.getByRole('button',{name:/질의 목록/}));
  expect(screen.getByRole('heading',{name:'질의 목록'})).toBeInTheDocument();
  expect(screen.getByText('아직 분석한 질의가 없습니다.')).toBeInTheDocument();
  expect(screen.getByRole('combobox',{name:'질의 정렬 기준'})).toHaveValue('newest');
  expect(screen.getByRole('option',{name:'우선순위순'})).toBeEnabled();
  await userEvent.click(screen.getByRole('button',{name:'첫 질의 분석하기'}));
  expect(screen.getByRole('heading',{name:'게시글 작성'})).toBeInTheDocument();
});

it('adds only successful analyses and lists them newest first', async () => {
  let analysisCall = 0;
  const responses = [
    {...result, analyzedAt:'2026-09-21T12:00:00Z'},
    {...result, priority:{...result.priority, level:'level_4' as const, label:'낮음'}, handlingPriority:{...result.handlingPriority,level:'level_4' as const}, analyzedAt:'2026-09-21T13:00:00Z'},
  ];
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async input => input==='/api/config'
    ? ok({provider:'mock',lowConfidenceThreshold:.6})
    : ok(responses[analysisCall++]));
  render(<App/>); await screen.findByText('● Mock 모드');

  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),'0');
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText('Mock 분석 결과');
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),'3');
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByRole('heading',{name:'Level 4 · 낮음'});

  await userEvent.click(screen.getByRole('button',{name:/질의 목록 2/}));
  const items = screen.getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent(samples[3].post.title);
  expect(items[0]).toHaveTextContent('Level 4 · 낮음');
  expect(items[1]).toHaveTextContent(samples[0].post.title);
  expect(items[1]).toHaveTextContent('Level 1 · 긴급');
  expect(items[0]).toHaveTextContent('Mock');

  const callsBeforeSort = fetch.mock.calls.length;
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'질의 정렬 기준'}),'priority');
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(samples[0].post.title);
  expect(screen.getAllByRole('listitem')[1]).toHaveTextContent(samples[3].post.title);
  expect(fetch).toHaveBeenCalledTimes(callsBeforeSort);
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'질의 정렬 기준'}),'newest');
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(samples[3].post.title);
});

it('does not add failed requests to the query list', async () => {
  mockFetch(async () => new Response(JSON.stringify({error:{code:'JEV_TIMEOUT',message:'시간이 초과되었습니다.'}}),{status:504}));
  await start();
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button',{name:/질의 목록 0/}));
  expect(screen.getByText('아직 분석한 질의가 없습니다.')).toBeInTheDocument();
});

it('uses record id as a stable newest-first tie breaker', () => {
  const first: QueryRecord = {id:1,post:samples[0].post,analysis:result};
  const second: QueryRecord = {id:2,post:samples[1].post,analysis:result};
  expect(sortQueryRecords([first,second],'newest').map(record => record.id)).toEqual([2,1]);
});

it('sorts priority from Level 1 to 4, then newest and record id without changing the source', () => {
  const record = (id: number, level: Analysis['priority']['level'], analyzedAt: string): QueryRecord => ({
    id, post: samples[0].post, analysis: {...result, priority: {...result.priority, level}, handlingPriority:{...result.handlingPriority,level}, analyzedAt},
  });
  const records = [
    record(1,'level_4','2026-09-21T15:00:00Z'),
    record(2,'level_2','2026-09-21T13:00:00Z'),
    record(3,'level_1','2026-09-21T10:00:00Z'),
    record(4,'level_2','2026-09-21T14:00:00Z'),
    record(5,'level_3','2026-09-21T16:00:00Z'),
    record(6,'level_2','2026-09-21T14:00:00Z'),
  ];
  expect(sortQueryRecords(records,'priority').map(item => item.id)).toEqual([3,6,4,2,5,1]);
  expect(records.map(item => item.id)).toEqual([1,2,3,4,5,6]);
});

it('sorts a rule-promoted handling Level before a higher raw urgency', () => {
  const normal: QueryRecord = {id:1,post:samples[1].post,analysis:{...result,priority:{...result.priority,level:'level_2'},handlingPriority:{...result.handlingPriority,level:'level_2'}}};
  const promoted: QueryRecord = {id:2,post:samples.at(-1)!.post,analysis:{...result,priority:{...result.priority,level:'level_4'},handlingPriority:{level:'level_1',source:'operating_rule',ruleTopic:'종사자 변경보고 기능 관련 질의',matchProbability:.96}}};
  expect(sortQueryRecords([normal,promoted],'priority').map(item => item.id)).toEqual([2,1]);
  expect(promoted.analysis.priority.level).toBe('level_4');
});

it('sets, edits and clears one session rule for future submissions only', async () => {
  const captured: unknown[] = [];
  const fetch = vi.spyOn(globalThis,'fetch').mockImplementation(async (input, init) => {
    if (input === '/api/config') return ok({provider:'mock',lowConfidenceThreshold:.6});
    const body = JSON.parse(String(init?.body));
    captured.push(body);
    const promoted = body.operatingRuleTopic === '종사자 변경보고 기능 관련 질의';
    return ok({...result, priority:{...result.priority,level:'level_4',label:'낮음'}, handlingPriority:{level: promoted ? 'level_1' : 'level_4',source:promoted ? 'operating_rule' : 'base',ruleTopic:body.operatingRuleTopic ?? null,matchProbability:body.operatingRuleTopic ? (promoted ? .96 : .04) : null}});
  });
  render(<App/>); await screen.findByText('● Mock 모드');
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),String(samples.length-1));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText('Mock 분석 결과');
  expect(captured[0]).not.toHaveProperty('operatingRuleTopic');
  await userEvent.click(screen.getByRole('button',{name:/운영 규칙/}));
  await userEvent.click(screen.getByRole('button',{name:'시연 주제 채우기'}));
  await userEvent.click(screen.getByRole('button',{name:'규칙 저장'}));
  await userEvent.click(screen.getByRole('button',{name:'새 분석'}));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText(/처리 우선순위를 Level 1로 상향했습니다/);
  expect(screen.getByText(/Mock 업무 긴급도 · Level 4/)).toBeInTheDocument();
  expect(captured[1]).toHaveProperty('operatingRuleTopic','종사자 변경보고 기능 관련 질의');
  await userEvent.click(screen.getByRole('button',{name:/운영 규칙/}));
  fireEvent.change(screen.getByLabelText(/주제 설명/),{target:{value:'다른 기능'}});
  await userEvent.click(screen.getByRole('button',{name:'규칙 수정'}));
  await userEvent.click(screen.getByRole('button',{name:/질의 목록 2/}));
  expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('운영 규칙 적용');
  await userEvent.click(screen.getByRole('button',{name:'새 분석'}));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText(/80% 미만으로 원래 긴급도를 유지했습니다/);
  expect(captured[2]).toHaveProperty('operatingRuleTopic','다른 기능');
  await userEvent.click(screen.getByRole('button',{name:/운영 규칙/}));
  await userEvent.click(screen.getByRole('button',{name:'규칙 해제'}));
  await userEvent.click(screen.getByRole('button',{name:'새 분석'}));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText('Mock 분석 결과');
  expect(captured[3]).not.toHaveProperty('operatingRuleTopic');
  expect(fetch).toHaveBeenCalledTimes(5);
});

it('does not save a result when the rule relevance call fails', async () => {
  mockFetch(async () => new Response(JSON.stringify({error:{code:'JEV_TIMEOUT',message:'Jev 요청 시간이 초과되었습니다.'}}),{status:504}));
  render(<App/>); await screen.findByText('● Mock 모드');
  await userEvent.click(screen.getByRole('button',{name:'운영 규칙'}));
  await userEvent.click(screen.getByRole('button',{name:'시연 주제 채우기'}));
  await userEvent.click(screen.getByRole('button',{name:'규칙 저장'}));
  await userEvent.click(screen.getByRole('button',{name:'새 분석'}));
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),String(samples.length-1));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Jev 요청 시간이 초과되었습니다.');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:/질의 목록 0/}));
  expect(screen.getByText('아직 분석한 질의가 없습니다.')).toBeInTheDocument();
});

it('opens read-only detail with the original urgency and rule reason without another API call', async () => {
  const analysis: Analysis = {...result, priority:{...result.priority,level:'level_4',label:'낮음'},handlingPriority:{level:'level_1',source:'operating_rule',ruleTopic:'인력현황 기능',matchProbability:.97}};
  const fetch = mockFetch(async () => ok(analysis));
  render(<App/>); await screen.findByText('● Mock 모드');
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'시연 예제'}),String(samples.length-1));
  await userEvent.click(screen.getByRole('button',{name:/Jev로 우선순위 분석/}));
  await screen.findByText('Mock 분석 결과');
  await userEvent.click(screen.getByRole('button',{name:/질의 목록 1/}));
  await userEvent.selectOptions(screen.getByRole('combobox',{name:'질의 정렬 기준'}),'priority');
  const callsBeforeDetail = fetch.mock.calls.length;
  await userEvent.click(screen.getByRole('button',{name:samples.at(-1)!.post.title}));
  expect(screen.getByRole('heading',{name:'질의 상세'})).toBeInTheDocument();
  expect(screen.getByText(samples.at(-1)!.post.content)).toBeInTheDocument();
  expect(screen.getByText(/Mock 업무 긴급도 · Level 4/)).toBeInTheDocument();
  expect(screen.getByText(/주제 관련성 97%/)).toBeInTheDocument();
  expect(screen.getAllByRole('meter')).toHaveLength(4);
  expect(fetch).toHaveBeenCalledTimes(callsBeforeDetail);
  await userEvent.click(screen.getByRole('button',{name:/목록으로 돌아가기/}));
  expect(screen.getByRole('combobox',{name:'질의 정렬 기준'})).toHaveValue('priority');
  await userEvent.click(screen.getByRole('button',{name:'새 분석'}));
  expect(screen.getByLabelText(/제목/)).toHaveValue(samples.at(-1)!.post.title);
});
