import type { PiAuth } from "./pi-config.js";
import type { ProxyModel } from "./models.js";

export function renderUI(auth: PiAuth, models: ProxyModel[], port: number, isActive: boolean): string {
  const providers = Object.entries(auth).map(([id, entry]) => {
    const expired = entry.type === "oauth" && Date.now() >= entry.expires - 60_000;
    const expireDate = entry.type === "oauth" ? new Date(entry.expires).toLocaleString("ko-KR") : "N/A";
    return { id, expired, expireDate, type: entry.type };
  });

  const byProvider: Record<string, ProxyModel[]> = {};
  for (const m of models) {
    if (!byProvider[m.provider]) byProvider[m.provider] = [];
    byProvider[m.provider].push(m);
  }

  const providerRows = providers.map((p) => `
    <tr class="${p.expired ? "expired" : "ok"}">
      <td><span class="dot ${p.expired ? "red" : "green"}"></span> ${p.id}</td>
      <td>${p.type}</td>
      <td>${p.expired ? `<b>만료됨</b> (Pi에서 재로그인 필요)` : `유효 (${p.expireDate}까지)`}</td>
    </tr>`).join("");

  const modelSections = Object.entries(byProvider).map(([prov, ms]) => {
    const provAuth = auth[prov];
    const expired = provAuth?.type === "oauth" && Date.now() >= provAuth.expires - 60_000;
    const pills = ms.map((m) => `<span class="pill ${expired ? "dim" : ""}">${m.id}</span>`).join(" ");
    return `<div class="model-group">
      <h3>${prov} <span class="badge ${expired ? "badge-red" : "badge-green"}">${expired ? "만료" : "활성"}</span></h3>
      <div>${pills}</div>
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>end-pi</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 2rem; }
    h1 { font-size: 1.4rem; font-weight: 600; margin-bottom: 0.25rem; }
    .subtitle { color: #666; font-size: 0.85rem; margin-bottom: 2rem; }
    .status-bar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 2rem; padding: 0.75rem 1rem; background: #1a1a1a; border-radius: 8px; border: 1px solid #2a2a2a; }
    .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }
    .green { background: #22c55e; }
    .red { background: #ef4444; }
    h2 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.75rem; color: #aaa; text-transform: uppercase; letter-spacing: 0.05em; font-size: 0.75rem; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
    td { padding: 0.6rem 0.75rem; border-bottom: 1px solid #1e1e1e; font-size: 0.875rem; }
    tr.expired { color: #888; }
    tr.ok { color: #e0e0e0; }
    .model-group { margin-bottom: 1.25rem; background: #1a1a1a; border-radius: 8px; padding: 1rem; border: 1px solid #2a2a2a; }
    .model-group h3 { font-size: 0.875rem; margin-bottom: 0.6rem; color: #ccc; }
    .pill { display: inline-block; background: #2a2a2a; border-radius: 4px; padding: 2px 8px; font-size: 0.78rem; margin: 2px; font-family: monospace; color: #ddd; }
    .pill.dim { opacity: 0.4; }
    .badge { font-size: 0.65rem; padding: 1px 6px; border-radius: 3px; font-weight: 600; vertical-align: middle; margin-left: 6px; }
    .badge-green { background: #14532d; color: #4ade80; }
    .badge-red { background: #450a0a; color: #f87171; }
    .actions { display: flex; gap: 0.75rem; margin-top: 2rem; }
    button { padding: 0.5rem 1.25rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
    .btn-restore { background: #2a1a1a; color: #f87171; border: 1px solid #3a1a1a; }
    .btn-restore:hover { background: #3a1a1a; }
    .btn-refresh { background: #1a2a1a; color: #4ade80; border: 1px solid #1a3a1a; }
    .btn-refresh:hover { background: #1a3a1a; }
    .endpoint { font-family: monospace; font-size: 0.8rem; color: #888; }
    .info { margin-top: 1rem; padding: 0.75rem 1rem; background: #111827; border-radius: 6px; border-left: 3px solid #3b82f6; font-size: 0.82rem; color: #93c5fd; }
  </style>
</head>
<body>
  <h1>end-pi</h1>
  <p class="subtitle">Codex Desktop ↔ Pi Provider Proxy</p>

  <div class="status-bar">
    <span class="dot ${isActive ? "green" : "red"}"></span>
    <strong>${isActive ? "프록시 활성" : "프록시 비활성"}</strong>
    <span class="endpoint">http://localhost:${port}/v1</span>
  </div>

  <div class="info">
    Codex Desktop 모델 선택에서 스크롤하면 모든 모델 표시됩니다.
    Claude, Gemini, GPT 등 아래 전체 목록 참고.
  </div>

  <h2>Provider 상태</h2>
  <table>
    <tr style="color:#666; font-size:0.75rem;">
      <td>Provider</td><td>인증 방식</td><td>상태</td>
    </tr>
    ${providerRows}
  </table>

  <h2>사용 가능한 모델 (${models.length}개)</h2>
  ${modelSections}

  <div class="actions">
    <button class="btn-refresh" onclick="location.reload()">새로고침</button>
    <button class="btn-restore" onclick="if(confirm('Codex를 순정으로 복구하시겠습니까?')) fetch('/api/restore', {method:'POST'}).then(()=>location.reload())">순정 복구</button>
  </div>

  <script>setTimeout(() => location.reload(), 30000)</script>
</body>
</html>`;
}
