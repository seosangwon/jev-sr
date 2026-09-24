import os
import re
from dataclasses import dataclass, field
from math import isfinite
from typing import Literal
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    provider: Literal["mock", "jev"] = "mock"
    api_key: str = field(default="", repr=False)
    discord_webhook_url: str = field(default="", repr=False)
    low_confidence_threshold: float = 0.60

    def __post_init__(self):
        if self.provider not in ("mock", "jev"):
            raise ValueError("PRIORITY_ANALYZER는 mock 또는 jev여야 합니다.")
        if not isfinite(self.low_confidence_threshold) or not 0 <= self.low_confidence_threshold <= 1:
            raise ValueError("LOW_CONFIDENCE_THRESHOLD는 0~1이어야 합니다.")
        if self.discord_webhook_url:
            url = urlsplit(self.discord_webhook_url)
            if (url.scheme != "https" or url.netloc != "discord.com" or
                    not re.fullmatch(r"/api/webhooks/\d+/[A-Za-z0-9._-]+", url.path) or url.query or url.fragment):
                raise ValueError("DISCORD_WEBHOOK_URL은 Discord의 HTTPS 웹훅 URL이어야 합니다.")

    @classmethod
    def from_env(cls):
        return cls(
            provider=os.getenv("PRIORITY_ANALYZER", "mock").strip(),
            api_key=os.getenv("TYPESAFE_API_KEY", "").strip(),
            discord_webhook_url=os.getenv("DISCORD_WEBHOOK_URL", "").strip(),
            low_confidence_threshold=float(os.getenv("LOW_CONFIDENCE_THRESHOLD", "0.60")),
        )
