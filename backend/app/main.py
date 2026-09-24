from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .config import Settings
from .models import PostInput, PriorityAnalysis
from .providers import AnalysisError, JevPriorityAnalyzer, MockPriorityAnalyzer, PriorityAnalyzer


def create_app(settings: Settings | None = None, analyzer: PriorityAnalyzer | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    analyzer = analyzer or (MockPriorityAnalyzer() if settings.provider == "mock" else JevPriorityAnalyzer(settings.api_key))
    app = FastAPI(title="Jev 게시글 우선순위 분석기")

    @app.middleware("http")
    async def no_store(request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        labels = {"targetInfo": "대상자 정보", "title": "제목", "content": "내용"}
        limits = {"targetInfo": 500, "title": 200, "content": 5000}
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

    @app.post("/api/analyze-priority", response_model=PriorityAnalysis)
    async def analyze(post: PostInput):
        return await analyzer.analyze(post)

    return app


app = create_app()
