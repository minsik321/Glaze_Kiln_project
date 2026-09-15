import { loadEnv } from "vite";
const env = loadEnv("development", process.cwd(), "VITE_");
const url = env.VITE_SUPABASE_URL?.trim();
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
function fail(message) { console.error(message); process.exitCode = 1; }
if (!url || !key) {
  fail("Supabase URL/publishable key가 설정되지 않았습니다. .env.local을 확인하세요.");
} else {
  let valid = key.startsWith("sb_publishable_");
  if (!valid) {
    try { valid = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role === "anon"; } catch {}
  }
  if (!valid) {
    fail("브라우저용 publishable 또는 legacy anon 키만 사용할 수 있습니다.");
  } else {
    for (const endpoint of ["/auth/v1/settings", "/rest/v1/profiles?select=id&limit=0", "/rest/v1/work_records?select=id&limit=0"]) {
      const label = endpoint.split("?")[0];
      try {
        const response = await fetch(new URL(endpoint, url), { headers: { apikey: key }, signal: AbortSignal.timeout(15000) });
        const data = await response.json();
        if (label === "/auth/v1/settings") {
          if (response.ok && data.external?.email) console.log("PASS: 인증 API 연결 및 이메일 인증 활성화");
          else fail(`FAIL: 인증 설정 확인 필요 (HTTP ${response.status})`);
        } else if ([401,403].includes(response.status) && data.code === "42501") {
          console.log(`PASS: ${label} 접근 가능, 익명 조회 차단 확인`);
        } else {
          fail(`FAIL: ${label} 스키마/권한 확인 필요 (HTTP ${response.status}, code ${data.code ?? "none"})`);
        }
      } catch (error) {
        fail(`FAIL: ${label} 요청 실패 (${error.cause?.code ?? error.name}). 네트워크와 URL을 확인하세요.`);
      }
    }
    if (!process.exitCode) console.log("연결 검사 완료. 로그인 계정의 CRUD/이메일 발송은 별도 검증이 필요합니다.");
  }
}
