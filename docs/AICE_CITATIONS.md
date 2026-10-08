# AICE — 인용 자료 모음 (v9)

앱 화면·컴포넌트에는 개별 인용을 달지 않는다. 이 문서 한 곳에 모아 관리한다.
특허는 인용 가능성·권리범위가 불확실할 수 있으므로 신뢰 근거의 1순위는
학술 논문으로 하고, 특허는 참고 caveat과 함께 별도 절에 둔다.

## 1 · 학술 논문 (1순위 근거)

| 주제 | 문헌 | 인용 가능성 |
|---|---|---|
| 유약 질감 판정(Stull 차트) | R.T. Stull, "Fusibility and Viscosity Tests", Trans. Am. Ceram. Soc., Vol.14, pp.62–70 (1912) | 저작권 만료(1912년 발표, 공개 학술지). 이미 `kiln-plan-v7.md` 04절에서 인용 중 — 유지 |
| 침적 코팅 두께 이론 | L. Landau, B. Levich, "Dragging of a liquid by a moving plate", Acta Physicochim. URSS, 17, 42–54 (1942) | 고전 논문, 학계에서 통상 인용되는 공식 출처. 인용 가능 |
| 슬립캐스팅 흡수 이론(Darcy 기반, 원 논문) | D.S. Adcock, I.C. McDowall, "The Mechanism of Filter Pressing and Slip Casting", J. Am. Ceram. Soc., 40(10), 355–362 (1957), doi:10.1111/j.1151-2916.1957.tb12552.x | 학술지(J. Am. Ceram. Soc.) 정식 논문, 서지사항 확인 완료 — 인용 가능 |
| 슬립캐스팅 흡수 이론(후속 정식화) | W.J. Tiller, C.P. Tsai, "Theory of Filtration of Ceramics: I, Slip Casting", J. Am. Ceram. Soc., 69(12), 882–887 (1986), doi:10.1111/j.1151-2916.1986.tb07388.x | 학술지 논문, 인용 가능. Adcock–McDowall(1957) 이론을 정식화·확장 |
| 조성 단독 예측의 한계(본 프로젝트 02절 진단의 근거) | "GlazyBench: A Benchmark for Ceramic Glaze Property Prediction and Image Generation", arXiv:2605.06641 | arXiv 공개 논문, 인용 가능. 이미 `AICE_DIRECTION_PLAN.md` 7.5절에서 인용 중 — 유지 |
| RAG(레시피 탐색 계층의 방법론적 근거) | P. Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks", NeurIPS 2020, arXiv:2005.11401 | 저명 학회 발표 논문, 인용 가능 |
| Optimization Model(폐루프 개인화 보정의 방법론적 근거) | P.I. Frazier, "A Tutorial on Bayesian Optimization", arXiv:1807.02811 (2018) | arXiv 공개 논문, 인용 가능 |
| 표면적 계산(파푸스·굴딘 정리) | 고전 기하 정리(공개 수학 지식, 특정 저자 논문 인용 불필요) | 공용 지식 — 인용 표기만, 저작권 이슈 없음 |

## 2 · 특허 (참고용 — caveat 필수, `AICE_DIRECTION_PLAN.md` 7절과 동일)

특허는 실시가능성·권리범위가 국가·청구항별로 다르고 변리사 재확인이
필요하므로, 계산식이나 설계의 **1차 근거로 쓰지 않는다.** 방향성 참고로만
남긴다.

| 주제 | 공보번호 | 한계 |
|---|---|---|
| 목표 색상 기반 레시피·색상 예측 | TW202533100A / TWI857914B | 재사용 가능한 대규모 데이터셋 없음, 대만 등록만 확인 |
| 결과 피드백 기반 소성곡선 최적화 | CN108931144A | 중국 출원만 확인, 실측 표본 없음 |
| 유약층 두께·소성 결과 관계 | US20240360039A1 | 특정 위생도기·이중유약 조건에 한정, 일반화 불가 |
| 도포 전후 측정 기반 두께 제어 | DE3320160C2 | 광학 산업장비 대상, 본 프로젝트의 무게 기반 계산식을 직접 뒷받침하지 않음 |

## 3 · 비특허 참고자료

- Glazy 공식 도움말 — 레시피·소성 스케줄 저장 구조 참고: https://help.glazy.org/guide/kiln-schedules
- Glazy 공개 데이터 — CC BY-NC-SA 4.0, 수치·화학분석만 활용, 이미지·설명은 링크 참조

## 4 · 확인이 더 필요한 항목

- ~~슬립캐스팅 논문의 정확한 서지사항~~ → 확정 완료(§1, Adcock & McDowall 1957 / Tiller & Tsai 1986).
- Orton cone 열일(heat work)–Arrhenius 등가식의 단일 원 논문은 확인하지
  못했다. 요업공학 분야에서 통상적으로 쓰이는 관계식이며 Edward Orton Jr.
  Ceramic Foundation의 공개 자료(https://www.ortonceramic.com/pyrometric-cones-faq,
  https://help.glazy.org/concepts/temperature)가 2차 출처로 존재한다. 원
  논문이 특정되기 전까지는 "요업공학 표준 관계식(2차 출처)"으로 표기하고
  1차 논문으로 단정하지 않는다.

자료 확인일: 2026-09-17.
