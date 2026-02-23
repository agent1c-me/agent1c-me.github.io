export const XAI_BASE_URL_DEFAULT = "https://api.x.ai/v1"
export const ZAI_BASE_URL_DEFAULT = "https://api.z.ai/api/coding/paas/v4"

export function normalizeOllamaBaseUrl(value){
  const source = String(value || "").trim()
  if (!source) return ""
  return source.replace(/\/+$/, "")
}

function chatMessagesPayload(systemPrompt, messages){
  return [{ role: "system", content: systemPrompt }, ...(messages || []).map(m => ({ role: m.role, content: m.content }))]
}

export async function openAiChat({ apiKey, model, temperature, systemPrompt, messages }){
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: chatMessagesPayload(systemPrompt, messages),
    }),
  })
  if (!response.ok) throw new Error(`OpenAI call failed (${response.status})`)
  const json = await response.json()
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error("OpenAI returned no message.")
  return String(text).trim()
}

export async function anthropicChat({ apiKey, model, temperature, systemPrompt, messages }){
  const anthroMessages = (messages || []).map(message => ({
    role: message?.role === "assistant" ? "assistant" : "user",
    content: String(message?.content || ""),
  }))
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      temperature,
      system: systemPrompt,
      messages: anthroMessages,
    }),
  })
  if (!response.ok) throw new Error(`Anthropic call failed (${response.status})`)
  const json = await response.json()
  const text = (json?.content || [])
    .filter(part => part?.type === "text")
    .map(part => String(part?.text || ""))
    .join("\n")
    .trim()
  if (!text) throw new Error("Anthropic returned no message.")
  return text
}

export function makeXaiChat({
  isCloudAuthHost,
  getCloudAuthAccessToken,
  getSupabaseConfig,
  cloudFunctionFallback,
  applyCloudUsageToUi,
  refreshCloudCredits,
  xaiBaseUrl = XAI_BASE_URL_DEFAULT,
}){
  return async function xaiChat({ apiKey, model, temperature, systemPrompt, messages }){
    const useCloudManagedXai = isCloudAuthHost()
    if (useCloudManagedXai) {
      const { supabaseUrl, anonKey } = getSupabaseConfig()
      const functionUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/xai-chat` : cloudFunctionFallback
      const accessToken = await getCloudAuthAccessToken()
      if (!accessToken) throw new Error("Cloud auth token missing. Please sign in again.")
      const headers = { "Content-Type": "application/json" }
      if (anonKey) headers.apikey = anonKey
      headers.Authorization = `Bearer ${accessToken}`
      const response = await fetch(functionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature,
          messages: chatMessagesPayload(systemPrompt, messages),
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        const providerMsg = String(json?.error?.message || json?.msg || json?.error || "").trim()
        const providerCode = String(json?.error?.code || json?.error_code || "").trim()
        throw new Error(`Cloud provider call failed (${response.status})${providerCode ? ` code=${providerCode}` : ""}${providerMsg ? `: ${providerMsg}` : ""}`)
      }
      if (json?.agent1c_usage) applyCloudUsageToUi?.(json.agent1c_usage)
      else refreshCloudCredits?.().catch(() => {})
      const text = json?.choices?.[0]?.message?.content
      if (!text) throw new Error("Cloud provider returned no message.")
      return String(text).trim()
    }
    const response = await fetch(`${xaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: chatMessagesPayload(systemPrompt, messages),
      }),
    })
    if (!response.ok) throw new Error(`Cloud provider call failed (${response.status})`)
    const json = await response.json()
    const text = json?.choices?.[0]?.message?.content
    if (!text) throw new Error("Cloud provider returned no message.")
    return String(text).trim()
  }
}

export async function zaiChat({ apiKey, model, temperature, systemPrompt, messages, zaiBaseUrl = ZAI_BASE_URL_DEFAULT }){
  const response = await fetch(`${zaiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: chatMessagesPayload(systemPrompt, messages),
    }),
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const providerMsg = String(json?.error?.message || "").trim()
    const providerCode = String(json?.error?.code || "").trim()
    throw new Error(`z.ai call failed (${response.status})${providerCode ? ` code=${providerCode}` : ""}${providerMsg ? `: ${providerMsg}` : ""}`)
  }
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error("z.ai returned no message.")
  return String(text).trim()
}

export async function ollamaChat({ baseUrl, model, temperature, systemPrompt, messages }){
  const endpoint = `${normalizeOllamaBaseUrl(baseUrl)}/api/chat`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature },
      messages: chatMessagesPayload(systemPrompt, messages),
    }),
  })
  if (!response.ok) throw new Error(`Ollama call failed (${response.status})`)
  const json = await response.json()
  const text = json?.message?.content
  if (!text) throw new Error("Ollama returned no message.")
  return String(text).trim()
}

export async function listOpenAiModels(apiKey){
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) throw new Error(`OpenAI models failed (${response.status})`)
  const json = await response.json()
  const ids = (json?.data || []).map(item => item.id).filter(Boolean).sort((a, b) => a.localeCompare(b))
  if (!ids.length) throw new Error("No models returned.")
  return ids
}
