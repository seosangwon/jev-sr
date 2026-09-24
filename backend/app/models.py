from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Level = Literal["level_1", "level_2", "level_3", "level_4"]
Scope = Literal["individual", "team", "many_users", "organization_wide", "unknown"]
Probability = Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
LABELS: dict[Level, str] = {"level_1": "긴급", "level_2": "높음", "level_3": "보통", "level_4": "낮음"}


class PostInput(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    targetInfo: str = Field(min_length=1, max_length=500)
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)

    @field_validator("targetInfo", "title", "content")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return value.strip()


class AnalysisRequest(PostInput):
    operatingRuleTopic: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("operatingRuleTopic")
    @classmethod
    def nonblank_topic(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("공백만 입력할 수 없습니다.")
        return value.strip()


class Priority(BaseModel):
    level: Level
    label: str
    confidence: Probability
    probabilities: dict[Level, Probability]


class Signals(BaseModel):
    payrollDisrupted: Probability
    requiredFunctionUnavailable: Probability
    workBlocked: Probability
    impactScope: Scope
    impactScopeConfidence: Probability


class PriorityAnalysis(BaseModel):
    priority: Priority
    signals: Signals
    analyzedAt: datetime
    provider: Literal["mock", "jev"]


class HandlingPriority(BaseModel):
    level: Level
    source: Literal["base", "operating_rule"]
    ruleTopic: str | None = None
    matchProbability: Probability | None = None


class AnalysisResponse(PriorityAnalysis):
    handlingPriority: HandlingPriority
    notificationStatus: Literal["not_required", "simulated", "not_configured", "sent", "failed"]
