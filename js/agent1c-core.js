export function normalizeUserName(value){
  const raw = String(value || "").trim().replace(/\s+/g, " ")
  if (!raw) return ""
  return raw.slice(0, 48).replace(/[\r\n\t]/g, " ").trim()
}

export function isIOSLikeDevice(){
  try {
    const ua = String(navigator.userAgent || "")
    const platform = String(navigator.platform || "")
    const touchPoints = Number(navigator.maxTouchPoints || 0)
    return /iPad|iPhone|iPod/i.test(ua)
      || (/Mac/i.test(platform) && touchPoints > 1)
  } catch {
    return false
  }
}

export function enforceNoZoomOnIOS(){
  if (!isIOSLikeDevice()) return
  const block = (e) => {
    e.preventDefault()
  }
  document.addEventListener("gesturestart", block, { passive: false })
  document.addEventListener("gesturechange", block, { passive: false })
  document.addEventListener("gestureend", block, { passive: false })
  document.addEventListener("touchmove", (e) => {
    if (e.touches && e.touches.length > 1) e.preventDefault()
  }, { passive: false })
}

export function utcDayKey(ts = Date.now()){
  return new Date(ts).toISOString().slice(0, 10)
}

export function isTokenLimitError(err){
  const text = String(err instanceof Error ? err.message : err || "").toLowerCase()
  if (!text) return false
  if (text.includes("limit_reached")) return true
  if (text.includes("daily token limit reached")) return true
  if (text.includes("code=limit_reached")) return true
  if (text.includes("429") && (text.includes("limit") || text.includes("token"))) return true
  return false
}

export function escapeHtml(value){
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function formatNumber(value){
  return Number(value || 0).toLocaleString("en-US")
}
