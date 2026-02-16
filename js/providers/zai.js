const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"

function buildError(status, payload){
  const providerMsg = String(payload?.error?.message || "").trim()
  const providerCode = String(payload?.error?.code || "").trim()
  return new Error(
    `z.ai call failed (${status})${providerCode ? ` code=${providerCode}` : ""}${providerMsg ? `: ${providerMsg}` : ""}`
  )
}

export async function zaiChat({ apiKey, model, temperature, systemPrompt, messages }){
  const payload = {
    model,
    temperature,
    messages: [{ role: "system", content: systemPrompt }, ...(messages || []).map(m => ({ role: m.role, content: m.content }))],
  }
  const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) throw buildError(response.status, json)
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error("z.ai returned no message.")
  return String(text).trim()
}
