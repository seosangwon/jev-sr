import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from pydantic import ValidationError
from typesafe_sdk import (
    AsyncTypeSafeClient, ChoiceAnswer, NoulAnswer, RetryPolicy, SystemOneResponse,
    TypeSafeAPIConnectionError, TypeSafeAPIError, TypeSafeAPIResponseValidationError,
    TypeSafeAPITimeoutError,
)

from .models import LABELS, PostInput, Priority, PriorityAnalysis, Signals
from .questions import QUESTIONS, structured_state

# SDK debug logs include unredacted post bodies. Disable that logger for this app.
logging.getLogger("typesafe_sdk").disabled = True


class AnalysisError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


class PriorityAnalyzer(Protocol):
    async def analyze(self, post: PostInput) -> PriorityAnalysis: ...


def convert_response(response: SystemOneResponse) -> PriorityAnalysis:
    """Reject incomplete answers; never reconstruct Jev's chosen level from signals."""
    try:
        priority = response.answers["priority"]
        scope = response.answers["impactScope"]
        if not isinstance(priority, ChoiceAnswer) or not isinstance(scope, ChoiceAnswer):
            raise ValueError("Unexpected choice type")
        for answer, options in ((priority, set(LABELS)), (scope, {"individual", "team", "many_users", "organization_wide", "unknown"})):
            if set(answer.probabilities) != options or answer.choice not in options:
                raise ValueError("Incomplete choices")
            values = list(answer.probabilities.values())
            if any(not 0 <= p <= 1 for p in values) or not 0.99 <= sum(values) <= 1.01:
                raise ValueError("Invalid probability distribution")
            if answer.probabilities[answer.choice] < max(values):
                raise ValueError("Choice is inconsistent with distribution")
            if not 0 <= answer.confidence <= 1:
                raise ValueError("Invalid confidence")
        signals = {}
        for key in ("payrollDisrupted", "requiredFunctionUnavailable", "workBlocked"):
            answer = response.answers[key]
            if not isinstance(answer, NoulAnswer):
                raise ValueError("Unexpected noul type")
            signals[key] = answer.noul
        total = sum(priority.probabilities.values())
        return PriorityAnalysis(
            priority=Priority(level=priority.choice, label=LABELS[priority.choice], confidence=priority.confidence,
                              probabilities={k: v / total for k, v in priority.probabilities.items()}),
            signals=Signals(**signals, impactScope=scope.choice, impactScopeConfidence=scope.confidence),
            analyzedAt=datetime.now(timezone.utc), provider="jev",
        )
    except (KeyError, AttributeError, TypeError, ValueError, ValidationError) as exc:
        raise AnalysisError("JEV_INVALID_RESPONSE", "Jev 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.") from exc


class JevPriorityAnalyzer:
    def __init__(self, api_key: str, *, transport=None, timeout: float = 20):
        self.api_key, self.transport, self.timeout = api_key, transport, timeout

    async def analyze(self, post: PostInput) -> PriorityAnalysis:
        if not self.api_key.strip():
            raise AnalysisError("JEV_MISSING_KEY", "Jev 모드에 TYPESAFE_API_KEY가 설정되지 않았습니다. 서버에 키를 설정하거나 Mock 모드로 실행해 주세요.", 503)
        try:
            # Explicit official endpoint prevents unintended environment-based redirection.
            async with AsyncTypeSafeClient(
                api_key=self.api_key, base_url="https://api.typesafe.ai", model="jev-latest",
                timeout=self.timeout, retry=RetryPolicy(max_retries=0), transport=self.transport,
            ) as client:
                async with asyncio.timeout(self.timeout):
                    response = await client.system_one(state=structured_state(post), questions=QUESTIONS)
            return convert_response(response)
        except (TypeSafeAPITimeoutError, TimeoutError) as exc:
            raise AnalysisError("JEV_TIMEOUT", "Jev 요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", 504) from exc
        except TypeSafeAPIResponseValidationError as exc:
            raise AnalysisError("JEV_INVALID_RESPONSE", "Jev 응답 형식이 올바르지 않습니다. 잠시 후 다시 시도해 주세요.") from exc
        except TypeSafeAPIConnectionError as exc:
            raise AnalysisError("JEV_UNAVAILABLE", "Jev에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.", 503) from exc
        except TypeSafeAPIError as exc:
            if exc.status in (401, 403):
                raise AnalysisError("JEV_AUTH_ERROR", "Jev 인증에 실패했습니다. 서버의 API 키와 접근 권한을 확인해 주세요.", 503) from exc
            raise AnalysisError("JEV_UNAVAILABLE", "Jev 외부 서비스 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 503) from exc


class MockPriorityAnalyzer:
    """Synthetic fixture playback, deliberately not a keyword classifier or AI model."""
    def __init__(self):
        self.samples = json.loads((Path(__file__).resolve().parents[2] / "samples/posts.json").read_text())

    async def analyze(self, post: PostInput) -> PriorityAnalysis:
        sample = next((s for s in self.samples if PostInput(**s["post"]) == post), None)
        level = sample["level"] if sample else "level_3"
        confidence = sample.get("confidence", 0.91) if sample else 0.35
        probabilities = dict(zip(LABELS, [0.05] * 4))
        probabilities[level] = 0.85
        if confidence < 0.6:
            probabilities = {"level_1": 0.2, "level_2": 0.25, "level_3": 0.3, "level_4": 0.25}
        return PriorityAnalysis(
            priority=Priority(level=level, label=LABELS[level], confidence=confidence, probabilities=probabilities),
            signals=Signals(
                **dict(zip(("payrollDisrupted", "requiredFunctionUnavailable", "workBlocked"), sample["signals"] if sample else [0.5] * 3)),
                impactScope=sample["scope"] if sample else "unknown", impactScopeConfidence=0.82 if confidence >= 0.6 else 0.3,
            ),
            analyzedAt=datetime.now(timezone.utc), provider="mock",
        )
