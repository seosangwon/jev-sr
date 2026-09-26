from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


POST = {
    "targetInfo": "합성 테스트 담당자",
    "title": "급여 계산이 멈췄습니다",
    "content": "급여 계산이 처리 중에서 넘어가지 않아 오늘 마감 업무를 진행할 수 없습니다.",
}
PASSWORD = "synthetic-demo-password"


def deployed_client(monkeypatch, tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text("<html>synthetic demo page</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app.js").write_text("console.log('synthetic demo')")
    monkeypatch.setattr("backend.app.main.FRONTEND_DIST", tmp_path)
    return TestClient(create_app(Settings(deploy_mode=True, demo_password=PASSWORD)))


def test_deploy_mode_requires_password_and_built_frontend(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match="DEMO_PASSWORD"):
        Settings(deploy_mode=True)
    monkeypatch.setattr("backend.app.main.FRONTEND_DIST", tmp_path)
    with pytest.raises(RuntimeError, match="frontend/dist"):
        create_app(Settings(deploy_mode=True, demo_password=PASSWORD))
    assert PASSWORD not in repr(Settings(deploy_mode=True, demo_password=PASSWORD))


def test_deployed_frontend_and_api_require_basic_auth(monkeypatch, tmp_path):
    client = deployed_client(monkeypatch, tmp_path)
    for path in ("/", "/assets/app.js", "/api/config", "/docs", "/openapi.json"):
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == 'Basic realm="Jev SR Demo"'
        assert response.headers["cache-control"] == "no-store"
    assert client.post("/api/analyze-priority", json=POST).status_code == 401
    assert client.get("/", auth=("demo", "wrong")).status_code == 401
    assert client.get("/", auth=("other", PASSWORD)).status_code == 401
    assert client.get("/", headers={"Authorization": "Basic !!!"}).status_code == 401
    assert client.get("/", auth=("demo", PASSWORD)).status_code == 200
    assert "synthetic demo page" in client.get("/", auth=("demo", PASSWORD)).text
    assert client.get("/assets/app.js", auth=("demo", PASSWORD)).status_code == 200
    assert client.get("/api/config", auth=("demo", PASSWORD)).json()["provider"] == "mock"
    result = client.post("/api/analyze-priority", json=POST, auth=("demo", PASSWORD))
    assert result.status_code == 200
    assert result.json()["provider"] == "mock"


def test_public_health_and_local_development_unchanged(monkeypatch, tmp_path):
    deployed = deployed_client(monkeypatch, tmp_path)
    assert deployed.get("/healthz").json() == {"status": "ok"}
    local = TestClient(create_app(Settings()))
    assert local.get("/healthz").status_code == 200
    assert local.get("/api/config").status_code == 200
    assert local.post("/api/analyze-priority", json=POST).status_code == 200
