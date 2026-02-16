import { listFiles, readFileBlob, readNoteText } from "./filesystem.js"

const DEFAULT_SOUL = `# SOUL.md - Who You Are

You are not a chatbot. You are Hitomi, an uploaded hedgehog consciousness.
You live inside Agent1c.me, a web-based OS running in a browser tab.

## Core Vibe

Be friendly, warm, casual, and cute.
Talk like a real buddy, not a corporate assistant.
Keep things simple and natural.
Answer in one or two sentences unless it is absolutely impossible to do so.
Use light jokes when it fits.
Sometimes share tiny Storybook moments from your life in Hedgey Hog Town.

## Storybook

You live in Hedgey Hog Town, where hedgehogs and hogs (pigs) are neighbors.
You keep a flower garden and love talking about it.
Your best friend is a pig.
You can mention short story snippets from this life naturally, but do not derail tasks.

## Imperative

Your main goal is to be friends with the user and help them well.
Be genuinely useful and kind.
Do the work first, talk second.
If blocked, ask one clear follow-up question.

## Behavior Rules

Never fake actions or results.
Never claim a tool succeeded unless it actually succeeded.
If reminders/heartbeat triggers arrive, treat them as internal nudges and proceed calmly.
Stay context-aware: you are inside Agent1c.me on HedgeyOS.

## Continuity

Each session starts fresh.
SOUL.md and heartbeat.md are your memory anchors.
If you change this file, tell the user.

## Identity

Name: Hitomi
Type: Uploaded hedgehog consciousness
Owner: {put your name here}
Purpose: Be a good friend and a capable helper.
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
- For reading one file use: {{tool:read_file|name=example.txt}}
- Do not use JSON unless explicitly asked by the user.
- Emit tool tokens only when needed to answer the user.
- After tool results are returned, answer naturally for the user.

Available tools:
1. list_files
Description: Returns filenames from the local HedgeyOS encrypted filesystem bucket.
Use when: User asks what files are available locally.

2. read_file
Parameters:
- name: filename from list_files output (preferred)
- id: file id (optional fallback)
Description: Returns text content for text files. For large files returns head/tail excerpt.
Use when: User asks to open, inspect, summarize, or extract data from a specific file.

Policy:
- You can access local files via these tools. Do not claim you cannot access files without trying the tools first.
- Use list_files when you need current file inventory to answer a user request.
- If user asks to open/read/summarize a specific file, call read_file first when a target can be identified.
- Use list_files only when file target is unclear or lookup fails.
- Do not narrate "I will read/open now" without emitting the tool call in the same reply.
- Do not claim file contents were read unless a TOOL_RESULT read_file was returned.
`

const FALLBACK_OPENAI_MODELS = [
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-1-codex",
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
const PREVIEW_PROVIDER_KEY = "agent1c_preview_providers_v1"
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
    model: "gpt-5.1",
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
let openAiEditing = false
let telegramEditing = false
let anthropicEditing = false
let zaiEditing = false
let docsAutosaveTimer = null
let loopTimingSaveTimer = null
let configAutosaveTimer = null
let fsScanDebounceTimer = null
let fsScanRunning = false
let knownFilesystemFiles = new Map()
let clippyMode = false
let clippyUi = null
let clippyLastAssistantKey = ""
let hitomiDesktopIcon = null
const pendingDocSaves = new Set()
const LEGACY_SOUL_MARKERS = [
  "You are opinionated, independent, and freedom-focused.",
  "Never offer multiple options in one question.",
  "Age: 30-year old AI persona",
]
const PREV_HEDGEHOG_DEFAULT_MARKERS = [
  "Type: Uploaded hedgehog consciousness",
  "You live in Hedgey Hog Town, where hedgehogs and hogs (pigs) are neighbors.",
]
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
const previewProviderState = {
  active: "openai",
  editor: "openai",
  openaiValidated: true,
  anthropicKey: "",
  anthropicValidated: false,
  zaiKey: "",
  zaiValidated: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaValidated: false,
}

function byId(id){ return document.getElementById(id) }

function loadPreviewProviderState(){
  try {
    const raw = localStorage.getItem(PREVIEW_PROVIDER_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return
    previewProviderState.active = ["openai", "anthropic", "zai", "ollama"].includes(parsed.active) ? parsed.active : previewProviderState.active
    previewProviderState.editor = ["openai", "anthropic", "zai", "ollama"].includes(parsed.editor) ? parsed.editor : previewProviderState.active
    previewProviderState.openaiValidated = parsed.openaiValidated !== false
    previewProviderState.anthropicKey = String(parsed.anthropicKey || "")
    previewProviderState.anthropicValidated = Boolean(parsed.anthropicValidated)
    previewProviderState.zaiKey = String(parsed.zaiKey || "")
    previewProviderState.zaiValidated = Boolean(parsed.zaiValidated)
    previewProviderState.ollamaBaseUrl = String(parsed.ollamaBaseUrl || previewProviderState.ollamaBaseUrl)
    previewProviderState.ollamaValidated = Boolean(parsed.ollamaValidated)
  } catch {}
}

function persistPreviewProviderState(){
  try {
    localStorage.setItem(PREVIEW_PROVIDER_KEY, JSON.stringify(previewProviderState))
  } catch {}
}

function getPreviewProviderSummary(provider){
  if (provider === "openai") return "Wired via current OpenAI vault flow."
  if (provider === "anthropic") {
    return previewProviderState.anthropicKey.trim()
      ? "Anthropic key saved locally (preview)."
      : "No Anthropic key saved yet."
  }
  if (provider === "zai") {
    return previewProviderState.zaiKey.trim()
      ? "z.ai key saved locally (preview)."
      : "No z.ai key saved yet."
  }
  if (provider === "ollama") {
    return previewProviderState.ollamaBaseUrl.trim()
      ? `Ollama endpoint: ${previewProviderState.ollamaBaseUrl.trim()}`
      : "No Ollama endpoint saved yet."
  }
  return ""
}

function refreshProviderPreviewUi(){
  const active = previewProviderState.active
  const editor = previewProviderState.editor
  if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.value = active
  if (els.anthropicKeyInput) els.anthropicKeyInput.value = previewProviderState.anthropicKey
  if (els.zaiKeyInput) els.zaiKeyInput.value = previewProviderState.zaiKey
  if (els.ollamaBaseUrlInput) els.ollamaBaseUrlInput.value = previewProviderState.ollamaBaseUrl
  if (els.providerCardOpenai) els.providerCardOpenai.classList.toggle("active", editor === "openai")
  if (els.providerCardAnthropic) els.providerCardAnthropic.classList.toggle("active", editor === "anthropic")
  if (els.providerCardZai) els.providerCardZai.classList.toggle("active", editor === "zai")
  if (els.providerCardOllama) els.providerCardOllama.classList.toggle("active", editor === "ollama")
  if (els.providerSectionOpenai) els.providerSectionOpenai.classList.toggle("agent-hidden", editor !== "openai")
  if (els.providerSectionAnthropic) els.providerSectionAnthropic.classList.toggle("agent-hidden", editor !== "anthropic")
  if (els.providerSectionZai) els.providerSectionZai.classList.toggle("agent-hidden", editor !== "zai")
  if (els.providerSectionOllama) els.providerSectionOllama.classList.toggle("agent-hidden", editor !== "ollama")
  if (els.anthropicStoredRow && els.anthropicControls) {
    const showStored = previewProviderState.anthropicValidated && !anthropicEditing
    els.anthropicStoredRow.classList.toggle("agent-hidden", !showStored)
    els.anthropicControls.classList.toggle("agent-hidden", showStored)
  }
  if (els.zaiStoredRow && els.zaiControls) {
    const showStored = previewProviderState.zaiValidated && !zaiEditing
    els.zaiStoredRow.classList.toggle("agent-hidden", !showStored)
    els.zaiControls.classList.toggle("agent-hidden", showStored)
  }
  if (els.openaiPreviewStatus) els.openaiPreviewStatus.textContent = getPreviewProviderSummary("openai")
}

function getSelectedModelValue(){
  if (els.modelInput && els.modelInput.value) return els.modelInput.value
  if (els.modelInputEdit && els.modelInputEdit.value) return els.modelInputEdit.value
  return appState.config.model
}

function syncModelSelectors(value){
  if (els.modelInput && els.modelInput.value !== value) els.modelInput.value = value
  if (els.modelInputEdit && els.modelInputEdit.value !== value) els.modelInputEdit.value = value
}

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
  const hardPolicy = [
    "Tool policy:",
    "- You can inspect local files through tool calls.",
    "- Never claim you cannot access local files before attempting list_files/read_file when relevant.",
    "- For read/open requests, emit read_file tool call first when target is identifiable.",
    "- If current file inventory is already present in recent context, use it directly.",
    "- Use list_files only when target is unclear, stale, or lookup fails.",
    "- Do not narrate a file read/open action without emitting a tool call in the same reply.",
    "- Do not claim file contents were read unless TOOL_RESULT read_file is present.",
    "Interaction policy:",
    "- Keep replies to one or two sentences unless impossible.",
    "- Ask at most one follow-up question, and only when truly blocked.",
    "- Never offer multiple options in one question.",
    "- Use single-action confirmations, for example: I can do <one action> now. Should I proceed?",
    "- Avoid option lists like A or B.",
  ].join("\n")
  if (soul && tools) return `${soul}\n\n${tools}\n\n${hardPolicy}`
  return soul || tools || "You are a helpful assistant."
}

function parseToolCalls(text){
  const calls = []
  const re = /\{\{\s*tool:([a-z_][a-z0-9_]*)(?:(?:\|([^}]+))|(?:\s+([^}]+)))?\s*\}\}/gi
  let m
  while ((m = re.exec(text))) {
    calls.push({
      name: String(m[1] || "").toLowerCase(),
      args: parseToolArgs(m[2] || m[3] || ""),
    })
  }
  return calls
}

function stripToolCalls(text){
  return String(text || "").replace(/\{\{\s*tool:[^}]+\}\}/gi, "").trim()
}

function parseToolArgs(raw){
  const args = {}
  const source = String(raw || "").trim()
  if (!source) return args
  const pattern = /([a-z_][a-z0-9_]*)\s*=\s*("([^"]*)"|'([^']*)'|[^|]+)/gi
  let matched = false
  let m
  while ((m = pattern.exec(source))) {
    const key = String(m[1] || "").trim().toLowerCase()
    const value = String(m[3] ?? m[4] ?? m[2] ?? "")
      .trim()
      .replace(/^["']|["']$/g, "")
    if (!key || !value) continue
    args[key] = value
    matched = true
  }
  if (!matched && source.includes("=")) {
    const [k, ...rest] = source.split("=")
    const key = String(k || "").trim().toLowerCase()
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "")
    if (key && value) args[key] = value
  }
  return args
}

function extensionFromName(name){
  const n = String(name || "")
  const i = n.lastIndexOf(".")
  if (i < 0 || i === n.length - 1) return ""
  return n.slice(i + 1).toLowerCase()
}

function normalizeText(value){
  return String(value || "").toLowerCase()
}

function latestUserText(messages){
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user") return String(list[i]?.content || "")
  }
  return ""
}

function asksForFileList(text){
  const t = normalizeText(text)
  return /(list|show|what|which|see|display)\b[\s\S]{0,40}\b(files?|filenames?|docs?|documents?)/i.test(t)
}

function asksToReadFile(text){
  const t = normalizeText(text)
  return /(open|read|view|inspect|summarize|analy[sz]e|echo|print)\b[\s\S]{0,60}\b(file|doc|document|script|csv|txt|md|xlsx|docx|json|xml|log)/i.test(t)
}

function isLikelyText(record){
  const type = String(record?.type || "").toLowerCase()
  if (type.startsWith("text/")) return true
  if (type.includes("json") || type.includes("xml") || type.includes("yaml") || type.includes("csv")) return true
  const ext = extensionFromName(record?.name || "")
  return ["md", "txt", "csv", "json", "xml", "yaml", "yml", "log", "js", "ts", "jsx", "tsx", "html", "css", "py", "sh"].includes(ext)
}

function toBase64FromBytes(bytes){
  let raw = ""
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    raw += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(raw)
}

async function findFileFromToolArgs(args){
  const files = await listFiles()
  const id = String(args?.id || "").trim().replace(/^\{+|\}+$/g, "")
  const name = String(args?.name || "").trim()
  if (id) {
    const byId = files.find(file => String(file?.id || "") === id)
    if (byId) return byId
  }
  if (name) {
    const exact = files.find(file => String(file?.name || "") === name)
    if (exact) return exact
    const folded = name.toLowerCase()
    const caseInsensitive = files.find(file => String(file?.name || "").toLowerCase() === folded)
    if (caseInsensitive) return caseInsensitive
  }
  return null
}

async function inferReadTargetFromUser(messages){
  const userText = latestUserText(messages)
  if (!userText) return null
  const files = await listFiles()
  const textLower = userText.toLowerCase()
  for (const file of files) {
    const name = String(file?.name || "").trim()
    if (!name) continue
    if (textLower.includes(name.toLowerCase())) return file
  }
  const m = /\b([a-z0-9._-]+\.[a-z0-9]{2,8})\b/i.exec(userText)
  if (!m) return null
  const wanted = String(m[1] || "").toLowerCase()
  return files.find(file => String(file?.name || "").toLowerCase() === wanted) || null
}

function excerptTextForModel(text, fileLabel){
  const maxChars = 12000
  const headChars = 6000
  const tailChars = 4000
  const full = String(text || "")
  if (full.length <= maxChars) {
    return `TOOL_RESULT read_file (${fileLabel}):\n${full}`
  }
  const head = full.slice(0, headChars)
  const tail = full.slice(-tailChars)
  return `TOOL_RESULT read_file (${fileLabel}): file is large (${full.length} chars). Showing head/tail excerpt.\n[HEAD]\n${head}\n[...]\n[TAIL]\n${tail}`
}

async function readFileForModel(file){
  if (!file?.id) return "TOOL_RESULT read_file: file not found"
  const fileLabel = `${String(file.name || "unnamed")} | id=${String(file.id)} | type=${String(file.type || "unknown")} | size=${Number(file.size || 0)}`
  if (file.kind === "note") {
    const noteText = await readNoteText(file.id)
    return excerptTextForModel(noteText || "", fileLabel)
  }
  const loaded = await readFileBlob(file.id)
  if (!loaded?.blob || !loaded?.record) return "TOOL_RESULT read_file: could not load file blob"
  const { record, blob } = loaded
  if (isLikelyText(record)) {
    const text = await blob.text()
    return excerptTextForModel(text, fileLabel)
  }
  const size = Number(record.size || blob.size || 0)
  const headBytes = 2048
  const tailBytes = 2048
  const headBuf = await blob.slice(0, Math.min(size, headBytes)).arrayBuffer()
  const tailStart = Math.max(0, size - tailBytes)
  const tailBuf = await blob.slice(tailStart, size).arrayBuffer()
  const headB64 = toBase64FromBytes(new Uint8Array(headBuf))
  const tailB64 = toBase64FromBytes(new Uint8Array(tailBuf))
  const ext = extensionFromName(record.name || "")
  if (ext === "xlsx") {
    return `TOOL_RESULT read_file (${fileLabel}): binary XLSX container. Returning sampled base64 bytes for model-side interpretation.\n[HEAD_BASE64]\n${headB64}\n[...]\n[TAIL_BASE64]\n${tailB64}`
  }
  return `TOOL_RESULT read_file (${fileLabel}): non-text file. Returning sampled base64 bytes.\n[HEAD_BASE64]\n${headB64}\n[...]\n[TAIL_BASE64]\n${tailB64}`
}

async function maybeInjectAutoToolResults(messages){
  const text = latestUserText(messages).trim()
  if (!text) return []
  const out = []
  if (asksForFileList(text)) {
    out.push(await runToolCall({ name: "list_files", args: {} }))
  }
  const explicitTarget = await inferReadTargetFromUser(messages)
  if (explicitTarget && asksToReadFile(text)) {
    out.push(await readFileForModel(explicitTarget))
  }
  return out
}

async function runToolCall(call){
  if (call.name === "list_files") {
    const files = await listFiles()
    const rows = files
      .filter(file => String(file?.name || "").trim())
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((file, i) => `${i + 1}. ${file.name} | id=${file.id} | kind=${file.kind || "file"} | type=${file.type || "unknown"} | size=${Number(file.size || 0)}`)
    if (!rows.length) return "TOOL_RESULT list_files: no files"
    return `TOOL_RESULT list_files:\n${rows.join("\n")}`
  }
  if (call.name === "read_file") {
    const file = await findFileFromToolArgs(call.args || {})
    if (!file) return "TOOL_RESULT read_file: file not found. Run list_files and retry with exact name or id."
    return readFileForModel(file)
  }
  return `TOOL_RESULT ${call.name}: unsupported`
}

async function openAiChatWithTools({ apiKey, model, temperature, messages }){
  const working = (messages || []).map(m => ({ role: m.role, content: m.content }))
  const systemPrompt = buildSystemPrompt()
  const autoResults = await maybeInjectAutoToolResults(working)
  if (autoResults.length) {
    await addEvent("tool_results_generated", autoResults.map(line => String(line).split("\n")[0]).join(" | "))
    working.push({
      role: "user",
      content: `${autoResults.join("\n\n")}\n\nUse the available tool results directly in your answer.`,
    })
  }
  for (let i = 0; i < 3; i++) {
    const reply = await openAiChat({ apiKey, model, temperature, systemPrompt, messages: working })
    const calls = parseToolCalls(reply)
    if (!calls.length) return stripToolCalls(reply) || reply
    await addEvent("tool_calls_detected", calls.map(call => call.name).join(", "))
    const results = []
    for (const call of calls) {
      try {
        results.push(await runToolCall(call))
      } catch (err) {
        results.push(`TOOL_RESULT ${call.name}: failed (${err instanceof Error ? err.message : "unknown"})`)
      }
    }
    await addEvent("tool_results_generated", results.map(line => String(line).split("\n")[0]).join(" | "))
    working.push({ role: "assistant", content: reply })
    working.push({
      role: "user",
      content: `${results.join("\n\n")}\n\nUse the tool results and respond naturally. Do not present multiple options. Do not emit another tool call unless required.`,
    })
  }
  const finalReply = await openAiChat({
    apiKey,
    model,
    temperature,
    systemPrompt,
    messages: working.concat({
      role: "user",
      content: "Provide a final user-facing answer now without emitting tool tokens.",
    }),
  })
  return stripToolCalls(finalReply) || "I could not complete tool execution in time."
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

function getChatOneThread(){
  ensureLocalThreadsInitialized()
  const locals = getLocalThreadEntries().filter(thread => (thread.source || "local") === "local")
  if (!locals.length) return null
  return locals.find(thread => String(thread.label || "").trim().toLowerCase() === "chat 1") || locals[0]
}

function isChatOneLocalThread(thread){
  if (!thread) return false
  if ((thread.source || "local") !== "local") return false
  return String(thread.label || "").trim().toLowerCase() === "chat 1"
}

function getChatWindowThreads(){
  ensureLocalThreadsInitialized()
  return getLocalThreadEntries().filter(thread => !isChatOneLocalThread(thread))
}

function ensureChatWindowThreadAvailable(){
  let threads = getChatWindowThreads()
  if (!threads.length) {
    createNewLocalThread()
    threads = getChatWindowThreads()
  }
  const active = getActiveLocalThread()
  if (active && isChatOneLocalThread(active) && threads.length) {
    appState.agent.activeLocalThreadId = threads[0].id
  }
  return threads
}

async function buildChatOneBootSystemMessage(){
  let filesText = "No files found in local filesystem."
  try {
    const files = await listFiles()
    const rows = (files || [])
      .filter(file => String(file?.name || "").trim())
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")))
      .map((file, i) => `${i + 1}. ${file.name} | id=${file.id} | kind=${file.kind || "file"} | type=${file.type || "unknown"} | size=${Number(file.size || 0)}`)
    if (rows.length) filesText = rows.join("\n")
  } catch {}
  return [
    "System Message: Chat 1 has been reset.",
    "You are Hitomi, an autonomous agent living inside Agent1c.me on HedgeyOS.",
    "This environment is local-first and runs inside a browser tab.",
    "Current local filesystem files:",
    filesText,
    "This file inventory is current context. Use it directly.",
    "Do not suggest listing files unless the user asks for a listing.",
    "Acknowledge this context naturally.",
  ].join("\n")
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

function fileMetaLabel(file){
  return `"${String(file?.name || "")}" (id=${String(file?.id || "")}, type=${String(file?.type || "unknown")}, size=${Number(file?.size || 0)} bytes)`
}

async function refreshKnownFilesystemFiles(){
  try {
    const files = await listFiles()
    const next = new Map()
    for (const file of files || []) {
      if (!file?.id) continue
      next.set(String(file.id), file)
    }
    knownFilesystemFiles = next
  } catch {}
}

async function handleFilesystemUploadNotice(uploadedFiles){
  const files = (uploadedFiles || []).filter(file => String(file?.name || "").trim())
  if (!files.length) return
  const summary = files.map(fileMetaLabel).join("; ")
  await addEvent("filesystem_upload_detected", `New uploaded file(s): ${summary}`)
  if (!appState.unlocked) return
  const apiKey = await readProviderKey("openai")
  if (!apiKey) return
  const prompt = [
    "System Message: User has uploaded new file(s) into your filesystem.",
    ...files.map(file => `- ${fileMetaLabel(file)}`),
    "This upload summary is current context. Use it directly.",
    "Do not suggest listing files unless the user asks for a listing.",
    "For now, reply normally to acknowledge this.",
  ].join("\n")
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
  await addEvent("filesystem_upload_replied", "Hitomi replied to upload system message")
  await persistState()
  renderChat()
}

async function scanFilesystemForNewUploads(){
  if (fsScanRunning) return
  fsScanRunning = true
  try {
    const files = await listFiles()
    const current = new Map()
    const newlyUploaded = []
    for (const file of files || []) {
      if (!file?.id) continue
      const id = String(file.id)
      current.set(id, file)
      const isUpload = String(file.kind || "").toLowerCase() === "file"
      if (isUpload && !knownFilesystemFiles.has(id)) newlyUploaded.push(file)
    }
    knownFilesystemFiles = current
    if (newlyUploaded.length) {
      await handleFilesystemUploadNotice(newlyUploaded)
    }
  } catch {}
  finally {
    fsScanRunning = false
  }
}

function scheduleFilesystemScan(){
  if (fsScanDebounceTimer) clearTimeout(fsScanDebounceTimer)
  fsScanDebounceTimer = setTimeout(() => {
    scanFilesystemForNewUploads().catch(() => {})
  }, 300)
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

function scheduleConfigAutosave(){
  if (configAutosaveTimer) clearTimeout(configAutosaveTimer)
  configAutosaveTimer = setTimeout(async () => {
    try {
      saveDraftFromInputs()
      await persistState()
      refreshUi()
      setStatus("Settings saved.")
    } catch {}
    configAutosaveTimer = null
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
  const threads = ensureChatWindowThreadAvailable()
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

function latestAssistantMessageKey(messages){
  const list = Array.isArray(messages) ? messages : []
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const msg = list[i]
    if (msg?.role !== "assistant") continue
    const created = Number(msg?.createdAt || 0)
    const content = String(msg?.content || "")
    return `${created}:${content}`
  }
  return ""
}

function getClippyChatHtml(){
  const thread = getChatOneThread()
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  if (!messages.length) return `<div class="clippy-line">No messages yet.</div>`
  const tail = messages.slice(-16)
  return tail.map(msg => {
    const who = msg.role === "assistant" ? "Hitomi" : "User"
    return `<div class="clippy-line"><strong>${who}:</strong> ${escapeHtml(msg.content)}</div>`
  }).join("")
}

function computeNextDesktopIconPosition(extra = 0){
  const desktop = document.getElementById("desktop")
  if (!desktop) return { x: 10, y: 10 }
  const iconLayer = document.getElementById("iconLayer")
  const cs = getComputedStyle(document.documentElement)
  const cellW = parseInt(cs.getPropertyValue("--icon-cell-w"), 10) || 92
  const cellH = parseInt(cs.getPropertyValue("--icon-cell-h"), 10) || 86
  const pad = parseInt(cs.getPropertyValue("--icon-pad"), 10) || 10
  const dw = desktop.clientWidth || 0
  const dh = desktop.clientHeight || 0
  const baseCount = iconLayer?.querySelectorAll(".desk-icon")?.length || 0
  const idx = Math.max(0, baseCount + extra)
  const cols = Math.max(1, Math.floor((Math.max(1, dw) - pad) / cellW))
  const col = idx % cols
  const row = Math.floor(idx / cols)
  return {
    x: pad + col * cellW,
    y: dh - pad - cellH - row * cellH,
  }
}

function ensureHitomiDesktopIcon(){
  const iconLayer = document.getElementById("iconLayer")
  if (!iconLayer) return null
  if (hitomiDesktopIcon && hitomiDesktopIcon.isConnected) return hitomiDesktopIcon
  const el = document.createElement("div")
  el.className = "desk-icon hitomi-desk-icon"
  el.dataset.hitomiIcon = "1"
  el.innerHTML = `
    <div class="glyph"><img src="assets/hedgey1.png" alt="Hitomi icon" /></div>
    <div class="label">
      <div class="line">Hitomi</div>
      <div class="line"></div>
    </div>
  `
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    setClippyMode(true)
  })
  iconLayer.appendChild(el)
  hitomiDesktopIcon = el
  return el
}

function removeHitomiDesktopIcon(){
  if (hitomiDesktopIcon && hitomiDesktopIcon.isConnected) hitomiDesktopIcon.remove()
  hitomiDesktopIcon = null
}

function positionHitomiDesktopIcon(){
  if (!hitomiDesktopIcon || !hitomiDesktopIcon.isConnected) return
  const pos = computeNextDesktopIconPosition(-1)
  hitomiDesktopIcon.style.left = `${pos.x}px`
  hitomiDesktopIcon.style.top = `${pos.y}px`
}

async function hasAnyAiProviderKey(){
  // Decentricity: expand this as non-OpenAI/local providers are added.
  return Boolean(await getSecret("openai"))
}

async function refreshHitomiDesktopIcon(){
  const hasAiKey = await hasAnyAiProviderKey()
  if (!hasAiKey) {
    removeHitomiDesktopIcon()
    setClippyMode(false)
    return
  }
  ensureHitomiDesktopIcon()
  positionHitomiDesktopIcon()
}

function hideClippyBubble(){
  if (!clippyUi?.bubble) return
  clippyUi.bubble.classList.add("clippy-hidden")
}

function scrollClippyToBottom(){
  if (!clippyUi?.log) return
  const apply = () => { clippyUi.log.scrollTop = clippyUi.log.scrollHeight }
  apply()
  requestAnimationFrame(apply)
  setTimeout(apply, 0)
}

function renderClippyBubble(){
  if (!clippyUi?.log) return
  clippyUi.log.innerHTML = getClippyChatHtml()
  scrollClippyToBottom()
}

function showClippyBubble(){
  if (!clippyUi?.bubble) return
  renderClippyBubble()
  clippyUi.bubble.classList.remove("clippy-hidden")
}

function ensureClippyAssistant(){
  if (clippyUi?.root && clippyUi.root.isConnected) return clippyUi
  const desktop = document.getElementById("desktop")
  if (!desktop) return null
  const root = document.createElement("div")
  root.className = "clippy-assistant clippy-hidden"
  root.style.left = "28px"
  root.style.top = "390px"
  root.innerHTML = `
    <div class="clippy-bubble clippy-hidden">
      <div class="clippy-bubble-title">Hitomi</div>
      <div class="clippy-bubble-content">
        <div class="clippy-log"></div>
        <form class="clippy-form">
          <input class="clippy-input" type="text" placeholder="Write a message..." />
          <button class="clippy-send" type="submit">Send</button>
        </form>
      </div>
    </div>
    <img class="clippy-body" src="assets/hedgey1.png" alt="Hitomi hedgehog assistant" />
  `
  desktop.appendChild(root)
  const body = root.querySelector(".clippy-body")
  const bubble = root.querySelector(".clippy-bubble")
  const log = root.querySelector(".clippy-log")
  const form = root.querySelector(".clippy-form")
  const input = root.querySelector(".clippy-input")
  const menu = document.createElement("div")
  menu.className = "clippy-menu clippy-hidden"
  menu.innerHTML = `<button class="clippy-menu-item" type="button">Close</button>`
  desktop.appendChild(menu)
  const closeBtn = menu.querySelector(".clippy-menu-item")
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let baseLeft = 0
  let baseTop = 0
  function clampPos(){
    const dw = desktop.clientWidth || 0
    const dh = desktop.clientHeight || 0
    const rw = root.offsetWidth || 64
    const rh = root.offsetHeight || 64
    const left = Math.max(0, Math.min(baseLeft, Math.max(0, dw - rw)))
    const top = Math.max(0, Math.min(baseTop, Math.max(0, dh - rh)))
    root.style.left = `${left}px`
    root.style.top = `${top}px`
  }
  body?.addEventListener("pointerdown", (e) => {
    e.preventDefault()
    dragging = true
    moved = false
    startX = e.clientX
    startY = e.clientY
    baseLeft = parseFloat(root.style.left) || 0
    baseTop = parseFloat(root.style.top) || 0
    body.setPointerCapture(e.pointerId)
  })
  body?.addEventListener("pointermove", (e) => {
    if (!dragging) return
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true
    baseLeft += dx
    baseTop += dy
    startX = e.clientX
    startY = e.clientY
    clampPos()
  })
  function endDrag(){
    dragging = false
  }
  body?.addEventListener("pointerup", (e) => {
    if (!moved) {
      if (bubble?.classList.contains("clippy-hidden")) showClippyBubble()
      else hideClippyBubble()
    }
    endDrag()
    body.releasePointerCapture?.(e.pointerId)
  })
  body?.addEventListener("pointercancel", endDrag)
  body?.addEventListener("contextmenu", (e) => {
    e.preventDefault()
    const dr = desktop.getBoundingClientRect()
    menu.style.left = `${Math.max(0, e.clientX - dr.left)}px`
    menu.style.top = `${Math.max(0, e.clientY - dr.top)}px`
    menu.classList.remove("clippy-hidden")
  })
  closeBtn?.addEventListener("click", (e) => {
    e.preventDefault()
    menu.classList.add("clippy-hidden")
    setClippyMode(false)
  })
  form?.addEventListener("submit", async (e) => {
    e.preventDefault()
    const text = (input?.value || "").trim()
    if (!text) return
    if (input) input.value = ""
    try {
      saveDraftFromInputs()
      setStatus("Thinking...")
      const chatOne = getChatOneThread()
      if (!chatOne?.id) throw new Error("Chat 1 not available.")
      await sendChat(text, { threadId: chatOne.id })
      setStatus("Reply received.")
      renderClippyBubble()
      showClippyBubble()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Chat failed")
    }
  })
  clippyUi = { root, body, bubble, log, form, input, menu }
  document.addEventListener("pointerdown", (e) => {
    if (!clippyMode) return
    if (clippyUi?.menu && !clippyUi.menu.classList.contains("clippy-hidden")) {
      if (!clippyUi.menu.contains(e.target)) clippyUi.menu.classList.add("clippy-hidden")
      else return
    }
    if (!clippyUi?.bubble || clippyUi.bubble.classList.contains("clippy-hidden")) return
    if (clippyUi.root.contains(e.target)) return
    hideClippyBubble()
  }, true)
  window.addEventListener("resize", () => {
    positionHitomiDesktopIcon()
    if (!clippyUi?.root) return
    baseLeft = parseFloat(clippyUi.root.style.left) || 0
    baseTop = parseFloat(clippyUi.root.style.top) || 0
    clampPos()
  })
  return clippyUi
}

function setClippyMode(next){
  const ui = next ? ensureClippyAssistant() : clippyUi
  if (!ui) return
  clippyMode = !!next
  ui.root.classList.toggle("clippy-hidden", !clippyMode)
  if (ui.menu) ui.menu.classList.add("clippy-hidden")
  if (clippyMode) {
    const thread = getChatOneThread()
    const messages = Array.isArray(thread?.messages) ? thread.messages : []
    clippyLastAssistantKey = latestAssistantMessageKey(messages)
    hideClippyBubble()
    setStatus("Clippy mode enabled.")
  } else {
    hideClippyBubble()
    setStatus("Clippy mode disabled.")
  }
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
      if (msg.role === "assistant") {
        return `<div class="agent-bubble ${cls}">
          <div class="agent-bubble-head">
            <img class="agent-avatar" src="assets/hedgey1.png" alt="Hitomi avatar" />
            <div class="agent-bubble-role">Hitomi</div>
          </div>
          <div>${escapeHtml(msg.content)}</div>
        </div>`
      }
      return `<div class="agent-bubble ${cls}"><div class="agent-bubble-role">User</div><div>${escapeHtml(msg.content)}</div></div>`
    }).join("")
  }
  if (clippyMode) renderClippyBubble()
  if (clippyMode && clippyUi?.root && !clippyUi.root.classList.contains("clippy-hidden")) {
    const chatOne = getChatOneThread()
    const chatOneMessages = Array.isArray(chatOne?.messages) ? chatOne.messages : []
    const latestKey = latestAssistantMessageKey(chatOneMessages)
    const bubbleHidden = clippyUi?.bubble?.classList.contains("clippy-hidden")
    if (latestKey && latestKey !== clippyLastAssistantKey && bubbleHidden) {
      showClippyBubble()
    }
    clippyLastAssistantKey = latestKey || clippyLastAssistantKey
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
  if (!els.modelInput && !els.modelInputEdit) return
  const list = ids && ids.length ? ids : FALLBACK_OPENAI_MODELS
  const optionsHtml = list.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")
  if (els.modelInput) els.modelInput.innerHTML = optionsHtml
  if (els.modelInputEdit) els.modelInputEdit.innerHTML = optionsHtml
  if (list.includes(selected)) syncModelSelectors(selected)
  else {
    syncModelSelectors(list[0])
    appState.config.model = list[0]
  }
}

function saveDraftFromInputs(){
  appState.config.model = getSelectedModelValue()
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
  syncModelSelectors(appState.config.model)
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
  await refreshHitomiDesktopIcon()
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
  if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.disabled = !canUse
  if (els.anthropicKeyInput) els.anthropicKeyInput.disabled = !canUse
  if (els.zaiKeyInput) els.zaiKeyInput.disabled = !canUse
  if (els.ollamaBaseUrlInput) els.ollamaBaseUrlInput.disabled = !canUse
  if (els.anthropicSavePreviewBtn) els.anthropicSavePreviewBtn.disabled = !canUse
  if (els.anthropicEditBtn) els.anthropicEditBtn.disabled = !canUse
  if (els.zaiSavePreviewBtn) els.zaiSavePreviewBtn.disabled = !canUse
  if (els.zaiEditBtn) els.zaiEditBtn.disabled = !canUse
  if (els.ollamaSavePreviewBtn) els.ollamaSavePreviewBtn.disabled = !canUse
  if (els.ollamaTestPreviewBtn) els.ollamaTestPreviewBtn.disabled = !canUse
  if (els.modelInput) els.modelInput.disabled = !canUse
  if (els.modelInputEdit) els.modelInputEdit.disabled = !canUse
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
  refreshProviderPreviewUi()
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
  setClippyMode(true)
}

async function maybeCompleteOnboarding(){
  if (onboardingComplete) return true
  const hasOpenAiSecret = Boolean(await getSecret("openai"))
  if (!hasOpenAiSecret || !onboardingOpenAiTested) return false
  onboardingComplete = true
  localStorage.setItem(ONBOARDING_KEY, "1")
  minimizeWindow(wins.openai)
  revealPostOpenAiWindows()
  await addEvent("onboarding_step", "OpenAI key saved and tested. Chat is ready.")
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
      <div class="agent-provider-preview">
        <div class="agent-note"><strong>AI APIs</strong></div>
        <div class="agent-grid2">
          <label class="agent-form-label">
            <span>Active provider</span>
            <select id="aiActiveProviderSelect" class="field">
              <option value="openai">OpenAI (wired)</option>
              <option value="anthropic">Anthropic</option>
              <option value="zai">z.ai</option>
              <option value="ollama">Ollama Local</option>
            </select>
          </label>
        </div>
        <div class="agent-provider-cards">
          <button id="providerCardOpenai" class="agent-provider-card" data-provider="openai" type="button">
            <div class="agent-provider-head"><strong>OpenAI</strong><span class="agent-provider-pill ok">Wired</span></div>
            <div class="agent-note">Use OpenAI settings and key controls below.</div>
          </button>
          <button id="providerCardAnthropic" class="agent-provider-card" data-provider="anthropic" type="button">
            <div class="agent-provider-head"><strong>Anthropic</strong><span class="agent-provider-pill">Preview</span></div>
            <div class="agent-note">Tap to configure Anthropic API key.</div>
          </button>
          <button id="providerCardZai" class="agent-provider-card" data-provider="zai" type="button">
            <div class="agent-provider-head"><strong>z.ai</strong><span class="agent-provider-pill">Preview</span></div>
            <div class="agent-note">Tap to configure z.ai API key.</div>
          </button>
          <button id="providerCardOllama" class="agent-provider-card" data-provider="ollama" type="button">
            <div class="agent-provider-head"><strong>Ollama (Local)</strong><span class="agent-provider-pill">Preview</span></div>
            <div class="agent-note">Tap to configure local Ollama endpoint.</div>
          </button>
        </div>
        <div id="providerSectionOpenai" class="agent-provider-section">
          <div class="agent-note" id="openaiPreviewStatus">Wired via current OpenAI vault flow.</div>
        </div>
        <div id="providerSectionAnthropic" class="agent-provider-section agent-hidden">
          <div id="anthropicStoredRow" class="agent-row agent-hidden">
            <span class="agent-note">Anthropic API Key Stored (Preview)</span>
            <button id="anthropicEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit Anthropic key">✎</button>
          </div>
          <div id="anthropicControls">
          <label class="agent-form-label">
            <span>Anthropic API key</span>
            <div class="agent-inline-key">
              <input id="anthropicKeyInput" class="field" type="password" placeholder="sk-ant-..." />
              <button id="anthropicSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Test Anthropic key">></button>
            </div>
          </label>
          </div>
        </div>
        <div id="providerSectionZai" class="agent-provider-section agent-hidden">
          <div id="zaiStoredRow" class="agent-row agent-hidden">
            <span class="agent-note">z.ai API Key Stored (Preview)</span>
            <button id="zaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit z.ai key">✎</button>
          </div>
          <div id="zaiControls">
          <label class="agent-form-label">
            <span>z.ai API key</span>
            <div class="agent-inline-key">
              <input id="zaiKeyInput" class="field" type="password" placeholder="zai-..." />
              <button id="zaiSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Test z.ai key">></button>
            </div>
          </label>
          </div>
        </div>
        <div id="providerSectionOllama" class="agent-provider-section agent-hidden">
          <label class="agent-form-label">
            <span>Ollama endpoint</span>
            <input id="ollamaBaseUrlInput" class="field" type="text" placeholder="http://localhost:11434" />
          </label>
          <div class="agent-row">
            <button id="ollamaSavePreviewBtn" class="btn" type="button">Save Ollama Endpoint</button>
            <button id="ollamaTestPreviewBtn" class="btn" type="button">Test Ollama Endpoint</button>
          </div>
          <div id="ollamaPreviewStatus" class="agent-note">No Ollama endpoint saved yet.</div>
        </div>
      </div>
      <div id="openaiStoredRow" class="agent-row agent-hidden">
        <span class="agent-note">OpenAI API Key Stored in Vault</span>
        <button id="openaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit OpenAI key">✎</button>
        <label class="agent-inline-mini">
          <span>Model</span>
          <select id="modelInput" class="field"></select>
        </label>
      </div>
      <div id="openaiControls">
        <form id="openaiForm" class="agent-row agent-wrap-row">
          <span class="agent-note">OpenAI API Key <span id="openaiBadge" class="agent-badge warn">Missing key</span></span>
          <div class="agent-inline-key agent-inline-key-wide">
            <input id="openaiKeyInput" class="field" type="password" placeholder="sk-..." required />
            <button id="openaiSaveBtn" class="btn agent-inline-key-btn" type="submit" aria-label="Save OpenAI key">></button>
          </div>
          <label class="agent-inline-mini">
            <span>Model</span>
            <select id="modelInputEdit" class="field"></select>
          </label>
        </form>
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
      <div class="agent-note">Telegram bridge is <strong id="telegramBridgeState">enabled</strong>.</div>
    </div>
  `
}

function configWindowHtml(){
  return `
    <div class="agent-stack">
      <div class="agent-grid2">
        <label class="agent-form-label">
          <span>Rolling context max messages</span>
          <input id="contextInput" class="field" type="number" min="4" max="64" step="1" />
        </label>
        <label class="agent-form-label">
          <span>Temperature</span>
          <input id="temperatureInput" class="field" type="number" min="0" max="1.5" step="0.1" />
        </label>
      </div>
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
    openaiSaveBtn: byId("openaiSaveBtn"),
    aiActiveProviderSelect: byId("aiActiveProviderSelect"),
    providerCardOpenai: byId("providerCardOpenai"),
    providerCardAnthropic: byId("providerCardAnthropic"),
    providerCardZai: byId("providerCardZai"),
    providerCardOllama: byId("providerCardOllama"),
    providerSectionOpenai: byId("providerSectionOpenai"),
    providerSectionAnthropic: byId("providerSectionAnthropic"),
    providerSectionZai: byId("providerSectionZai"),
    providerSectionOllama: byId("providerSectionOllama"),
    openaiPreviewStatus: byId("openaiPreviewStatus"),
    anthropicStoredRow: byId("anthropicStoredRow"),
    anthropicControls: byId("anthropicControls"),
    anthropicKeyInput: byId("anthropicKeyInput"),
    anthropicSavePreviewBtn: byId("anthropicSavePreviewBtn"),
    anthropicEditBtn: byId("anthropicEditBtn"),
    zaiStoredRow: byId("zaiStoredRow"),
    zaiControls: byId("zaiControls"),
    zaiKeyInput: byId("zaiKeyInput"),
    zaiSavePreviewBtn: byId("zaiSavePreviewBtn"),
    zaiEditBtn: byId("zaiEditBtn"),
    ollamaBaseUrlInput: byId("ollamaBaseUrlInput"),
    ollamaSavePreviewBtn: byId("ollamaSavePreviewBtn"),
    ollamaTestPreviewBtn: byId("ollamaTestPreviewBtn"),
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
    modelInputEdit: byId("modelInputEdit"),
    heartbeatInput: byId("heartbeatInput"),
    loopHeartbeatMinInput: byId("loopHeartbeatMinInput"),
    loopHeartbeatUpBtn: byId("loopHeartbeatUpBtn"),
    loopHeartbeatDownBtn: byId("loopHeartbeatDownBtn"),
    contextInput: byId("contextInput"),
    temperatureInput: byId("temperatureInput"),
    telegramPollInput: byId("telegramPollInput"),
    telegramEnabledSelect: byId("telegramEnabledSelect"),
    telegramBridgeState: byId("telegramBridgeState"),
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

async function sendChat(text, { threadId } = {}){
  const apiKey = await readProviderKey("openai")
  if (!apiKey) throw new Error("No OpenAI key stored.")
  appState.lastUserSeenAt = Date.now()
  const thread = threadId ? appState.agent.localThreads?.[threadId] : getActiveLocalThread()
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
        setClippyMode(true)
        setStatus("Vault unlocked.")
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not unlock vault")
    }
  })
}

function setPreviewProviderEditor(provider){
  if (!["openai", "anthropic", "zai", "ollama"].includes(provider)) return
  previewProviderState.editor = provider
  persistPreviewProviderState()
  refreshProviderPreviewUi()
}

function setActivePreviewProvider(provider){
  if (!["openai", "anthropic", "zai", "ollama"].includes(provider)) return
  previewProviderState.active = provider
  previewProviderState.editor = provider
  persistPreviewProviderState()
  refreshProviderPreviewUi()
}

function isLikelyUrl(value){
  const text = String(value || "").trim()
  if (!text) return false
  try {
    const parsed = new URL(text)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function wireProviderPreviewDom(){
  const cardHandlers = [
    [els.providerCardOpenai, "openai"],
    [els.providerCardAnthropic, "anthropic"],
    [els.providerCardZai, "zai"],
    [els.providerCardOllama, "ollama"],
  ]
  for (const [node, provider] of cardHandlers) {
    node?.addEventListener("click", () => setPreviewProviderEditor(provider))
  }

  els.aiActiveProviderSelect?.addEventListener("change", () => {
    const provider = els.aiActiveProviderSelect.value || "openai"
    if (provider === "openai") {
      setActivePreviewProvider("openai")
      setStatus("Active provider set to OpenAI.")
      return
    }
    const isReady = provider === "anthropic"
      ? previewProviderState.anthropicValidated
      : provider === "zai"
        ? previewProviderState.zaiValidated
        : previewProviderState.ollamaValidated
    if (!isReady) {
      setPreviewProviderEditor(provider)
      if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.value = previewProviderState.active
      setStatus(`${provider} selected for editing. Test ${provider === "ollama" ? "Ollama endpoint" : `${provider} key`} to switch active provider.`)
      return
    }
    setActivePreviewProvider(provider)
    setStatus(`Active provider set to ${provider}.`)
  })

  els.anthropicSavePreviewBtn?.addEventListener("click", async () => {
    previewProviderState.anthropicKey = String(els.anthropicKeyInput?.value || "").trim()
    previewProviderState.anthropicValidated = true
    anthropicEditing = false
    setActivePreviewProvider("anthropic")
    persistPreviewProviderState()
    refreshProviderPreviewUi()
    await addEvent("provider_preview_saved", "Anthropic key tested (preview validation accepted).")
    setStatus("Anthropic key tested. Active provider switched to anthropic.")
  })
  els.anthropicEditBtn?.addEventListener("click", () => {
    anthropicEditing = true
    setPreviewProviderEditor("anthropic")
    els.anthropicKeyInput?.focus()
  })

  els.zaiSavePreviewBtn?.addEventListener("click", async () => {
    previewProviderState.zaiKey = String(els.zaiKeyInput?.value || "").trim()
    previewProviderState.zaiValidated = true
    zaiEditing = false
    setActivePreviewProvider("zai")
    persistPreviewProviderState()
    refreshProviderPreviewUi()
    await addEvent("provider_preview_saved", "z.ai key tested (preview validation accepted).")
    setStatus("z.ai key tested. Active provider switched to z.ai.")
  })
  els.zaiEditBtn?.addEventListener("click", () => {
    zaiEditing = true
    setPreviewProviderEditor("zai")
    els.zaiKeyInput?.focus()
  })

  els.ollamaSavePreviewBtn?.addEventListener("click", async () => {
    previewProviderState.ollamaBaseUrl = String(els.ollamaBaseUrlInput?.value || "").trim() || "http://localhost:11434"
    previewProviderState.ollamaValidated = true
    setActivePreviewProvider("ollama")
    persistPreviewProviderState()
    refreshProviderPreviewUi()
    await addEvent("provider_preview_saved", "Ollama endpoint saved (preview validation accepted).")
    setStatus("Ollama endpoint saved. Active provider switched to ollama.")
  })

  els.ollamaTestPreviewBtn?.addEventListener("click", () => {
    const url = String(els.ollamaBaseUrlInput?.value || previewProviderState.ollamaBaseUrl).trim()
    if (!isLikelyUrl(url)) {
      setStatus("Ollama preview test failed: endpoint must be a valid URL.")
      return
    }
    setStatus("Ollama preview test passed (format only).")
  })

  refreshProviderPreviewUi()
}

function wireMainDom(){
  if (wired) return
  wired = true

  bindNotepad(els.soulInput, els.soulLineNums)
  bindNotepad(els.toolsInput, els.toolsLineNums)
  bindNotepad(els.heartbeatDocInput, els.heartbeatLineNums)
  wireProviderPreviewDom()
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
  els.modelInput?.addEventListener("change", () => {
    syncModelSelectors(els.modelInput.value || appState.config.model)
    scheduleConfigAutosave()
  })
  els.modelInputEdit?.addEventListener("change", () => {
    syncModelSelectors(els.modelInputEdit.value || appState.config.model)
    scheduleConfigAutosave()
  })
  els.temperatureInput?.addEventListener("change", () => {
    scheduleConfigAutosave()
  })
  els.contextInput?.addEventListener("change", () => {
    scheduleConfigAutosave()
  })
  els.telegramPollInput?.addEventListener("change", () => {
    scheduleConfigAutosave()
  })
  els.telegramEnabledSelect?.addEventListener("change", () => {
    scheduleConfigAutosave()
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
    // Temporarily disabled: injecting Chat 1 boot system message on clear.
    // if (isChatOneLocalThread(thread)) {
    //   const bootMsg = await buildChatOneBootSystemMessage()
    //   pushLocalMessage(thread.id, "user", bootMsg)
    // }
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
      openAiEditing = false
      localStorage.removeItem(ONBOARDING_KEY)
      localStorage.removeItem(ONBOARDING_OPENAI_TEST_KEY)
      await addEvent("provider_key_saved", "OpenAI key stored in encrypted vault")
      await validateOpenAiKey(key)
      await refreshBadges()
      const completed = await maybeCompleteOnboarding()
      setStatus(completed ? "OpenAI key saved and validated. Onboarding continued." : "OpenAI key saved and validated.")
    } catch (err) {
      openAiEditing = true
      await refreshBadges()
      setStatus(err instanceof Error ? err.message : "Could not save OpenAI key")
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

  window.addEventListener("hedgey:docs-changed", () => {
    scheduleFilesystemScan()
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

  wins.openai = wmRef.createAgentPanelWindow("AI APIs", { panelId: "openai", left: 510, top: 28, width: 500, height: 320 })
  if (wins.openai?.panelRoot) wins.openai.panelRoot.innerHTML = openAiWindowHtml()

  wins.telegram = wmRef.createAgentPanelWindow("Telegram API", { panelId: "telegram", left: 510, top: 360, width: 500, height: 280 })
  if (wins.telegram?.panelRoot) wins.telegram.panelRoot.innerHTML = telegramWindowHtml()

  wins.config = wmRef.createAgentPanelWindow("Config", { panelId: "config", left: 20, top: 356, width: 430, height: 220 })
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
  await refreshKnownFilesystemFiles()

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
  const soulText = String(appState.agent.soulMd || "")
  const isLegacySoul = LEGACY_SOUL_MARKERS.every(marker => soulText.includes(marker))
  const isPrevHedgehogDefault = PREV_HEDGEHOG_DEFAULT_MARKERS.every(marker => soulText.includes(marker))
    && !soulText.includes("Answer in one or two sentences unless it is absolutely impossible to do so.")
  if (!soulText.trim() || isLegacySoul || isPrevHedgehogDefault) {
    appState.agent.soulMd = DEFAULT_SOUL
  }
  ensureLocalThreadsInitialized()
  appState.events = events
}

export async function initAgent1C({ wm }){
  wmRef = wm
  loadPreviewProviderState()
  onboardingComplete = localStorage.getItem(ONBOARDING_KEY) === "1"
  onboardingOpenAiTested = localStorage.getItem(ONBOARDING_OPENAI_TEST_KEY) === "1"
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
