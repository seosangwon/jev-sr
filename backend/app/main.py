import asyncio
import base64
import binascii
import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .config import Settings
from .models import AnalysisRequest, AnalysisResponse, HandlingPriority, PostInput
from .notifications import DiscordWebhookNotifier, Notifier
from .providers import AnalysisError, JevPriorityAnalyzer, JevRuleMatcher, MockPriorityAnalyzer, MockRuleMatcher, PriorityAnalyzer, RuleMatcher


RULE_MATCH_THRESHOLD = 0.8
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend/dist"


def authorized(request: Request, password: str) -> bool:
    scheme, _, encoded = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "basic" or not encoded:
        return False
    try:
        raw = base64.b64decode(encoded, validate=True)
        username, supplied_password = raw.split(b":", 1)
    except (ValueError, binascii.Error):
        return False
    return bool(
        secrets.compare_digest(username, b"demo")
        & secrets.compare_digest(supplied_password, password.encode("utf-8"))
    )


def create_app(settings: Settings | None = None, analyzer: PriorityAnalyzer | None = None, rule_matcher: RuleMatcher | None = None, notifier: Notifier | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    analyzer = analyzer or (MockPriorityAnalyzer() if settings.provider == "mock" else JevPriorityAnalyzer(settings.api_key))
    rule_matcher = rule_matcher or (MockRuleMatcher() if settings.provider == "mock" else JevRuleMatcher(settings.api_key))
    notifier = notifier or (DiscordWebhookNotifier(settings.discord_webhook_url) if settings.discord_webhook_url else None)
    app = FastAPI(title="Jev 게시글 우선순위 분석기")

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        if settings.deploy_mode and request.url.path != "/healthz" and not authorized(request, settings.demo_password):
            response = Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Jev SR Demo"'})
        else:
            response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return {"status": "ok"}

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        labels = {"targetInfo": "대상자 정보", "title": "제목", "content": "내용", "operatingRuleTopic": "운영 규칙 주제"}
        limits = {"targetInfo": 500, "title": 200, "content": 5000, "operatingRuleTopic": 200}
        fields = {}
        for error in exc.errors():
            field = str(error["loc"][-1])
            name = labels.get(field, "입력값")
            if error["type"] == "string_too_long":
                fields[field] = f"{name}는 최대 {limits.get(field, 5000):,}자까지 입력할 수 있습니다."
            else:
                fields[field] = f"{name}를 공백이 아닌 텍스트로 입력해 주세요."
        # Do not serialize exc.errors(): it includes the original private input.
        return JSONResponse(status_code=422, content={"error": {"code": "INVALID_INPUT", "message": "입력값을 확인해 주세요.", "fields": fields}})

    @app.exception_handler(AnalysisError)
    async def provider_error(request: Request, exc: AnalysisError):
        return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})

    @app.get("/api/config")
    async def config():
        return {"provider": settings.provider, "lowConfidenceThreshold": settings.low_confidence_threshold}

    @app.post("/api/analyze-priority", response_model=AnalysisResponse)
    async def analyze(request: AnalysisRequest):
        post = PostInput.model_validate(request.model_dump(exclude={"operatingRuleTopic"}))
        topic = request.operatingRuleTopic
        if topic is None:
            original = await analyzer.analyze(post)
            handling = HandlingPriority(level=original.priority.level, source="base")
        else:
            original, probability = await asyncio.gather(analyzer.analyze(post), rule_matcher.match(post, topic))
            matched = probability >= RULE_MATCH_THRESHOLD
            handling = HandlingPriority(
                level="level_1" if matched else original.priority.level,
                source="operating_rule" if matched else "base",
                ruleTopic=topic, matchProbability=probability,
            )
        if handling.level != "level_1":
            notification_status = "not_required"
        elif settings.provider == "mock":
            notification_status = "simulated"
        elif notifier is None:
            notification_status = "not_configured"
        else:
            try:
                sent = await notifier.send(post, original, handling)
            except Exception:
                # Notification problems do not replace a valid Jev result.
                sent = False
            notification_status = "sent" if sent else "failed"
        return AnalysisResponse(**original.model_dump(), handlingPriority=handling, notificationStatus=notification_status)

    if settings.deploy_mode:
        if not (FRONTEND_DIST / "index.html").is_file():
            raise RuntimeError("DEPLOY_MODE에서는 빌드된 frontend/dist가 필요합니다.")
        app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

    return app


app = create_app()
