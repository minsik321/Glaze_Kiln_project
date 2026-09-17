# 유약 실험·소성 관리 시스템

비전문가가 사진·선택 카드·단면도·그래프로 한 번의 가상 유약 실험을 수행하는
AICE 로컬 MVP다. **시뮬레이터 기반**이며 실제 센서 연결, 실제 가마 제어와 품질
보장은 포함하지 않는다.

## 무엇을 하는가

레시피가 정하는 것은 전체의 일부다. 물을 얼마나 넣어 개었는지(비중), 몇 초
담갔는지(두께), 어떤 열이력을 받았는지, 얼마나 천천히 식혔는지는 레시피 밖에
있다. **문제는 정보의 부족이 아니라 정보의 소실이다.**

이 시스템은 출처가 확인된 관측, 문헌·특허 범위, 추론과 합성을 구분하고 가상
도포·적재·곡선·결과를 하나의 버전 있는 `AiceRun`으로 기록한다. 근거가 없으면
정상이나 안전으로 처리하지 않고 `판정 불가`로 남긴다.

```
[바깥 루프 · 회차 사이]  목표 지정 → 탐색 범위 → 후보 생성 → 선택
[안쪽 루프 · 회차 내]     배치 → 시유 → 위험 판정 → 적재 → 소성 → 자동 기록
[되먹임]                 결과 3축 → 계수 보정 → 탐색 갱신
```

기록은 목적이 아니라 제어의 부산물이다.

## 주장하지 않는 것

문서 앞에 둔다. 뒤에서 지키기 위해서다.

- **실제 품질이 개선된다고 주장하지 않는다.** 실물 소성이 없다.
- **조성으로 결과를 예측한다고 주장하지 않는다.** 실험 데이터가 없다.
- **탐색이 목표에 수렴한다고 주장하지 않는다.** 자기 생성 데이터로는 증명되지 않는다.
- 계수(k₁, k₂, ρ_dry, E, α, β)의 값을 주장하지 않는다. **동정 절차만 주장한다.**

주장하는 것은 하나다. **계측 → 판단 → 제어 → 기록이 하나의 사이클로 동작하고,
그 사이클이 재현에 필요한 값을 자동으로 남긴다.**

## 설치와 실행

React + TypeScript + Vite 기반입니다. Node.js 22.12 이상에서:

```powershell
npm ci
npm run dev
```

http://localhost:5173/ 에서 실행합니다. 빌드: `npm run build` (출력 `dist/`).
두께·소성곡선·비중 판정은 TypeScript로 직접 계산하고(`src/kiln`의 대응 Python
모듈을 원본으로 포팅), 채팅형 입구에서의 레시피 후보 추천과 예상 이미지 생성은
FastAPI 백엔드가 aimlapi.com을 통해 처리합니다(`docs/AICE_LLM_FRONTDOOR_PLAN.md`).
데이터는 Supabase PostgreSQL에 저장하고 FastAPI가 인증된 작업 기록 API를 제공합니다.
로그인·프로필·개인 기록 저장·공개 기록 조회가 구현되어 있습니다.

- [개발/DB 설정](docs/DEVELOPMENT.md)
- [AICE 로컬 실행·백업·복구](docs/AICE_LOCAL_OPERATIONS.md)
- [AiceRun 마이그레이션](docs/AICE_MIGRATION.md)
- [FastAPI 백엔드](backend/README.md)
- [React 구조](app/README.md)
- [현재 작업 상태(LLM 프런트도어 TODO)](docs/AICE_LLM_FRONTDOOR_TODO.md)

## 문서

| 문서 | 내용 |
|---|---|
| [docs/kiln-plan-v7.md](docs/kiln-plan-v7.md) | 기획서 원본. 모든 설계 판단의 출처 |
| [docs/AICE_LLM_FRONTDOOR_PLAN.md](docs/AICE_LLM_FRONTDOOR_PLAN.md) | 현재 방향성 — LLM 채팅 입구·RAG·Prediction·Optimization |
| [docs/AICE_LLM_FRONTDOOR_TODO.md](docs/AICE_LLM_FRONTDOOR_TODO.md) | 현재 작업 상태와 남은 항목 |
| [docs/INTERFACES.md](docs/INTERFACES.md) | 모듈 간 계약 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 폐기된 설계와 그 이유 |
| [CLAUDE.md](CLAUDE.md) | 저장소 안내 (모듈별 상세는 각 모듈의 `CLAUDE.md`) |
