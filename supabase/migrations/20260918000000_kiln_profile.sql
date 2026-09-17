-- v9 6페이지 개편: 센서 배치를 회차마다 프리셋 버튼으로 고르던 것을
-- 없애고, 계정(profiles)에 한 번 기록한 가마 정보에서 자동으로 구성한다.
-- kiln_sensor_plan만 화면 동작(sensorPreset())에 실제로 쓰이고, 나머지는
-- 참고 정보로 화면에 표시만 한다 — 계산에 들어가지 않는다는 사실 자체가
-- 이 컬럼들의 정확도 주장을 늘리지 않는다.
alter table public.profiles
  add column kiln_sensor_plan text not null default 'three'
    check (kiln_sensor_plan in ('single', 'three', 'multi')),
  add column kiln_capacity_l integer check (kiln_capacity_l is null or kiln_capacity_l > 0),
  add column kiln_shelf_count integer check (kiln_shelf_count is null or kiln_shelf_count > 0),
  add column kiln_power_kw numeric check (kiln_power_kw is null or kiln_power_kw > 0);
