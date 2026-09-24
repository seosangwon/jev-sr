# Jev 게시글 우선순위 분석기

대상자 정보·제목·내용을 입력하면 업무 우선순위 Level 1~4, 네 단계의 전체 확률, 판단 신뢰도와 세부 분석을 보여 주는 MVP입니다. **기능 범위와 완료 기준은 [docs/jev-sr-mvp.md](docs/jev-sr-mvp.md)가 유일한 기준입니다.**

## 빠른 실행: API 키 없이 Mock 데모

필수 도구: Python **3.11 이상**, Node.js **20 이상**, npm, [uv](https://docs.astral.sh/uv/). 개발 시 Python 3.12와 Node 20.15로 검증했습니다. 아래 명령은 저장소 루트에서 실행합니다.

```sh
uv sync --locked --group dev
npm ci --prefix frontend
```

터미널 1에서 백엔드를 실행합니다. 별도의 환경 설정이 없으면 기본값은 Mock입니다.

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

터미널 2에서 프론트엔드를 실행합니다.

```sh
npm run dev --prefix frontend
```

브라우저에서 [http://127.0.0.1:5173](http://127.0.0.1:5173)을 엽니다. 다른 로컬 서비스가 5173 포트를 사용 중이라면 Vite가 출력한 주소를 사용하세요. 개발 서버의 `/api` 요청은 `127.0.0.1:8000`의 FastAPI로 전달됩니다.

1. `시연 예제`에서 **급여 마감 중단**을 선택합니다.
2. `Jev로 우선순위 분석`을 누르면 Level 1과 네 확률 막대가 표시됩니다.
3. **급여 조회 방법 문의**는 Level 4로 표시됩니다.
4. **모호한 내용 / 낮은 신뢰도**는 Level 3과 추가 확인 안내를 표시합니다.
5. 여러 질의를 분석한 뒤 상단 `질의 목록`을 누르면 최근 분석한 순서로 결과가 표시됩니다.
6. 초기화 후 새 입력을 작성할 수 있습니다. 입력·결과·목록은 브라우저 메모리에만 유지되며 새로고침하면 사라집니다.

[samples/posts.json](samples/posts.json)에 기본·경계 사례 12개를 제공합니다. 모두 합성 데이터입니다. Mock은 세 필드가 일치하는 예제의 결과를 재생합니다(앞뒤 공백은 무시). **예제를 수정하거나 다른 글을 입력하면 Level 3·낮은 신뢰도의 고정 시연 결과를 반환합니다.** 키워드 분류기나 실제 AI가 아니며 자유 입력에 대한 의미 분석 정확도를 검증하는 모드가 아닙니다. 시간 정보만 현재 시각이며 나머지 결과는 결정론적입니다.

## Jev 모드와 설정

설정 이름과 예시는 루트 [.env.example](.env.example)에만 있습니다. 앱은 프로세스 환경변수를 읽습니다. 로컬 파일을 이용하려면 다음처럼 복사하고 편집하세요. `.env`는 Git에서 제외됩니다.

```sh
cp .env.example .env
```

- `PRIORITY_ANALYZER`: `mock` 또는 `jev`. 기본값 `mock`.
- `TYPESAFE_API_KEY`: 실제 Jev 호출에 사용할 TypeSafe 키. 프론트엔드가 아닌 서버에만 설정합니다.
- `LOW_CONFIDENCE_THRESHOLD`: 0~1 사이 값. 기본값 0.60. 결과 신뢰도가 **미만**일 때 추가 확인 안내를 표시합니다.

`.env`에서 Provider를 `jev`로 바꾸고 발급받은 키를 로컬 편집기로 입력한 다음, 기존 백엔드를 종료하고 아래 명령으로 시작합니다. `.env` 파일은 자동으로 읽지 않으므로 `--env-file`이 필요합니다. 키를 명령줄이나 Git에 넣지 마세요.

```sh
.venv/bin/python -m uvicorn backend.app.main:app --env-file .env --host 127.0.0.1 --port 8000
```

설정 변경 후 백엔드를 재시작하고 브라우저를 새로고침하세요. Mock으로 돌아가려면 Provider를 `mock`으로 바꾸고 같은 방법으로 재시작합니다. Jev 모드에 키가 없으면 분석 시 `JEV_MISSING_KEY` 오류를 보여 주며 Mock 결과로 대체하지 않습니다.

**실제 사내 데이터를 외부 Jev API로 전송하기 전에 조직의 개인정보·정보보안 검토가 필요합니다.** 본 MVP는 입력 원문·키를 서버 로그에 기록하지 않습니다. 원문을 기록할 수 있는 SDK logger도 비활성화했습니다. 질의 목록은 React 메모리에만 있으며 DB, 파일, localStorage 또는 sessionStorage에 저장하지 않습니다. 응답에는 `Cache-Control: no-store`를 설정합니다.

## 기술 구조와 주요 파일

```text
React + TypeScript + Vite
  ├─ 성공한 분석 → 세션 질의 목록 → 최신 분석순
  ├─ GET /api/config             → 공개 Provider/신뢰도 기준
  └─ POST /api/analyze-priority  → FastAPI 입력 검증
                                   └─ PriorityAnalyzer 인터페이스
                                       ├─ MockPriorityAnalyzer → 합성 fixture
                                       └─ JevPriorityAnalyzer  → 공식 typesafe-sdk
                                                                  → Jev
                                   ← 내부 PriorityAnalysis 응답
```

| 파일 | 역할 |
|---|---|
| `backend/app/main.py` | API, 공개 설정, 입력 오류와 Provider 오류 응답 |
| `backend/app/models.py` | 입력·우선순위·세부 분석 응답 모델 |
| `backend/app/questions.py` | 구조화된 상태와 독립 질문 5개 |
| `backend/app/providers.py` | Provider 인터페이스, Jev/Mock, SDK 응답 검증·변환 |
| `backend/app/config.py` | 서버 환경 설정 및 기준값 검증 |
| `frontend/src/App.tsx` | 입력·로딩·재시도·초기화·결과 UI |
| `frontend/src/QueryList.tsx` | 현재 세션의 질의 목록 화면 |
| `frontend/src/history.ts` | 목록 모델과 최신 분석순 정렬 |
| `frontend/src/api.ts` | 클라이언트 검증, API 호출 및 런타임 응답 검증 |
| `samples/posts.json` | Mock 및 시연·테스트에 공유하는 합성 사례 |
| `backend/tests/test_priority.py` | 입력·Provider·SDK HTTP 계약·변환·오류 테스트 |
| `frontend/src/App.test.tsx` | UI 흐름·입력 경계·실패·재시도 테스트 |
| `frontend/e2e/flow.spec.ts` | 실제 브라우저와 FastAPI를 연결하는 데모 테스트 |
| `docs/verification.md` | 기획서 완료 조건별 검증 결과와 제약 |

Python 의존성은 `uv.lock`, 프론트엔드는 `frontend/package-lock.json`으로 고정합니다. 실제 런타임 SDK는 **typesafe-sdk 0.7.0**입니다.

## Jev 질문과 공식 계약

2026-09-21에 다음 TypeSafe 공식 문서를 확인하고 설치된 SDK 코드와 대조했습니다.

- [공식 Python SDK](https://docs.typesafe.ai/sdk/python)
- [AsyncTypeSafeClient API](https://docs.typesafe.ai/sdk/python/api/clients/async)
- [HTTP API](https://docs.typesafe.ai/api)
- [독립 질문의 동작](https://docs.typesafe.ai/primitives)
- [신뢰도와 확률의 차이](https://docs.typesafe.ai/confidence)
- [SDK 사용·재시도·로그](https://docs.typesafe.ai/sdk/python/usage)

서버가 `AsyncTypeSafeClient.system_one(state=..., questions=...)`를 한 번 호출합니다. 공식 API 주소는 `https://api.typesafe.ai/v1/systemone`, 모델은 `jev-latest`입니다. 세 입력은 `[게시글 대상자]`, `[게시글 제목]`, `[게시글 내용]`으로 구분합니다.

| 질문 | 타입 | 응답 사용 |
|---|---|---|
| 실제 업무 긴급도 | Choice, Level 1~4 | Jev가 선택한 Level·전체 확률·confidence를 그대로 사용 |
| 급여 계산·마감·지급의 실제 중단 | Noul | 예일 확률을 세부 분석에 표시 |
| 필수 업무 기능의 실제 장애 | Noul | 예일 확률을 세부 분석에 표시 |
| 현재 업무 진행 차단 | Noul | 예일 확률을 세부 분석에 표시 |
| 실제 영향 범위 | Choice, 5가지 | 영향 범위와 confidence를 표시 |

대상자 정보는 영향 문맥으로 전달하되, 전체 대상이라고 장애 범위를 자동 추정하지 않도록 질문에 명시합니다. 급여 조회 문의와 급여 마감 중단도 구분합니다. 질문들은 같은 상태를 독립적으로 읽습니다. **세부 분석값을 조합해 최종 Level을 코드로 다시 계산하지 않습니다.**

SDK의 `confidence`는 선택 확률과 별개인 분포 집중도의 지표이며, 모델 정답률을 뜻하지 않습니다. 확률은 0~1의 유한한 값과 전체 선택지 포함 여부를 확인합니다. 합계가 1에서 0.01 이내인 반올림 오차만 합계 1로 보정하고, 잘못된 응답은 오류 처리합니다. 원본 SDK 응답·사용량·요청 식별자는 UI에 전달하지 않습니다.

## API와 오류 처리

`POST /api/analyze-priority`는 다음 형태를 받습니다.

```json
{
  "targetInfo": "인사팀 급여 담당자",
  "title": "급여 계산이 멈췄습니다",
  "content": "급여 계산이 처리 중에서 넘어가지 않아 오늘 마감 업무를 진행할 수 없습니다."
}
```

각 필드는 필수 문자열이며, 대상자 500자·제목 200자·내용 5,000자까지 허용합니다. 앞뒤 공백 제거 전 길이를 검증하고 공백만 있는 값은 거절합니다. 프론트엔드와 Python 모두 Unicode 코드 포인트 수를 사용합니다(이모지도 양쪽에서 동일하게 계산). 프론트엔드는 초과 입력을 숨기거나 잘라내지 않고 구체적 오류를 표시합니다.

성공 응답은 기획서의 `priority`, `signals`, `analyzedAt`, `provider` 구조를 따릅니다. 오류는 `{"error":{"code":"...","message":"...","fields":{...}}}` 형태이며, `fields`는 입력 오류에만 있습니다.

| HTTP | 코드 | 사용자 조치 |
|---|---|---|
| 422 | `INVALID_INPUT` | 필수값·공백·길이·문자열 형식 확인 |
| 503 | `JEV_MISSING_KEY` | 서버 키 설정 또는 Mock 선택 |
| 503 | `JEV_AUTH_ERROR` | 키·권한 확인 |
| 504 | `JEV_TIMEOUT` | 잠시 후 재시도 |
| 502 | `JEV_INVALID_RESPONSE` | 잠시 후 재시도, 지속 시 연동 점검 |
| 503 | `JEV_UNAVAILABLE` | 네트워크·서비스 상태 확인 후 재시도 |

서버 Jev 호출 전체 제한은 20초, 브라우저 분석 요청 제한은 30초입니다. SDK 자동 재시도는 이 MVP에서 비활성화하여 중복 호출 없이 사용자가 재시도하도록 합니다. 재시도는 새 분석 요청입니다. 외부 오류 상세나 원문은 응답에 포함하지 않습니다. 분석 실패 시 결과 카드는 표시하지 않고 입력을 유지합니다.

## 검증 명령

저장소 루트에서 실행합니다.

```sh
.venv/bin/python -m pytest -q
npm test --prefix frontend
npm run typecheck --prefix frontend
npm run build --prefix frontend
```

브라우저 통합 테스트는 처음 한 번 Chromium 설치가 필요합니다. 아래는 `frontend` 디렉터리에서 실행합니다. 테스트는 데모 서버와 충돌하지 않도록 전용 8100/5273 포트에서 서버를 시작하고 종료합니다.

```sh
cd frontend
npx playwright install chromium
npm run test:e2e
```

이 테스트는 테스트 프로세스의 Provider를 Mock으로 고정하고 키를 비웁니다. 외부 Jev 호출 없이 12개 사례의 분석·목록 누적·최신순 정렬과 모바일 화면을 확인합니다. SDK 계약 테스트 역시 공식 SDK와 HTTP 모의 transport를 연결하며 실제 API 비용이 발생하지 않습니다.

## 제약과 확장 지점

- 사용자가 설정한 키로 합성 데이터 한 건의 실제 Jev 연결·응답 형식을 확인했습니다. 이 연결 확인과 Mock/HTTP 계약 테스트는 실제 업무 데이터에 대한 모델의 한국어 판단 품질을 보증하지 않습니다.
- `jev-latest`는 TypeSafe가 갱신하는 별칭이므로 모델 판단은 향후 바뀔 수 있습니다.
- 개발용 MVP이며 공개 서비스용 인증·요청 제한·운영 구성을 포함하지 않습니다. 기본 서버는 로컬 주소에만 바인딩합니다.
- 목록은 현재 페이지 메모리에만 존재합니다. 새로고침·탭 종료 시 사라지며 다른 사용자나 기기와 공유되지 않습니다.
- 기본 정렬은 최신 분석순입니다. 우선순위순 선택지는 다음 확장 위치를 보여 주지만 아직 선택할 수 없습니다.
- 배포 관리, 알림 전송, 게시글 수정·삭제, 영속 DB, 로그인, 카테고리 분류, 담당자 배정, 관리자·통계 화면을 구현하지 않았습니다.
- 향후 알림은 `PriorityAnalysis`의 `priority.probabilities`, `priority.confidence`, `signals`를 입력으로 받는 별도 정책 계층에서 붙일 수 있습니다. 현재는 구조만 보존하며 알림 정책·전송 로직은 없습니다.
