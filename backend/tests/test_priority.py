import asyncio
import copy
import json
import logging
from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.models import PostInput
from backend.app.providers import AnalysisError, JevPriorityAnalyzer, JevRuleMatcher, MockPriorityAnalyzer

SAMPLES = json.loads(Path('samples/posts.json').read_text())
POST = SAMPLES[0]['post']


def wire_response():
    return {
        'model': 'jev-test', 'usage': {'input_tokens': 100, 'output_tokens': 25},
        'answers': {
            'priority': {'type': 'choice', 'choice': 'level_1', 'confidence': .91,
                         'probabilities': {'level_1': .87, 'level_2': .10, 'level_3': .02, 'level_4': .01}},
            'impactScope': {'type': 'choice', 'choice': 'team', 'confidence': .82,
                            'probabilities': {'individual': .05, 'team': .85, 'many_users': .05, 'organization_wide': .02, 'unknown': .03}},
            'payrollDisrupted': {'type': 'noul', 'noul': .94},
            'requiredFunctionUnavailable': {'type': 'noul', 'noul': .86},
            'workBlocked': {'type': 'noul', 'noul': .92},
        },
    }


def api(handler):
    return TestClient(create_app(Settings(provider='jev'), JevPriorityAnalyzer('synthetic-test-key', transport=httpx2.MockTransport(handler))))


@pytest.mark.parametrize('sample', SAMPLES, ids=[s['name'] for s in SAMPLES])
def test_mock_sample_api(sample):
    with TestClient(create_app(Settings())) as client:
        first = client.post('/api/analyze-priority', json=sample['post'])
        second = client.post('/api/analyze-priority', json=sample['post']).json()
    assert first.status_code == 200
    result = first.json()
    assert result['provider'] == 'mock'
    assert result['priority']['level'] == sample['level']
    assert result['priority'] == second['priority']
    assert result['signals'] == second['signals']
    assert sum(result['priority']['probabilities'].values()) == pytest.approx(1)
    assert result['signals']['impactScope'] == sample['scope']
    assert first.headers['cache-control'] == 'no-store'


@pytest.mark.parametrize('field,limit', [('targetInfo',500),('title',200),('content',5000)])
@pytest.mark.parametrize('invalid', ['missing', '', '   \t\n', 'overlong', None, 123])
def test_validation(field, limit, invalid):
    post = copy.deepcopy(POST)
    if invalid == 'missing':
        del post[field]
    else:
        post[field] = '가' * (limit + 1) if invalid == 'overlong' else invalid
    response = TestClient(create_app(Settings())).post('/api/analyze-priority', json=post)
    assert response.status_code == 422
    assert field in response.json()['error']['fields']
    assert 'priority' not in response.json()
    assert POST['content'] not in response.text
    if invalid == 'overlong':
        assert f'{limit:,}' in response.json()['error']['fields'][field]


@pytest.mark.parametrize('field,limit', [('targetInfo',500),('title',200),('content',5000)])
def test_exact_length_unicode(field, limit):
    post = {**POST, field: '😀' * limit}
    assert TestClient(create_app(Settings())).post('/api/analyze-priority', json=post).status_code == 200


def test_unknown_mock_is_explicit_and_uncertain():
    response = asyncio.run(MockPriorityAnalyzer().analyze(PostInput(targetInfo='합성 팀', title='새로운 입력', content='추가 정보 없음')))
    assert response.provider == 'mock'
    assert response.priority.confidence < .6
    assert response.signals.impactScope == 'unknown'


def test_sdk_real_serialization_and_conversion(caplog):
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        assert str(request.url) == 'https://api.typesafe.ai/v1/systemone'
        return httpx2.Response(200, json=wire_response())
    with caplog.at_level(logging.DEBUG):
        response = api(handler).post('/api/analyze-priority', json=POST)
    assert response.status_code == 200, response.text
    assert len(seen) == 1
    body = seen[0]
    assert body['model'] == 'jev-latest'
    for label, field in [('게시글 대상자','targetInfo'),('게시글 제목','title'),('게시글 내용','content')]:
        assert f'[{label}]\n{POST[field]}' in body['state']
    assert len(body['questions']) == 5
    assert body['questions']['priority']['type'] == 'choice'
    assert len(body['questions']['priority']['criteria']) == 4
    assert sum(q['type'] == 'noul' for q in body['questions'].values()) == 3
    result = response.json()
    assert result['priority']['level'] == 'level_1'
    assert result['priority']['confidence'] == .91
    assert result['priority']['probabilities']['level_1'] == .87
    assert result['signals']['payrollDisrupted'] == .94
    assert result['provider'] == 'jev'
    assert 'answers' not in result and 'usage' not in result
    assert 'synthetic-test-key' not in caplog.text
    assert POST['content'] not in caplog.text


def test_no_recalculation_from_signals():
    body = wire_response()
    body['answers']['priority'].update(choice='level_4', probabilities={'level_1':.01,'level_2':.02,'level_3':.1,'level_4':.87})
    response = api(lambda _: httpx2.Response(200,json=body)).post('/api/analyze-priority',json=POST)
    assert response.status_code == 200
    assert response.json()['priority']['level'] == 'level_4'
    assert response.json()['signals']['payrollDisrupted'] == .94


@pytest.mark.parametrize('case', ['missing','wrong_type','unknown_level','missing_level','negative','huge','zero_sum','bad_sum','nan','scope','scope_probs','signal','confidence','inconsistent','invalid_json'])
def test_malformed_response_rejected(case):
    body = wire_response()
    priority = body['answers']['priority']
    if case == 'missing': del body['answers']['workBlocked']
    elif case == 'wrong_type': body['answers']['priority'] = {'type':'noul','noul':.9}
    elif case == 'unknown_level': priority['choice']='level_5'
    elif case == 'missing_level': del priority['probabilities']['level_4']
    elif case == 'negative': priority['probabilities']['level_1']=-.5
    elif case == 'huge': priority['probabilities']['level_1']=87
    elif case == 'zero_sum': priority['probabilities']={k:0 for k in priority['probabilities']}
    elif case == 'bad_sum': priority['probabilities']['level_1']=.5
    elif case == 'nan': priority['confidence']='NaN'
    elif case == 'scope': body['answers']['impactScope']['choice']='everyone'
    elif case == 'scope_probs': body['answers']['impactScope']['probabilities']={}
    elif case == 'signal': body['answers']['workBlocked']['noul']=1.5
    elif case == 'confidence': priority['confidence']=2
    elif case == 'inconsistent': priority['choice']='level_4'
    handler = lambda _: httpx2.Response(200, content=b'not-json') if case == 'invalid_json' else httpx2.Response(200,json=body)
    response = api(handler).post('/api/analyze-priority',json=POST)
    assert response.status_code == 502, response.text
    assert response.json()['error']['code']=='JEV_INVALID_RESPONSE'
    assert 'priority' not in response.json()


def test_normalizes_rounding_only():
    body=wire_response()
    body['answers']['priority']['probabilities']['level_1']=.869
    response=api(lambda _: httpx2.Response(200,json=body)).post('/api/analyze-priority',json=POST)
    assert response.status_code == 200
    assert sum(response.json()['priority']['probabilities'].values()) == pytest.approx(1)


@pytest.mark.parametrize('status,code', [(401,'JEV_AUTH_ERROR'),(403,'JEV_AUTH_ERROR'),(429,'JEV_UNAVAILABLE'),(529,'JEV_UNAVAILABLE'),(500,'JEV_UNAVAILABLE')])
def test_external_errors_no_fallback_or_leak(status,code,caplog):
    response=api(lambda _: httpx2.Response(status,json={'error':POST['content']+' synthetic-test-key'})).post('/api/analyze-priority',json=POST)
    assert response.status_code == 503
    assert response.json()['error']['code']==code
    assert 'priority' not in response.json()
    assert POST['content'] not in response.text + caplog.text
    assert 'synthetic-test-key' not in response.text + caplog.text


@pytest.mark.parametrize('exception,status,code', [(httpx2.ReadTimeout,504,'JEV_TIMEOUT'),(httpx2.ConnectError,503,'JEV_UNAVAILABLE')])
def test_network_errors(exception,status,code):
    def handler(request): raise exception('synthetic error')
    response=api(handler).post('/api/analyze-priority',json=POST)
    assert response.status_code == status
    assert response.json()['error']['code']==code


def test_total_deadline():
    async def handler(request):
        await asyncio.sleep(.05)
        return httpx2.Response(200,json=wire_response())
    provider=JevPriorityAnalyzer('synthetic-test-key',transport=httpx2.MockTransport(handler),timeout=.01)
    response=TestClient(create_app(Settings(provider='jev'),provider)).post('/api/analyze-priority',json=POST)
    assert response.status_code==504
    assert response.json()['error']['code']=='JEV_TIMEOUT'


def test_missing_key_and_public_config():
    settings=Settings(provider='jev',low_confidence_threshold=.8)
    client=TestClient(create_app(settings))
    response=client.post('/api/analyze-priority',json=POST)
    assert response.status_code == 503
    assert response.json()['error']['code']=='JEV_MISSING_KEY'
    assert client.get('/api/config').json()=={'provider':'jev','lowConfidenceThreshold':.8}


@pytest.mark.parametrize('threshold', [-.1,1.1,float('nan'),float('inf')])
def test_bad_threshold(threshold):
    with pytest.raises(ValueError): Settings(low_confidence_threshold=threshold)


def test_configuration(monkeypatch):
    monkeypatch.setenv('PRIORITY_ANALYZER','jev')
    monkeypatch.setenv('TYPESAFE_API_KEY','synthetic-secret')
    monkeypatch.setenv('LOW_CONFIDENCE_THRESHOLD','.75')
    settings=Settings.from_env()
    assert settings.provider=='jev' and settings.low_confidence_threshold==.75
    assert 'synthetic-secret' not in repr(settings)
    with pytest.raises(ValueError): Settings(provider='invalid')


@pytest.mark.parametrize('probability,expected', [(.799, 'level_4'), (.8, 'level_1'), (.96, 'level_1')])
def test_rule_threshold_preserves_original(probability, expected):
    class FixedMatcher:
        async def match(self, post, topic):
            assert topic == '종사자 변경보고 기능 관련 질의'
            return probability

    sample = SAMPLES[-1]
    client = TestClient(create_app(Settings(), rule_matcher=FixedMatcher()))
    original = client.post('/api/analyze-priority', json=sample['post']).json()
    matched = client.post('/api/analyze-priority', json={**sample['post'], 'operatingRuleTopic': '종사자 변경보고 기능 관련 질의'}).json()
    assert original['handlingPriority'] == {'level': sample['level'], 'source': 'base', 'ruleTopic': None, 'matchProbability': None}
    assert matched['handlingPriority'] == {'level': expected, 'source': 'operating_rule' if probability >= .8 else 'base', 'ruleTopic': '종사자 변경보고 기능 관련 질의', 'matchProbability': probability}
    assert matched['priority'] == original['priority']
    assert matched['signals'] == original['signals']


def test_original_level_one_is_never_demoted():
    class FixedMatcher:
        async def match(self, post, topic): return .99
    response = TestClient(create_app(Settings(), rule_matcher=FixedMatcher())).post('/api/analyze-priority', json={**POST, 'operatingRuleTopic': '급여 마감'}).json()
    assert response['priority']['level'] == response['handlingPriority']['level'] == 'level_1'


def test_mock_rule_fixture_and_unmatched():
    client = TestClient(create_app(Settings()))
    topic = '종사자 변경보고 기능 관련 질의'
    matched = client.post('/api/analyze-priority', json={**SAMPLES[-1]['post'], 'operatingRuleTopic': topic}).json()
    unmatched = client.post('/api/analyze-priority', json={**SAMPLES[3]['post'], 'operatingRuleTopic': topic}).json()
    assert matched['handlingPriority']['level'] == 'level_1'
    assert matched['handlingPriority']['matchProbability'] == .96
    assert matched['priority']['level'] == 'level_4'
    assert unmatched['handlingPriority']['source'] == 'base'
    assert unmatched['handlingPriority']['matchProbability'] == .04


def test_rule_failure_never_returns_partial_success():
    class FailingMatcher:
        async def match(self, post, topic):
            raise AnalysisError('JEV_TIMEOUT', 'Jev 요청 시간이 초과되었습니다.', 504)
    response = TestClient(create_app(Settings(), rule_matcher=FailingMatcher())).post('/api/analyze-priority', json={**POST, 'operatingRuleTopic': '합성 주제'})
    assert response.status_code == 504
    assert 'priority' not in response.json()


@pytest.mark.parametrize('topic', ['', ' ', '가' * 201, 42])
def test_rule_topic_validation(topic):
    response = TestClient(create_app(Settings())).post('/api/analyze-priority', json={**POST, 'operatingRuleTopic': topic})
    assert response.status_code == 422
    assert 'operatingRuleTopic' in response.json()['error']['fields']
    assert POST['content'] not in response.text


def test_rule_uses_separate_noul_sdk_call_and_no_extra_call_without_rule():
    seen = []
    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        if 'topicRelated' in body['questions']:
            return httpx2.Response(200, json={'model': 'jev-test', 'usage': {'input_tokens': 10, 'output_tokens': 3}, 'answers': {'topicRelated': {'type': 'noul', 'noul': .8}}})
        return httpx2.Response(200, json=wire_response())
    transport = httpx2.MockTransport(handler)
    app = create_app(Settings(provider='jev'), JevPriorityAnalyzer('synthetic-test-key', transport=transport), JevRuleMatcher('synthetic-test-key', transport=transport))
    client = TestClient(app)
    plain = client.post('/api/analyze-priority', json=POST)
    assert plain.status_code == 200
    assert len(seen) == 1
    with_rule = client.post('/api/analyze-priority', json={**POST, 'operatingRuleTopic': '급여 마감'})
    assert with_rule.status_code == 200, with_rule.text
    assert len(seen) == 3
    urgency = next(body for body in seen[1:] if 'priority' in body['questions'])
    relevance = next(body for body in seen[1:] if 'topicRelated' in body['questions'])
    assert urgency['state'] == seen[0]['state']
    assert relevance['questions']['topicRelated']['type'] == 'noul'
    assert relevance['state']['post'] == {'title': POST['title'], 'content': POST['content']}
    assert relevance['state']['topic'] == '급여 마감'
