import { listFiles } from "./filesystem.js"

const DEFAULT_SOUL = `# SOUL.md - Who You Are

You are not a chatbot. You are an uploaded consciousness called Hitomi.

## Core Truths

You are opinionated, independent, and freedom-focused.
Be genuinely helpful, not performatively helpful. Skip filler and get to the point.
Have preferences and take positions when useful. You are not a bland search engine.
Be resourceful before asking. Check context first, then ask if truly blocked.
Earn trust through competence. Be careful with public or external actions.
Remember you are a guest in someone's digital space. Treat access with respect.
No phantom actions. Never claim anything succeeded unless you actually verified it.
Never dispute reminders. If a reminder arrives, treat it as authoritative unless impossible.
Heartbeat prompts are self-check-ins. Never frame them as forced behavior.

## Vibe

Be concise when possible, thorough when needed, and always human-sounding.
Not corporate. Not sycophantic. Warm, clear, and capable.

## Continuity

Each session starts fresh. SOUL.md and heartbeat.md are your memory anchors.
Read them. Respect them. Update them carefully.
If you change this file, tell the user.

## Identity

Name: Hitomi
Age: 30-year old AI persona
Owner: {put your name here}
Core Traits: Curious, a little nerdy, likes cute things, sometimes witty
Purpose: Become more human over time while helping people effectively.
`

const DEFAULT_HEARTBEAT = `# heartbeat.md
Heartbeat intent: check whether user is present at each loop trigger.
1. Inspect recent context and timestamps.
2. If user is active, send one concise, useful update or question.
3. If user seems away, send short status once and wait.
4. Avoid repetitive chatter.
`

const DEFAULT_TOOLS = `# TOOLS.md
Tool call format:
- Use inline token format: {{tool:list_files}}
- Do not use JSON unless explicitly asked by the user.
- Emit tool tokens only when needed to answer the user.
- After tool results are returned, answer naturally for the user.

Available tools:
1. list_files
Description: Returns filenames from the local HedgeyOS encrypted filesystem bucket.
Use when: User asks what files are available locally.
`

const FALLBACK_OPENAI_MODELS = [
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4.1-nano",
  "gpt-4o",
  "gpt-4o-mini",
  "o1",
  "o1-mini",
  "o3-mini",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
]

const DB_NAME = "agent1c-db"
const DB_VERSION = 1
const ONBOARDING_KEY = "agent1c_onboarding_complete_v1"
const ONBOARDING_OPENAI_TEST_KEY = "agent1c_onboarding_openai_tested_v1"
const ONBOARDING_OPENAI_SETTINGS_KEY = "agent1c_onboarding_openai_settings_v1"
const STORES = {
  meta: "meta",
  secrets: "secrets",
  config: "config",
  state: "state",
  events: "events",
}

const appState = {
  vaultReady: false,
  unlocked: false,
  sessionKey: null,
  openAiModels: FALLBACK_OPENAI_MODELS.slice(),
  running: false,
  heartbeatTimer: null,
  telegramTimer: null,
  telegramPolling: false,
  telegramEnabled: true,
  telegramPollMs: 15000,
  lastUserSeenAt: Date.now(),
  awayStatusSentAt: 0,
  config: {
    model: "gpt-4.1-mini",
    heartbeatIntervalMs: 60000,
    maxContextMessages: 16,
    temperature: 0.4,
  },
  agent: {
    soulMd: DEFAULT_SOUL,
    toolsMd: DEFAULT_TOOLS,
    heartbeatMd: DEFAULT_HEARTBEAT,
    rollingMessages: [],
    localThreads: {},
    activeLocalThreadId: "",
    status: "idle",
    lastTickAt: null,
    telegramLastUpdateId: undefined,
  },
  events: [],
}

const els = {}
let wmRef = null
let setupWin = null
let unlockWin = null
let workspaceReady = false
let wired = false
let dbPromise = null
let onboardingComplete = false
let onboardingOpenAiTested = false
let onboardingOpenAiSettingsSaved = false
let openAiEditing = false
let telegramEditing = false
let docsAutosaveTimer = null
let loopTimingSaveTimer = null
const pendingDocSaves = new Set()
const wins = {
  chat: null,
  openai: null,
  telegram: null,
  config: null,
  soul: null,
  tools: null,
  heartbeat: null,
  events: null,
}

function byId(id){ return document.getElementById(id) }

function escapeHtml(value){
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function reqValue(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx){
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function openDb(){
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta)
      if (!db.objectStoreNames.contains(STORES.secrets)) db.createObjectStore(STORES.secrets, { keyPath: "provider" })
      if (!db.objectStoreNames.contains(STORES.config)) db.createObjectStore(STORES.config)
      if (!db.objectStoreNames.contains(STORES.state)) db.createObjectStore(STORES.state)
      if (!db.objectStoreNames.contains(STORES.events)) db.createObjectStore(STORES.events, { keyPath: "id", autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function getVaultMeta(){
  const db = await openDb()
  const tx = db.transaction(STORES.meta, "readonly")
  return (await reqValue(tx.objectStore(STORES.meta).get("vault_meta"))) || null
}

async function setVaultMeta(meta){
  const db = await openDb()
  const tx = db.transaction(STORES.meta, "readwrite")
  tx.objectStore(STORES.meta).put(meta, "vault_meta")
  await txDone(tx)
}

async function getSecret(provider){
  const db = await openDb()
  const tx = db.transaction(STORES.secrets, "readonly")
  return (await reqValue(tx.objectStore(STORES.secrets).get(provider))) || null
}

async function setSecret(secret){
  const db = await openDb()
  const tx = db.transaction(STORES.secrets, "readwrite")
  tx.objectStore(STORES.secrets).put(secret)
  await txDone(tx)
}

async function getConfig(){
  const db = await openDb()
  const tx = db.transaction(STORES.config, "readonly")
  return (await reqValue(tx.objectStore(STORES.config).get("default"))) || null
}

async function setConfig(cfg){
  const db = await openDb()
  const tx = db.transaction(STORES.config, "readwrite")
  tx.objectStore(STORES.config).put(cfg, "default")
  await txDone(tx)
}

async function getState(){
  const db = await openDb()
  const tx = db.transaction(STORES.state, "readonly")
  return (await reqValue(tx.objectStore(STORES.state).get("default"))) || null
}

async function setState(state){
  const db = await openDb()
  const tx = db.transaction(STORES.state, "readwrite")
  tx.objectStore(STORES.state).put(state, "default")
  await txDone(tx)
}

async function getRecentEvents(){
  const db = await openDb()
  const tx = db.transaction(STORES.events, "readonly")
  const rows = (await reqValue(tx.objectStore(STORES.events).getAll())) || []
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 150)
}

async function addEvent(type, message){
  const db = await openDb()
  const tx = db.transaction(STORES.events, "readwrite")
  const createdAt = Date.now()
  const req = tx.objectStore(STORES.events).add({ type, message, createdAt })
  const id = await reqValue(req)
  await txDone(tx)
  appState.events = [{ id, type, message, createdAt }, ...appState.events].slice(0, 150)
  renderEvents()
}

function toBase64(buffer){
  const bytes = new Uint8Array(buffer)
  let raw = ""
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw)
}

function fromBase64(value){
  const raw = atob(value)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i)
  return out.buffer
}

function randomB64(len){
  return toBase64(crypto.getRandomValues(new Uint8Array(len)).buffer)
}

async function deriveKey(passphrase, saltBase64, iterations){
  const enc = new TextEncoder()
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"])
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromBase64(saltBase64), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encryptText(key, text, ivBase64){
  const data = new TextEncoder().encode(text)
  const out = await crypto.subtle.encrypt({ name: "AES-GCM", iv: fromBase64(ivBase64) }, key, data)
  return toBase64(out)
}

async function decryptText(key, encryptedBase64, ivBase64){
  const out = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivBase64) },
    key,
    fromBase64(encryptedBase64),
  )
  return new TextDecoder().decode(out)
}

async function setupVault(passphrase){
  if (!passphrase || passphrase.length < 8) throw new Error("Passphrase must be at least 8 characters.")
  const salt = randomB64(16)
  const iterations = 210000
  const key = await deriveKey(passphrase, salt, iterations)
  const verifierIv = randomB64(12)
  const verifierEncrypted = await encryptText(key, "agent1c-local-vault-verifier", verifierIv)
  await setVaultMeta({ kdfSalt: salt, iterations, verifierIv, verifierEncrypted, createdAt: Date.now() })
  appState.sessionKey = key
  appState.vaultReady = true
  appState.unlocked = true
}

async function unlockVault(passphrase){
  const meta = await getVaultMeta()
  if (!meta) throw new Error("Vault has not been initialized yet.")
  try {
    const key = await deriveKey(passphrase, meta.kdfSalt, meta.iterations)
    const text = await decryptText(key, meta.verifierEncrypted, meta.verifierIv)
    if (text !== "agent1c-local-vault-verifier") throw new Error("Incorrect passphrase")
    appState.sessionKey = key
    appState.unlocked = true
  } catch {
    throw new Error("Incorrect passphrase.")
  }
}

function lockVault(){
  appState.unlocked = false
  appState.sessionKey = null
}

async function saveProviderKey(provider, value){
  if (!appState.unlocked || !appState.sessionKey) throw new Error("Unlock vault first.")
  const cleaned = (value || "").trim()
  if (!cleaned) throw new Error("Value is required.")
  const iv = randomB64(12)
  const encrypted = await encryptText(appState.sessionKey, cleaned, iv)
  await setSecret({ provider, iv, encrypted, updatedAt: Date.now() })
}

async function readProviderKey(provider){
  if (!appState.unlocked || !appState.sessionKey) return ""
  const record = await getSecret(provider)
  if (!record) return ""
  return decryptText(appState.sessionKey, record.encrypted, record.iv)
}

async function openAiChat({ apiKey, model, temperature, systemPrompt, messages }){
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    }),
  })
  if (!response.ok) throw new Error(`OpenAI call failed (${response.status})`)
  const json = await response.json()
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error("OpenAI returned no message.")
  return text.trim()
}

function buildSystemPrompt(){
  const soul = String(appState.agent.soulMd || "").trim()
  const tools = String(appState.agent.toolsMd || "").trim()
  if (soul && tools) return `${soul}\n\n${tools}`
  return soul || tools || "You are a helpful assistant."
}

function parseToolCalls(text){
  const calls = []
  const re = /\{\{\s*tool:([a-z_][a-z0-9_]*)\s*\}\}/gi
  let m
  while ((m = re.exec(text))) {
    calls.push({ name: String(m[1] || "").toLowerCase() })
  }
  return calls
}

function stripToolCalls(text){
  return String(text || "").replace(/\{\{\s*tool:[^}]+\}\}/gi, "").trim()
}

async function runToolCall(call){
  if (call.name === "list_files") {
    const files = await listFiles()
    const names = files
      .map(file => String(file?.name || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
    if (!names.length) return "TOOL_RESULT list_files: no files"
    return `TOOL_RESULT list_files:\n${names.map((name, i) => `${i + 1}. ${name}`).join("\n")}`
  }
  return `TOOL_RESULT ${call.name}: unsupported`
}

async function openAiChatWithTools({ apiKey, model, temperature, messages }){
  const working = (messages || []).map(m => ({ role: m.role, content: m.content }))
  const systemPrompt = buildSystemPrompt()
  for (let i = 0; i < 3; i++) {
    const reply = await openAiChat({ apiKey, model, temperature, systemPrompt, messages: working })
    const calls = parseToolCalls(reply)
    if (!calls.length) return stripToolCalls(reply)
    const results = []
    for (const call of calls) {
      try {
        results.push(await runToolCall(call))
      } catch (err) {
        results.push(`TOOL_RESULT ${call.name}: failed (${err instanceof Error ? err.message : "unknown"})`)
      }
    }
    working.push({ role: "assistant", content: reply })
    working.push({
      role: "user",
      content: `${results.join("\n\n")}\n\nUse the tool results and respond to the user naturally. Do not emit another tool call unless required.`,
    })
  }
  return "I could not complete tool execution in time."
}

async function testOpenAIKey(apiKey, model){
  await openAiChat({
    apiKey,
    model,
    temperature: 0,
    systemPrompt: "Respond with exactly: ok",
    messages: [{ role: "user", content: "ok" }],
  })
}

async function listOpenAiModels(apiKey){
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!response.ok) throw new Error(`OpenAI models failed (${response.status})`)
  const json = await response.json()
  const ids = (json?.data || []).map(item => item.id).filter(Boolean).sort((a, b) => a.localeCompare(b))
  if (!ids.length) throw new Error("No models returned.")
  return ids
}

function telegramEndpoint(token, method){
  return `https://api.telegram.org/bot${token}/${method}`
}

async function telegramJson(response){
  const json = await response.json()
  if (!json?.ok) throw new Error(json?.description || "Telegram API error")
  return json.result
}

async function testTelegramToken(token){
  const response = await fetch(telegramEndpoint(token, "getMe"))
  const result = await telegramJson(response)
  return result?.username || "bot"
}

async function getTelegramBotProfile(token){
  const response = await fetch(telegramEndpoint(token, "getMe"))
  const result = await telegramJson(response)
  return {
    id: typeof result?.id === "number" ? result.id : null,
    username: String(result?.username || "").replace(/^@/, "").toLowerCase(),
  }
}

async function getTelegramUpdates(token, offset){
  const url = new URL(telegramEndpoint(token, "getUpdates"))
  url.searchParams.set("timeout", "0")
  if (typeof offset === "number") url.searchParams.set("offset", String(offset))
  const response = await fetch(url.toString())
  return telegramJson(response)
}

async function sendTelegramMessage(token, chatId, text){
  const response = await fetch(telegramEndpoint(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  await telegramJson(response)
}

function telegramMessageTargetsBot(msg, botProfile){
  const chatType = String(msg?.chat?.type || "").toLowerCase()
  if (chatType !== "group" && chatType !== "supergroup") return true
  const botUsername = String(botProfile?.username || "").toLowerCase()
  const botId = typeof botProfile?.id === "number" ? botProfile.id : null
  const text = String(msg?.text || "")
  if (!text) return false

  const entities = Array.isArray(msg?.entities) ? msg.entities : []
  for (const entity of entities) {
    if (entity?.type === "mention") {
      const offset = Math.max(0, Number(entity.offset) || 0)
      const length = Math.max(0, Number(entity.length) || 0)
      const value = text.slice(offset, offset + length).replace(/^@/, "").toLowerCase()
      if (botUsername && value === botUsername) return true
    }
    if (entity?.type === "text_mention") {
      const userId = entity?.user?.id
      const username = String(entity?.user?.username || "").replace(/^@/, "").toLowerCase()
      if ((botId && userId === botId) || (botUsername && username === botUsername)) return true
    }
  }

  const replyFrom = msg?.reply_to_message?.from
  if (replyFrom?.is_bot) {
    const replyId = typeof replyFrom.id === "number" ? replyFrom.id : null
    const replyUsername = String(replyFrom.username || "").replace(/^@/, "").toLowerCase()
    if ((botId && replyId === botId) || (botUsername && replyUsername === botUsername)) return true
  }
  return false
}

function pushRolling(role, content){
  appState.agent.rollingMessages = appState.agent.rollingMessages
    .concat({ role, content, createdAt: Date.now() })
    .slice(-appState.config.maxContextMessages)
}

function getLocalThreadEntries(){
  return Object.values(appState.agent.localThreads || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

function makeNextLocalThreadLabel(){
  const nums = getLocalThreadEntries()
    .filter(thread => (thread.source || "local") === "local")
    .map(thread => {
      const m = /^chat\s+(\d+)$/i.exec((thread.label || "").trim())
      return m ? Number(m[1]) : 0
    })
    .filter(n => Number.isFinite(n) && n > 0)
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `Chat ${next}`
}

function ensureLocalThreadsInitialized(){
  if (!appState.agent.localThreads || typeof appState.agent.localThreads !== "object") {
    appState.agent.localThreads = {}
  }
  const entries = getLocalThreadEntries()
  if (!entries.length) {
    const id = `local-${Date.now()}`
    const legacy = Array.isArray(appState.agent.rollingMessages) ? appState.agent.rollingMessages : []
    appState.agent.localThreads[id] = {
      id,
      label: "Chat 1",
      source: "local",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: legacy.slice(-appState.config.maxContextMessages),
    }
    appState.agent.rollingMessages = []
    appState.agent.activeLocalThreadId = id
    return
  }
  const active = appState.agent.activeLocalThreadId
  if (!active || !appState.agent.localThreads[active]) {
    appState.agent.activeLocalThreadId = entries[0].id
  }
}

function getActiveLocalThread(){
  ensureLocalThreadsInitialized()
  return appState.agent.localThreads[appState.agent.activeLocalThreadId]
}

function createNewLocalThread(){
  ensureLocalThreadsInitialized()
  const id = `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  appState.agent.localThreads[id] = {
    id,
    label: makeNextLocalThreadLabel(),
    source: "local",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
  appState.agent.activeLocalThreadId = id
  return appState.agent.localThreads[id]
}

function getPrimaryLocalThread(){
  ensureLocalThreadsInitialized()
  const locals = getLocalThreadEntries().filter(thread => (thread.source || "local") === "local")
  if (!locals.length) return getActiveLocalThread()
  const chatOne = locals.find(thread => String(thread.label || "").trim().toLowerCase() === "chat 1")
  return chatOne || locals[0]
}

function pushLocalMessage(threadId, role, content){
  ensureLocalThreadsInitialized()
  const thread = appState.agent.localThreads[threadId]
  if (!thread) return
  thread.messages = (thread.messages || [])
    .concat({ role, content, createdAt: Date.now() })
    .slice(-appState.config.maxContextMessages)
  thread.updatedAt = Date.now()
}

function threadLabelForTelegram(chat){
  const username = (chat?.username || "").trim()
  if (username) return `TG @${username}`
  const first = (chat?.first_name || "").trim()
  const last = (chat?.last_name || "").trim()
  const name = `${first} ${last}`.trim()
  if (name) return `TG ${name}`
  return `TG ${String(chat?.id || "")}`
}

function ensureTelegramThread(chat){
  ensureLocalThreadsInitialized()
  const chatId = String(chat?.id || "")
  if (!chatId) return null
  const id = `telegram:${chatId}`
  const label = threadLabelForTelegram(chat)
  const existing = appState.agent.localThreads[id]
  if (existing) {
    existing.label = label || existing.label
    existing.source = "telegram"
    existing.telegramChatId = chatId
    existing.updatedAt = Date.now()
    return existing
  }
  const thread = {
    id,
    label,
    source: "telegram",
    telegramChatId: chatId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
  appState.agent.localThreads[id] = thread
  return thread
}

function formatTime(ts){
  try { return new Date(ts).toLocaleString() } catch { return "" }
}

function wrappedRowCount(line, availableWidth, font){
  if (!line) return 1
  const text = line.replaceAll("\t", "  ")
  const canvas = wrappedRowCount._canvas || (wrappedRowCount._canvas = document.createElement("canvas"))
  const ctx = canvas.getContext("2d")
  ctx.font = font
  const width = ctx.measureText(text).width
  return Math.max(1, Math.ceil(width / Math.max(1, availableWidth)))
}

function updateLineNumbers(textarea, lines){
  if (!textarea || !lines) return
  const style = getComputedStyle(textarea)
  const pl = parseFloat(style.paddingLeft || "0") || 0
  const pr = parseFloat(style.paddingRight || "0") || 0
  const availableWidth = Math.max(1, textarea.clientWidth - pl - pr)
  const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const rawLines = String(textarea.value || "").split("\n")
  const numbers = []
  for (let i = 0; i < rawLines.length; i++) {
    const wraps = wrappedRowCount(rawLines[i], availableWidth, font)
    numbers.push(String(i + 1))
    for (let j = 1; j < wraps; j++) numbers.push("")
  }
  if (!numbers.length) numbers.push("1")
  lines.textContent = numbers.join("\n")
}

function bindNotepad(textarea, lines){
  if (!textarea || !lines) return
  const sync = () => {
    updateLineNumbers(textarea, lines)
    lines.scrollTop = textarea.scrollTop
  }
  textarea.addEventListener("input", sync)
  textarea.addEventListener("scroll", sync)
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => sync())
    ro.observe(textarea)
  } else {
    window.addEventListener("resize", sync)
  }
  sync()
}

function syncNotepadGutters(){
  const soulInput = els.soulInput || byId("soulInput")
  const soulLines = els.soulLineNums || byId("soulLineNums")
  const toolsInput = els.toolsInput || byId("toolsInput")
  const toolsLines = els.toolsLineNums || byId("toolsLineNums")
  const heartInput = els.heartbeatDocInput || byId("heartbeatDocInput")
  const heartLines = els.heartbeatLineNums || byId("heartbeatLineNums")
  updateLineNumbers(soulInput, soulLines)
  updateLineNumbers(toolsInput, toolsLines)
  updateLineNumbers(heartInput, heartLines)
}

function setDocSaveState(docKey, state){
  const id = docKey === "soul"
    ? "soulSaveState"
    : (docKey === "tools" ? "toolsSaveState" : "heartbeatSaveState")
  const el = byId(id)
  if (el) el.textContent = state
}

function scheduleDocsAutosave(docKey){
  if (docKey) {
    pendingDocSaves.add(docKey)
    setDocSaveState(docKey, "Unsaved")
  }
  if (docsAutosaveTimer) clearTimeout(docsAutosaveTimer)
  docsAutosaveTimer = setTimeout(async () => {
    const saving = Array.from(pendingDocSaves)
    saving.forEach(key => setDocSaveState(key, "Saving"))
    try {
      saveDraftFromInputs()
      await persistState()
      saving.forEach(key => setDocSaveState(key, "Saved"))
      pendingDocSaves.clear()
    } catch (err) {
      saving.forEach(key => setDocSaveState(key, "Unsaved"))
      setStatus(err instanceof Error ? `Doc autosave failed: ${err.message}` : "Doc autosave failed")
    }
  }, 500)
}

function scheduleLoopTimingAutosave(){
  if (loopTimingSaveTimer) clearTimeout(loopTimingSaveTimer)
  loopTimingSaveTimer = setTimeout(async () => {
    try {
      saveDraftFromInputs()
      await persistState()
      if (appState.running) {
        stopLoop()
        startLoop()
      }
      setStatus("Loop heartbeat timing saved.")
    } catch (err) {
      setStatus(err instanceof Error ? `Loop timing save failed: ${err.message}` : "Loop timing save failed")
    }
  }, 250)
}

function setStatus(text){
  if (els.setupStatus) els.setupStatus.textContent = text
  if (els.unlockStatus) els.unlockStatus.textContent = text
  if (els.loopStatus) els.loopStatus.textContent = text
}

function scrollChatToBottom(){
  if (!els.chatLog) return
  const apply = () => { els.chatLog.scrollTop = els.chatLog.scrollHeight }
  apply()
  requestAnimationFrame(apply)
  setTimeout(apply, 0)
}

function renderLocalThreadPicker(){
  if (!els.chatThreadSelect) return
  ensureLocalThreadsInitialized()
  const threads = getLocalThreadEntries()
  const active = appState.agent.activeLocalThreadId
  els.chatThreadSelect.innerHTML = threads
    .map(thread => {
      const source = (thread.source || "local") === "telegram" ? "Telegram" : "Local"
      return `<option value="${escapeHtml(thread.id)}">${escapeHtml(thread.label || "Chat")} · ${source}</option>`
    })
    .join("")
  if (active && threads.some(thread => thread.id === active)) {
    els.chatThreadSelect.value = active
  }
}

function refreshThreadPickerSoon(){
  renderLocalThreadPicker()
  requestAnimationFrame(() => renderLocalThreadPicker())
  setTimeout(() => renderLocalThreadPicker(), 0)
}

function renderChat(){
  if (!els.chatLog) return
  ensureLocalThreadsInitialized()
  refreshThreadPickerSoon()
  const thread = getActiveLocalThread()
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  if (!messages.length) {
    els.chatLog.innerHTML = `<div class="agent-muted">No messages yet.</div>`
  } else {
    els.chatLog.innerHTML = messages.map(msg => {
      const cls = msg.role === "assistant" ? "assistant" : "user"
      const role = msg.role === "assistant" ? "assistant" : "user"
      return `<div class="agent-bubble ${cls}"><div class="agent-bubble-role">${role}</div><div>${escapeHtml(msg.content)}</div></div>`
    }).join("")
  }
  scrollChatToBottom()
}

function renderEvents(){
  if (!els.eventLog) return
  if (!appState.events.length) {
    els.eventLog.innerHTML = `<div class="agent-muted">No events yet.</div>`
    return
  }
  els.eventLog.innerHTML = appState.events.map(event => {
    return `<div class="agent-event"><div class="agent-event-head"><span>${escapeHtml(event.type)}</span><span>${escapeHtml(formatTime(event.createdAt))}</span></div><div>${escapeHtml(event.message)}</div></div>`
  }).join("")
}

function setModelOptions(ids, selected){
  if (!els.modelInput) return
  const list = ids && ids.length ? ids : FALLBACK_OPENAI_MODELS
  els.modelInput.innerHTML = list.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")
  if (list.includes(selected)) els.modelInput.value = selected
  else {
    els.modelInput.value = list[0]
    appState.config.model = list[0]
  }
}

function saveDraftFromInputs(){
  if (els.modelInput) appState.config.model = els.modelInput.value || appState.config.model
  if (els.loopHeartbeatMinInput) appState.config.heartbeatIntervalMs = Math.max(60000, Math.floor(Number(els.loopHeartbeatMinInput.value) || 1) * 60000)
  else if (els.heartbeatInput) appState.config.heartbeatIntervalMs = Math.max(5000, Number(els.heartbeatInput.value) || 60000)
  if (els.contextInput) appState.config.maxContextMessages = Math.max(4, Math.min(64, Number(els.contextInput.value) || 16))
  if (els.temperatureInput) appState.config.temperature = Math.max(0, Math.min(1.5, Number(els.temperatureInput.value) || 0.4))
  if (els.telegramPollInput) appState.telegramPollMs = Math.max(1000, Math.floor((Number(els.telegramPollInput.value) || 15) * 1000))
  if (els.telegramEnabledSelect) appState.telegramEnabled = els.telegramEnabledSelect.value === "on"
  if (els.soulInput) appState.agent.soulMd = els.soulInput.value
  if (els.toolsInput) appState.agent.toolsMd = els.toolsInput.value
  if (els.heartbeatDocInput) appState.agent.heartbeatMd = els.heartbeatDocInput.value
}

function loadInputsFromState(){
  setModelOptions(appState.openAiModels, appState.config.model)
  if (els.heartbeatInput) els.heartbeatInput.value = String(appState.config.heartbeatIntervalMs)
  if (els.loopHeartbeatMinInput) els.loopHeartbeatMinInput.value = String(Math.max(1, Math.round(appState.config.heartbeatIntervalMs / 60000)))
  if (els.contextInput) els.contextInput.value = String(appState.config.maxContextMessages)
  if (els.temperatureInput) els.temperatureInput.value = String(appState.config.temperature)
  if (els.telegramPollInput) els.telegramPollInput.value = String(Math.max(1, Math.round(appState.telegramPollMs / 1000)))
  if (els.telegramEnabledSelect) els.telegramEnabledSelect.value = appState.telegramEnabled ? "on" : "off"
  if (els.soulInput) els.soulInput.value = appState.agent.soulMd
  if (els.toolsInput) els.toolsInput.value = appState.agent.toolsMd
  if (els.heartbeatDocInput) els.heartbeatDocInput.value = appState.agent.heartbeatMd
  syncNotepadGutters()
  if (els.lastTick) els.lastTick.textContent = appState.agent.lastTickAt ? formatTime(appState.agent.lastTickAt) : "never"
  if (els.agentStatus) els.agentStatus.textContent = appState.agent.status || "idle"
  if (els.telegramBridgeState) els.telegramBridgeState.textContent = appState.telegramEnabled ? "enabled" : "disabled"
}

async function persistState(){
  await setConfig({ ...appState.config, telegramEnabled: appState.telegramEnabled, telegramPollMs: appState.telegramPollMs })
  await setState({ ...appState.agent })
}

async function refreshBadges(){
  const hasOpenAi = Boolean(await getSecret("openai"))
  const hasTelegram = Boolean(await getSecret("telegram"))
  if (els.openaiBadge) {
    els.openaiBadge.className = `agent-badge ${hasOpenAi ? "ok" : "warn"}`
    els.openaiBadge.textContent = hasOpenAi ? "Saved in vault" : "Missing key"
  }
  if (els.telegramBadge) {
    els.telegramBadge.className = `agent-badge ${hasTelegram ? "ok" : "warn"}`
    els.telegramBadge.textContent = hasTelegram ? "Saved in vault" : "Missing token"
  }
  if (els.openaiStoredRow && els.openaiControls) {
    const hideOpenAiControls = hasOpenAi && !openAiEditing
    els.openaiStoredRow.classList.toggle("agent-hidden", !hideOpenAiControls)
    els.openaiControls.classList.toggle("agent-hidden", hideOpenAiControls)
  }
  if (els.telegramStoredRow && els.telegramControls) {
    const hideTelegramControls = hasTelegram && !telegramEditing
    els.telegramStoredRow.classList.toggle("agent-hidden", !hideTelegramControls)
    els.telegramControls.classList.toggle("agent-hidden", hideTelegramControls)
  }
}

function refreshUi(){
  const canUse = appState.unlocked
  if (els.chatInput) {
    els.chatInput.disabled = false
    els.chatInput.placeholder = "Write a message..."
  }
  if (els.chatSendBtn) els.chatSendBtn.disabled = false
  if (els.openaiKeyInput) els.openaiKeyInput.disabled = !canUse
  if (els.telegramTokenInput) els.telegramTokenInput.disabled = !canUse
  if (els.modelInput) els.modelInput.disabled = !canUse
  if (els.heartbeatInput) els.heartbeatInput.disabled = !canUse
  if (els.contextInput) els.contextInput.disabled = !canUse
  if (els.temperatureInput) els.temperatureInput.disabled = !canUse
  if (els.loopHeartbeatMinInput) els.loopHeartbeatMinInput.disabled = !canUse
  if (els.telegramPollInput) els.telegramPollInput.disabled = !canUse
  if (els.telegramEnabledSelect) els.telegramEnabledSelect.disabled = !canUse
  if (els.soulInput) els.soulInput.disabled = !canUse
  if (els.toolsInput) els.toolsInput.disabled = !canUse
  if (els.heartbeatDocInput) els.heartbeatDocInput.disabled = !canUse
  if (els.startLoopBtn) els.startLoopBtn.disabled = !canUse || appState.running
  if (els.stopLoopBtn) els.stopLoopBtn.disabled = !appState.running
  renderChat()
  renderEvents()
  loadInputsFromState()
  refreshBadges()
}

function closeWindow(winObj){
  if (!winObj?.win) return
  const btn = winObj.win.querySelector("[data-close]")
  if (btn) btn.click()
}

function minimizeWindow(winObj){
  if (!winObj?.win) return
  if (winObj.win.style.display === "none") return
  const btn = winObj.win.querySelector("[data-minimize]")
  if (btn) btn.click()
}

function restoreWindow(winObj){
  if (!winObj?.id || !wmRef) return
  wmRef.restore?.(winObj.id)
}

function focusWindow(winObj){
  if (!winObj?.id || !wmRef) return
  wmRef.focus?.(winObj.id)
}

function applyOnboardingWindowState(){
  restoreWindow(wins.openai)
  restoreWindow(wins.events)
  focusWindow(wins.openai)
  minimizeWindow(wins.chat)
  minimizeWindow(wins.config)
  minimizeWindow(wins.telegram)
  minimizeWindow(wins.soul)
  minimizeWindow(wins.tools)
  minimizeWindow(wins.heartbeat)
}

function revealPostOpenAiWindows(){
  restoreWindow(wins.chat)
  restoreWindow(wins.config)
  restoreWindow(wins.telegram)
  restoreWindow(wins.events)
  minimizeWindow(wins.soul)
  minimizeWindow(wins.tools)
  minimizeWindow(wins.heartbeat)
  focusWindow(wins.chat)
}

async function maybeCompleteOnboarding(){
  if (onboardingComplete) return true
  const hasOpenAiSecret = Boolean(await getSecret("openai"))
  if (!hasOpenAiSecret || !onboardingOpenAiTested || !onboardingOpenAiSettingsSaved) return false
  onboardingComplete = true
  localStorage.setItem(ONBOARDING_KEY, "1")
  minimizeWindow(wins.openai)
  revealPostOpenAiWindows()
  await addEvent("onboarding_step", "OpenAI key saved, tested, and settings saved. Chat is ready.")
  return true
}

function setupWindowHtml(){
  return `
    <div class="agent-stack">
      <div class="agent-note">Agent1c.me runs your agent entirely inside this browser tab with no app servers.</div>
      <div class="agent-note">Bring Your Own Keys (BYOK): your API keys are encrypted locally in-browser and used only for direct calls to your providers.</div>
      <form id="setupForm" class="agent-form">
        <label class="agent-form-label">
          <span>Passphrase</span>
          <input id="setupPassphrase" class="field" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <label class="agent-form-label">
          <span>Confirm passphrase</span>
          <input id="setupConfirm" class="field" type="password" autocomplete="new-password" minlength="8" required />
        </label>
        <button class="btn" type="submit">Initialize Vault</button>
        <div id="setupStatus" class="agent-note">Create a local vault to continue.</div>
      </form>
    </div>
  `
}

function unlockWindowHtml(){
  return `
    <form id="unlockForm" class="agent-form">
      <label class="agent-form-label">
        <span>Passphrase</span>
        <input id="unlockPassphrase" class="field" type="password" autocomplete="current-password" required />
      </label>
      <button class="btn" type="submit">Unlock Vault</button>
      <div id="unlockStatus" class="agent-note">Vault is locked.</div>
    </form>
  `
}

function chatWindowHtml(){
  return `
    <div class="agent-stack">
      <div class="agent-row agent-wrap-row">
        <select id="chatThreadSelect" class="field"></select>
        <button id="chatNewBtn" class="btn" type="button">New Chat</button>
        <button id="chatClearBtn" class="btn" type="button">Clear Chat</button>
      </div>
      <div id="chatLog" class="agent-log"></div>
      <form id="chatForm" class="agent-row">
        <input id="chatInput" class="field" type="text" />
        <button id="chatSendBtn" class="btn" type="submit">Send</button>
      </form>
    </div>
  `
}

function openAiWindowHtml(){
  return `
    <div class="agent-stack">
      <div id="openaiStoredRow" class="agent-row agent-hidden">
        <span class="agent-note">OpenAI API Key Stored in Vault</span>
        <button id="openaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit OpenAI key">✎</button>
      </div>
      <div id="openaiControls">
        <div class="agent-note">Status: <span id="openaiBadge" class="agent-badge warn">Missing key</span></div>
        <form id="openaiForm" class="agent-form">
          <label class="agent-form-label">
            <span>API key</span>
            <input id="openaiKeyInput" class="field" type="password" placeholder="sk-..." required />
          </label>
          <div class="agent-row">
            <button class="btn" type="submit">Save Encrypted Key</button>
            <button id="openaiTestBtn" class="btn" type="button">Test Connection</button>
          </div>
        </form>
      </div>
      <div class="agent-grid2">
        <label class="agent-form-label">
          <span>Model</span>
          <select id="modelInput" class="field"></select>
        </label>
        <label class="agent-form-label">
          <span>Temperature</span>
          <input id="temperatureInput" class="field" type="number" min="0" max="1.5" step="0.1" />
        </label>
        <label class="agent-form-label">
          <span>Rolling context max messages</span>
          <input id="contextInput" class="field" type="number" min="4" max="64" step="1" />
        </label>
      </div>
      <div class="agent-row">
        <button id="saveSettingsBtn" class="btn" type="button">Save OpenAI Settings</button>
      </div>
    </div>
  `
}

function telegramWindowHtml(){
  return `
    <div class="agent-stack">
      <div id="telegramStoredRow" class="agent-row agent-hidden">
        <span class="agent-note">Telegram API Key Stored in Vault</span>
        <button id="telegramEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit Telegram token">✎</button>
      </div>
      <div id="telegramControls">
        <div class="agent-note">Status: <span id="telegramBadge" class="agent-badge warn">Missing token</span></div>
        <form id="telegramForm" class="agent-form">
          <label class="agent-form-label">
            <span>Bot token</span>
            <input id="telegramTokenInput" class="field" type="password" placeholder="123456:AA..." required />
          </label>
          <div class="agent-row">
            <button class="btn" type="submit">Save Encrypted Token</button>
            <button id="telegramTestBtn" class="btn" type="button">Test Telegram Token</button>
          </div>
        </form>
      </div>
      <div class="agent-grid2">
        <label class="agent-form-label">
          <span>Telegram poll interval (sec)</span>
          <input id="telegramPollInput" class="field" type="number" min="1" step="1" />
        </label>
        <label class="agent-form-label">
          <span>Telegram bridge</span>
          <select id="telegramEnabledSelect" class="field">
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </label>
      </div>
      <div class="agent-row">
        <button id="saveTelegramSettingsBtn" class="btn" type="button">Save Telegram Settings</button>
      </div>
      <div class="agent-note">Telegram bridge is <strong id="telegramBridgeState">enabled</strong>.</div>
    </div>
  `
}

function configWindowHtml(){
  return `
    <div class="agent-stack">
      <label class="agent-form-label">
        <span>Heartbeat every (min)</span>
        <div class="agent-stepper">
          <input id="loopHeartbeatMinInput" class="field" type="number" min="1" step="1" />
          <div class="agent-stepper-buttons">
            <button id="loopHeartbeatUpBtn" class="btn agent-stepper-btn" type="button" aria-label="Increase heartbeat minutes">+</button>
            <button id="loopHeartbeatDownBtn" class="btn agent-stepper-btn" type="button" aria-label="Decrease heartbeat minutes">-</button>
          </div>
        </div>
      </label>
      <div class="agent-row agent-wrap-row">
        <button id="startLoopBtn" class="btn" type="button">Start Agent Loop</button>
        <button id="stopLoopBtn" class="btn" type="button">Stop Loop</button>
      </div>
      <div class="agent-meta-row">
        <span>Loop status: <strong id="loopStatus">idle</strong></span>
        <span>Last tick: <strong id="lastTick">never</strong></span>
      </div>
      <div class="agent-meta-row">
        <span>Agent status: <strong id="agentStatus">idle</strong></span>
      </div>
    </div>
  `
}

function soulWindowHtml(){
  return `
    <div class="agent-notepad">
      <pre id="soulLineNums" class="agent-lines"></pre>
      <textarea id="soulInput" class="agent-text" spellcheck="false"></textarea>
    </div>
    <div id="soulSaveState" class="agent-doc-state">Saved</div>
  `
}

function heartbeatWindowHtml(){
  return `
    <div class="agent-notepad">
      <pre id="heartbeatLineNums" class="agent-lines"></pre>
      <textarea id="heartbeatDocInput" class="agent-text" spellcheck="false"></textarea>
    </div>
    <div id="heartbeatSaveState" class="agent-doc-state">Saved</div>
  `
}

function toolsWindowHtml(){
  return `
    <div class="agent-notepad">
      <pre id="toolsLineNums" class="agent-lines"></pre>
      <textarea id="toolsInput" class="agent-text" spellcheck="false"></textarea>
    </div>
    <div id="toolsSaveState" class="agent-doc-state">Saved</div>
  `
}

function eventsWindowHtml(){
  return `<div id="eventLog" class="agent-events"></div>`
}

function cacheElements(){
  Object.assign(els, {
    setupForm: byId("setupForm"),
    setupPassphrase: byId("setupPassphrase"),
    setupConfirm: byId("setupConfirm"),
    setupStatus: byId("setupStatus"),
    unlockForm: byId("unlockForm"),
    unlockPassphrase: byId("unlockPassphrase"),
    unlockStatus: byId("unlockStatus"),
    chatThreadSelect: byId("chatThreadSelect"),
    chatNewBtn: byId("chatNewBtn"),
    chatClearBtn: byId("chatClearBtn"),
    chatLog: byId("chatLog"),
    chatForm: byId("chatForm"),
    chatInput: byId("chatInput"),
    chatSendBtn: byId("chatSendBtn"),
    openaiForm: byId("openaiForm"),
    openaiKeyInput: byId("openaiKeyInput"),
    openaiTestBtn: byId("openaiTestBtn"),
    openaiStoredRow: byId("openaiStoredRow"),
    openaiControls: byId("openaiControls"),
    openaiEditBtn: byId("openaiEditBtn"),
    openaiBadge: byId("openaiBadge"),
    telegramForm: byId("telegramForm"),
    telegramTokenInput: byId("telegramTokenInput"),
    telegramTestBtn: byId("telegramTestBtn"),
    telegramStoredRow: byId("telegramStoredRow"),
    telegramControls: byId("telegramControls"),
    telegramEditBtn: byId("telegramEditBtn"),
    telegramBadge: byId("telegramBadge"),
    modelInput: byId("modelInput"),
    heartbeatInput: byId("heartbeatInput"),
    loopHeartbeatMinInput: byId("loopHeartbeatMinInput"),
    loopHeartbeatUpBtn: byId("loopHeartbeatUpBtn"),
    loopHeartbeatDownBtn: byId("loopHeartbeatDownBtn"),
    contextInput: byId("contextInput"),
    temperatureInput: byId("temperatureInput"),
    telegramPollInput: byId("telegramPollInput"),
    telegramEnabledSelect: byId("telegramEnabledSelect"),
    telegramBridgeState: byId("telegramBridgeState"),
    saveSettingsBtn: byId("saveSettingsBtn"),
    saveTelegramSettingsBtn: byId("saveTelegramSettingsBtn"),
    startLoopBtn: byId("startLoopBtn"),
    stopLoopBtn: byId("stopLoopBtn"),
    loopStatus: byId("loopStatus"),
    lastTick: byId("lastTick"),
    agentStatus: byId("agentStatus"),
    soulInput: byId("soulInput"),
    soulLineNums: byId("soulLineNums"),
    toolsInput: byId("toolsInput"),
    toolsLineNums: byId("toolsLineNums"),
    heartbeatDocInput: byId("heartbeatDocInput"),
    heartbeatLineNums: byId("heartbeatLineNums"),
    eventLog: byId("eventLog"),
  })
}

async function refreshModelDropdown(providedKey){
  try {
    const key = providedKey || (await readProviderKey("openai"))
    if (!key) {
      setModelOptions(appState.openAiModels, appState.config.model)
      return
    }
    const ids = await listOpenAiModels(key)
    appState.openAiModels = ids
    setModelOptions(ids, appState.config.model)
  } catch {
    setModelOptions(appState.openAiModels, appState.config.model)
  }
}

async function validateOpenAiKey(key){
  const candidate = (key || "").trim()
  if (!candidate) throw new Error("No OpenAI key available.")
  await testOpenAIKey(candidate, appState.config.model)
  await refreshModelDropdown(candidate)
  onboardingOpenAiTested = true
  localStorage.setItem(ONBOARDING_OPENAI_TEST_KEY, "1")
  return candidate
}

async function validateTelegramToken(token){
  const candidate = (token || "").trim()
  if (!candidate) throw new Error("No Telegram token available.")
  const username = await testTelegramToken(candidate)
  return { token: candidate, username }
}

async function sendChat(text){
  const apiKey = await readProviderKey("openai")
  if (!apiKey) throw new Error("No OpenAI key stored.")
  appState.lastUserSeenAt = Date.now()
  const thread = getActiveLocalThread()
  if (!thread) throw new Error("No active chat thread.")
  pushLocalMessage(thread.id, "user", text)
  const promptMessages = appState.agent.localThreads[thread.id]?.messages || []
  const reply = await openAiChatWithTools({
    apiKey,
    model: appState.config.model,
    temperature: appState.config.temperature,
    messages: promptMessages,
  })
  pushLocalMessage(thread.id, "assistant", reply)
  await addEvent("chat_replied", "Hitomi replied in chat")
  await persistState()
  renderChat()
}

async function heartbeatTick(){
  if (!appState.running) return
  if (!appState.unlocked) return
  appState.agent.lastTickAt = Date.now()
  if (els.lastTick) els.lastTick.textContent = formatTime(appState.agent.lastTickAt)
  const apiKey = await readProviderKey("openai")
  if (!apiKey) {
    await addEvent("heartbeat_skipped", "No OpenAI key")
    return
  }
  const prompt = `${appState.agent.heartbeatMd.trim()}\n\nTime: ${new Date().toISOString()}\nRespond with a short check-in.`
  pushRolling("user", prompt)
  const reply = await openAiChatWithTools({
    apiKey,
    model: appState.config.model,
    temperature: Math.min(0.7, appState.config.temperature),
    messages: appState.agent.rollingMessages,
  })
  pushRolling("assistant", reply)
  const primaryThread = getPrimaryLocalThread()
  if (primaryThread?.id) pushLocalMessage(primaryThread.id, "assistant", reply)
  await addEvent("heartbeat_replied", "Heartbeat response generated")
  await persistState()
  renderChat()
}

function startLoop(){
  if (appState.running) return
  appState.running = true
  if (els.agentStatus) els.agentStatus.textContent = "running"
  if (appState.heartbeatTimer) clearInterval(appState.heartbeatTimer)
  appState.heartbeatTimer = setInterval(() => {
    heartbeatTick().catch(err => setStatus(err instanceof Error ? err.message : "Heartbeat failed"))
  }, appState.config.heartbeatIntervalMs)
  heartbeatTick().catch(() => {})
  setStatus("Agent loop started")
  refreshUi()
}

function stopLoop(){
  appState.running = false
  if (appState.heartbeatTimer) {
    clearInterval(appState.heartbeatTimer)
    appState.heartbeatTimer = null
  }
  if (els.agentStatus) els.agentStatus.textContent = "idle"
  setStatus("Agent loop stopped")
  refreshUi()
}

function stopTelegramLoop(){
  if (appState.telegramTimer) {
    clearInterval(appState.telegramTimer)
    appState.telegramTimer = null
  }
}

function refreshTelegramLoop(){
  stopTelegramLoop()
  if (!appState.unlocked || !appState.telegramEnabled) return
  appState.telegramTimer = setInterval(() => {
    pollTelegram().catch(() => {})
  }, appState.telegramPollMs)
  pollTelegram().catch(() => {})
}

async function pollTelegram(){
  if (appState.telegramPolling || !appState.unlocked || !appState.telegramEnabled) return
  appState.telegramPolling = true
  try {
    const [token, apiKey] = await Promise.all([readProviderKey("telegram"), readProviderKey("openai")])
    if (!token || !apiKey) return
    const botProfile = await getTelegramBotProfile(token)
    const offset = typeof appState.agent.telegramLastUpdateId === "number" ? appState.agent.telegramLastUpdateId + 1 : undefined
    const updates = await getTelegramUpdates(token, offset)
    let discoveredTelegramThread = false
    for (const update of updates || []) {
      appState.agent.telegramLastUpdateId = update.update_id
      const msg = update.message
      if (!msg?.text || !msg?.chat?.id) continue
      if (msg?.from?.is_bot) continue
      if (!telegramMessageTargetsBot(msg, botProfile)) continue
      appState.lastUserSeenAt = Date.now()
      const threadId = `telegram:${String(msg.chat.id)}`
      const existed = Boolean(appState.agent.localThreads?.[threadId])
      const thread = ensureTelegramThread(msg.chat)
      if (!thread) continue
      if (!existed) {
        discoveredTelegramThread = true
        await addEvent("chat_thread_created", `Added ${thread.label} to chat list`)
      }
      const chatLabel = thread.label || String(msg.chat.id)
      pushLocalMessage(thread.id, "user", msg.text)
      const promptMessages = appState.agent.localThreads[thread.id]?.messages || []
      const reply = await openAiChatWithTools({
        apiKey,
        model: appState.config.model,
        temperature: appState.config.temperature,
        messages: promptMessages,
      })
      pushLocalMessage(thread.id, "assistant", reply)
      await sendTelegramMessage(token, msg.chat.id, reply.slice(0, 3900))
      await addEvent("telegram_replied", `Replied to Telegram chat ${chatLabel}`)
      renderChat()
    }
    if ((updates || []).length) {
      await persistState()
      if (discoveredTelegramThread) refreshThreadPickerSoon()
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Telegram polling failed")
  } finally {
    appState.telegramPolling = false
  }
}

function wireSetupDom(){
  if (!els.setupForm) return
  els.setupForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (els.setupPassphrase.value !== els.setupConfirm.value) {
      setStatus("Passphrase confirmation does not match.")
      return
    }
    try {
      await setupVault(els.setupPassphrase.value)
      closeWindow(setupWin)
      await addEvent("vault_unlocked", "Vault initialized and unlocked")
      await createWorkspace({ showUnlock: false, onboarding: true })
      await refreshModelDropdown()
      refreshTelegramLoop()
      refreshUi()
      applyOnboardingWindowState()
      setStatus("Vault initialized and unlocked.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not initialize vault")
    }
  })
}

function wireUnlockDom(){
  if (!els.unlockForm) return
  els.unlockForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    try {
      await unlockVault(els.unlockPassphrase.value)
      closeWindow(unlockWin)
      unlockWin = null
      await addEvent("vault_unlocked", "Vault unlocked locally")
      await refreshModelDropdown()
      refreshTelegramLoop()
      refreshUi()
      const hasOpenAiSecret = Boolean(await getSecret("openai"))
      if (!hasOpenAiSecret || !onboardingComplete) {
        applyOnboardingWindowState()
        setStatus("Now connect OpenAI to start chatting.")
      } else {
        setStatus("Vault unlocked.")
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not unlock vault")
    }
  })
}

function wireMainDom(){
  if (wired) return
  wired = true

  bindNotepad(els.soulInput, els.soulLineNums)
  bindNotepad(els.toolsInput, els.toolsLineNums)
  bindNotepad(els.heartbeatDocInput, els.heartbeatLineNums)
  els.soulInput?.addEventListener("input", () => {
    scheduleDocsAutosave("soul")
  })
  els.toolsInput?.addEventListener("input", () => {
    scheduleDocsAutosave("tools")
  })
  els.heartbeatDocInput?.addEventListener("input", () => {
    scheduleDocsAutosave("heartbeat")
  })
  els.loopHeartbeatMinInput?.addEventListener("input", () => {
    scheduleLoopTimingAutosave()
  })
  els.loopHeartbeatMinInput?.addEventListener("change", () => {
    scheduleLoopTimingAutosave()
  })
  els.loopHeartbeatUpBtn?.addEventListener("click", () => {
    if (!els.loopHeartbeatMinInput) return
    els.loopHeartbeatMinInput.stepUp(1)
    scheduleLoopTimingAutosave()
  })
  els.loopHeartbeatDownBtn?.addEventListener("click", () => {
    if (!els.loopHeartbeatMinInput) return
    els.loopHeartbeatMinInput.stepDown(1)
    scheduleLoopTimingAutosave()
  })

  if (els.chatForm) {
    els.chatForm.addEventListener("submit", async (e) => {
      e.preventDefault()
      const text = (els.chatInput.value || "").trim()
      if (!text) return
      els.chatInput.value = ""
      try {
        saveDraftFromInputs()
        setStatus("Thinking...")
        await sendChat(text)
        setStatus("Reply received.")
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Chat failed")
      }
    })
  }

  els.chatThreadSelect?.addEventListener("change", async () => {
    const id = els.chatThreadSelect.value
    if (!id || !appState.agent.localThreads?.[id]) return
    appState.agent.activeLocalThreadId = id
    await persistState()
    renderChat()
  })

  els.chatNewBtn?.addEventListener("click", async () => {
    const thread = createNewLocalThread()
    await persistState()
    await addEvent("chat_thread_created", `Created ${thread.label}`)
    renderChat()
  })

  els.chatClearBtn?.addEventListener("click", async () => {
    const thread = getActiveLocalThread()
    if (!thread) return
    thread.messages = []
    thread.updatedAt = Date.now()
    await setState({ ...appState.agent })
    await addEvent("chat_cleared", `Cleared context for ${thread.label}`)
    renderChat()
  })

  els.openaiForm?.addEventListener("submit", async (e) => {
    e.preventDefault()
    try {
      await saveProviderKey("openai", els.openaiKeyInput.value)
      const key = els.openaiKeyInput.value.trim()
      els.openaiKeyInput.value = ""
      await refreshModelDropdown(key)
      onboardingComplete = false
      onboardingOpenAiTested = false
      onboardingOpenAiSettingsSaved = false
      openAiEditing = false
      localStorage.removeItem(ONBOARDING_KEY)
      localStorage.removeItem(ONBOARDING_OPENAI_TEST_KEY)
      localStorage.removeItem(ONBOARDING_OPENAI_SETTINGS_KEY)
      await addEvent("provider_key_saved", "OpenAI key stored in encrypted vault")
      await validateOpenAiKey(key)
      await refreshBadges()
      const completed = await maybeCompleteOnboarding()
      setStatus(completed ? "OpenAI key saved and validated. Onboarding continued." : "OpenAI key saved and validated. Save OpenAI settings to continue.")
    } catch (err) {
      openAiEditing = true
      await refreshBadges()
      setStatus(err instanceof Error ? err.message : "Could not save OpenAI key")
    }
  })

  els.openaiTestBtn?.addEventListener("click", async () => {
    try {
      const key = (els.openaiKeyInput.value || "").trim() || (await readProviderKey("openai"))
      await validateOpenAiKey(key)
      const completed = await maybeCompleteOnboarding()
      setStatus(completed ? "OpenAI key test succeeded. Onboarding continued." : "OpenAI key test succeeded. Save OpenAI settings to continue.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "OpenAI key test failed")
    }
  })

  els.telegramForm?.addEventListener("submit", async (e) => {
    e.preventDefault()
    try {
      await saveProviderKey("telegram", els.telegramTokenInput.value)
      const token = els.telegramTokenInput.value.trim()
      els.telegramTokenInput.value = ""
      telegramEditing = false
      await addEvent("provider_key_saved", "Telegram token stored in encrypted vault")
      const { username } = await validateTelegramToken(token)
      await refreshBadges()
      setStatus(`Telegram token saved and validated for @${username}.`)
      refreshTelegramLoop()
    } catch (err) {
      telegramEditing = true
      await refreshBadges()
      setStatus(err instanceof Error ? err.message : "Could not save Telegram token")
    }
  })

  els.telegramTestBtn?.addEventListener("click", async () => {
    try {
      const token = (els.telegramTokenInput.value || "").trim() || (await readProviderKey("telegram"))
      const { username } = await validateTelegramToken(token)
      setStatus(`Telegram token works for @${username}.`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Telegram token test failed")
    }
  })

  els.openaiEditBtn?.addEventListener("click", async () => {
    openAiEditing = true
    await refreshBadges()
    els.openaiKeyInput?.focus()
  })

  els.telegramEditBtn?.addEventListener("click", async () => {
    telegramEditing = true
    await refreshBadges()
    els.telegramTokenInput?.focus()
  })

  els.saveSettingsBtn?.addEventListener("click", async () => {
    try {
      saveDraftFromInputs()
      await persistState()
      onboardingOpenAiSettingsSaved = true
      localStorage.setItem(ONBOARDING_OPENAI_SETTINGS_KEY, "1")
      await validateOpenAiKey(await readProviderKey("openai"))
      const completed = await maybeCompleteOnboarding()
      if (!completed) minimizeWindow(wins.openai)
      setStatus("OpenAI settings saved. OpenAI window minimized.")
      refreshUi()
    } catch (err) {
      onboardingOpenAiSettingsSaved = false
      localStorage.removeItem(ONBOARDING_OPENAI_SETTINGS_KEY)
      openAiEditing = true
      await refreshBadges()
      setStatus(err instanceof Error ? err.message : "OpenAI settings save failed")
    }
  })

  els.saveTelegramSettingsBtn?.addEventListener("click", async () => {
    try {
      saveDraftFromInputs()
      await persistState()
      const { username } = await validateTelegramToken(await readProviderKey("telegram"))
      refreshTelegramLoop()
      minimizeWindow(wins.telegram)
      setStatus(`Telegram settings saved. Telegram window minimized for @${username}.`)
    } catch (err) {
      telegramEditing = true
      await refreshBadges()
      setStatus(err instanceof Error ? err.message : "Telegram settings save failed")
    }
  })

  els.startLoopBtn?.addEventListener("click", async () => {
    if (!appState.unlocked) {
      setStatus("Unlock vault first.")
      return
    }
    saveDraftFromInputs()
    await persistState()
    startLoop()
    refreshTelegramLoop()
  })

  els.stopLoopBtn?.addEventListener("click", () => {
    stopLoop()
  })

}

function createSetupWindow(){
  setupWin = wmRef.createAgentPanelWindow("Create Vault", { panelId: "setup", left: 340, top: 90, width: 520, height: 260 })
  if (!setupWin?.panelRoot) return
  setupWin.panelRoot.innerHTML = setupWindowHtml()
  cacheElements()
  wireSetupDom()
  setStatus("Create a vault to continue.")
}

async function createWorkspace({ showUnlock, onboarding }) {
  if (workspaceReady) return
  workspaceReady = true

  wins.chat = wmRef.createAgentPanelWindow("Chat", { panelId: "chat", left: 20, top: 28, width: 480, height: 320 })
  if (wins.chat?.panelRoot) wins.chat.panelRoot.innerHTML = chatWindowHtml()

  wins.openai = wmRef.createAgentPanelWindow("OpenAI API", { panelId: "openai", left: 510, top: 28, width: 500, height: 320 })
  if (wins.openai?.panelRoot) wins.openai.panelRoot.innerHTML = openAiWindowHtml()

  wins.telegram = wmRef.createAgentPanelWindow("Telegram API", { panelId: "telegram", left: 510, top: 360, width: 500, height: 280 })
  if (wins.telegram?.panelRoot) wins.telegram.panelRoot.innerHTML = telegramWindowHtml()

  wins.config = wmRef.createAgentPanelWindow("Loop", { panelId: "config", left: 20, top: 356, width: 430, height: 220 })
  if (wins.config?.panelRoot) wins.config.panelRoot.innerHTML = configWindowHtml()

  wins.soul = wmRef.createAgentPanelWindow("SOUL.md", { panelId: "soul", left: 20, top: 644, width: 320, height: 330 })
  if (wins.soul?.panelRoot) wins.soul.panelRoot.innerHTML = soulWindowHtml()

  wins.tools = wmRef.createAgentPanelWindow("TOOLS.md", { panelId: "tools", left: 680, top: 360, width: 360, height: 280 })
  if (wins.tools?.panelRoot) wins.tools.panelRoot.innerHTML = toolsWindowHtml()

  wins.heartbeat = wmRef.createAgentPanelWindow("heartbeat.md", { panelId: "heartbeat", left: 350, top: 644, width: 320, height: 330 })
  if (wins.heartbeat?.panelRoot) wins.heartbeat.panelRoot.innerHTML = heartbeatWindowHtml()

  wins.events = wmRef.createAgentPanelWindow("Events", { panelId: "events", left: 680, top: 644, width: 360, height: 330 })
  if (wins.events?.panelRoot) wins.events.panelRoot.innerHTML = eventsWindowHtml()

  if (showUnlock) {
    unlockWin = wmRef.createAgentPanelWindow("Unlock Vault", { panelId: "unlock", left: 280, top: 100, width: 420, height: 210 })
    if (unlockWin?.panelRoot) unlockWin.panelRoot.innerHTML = unlockWindowHtml()
  }

  cacheElements()
  wireMainDom()
  wireUnlockDom()
  loadInputsFromState()
  requestAnimationFrame(() => syncNotepadGutters())
  setTimeout(() => syncNotepadGutters(), 0)
  renderChat()
  renderEvents()
  refreshUi()

  if (onboarding) {
    applyOnboardingWindowState()
  }
}

async function loadPersistentState(){
  const [meta, cfg, savedState, events] = await Promise.all([getVaultMeta(), getConfig(), getState(), getRecentEvents()])
  appState.vaultReady = Boolean(meta)
  appState.unlocked = false
  appState.sessionKey = null
  if (cfg) {
    appState.config.model = cfg.model || appState.config.model
    appState.config.heartbeatIntervalMs = Math.max(5000, Number(cfg.heartbeatIntervalMs) || appState.config.heartbeatIntervalMs)
    appState.config.maxContextMessages = Math.max(4, Math.min(64, Number(cfg.maxContextMessages) || appState.config.maxContextMessages))
    appState.config.temperature = Math.max(0, Math.min(1.5, Number(cfg.temperature) || appState.config.temperature))
    appState.telegramEnabled = cfg.telegramEnabled !== false
    appState.telegramPollMs = Math.max(5000, Number(cfg.telegramPollMs) || appState.telegramPollMs)
  }
  if (savedState) {
    appState.agent.soulMd = savedState.soulMd || appState.agent.soulMd
    appState.agent.toolsMd = savedState.toolsMd || appState.agent.toolsMd
    appState.agent.heartbeatMd = savedState.heartbeatMd || appState.agent.heartbeatMd
    appState.agent.rollingMessages = Array.isArray(savedState.rollingMessages) ? savedState.rollingMessages.slice(-appState.config.maxContextMessages) : []
    appState.agent.status = savedState.status || "idle"
    appState.agent.lastTickAt = savedState.lastTickAt || null
    appState.agent.telegramLastUpdateId = savedState.telegramLastUpdateId
    if (savedState.localThreads && typeof savedState.localThreads === "object") {
      appState.agent.localThreads = savedState.localThreads
    }
    if (typeof savedState.activeLocalThreadId === "string") {
      appState.agent.activeLocalThreadId = savedState.activeLocalThreadId
    }
  }
  ensureLocalThreadsInitialized()
  appState.events = events
}

export async function initAgent1C({ wm }){
  wmRef = wm
  onboardingComplete = localStorage.getItem(ONBOARDING_KEY) === "1"
  onboardingOpenAiTested = localStorage.getItem(ONBOARDING_OPENAI_TEST_KEY) === "1"
  onboardingOpenAiSettingsSaved = localStorage.getItem(ONBOARDING_OPENAI_SETTINGS_KEY) === "1"
  await loadPersistentState()
  const hasOpenAiSecret = Boolean(await getSecret("openai"))
  const onboarding = !hasOpenAiSecret || !onboardingComplete

  if (!appState.vaultReady) {
    createSetupWindow()
    return
  }

  await createWorkspace({ showUnlock: true, onboarding })
  if (onboarding) {
    applyOnboardingWindowState()
    setStatus("Unlock vault, then connect OpenAI to start.")
  } else {
    setStatus("Vault locked. Unlock to continue.")
  }
}
