// for Codex: Setup Hedgey Phase II runtime must follow data/onboarding-hedgey-phase1.json and PHASE_ONBOARDING_HEDGEY_PLAN.md first.
// for Codex: reuse existing Hitomi clippy components (full+compact bubbles) and only add chips, per contract. - Decentricity

function safeText(value){
  return String(value || "")
}

function escapeHtml(value){
  return safeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function normalizeInput(text){
  return safeText(text)
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function nowMs(){ return Date.now() }

function randomPick(list){
  const arr = Array.isArray(list) ? list : []
  if (!arr.length) return ""
  return arr[Math.floor(Math.random() * arr.length)]
}

function applyTokens(template, tokens = {}){
  let out = safeText(template)
  for (const [k, v] of Object.entries(tokens || {})) {
    out = out.replaceAll(`{${k}}`, safeText(v))
  }
  return out
}

function extractErrorCode(text){
  const src = safeText(text)
  const direct = /(?:code\s*[=:]?\s*|\()\s*(\d{3,4})\s*(?:\)|$)/i.exec(src)
  if (direct?.[1]) return direct[1]
  const status = /\b(\d{3})\b/.exec(src)
  return status?.[1] || ""
}

export async function createOnboardingHedgey({
  jsonUrl = "data/onboarding-hedgey-phase1.json",
  openUrl,
  onIntentAction,
  onEmitAction,
  getUiContext,
} = {}){
  let spec = null
  let active = false
  let currentState = "vault_intro"
  let messages = []
  let seenHintTimes = new Map()
  let lastAutoAt = 0
  let lastTypingAt = 0

  const memory = {
    providerKeyDetected: {
      openai: false,
      anthropic: false,
      xai: false,
      zai: false,
      ollama: false,
    },
  }

  async function load(){
    if (spec) return spec
    const resp = await fetch(jsonUrl, { cache: "no-store" })
    if (!resp.ok) throw new Error(`onboarding json load failed (${resp.status})`)
    spec = await resp.json()
    currentState = safeText(spec?.stateMachine?.initialState || "vault_intro")
    return spec
  }

  function isActive(){ return active }

  function setActive(next){
    active = !!next
    if (!active) return
    if (!messages.length) {
      const m1 = emitByKey("welcome_vault", { auto: true, bypassCooldown: true })
      if (m1) addMessage(`<strong>Hitomi:</strong> ${m1}`, { source: "guide", auto: true })
      const m2 = emitByKey("explain_vault_choices", { auto: true, bypassCooldown: true })
      if (m2) addMessage(`<strong>Hitomi:</strong> ${m2}`, { source: "guide", auto: true })
    }
  }

  function clearMessages(){ messages = [] }

  function getState(){ return currentState }

  function addMessage(html, { source = "guide", auto = false } = {}){
    messages.push({
      source,
      auto,
      html: safeText(html),
      createdAt: nowMs(),
    })
    if (messages.length > 48) messages = messages.slice(-48)
  }

  function getMessages(){
    return messages.slice()
  }

  function canEmitAuto({ dedupeKey = "", bypassCooldown = false } = {}){
    if (!active) return false
    const cfg = spec?.cooldownAndDedupe || {}
    const cooldownMs = Number(cfg.autoHintCooldownMs || 2600)
    const typingQuietWindowMs = Number(cfg.typingQuietWindowMs || 1400)
    const dedupeWindowMs = Number(cfg.dedupeWindowMs || 180000)
    const t = nowMs()
    if (!bypassCooldown) {
      if (t - lastAutoAt < cooldownMs) return false
      if (t - lastTypingAt < typingQuietWindowMs) return false
    }
    if (!dedupeKey) return true
    const seenAt = Number(seenHintTimes.get(dedupeKey) || 0)
    if (t - seenAt < dedupeWindowMs) return false
    return true
  }

  function markAutoEmission(dedupeKey = ""){
    lastAutoAt = nowMs()
    if (dedupeKey) seenHintTimes.set(dedupeKey, lastAutoAt)
  }

  function messageKeyFromTrigger(triggerId){
    const row = (spec?.autonomousTriggers || []).find(item => item.id === triggerId)
    return row || null
  }

  function providerLabel(provider){
    const p = safeText(provider).toLowerCase()
    if (p === "openai") return "OpenAI"
    if (p === "anthropic") return "Anthropic"
    if (p === "xai") return "xAI (Grok)"
    if (p === "zai") return "z.ai"
    if (p === "ollama") return "Ollama"
    return provider || "provider"
  }

  function allowedLink(url){
    const next = safeText(url).trim()
    if (!next) return false
    if (next === "https://platform.openai.com/api-keys") return true
    if (next === "https://platform.claude.com/settings/keys") return true
    if (next === "https://console.x.ai") return true
    if (next === "https://platform.z.ai") return true
    return false
  }

  function sanitizeTemplateHtml(input){
    const text = safeText(input)
    const placeholder = "__ANCHOR_PLACEHOLDER__"
    const anchors = []
    const replaced = text.replace(/<a\s+href=\"([^\"]+)\"\s+data-open-url=\"([^\"]+)\">([\s\S]*?)<\/a>/gi, (_, href, dataOpenUrl, label) => {
      if (href !== dataOpenUrl) return escapeHtml(label)
      if (!allowedLink(href)) return escapeHtml(label)
      const idx = anchors.length
      anchors.push({ href, label })
      return `${placeholder}${idx}__`
    })

    let out = escapeHtml(replaced)
    anchors.forEach((a, idx) => {
      const needle = `${placeholder}${idx}__`
      const html = `<a href=\"${escapeHtml(a.href)}\" data-open-url=\"${escapeHtml(a.href)}\">${escapeHtml(a.label)}</a>`
      out = out.replace(needle, html)
    })
    return out
  }

  function emitByKey(key, { auto = false, dedupeKey = "", bypassCooldown = false, tokens = {} } = {}){
    const templates = spec?.messageTemplates?.[key]
    if (!templates || !templates.length) return ""
    if (auto && !canEmitAuto({ dedupeKey, bypassCooldown })) return ""
    const raw = applyTokens(randomPick(templates), tokens)
    const html = sanitizeTemplateHtml(raw)
    if (auto) markAutoEmission(dedupeKey)
    return html
  }

  function emitText(text){
    const html = sanitizeTemplateHtml(text)
    addMessage(html, { source: "guide", auto: false })
    return html
  }

  function transitionTo(nextState, { autoEnter = true } = {}){
    if (!nextState || currentState === nextState) return
    currentState = nextState
    if (!autoEnter) return
    const stateCfg = spec?.stateMachine?.states?.[currentState]
    const enters = Array.isArray(stateCfg?.autoOnEnter) ? stateCfg.autoOnEnter : []
    enters.forEach((k, idx) => {
      const txt = emitByKey(k, { auto: true, dedupeKey: `enter:${currentState}:${k}`, bypassCooldown: idx === 0 })
      if (!txt) return
      addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: true })
    })
  }

  function findIntent(text){
    const norm = normalizeInput(text)
    if (!norm) return ""
    let best = { id: "", score: -1 }
    for (const row of (spec?.nlu?.intents || [])) {
      const id = safeText(row?.id)
      const p = Number(row?.priority || 0)
      const keys = Array.isArray(row?.keywords) ? row.keywords : []
      let matched = false
      for (const k of keys) {
        const kn = normalizeInput(k)
        if (!kn) continue
        if (norm.includes(kn)) {
          matched = true
          break
        }
      }
      if (!matched) continue
      if (p > best.score) best = { id, score: p }
    }
    return best.id || ""
  }

  function resolveTransitionByIntent(intent){
    if (!intent) return null
    const rows = Array.isArray(spec?.stateMachine?.transitions) ? spec.stateMachine.transitions : []
    return rows.find(t => safeText(t.from) === currentState && safeText(t.onIntent) === intent) || null
  }

  function resolveTransitionByTrigger(trigger){
    if (!trigger) return null
    const rows = Array.isArray(spec?.stateMachine?.transitions) ? spec.stateMachine.transitions : []
    return rows.find(t => safeText(t.from) === currentState && safeText(t.onTrigger) === trigger) || null
  }

  function contextForTokens(payload = {}){
    const provider = safeText(payload.provider || "")
    return {
      providerLabel: providerLabel(provider),
      provider,
      code: safeText(payload.code || payload.errorCode || extractErrorCode(payload.error || "") || "unknown"),
      model: safeText(payload.model || ""),
    }
  }

  function recordTyping(){
    lastTypingAt = nowMs()
  }

  function processIntent(intent){
    if (!intent) return ""
    if (intent === "vault_risk") {
      const txt = emitByKey("vault_risk_answer")
      if (txt) {
        addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
        return txt
      }
      const fallback = randomPick(spec?.nlu?.offTopicPolicy?.fallbackPool || [])
      return emitText(`<strong>Hitomi:</strong> ${escapeHtml(fallback)}`)
    }
    if (intent === "locality") {
      const txt = emitByKey("locality_answer")
      if (!txt) return ""
      addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
      return txt
    }
    if (intent === "model_help") {
      const txt = emitByKey("model_help_answer")
      if (!txt) return ""
      addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
      return txt
    }
    if (intent === "validation_help") {
      const txt = emitByKey("validation_help_answer")
      if (!txt) return ""
      addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
      return txt
    }
    if (intent === "progress_next") {
      const txt = emitByKey("progress_next_answer")
      if (!txt) return ""
      addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
      return txt
    }

    const t = resolveTransitionByIntent(intent)
    if (t?.to) {
      transitionTo(t.to)
      if (onIntentAction) onIntentAction(intent, { from: safeText(t.from), to: safeText(t.to) })
      return "ok"
    }

    const fallback = randomPick(spec?.nlu?.offTopicPolicy?.fallbackPool || [])
    return emitText(`<strong>Hitomi:</strong> ${escapeHtml(fallback)}`)
  }

  async function handleUserInput(text){
    if (!active) return ""
    recordTyping()
    const userHtml = `<strong>User:</strong> ${escapeHtml(text)}`
    addMessage(userHtml, { source: "user", auto: false })
    const intent = findIntent(text)

    if (!intent) {
      const fallback = randomPick(spec?.nlu?.offTopicPolicy?.fallbackPool || [])
      return emitText(`<strong>Hitomi:</strong> ${escapeHtml(fallback)}`)
    }
    return processIntent(intent)
  }

  function shouldShowPill(pill, uiCtx = {}){
    const cond = safeText(pill?.visibleWhen)
    if (!cond) return true
    const m = /^providerInputHasText:([a-z0-9_-]+)$/i.exec(cond)
    if (m?.[1]) {
      const p = m[1].toLowerCase()
      return Boolean(uiCtx?.providerInputs?.[p])
    }
    return true
  }

  function getPills(){
    const statePills = spec?.pills?.[currentState] || {}
    const uiCtx = typeof getUiContext === "function" ? (getUiContext() || {}) : {}
    const mapPill = (row) => ({
      id: safeText(row.id),
      label: safeText(row.label),
      intent: safeText(row.intent),
      emitMessageKey: safeText(row.emitMessageKey),
      emitMessage: safeText(row.emitMessage),
      emitAction: safeText(row.emitAction),
    })
    const primary = (Array.isArray(statePills.primary) ? statePills.primary : [])
      .filter(row => shouldShowPill(row, uiCtx))
      .slice(0, 5)
      .map(mapPill)
    const secondary = (Array.isArray(statePills.secondary) ? statePills.secondary : [])
      .filter(row => shouldShowPill(row, uiCtx))
      .slice(0, 5)
      .map(mapPill)
    return { primary, secondary }
  }

  async function handlePill(pillId){
    const groups = getPills()
    const row = [...groups.primary, ...groups.secondary].find(x => x.id === pillId)
    if (!row) return ""
    recordTyping()
    addMessage(`<strong>User:</strong> ${escapeHtml(row.label)}`, { source: "user", auto: false })

    if (row.emitAction && onEmitAction) {
      onEmitAction(row.emitAction)
      return ""
    }
    if (row.emitMessageKey) {
      const txt = emitByKey(row.emitMessageKey)
      if (txt) addMessage(`<strong>Hitomi:</strong> ${txt}`, { source: "guide", auto: false })
      return txt
    }
    if (row.emitMessage) {
      addMessage(`<strong>Hitomi:</strong> ${sanitizeTemplateHtml(row.emitMessage)}`, { source: "guide", auto: false })
      return row.emitMessage
    }
    if (row.intent) {
      return processIntent(row.intent)
    }
    return ""
  }

  function getRenderedHtml(){
    const tail = messages.slice(-16)
    if (!tail.length) return `<div class=\"clippy-line\">No setup messages yet.</div>`
    return tail.map(msg => `<div class=\"clippy-line\">${msg.html}</div>`).join("")
  }

  function handleTrigger(triggerId, payload = {}){
    if (!active) return
    const tr = messageKeyFromTrigger(triggerId)
    if (triggerId === "vault_skip_clicked") {
      currentState = "apis_intro"
    } else {
      const sectionState = {
        provider_section_opened_openai: "apis_openai",
        provider_section_opened_anthropic: "apis_anthropic",
        provider_section_opened_xai: "apis_xai",
        provider_section_opened_zai: "apis_zai",
        provider_section_opened_ollama: "apis_ollama",
      }[triggerId]
      if (sectionState) currentState = sectionState
    }
    const transition = resolveTransitionByTrigger(triggerId)
    if (transition?.to) transitionTo(transition.to)
    if (!tr) return
    const tokens = contextForTokens(payload)
    const keyTemplate = safeText(tr.dedupeKey || "")
    const dedupeKey = keyTemplate
      .replaceAll("{provider}", tokens.provider || "")
      .replaceAll("{model}", tokens.model || "")
      .replaceAll("{code}", tokens.code || "")
    const html = emitByKey(tr.messageKey, { auto: true, dedupeKey, tokens })
    if (!html) return
    addMessage(`<strong>Hitomi:</strong> ${html}`, { source: "guide", auto: true })
  }

  function handleProviderInputStarted(provider){
    const p = safeText(provider).toLowerCase()
    if (!p || memory.providerKeyDetected[p]) return
    memory.providerKeyDetected[p] = true
    handleTrigger("provider_key_input_started", { provider })
  }

  function onLinkClick(url){
    const next = safeText(url).trim()
    if (!next || !allowedLink(next)) return false
    if (typeof openUrl === "function") {
      openUrl(next)
      return true
    }
    return false
  }

  await load()

  return {
    isActive,
    setActive,
    getState,
    getMessages,
    getRenderedHtml,
    getPills,
    handleUserInput,
    handlePill,
    handleTrigger,
    handleProviderInputStarted,
    onLinkClick,
    clearMessages,
    recordTyping,
  }
}
