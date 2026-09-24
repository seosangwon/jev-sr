import asyncio
import io
import json
from pathlib import Path
from urllib.error import URLError

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.models import PostInput
from backend.app.notifications import DiscordWebhookNotifier, notification_payload
from backend.app.providers import AnalysisError, MockPriorityAnalyzer


POST = {"targetInfo": "합성 테스트 담당자", "title": "@everyone 급여 계산 중단", "content": "오늘 합성 급여 계산을 진행할 수 없습니다."}
DISCORD_URL = "https://discord.com/api/webhooks/123456/synthetic-token"


class FixedAnalyzer:
    def __init__(self, level: str = "level_1", fail: bool = False):
        self.level, self.fail = level, fail

    async def analyze(self, post):
        if self.fail:
            raise AnalysisError("JEV_TIMEOUT", "Jev 요청 시간이 초과되었습니다.", 504)
        result = await MockPriorityAnalyzer().analyze(post)
        return result.model_copy(update={
            "provider": "jev",
            "priority": result.priority.model_copy(update={"level": self.level}),
        })


class FixedMatcher:
    async def match(self, post, topic): return .96


class RecordingNotifier:
    def __init__(self, outcome=True):
        self.outcome, self.calls = outcome, []

    async def send(self, post, analysis, handling):
        self.calls.append((post, analysis, handling))
        if self.outcome == "raise":
            raise RuntimeError("synthetic failure")
        return self.outcome


def test_discord_payload_has_title_but_not_private_fields_or_mentions():
    post = PostInput(**POST)
    analysis = asyncio.run(FixedAnalyzer().analyze(post))
    from backend.app.models import HandlingPriority
    payload = notification_payload(post, analysis, HandlingPriority(level="level_1", source="base"))
    assert POST["title"] in payload["content"]
    assert POST["targetInfo"] not in payload["content"]
    assert POST["content"] not in payload["content"]
    assert payload["allowed_mentions"] == {"parse": []}


def test_discord_uses_wait_for_confirmation_and_requires_message_id():
    seen = []
    def opener(request, timeout):
        seen.append((request, timeout))
        response = io.BytesIO(b'{"id":"synthetic-message-id"}')
        response.status = 200
        return response
    post = PostInput(**POST)
    analysis = asyncio.run(FixedAnalyzer().analyze(post))
    from backend.app.models import HandlingPriority
    notifier = DiscordWebhookNotifier(DISCORD_URL, opener=opener)
    assert asyncio.run(notifier.send(post, analysis, HandlingPriority(level="level_1", source="base")))
    request, timeout = seen[0]
    assert request.full_url == DISCORD_URL + "?wait=true"
    assert timeout == 5
    assert request.get_header("User-agent") == "jev-sr-mvp/1.0"
    assert json.loads(request.data)["allowed_mentions"] == {"parse": []}


@pytest.mark.parametrize("body", [b"{}", b"not-json"])
def test_discord_does_not_report_unconfirmed_delivery(body):
    def opener(request, timeout):
        response = io.BytesIO(body)
        response.status = 200
        return response
    post = PostInput(**POST)
    analysis = asyncio.run(FixedAnalyzer().analyze(post))
    from backend.app.models import HandlingPriority
    notifier = DiscordWebhookNotifier(DISCORD_URL, opener=opener)
    assert not asyncio.run(notifier.send(post, analysis, HandlingPriority(level="level_1", source="base")))


def test_discord_network_failure_is_reported_without_exposing_url(caplog):
    def opener(request, timeout):
        raise URLError("synthetic network error")
    post = PostInput(**POST)
    analysis = asyncio.run(FixedAnalyzer().analyze(post))
    from backend.app.models import HandlingPriority
    notifier = DiscordWebhookNotifier(DISCORD_URL, opener=opener)
    assert not asyncio.run(notifier.send(post, analysis, HandlingPriority(level="level_1", source="base")))
    assert DISCORD_URL not in caplog.text


@pytest.mark.parametrize("outcome,status", [(True,"sent"), (False,"failed"), ("raise","failed")])
def test_jev_level_one_sends_once_and_preserves_result_on_failure(outcome, status):
    notifier = RecordingNotifier(outcome)
    client = TestClient(create_app(Settings(provider="jev"), analyzer=FixedAnalyzer(), notifier=notifier))
    response = client.post("/api/analyze-priority", json=POST)
    assert response.status_code == 200
    assert response.json()["priority"]["level"] == "level_1"
    assert response.json()["notificationStatus"] == status
    assert len(notifier.calls) == 1


def test_rule_promoted_level_one_notifies_but_lower_level_does_not():
    notifier = RecordingNotifier()
    client = TestClient(create_app(Settings(provider="jev"), analyzer=FixedAnalyzer("level_4"), rule_matcher=FixedMatcher(), notifier=notifier))
    ordinary = client.post("/api/analyze-priority", json=POST).json()
    promoted = client.post("/api/analyze-priority", json={**POST, "operatingRuleTopic": "급여 기능"}).json()
    assert ordinary["notificationStatus"] == "not_required"
    assert promoted["priority"]["level"] == "level_4"
    assert promoted["handlingPriority"]["level"] == "level_1"
    assert promoted["notificationStatus"] == "sent"
    assert len(notifier.calls) == 1


def test_mock_simulates_without_external_send_and_missing_url_is_explicit():
    notifier = RecordingNotifier()
    sample = json.loads(Path("samples/posts.json").read_text())[0]["post"]
    mock = TestClient(create_app(Settings(), notifier=notifier)).post("/api/analyze-priority", json=sample).json()
    jev = TestClient(create_app(Settings(provider="jev"), analyzer=FixedAnalyzer())).post("/api/analyze-priority", json=POST).json()
    assert mock["notificationStatus"] == "simulated"
    assert jev["notificationStatus"] == "not_configured"
    assert not notifier.calls


def test_failed_analysis_never_sends():
    notifier = RecordingNotifier()
    response = TestClient(create_app(Settings(provider="jev"), analyzer=FixedAnalyzer(fail=True), notifier=notifier)).post("/api/analyze-priority", json=POST)
    assert response.status_code == 504
    assert not notifier.calls


@pytest.mark.parametrize("url", ["http://discord.com/api/webhooks/1/x", "https://example.com/api/webhooks/1/x", "https://discord.com/api/webhooks/1/x?redirect=yes"])
def test_webhook_url_is_restricted_and_never_repr_exposed(url):
    with pytest.raises(ValueError):
        Settings(discord_webhook_url=url)
    assert DISCORD_URL not in repr(Settings(discord_webhook_url=DISCORD_URL))
