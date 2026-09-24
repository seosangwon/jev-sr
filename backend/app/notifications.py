"""One-way Discord notification for completed Level 1 analyses."""

import asyncio
import json
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import HandlingPriority, PostInput, PriorityAnalysis


class Notifier(Protocol):
    async def send(self, post: PostInput, analysis: PriorityAnalysis, handling: HandlingPriority) -> bool: ...


def notification_payload(post: PostInput, analysis: PriorityAnalysis, handling: HandlingPriority) -> dict:
    title = " ".join(post.title.split())
    reason = "운영 규칙 적용" if handling.source == "operating_rule" and analysis.priority.level != "level_1" else "Jev 원래 긴급도"
    return {
        "content": (
            "🚨 Level 1 새 질의\n"
            f"제목: {title}\n"
            f"Jev 긴급도: Level {analysis.priority.level[-1]}\n"
            f"처리 우선순위: Level {handling.level[-1]} · {reason}\n"
            f"분석 시각: {analysis.analyzedAt.isoformat()}"
        ),
        # A user-supplied title must never ping @everyone, a role, or a user.
        "allowed_mentions": {"parse": []},
    }


class DiscordWebhookNotifier:
    def __init__(self, url: str, *, opener=urlopen):
        self.url = url
        self.opener = opener

    def _send_sync(self, post: PostInput, analysis: PriorityAnalysis, handling: HandlingPriority) -> bool:
        payload = notification_payload(post, analysis, handling)
        request = Request(
            f"{self.url}?wait=true",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "jev-sr-mvp/1.0"},
            method="POST",
        )
        try:
            with self.opener(request, timeout=5) as response:
                if response.status != 200:
                    return False
                message = json.load(response)
                return isinstance(message, dict) and isinstance(message.get("id"), str)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError):
            return False

    async def send(self, post: PostInput, analysis: PriorityAnalysis, handling: HandlingPriority) -> bool:
        return await asyncio.to_thread(self._send_sync, post, analysis, handling)
