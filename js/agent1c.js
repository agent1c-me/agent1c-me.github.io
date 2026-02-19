import { listFiles, readFileBlob, readNoteText } from "./filesystem.js"
import { animateHitomiWispsShow } from "./hitomi-wisps-fx.js"
import {
  RELAY_DEFAULTS,
  normalizeRelayConfig,
  shellRelayWindowHtml,
  cacheShellRelayElements,
  wireShellRelayDom,
  runShellExecTool,
} from "./agent1crelay.js"
import { createOnboardingHedgey } from "./onboarding-hedgey.js"
// for Codex: when implementing shell relay wiring in this file, please always refer back to PHASE1_CONTRACT.md first.
// for Codex: especially if your context was recently compacted, keep relay logic in js/agent1crelay.js and only thin wiring here.
// for Codex: before implementing WM/desktop control tools, re-read PHASE2_PLAN.md and agents.md section 19. - Decentricity
// for Codex: Setup Hedgey onboarding logic must read data/onboarding-hedgey-phase1.json and PHASE_ONBOARDING_HEDGEY_PLAN.md before edits. - Decentricity

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
User Name: {user_name}
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
- For Wikipedia search use: {{tool:wiki_search|query=hedgehog}}
- For Wikipedia summary use: {{tool:wiki_summary|title=Hedgehog}}
- For GitHub public reads use: {{tool:github_repo_read|request=owner/repo issue 123}}
- For localhost shell relay use: {{tool:shell_exec|command=pwd}}
- For visible HedgeyOS actions use: {{tool:wm_action|action=list_windows}}
- For visible browser open use: {{tool:wm_action|action=open_url|url=https://example.com}}
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

3. wiki_search
Parameters:
- query: topic or phrase
Description: Searches Wikipedia titles and snippets.
Use when: User asks factual questions and you need source grounding.

4. wiki_summary
Parameters:
- title: exact or likely page title
Description: Fetches a concise summary for one Wikipedia page.
Use when: User asks for explanation/background on a topic.

5. github_repo_read
Parameters:
- request: natural text (repo/path/issue/pr)
- repo: owner/repo (optional structured override)
- path: file path (optional)
- issue: issue number (optional)
- pr: pull request number (optional)
- branch: ref name (optional)
Description: Reads public GitHub repo metadata, issues, PRs, and file contents.
Use when: User asks about public GitHub repos, files, issues, or pull requests.

6. shell_exec
Parameters:
- command: shell command to execute through localhost relay.
- timeout_ms: optional timeout override.
Description: Executes local shell command via user-run localhost relay.
Use when: User explicitly asks for local command execution.

7. wm_action
Parameters:
- action: list_windows | list_apps | tile | arrange | focus_window | minimize_window | restore_window | open_app | open_url
- title: window title for focus/minimize/restore (optional per action)
- app: app id for open_app (optional per action)
- url: target URL for open_url (optional per action)
Description: Controls visible native HedgeyOS window-manager/browser actions.
Use when: User asks to manipulate desktop windows/apps or open a website visibly in native Browser.

Policy:
- You can access local files via these tools. Do not claim you cannot access files without trying the tools first.
- Use list_files when you need current file inventory to answer a user request.
- If user asks to open/read/summarize a specific file, call read_file first when a target can be identified.
- Use list_files only when file target is unclear or lookup fails.
- Do not narrate "I will read/open now" without emitting the tool call in the same reply.
- Do not claim file contents were read unless a TOOL_RESULT read_file was returned.
- If user asks factual web context, prefer Wikipedia tools before guessing.
- If user asks GitHub repo/file/issue/PR questions, use github_repo_read before claiming details.
- Use shell_exec only for explicit user-requested local actions.
- Never claim command success unless TOOL_RESULT shell_exec confirms it.
- For visible desktop requests, use wm_action rather than narrating intent.
- If asked to open a website, use wm_action open_url so user sees it in native Browser.
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

const FALLBACK_ANTHROPIC_MODELS = [
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
  "claude-opus-4-1",
  "claude-opus-4",
  "claude-3-7-sonnet",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-latest",
]

const FALLBACK_XAI_MODELS = [
  "grok-4-0709",
  "grok-code-fast-1",
  "grok-4",
  "grok-3",
  "grok-3-mini",
]

const FALLBACK_ZAI_MODELS = [
  "glm-4.7",
  "glm-5",
  "glm-4.6",
  "glm-4.6v",
  "glm-4.5",
  "glm-4.5v",
  "glm-4-32b-0414-128k",
]

const DB_NAME = "agent1c-db"
const DB_VERSION = 1
const ONBOARDING_KEY = "agent1c_onboarding_complete_v1"
const ONBOARDING_OPENAI_TEST_KEY = "agent1c_onboarding_openai_tested_v1"
const USER_NAME_KEY = "agent1c_user_name_v1"
const PREVIEW_PROVIDER_KEY = "agent1c_preview_providers_v1"
const WINDOW_LAYOUT_KEY = "hedgey_window_layout_v1"
const UNENCRYPTED_MODE_KEY = "agent1c_unencrypted_mode_v1"
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
  unencryptedMode: false,
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
    relayEnabled: RELAY_DEFAULTS.enabled,
    relayBaseUrl: RELAY_DEFAULTS.baseUrl,
    relayToken: RELAY_DEFAULTS.token,
    relayTimeoutMs: RELAY_DEFAULTS.timeoutMs,
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
let xaiEditing = false
let zaiEditing = false
let ollamaEditing = false
let docsAutosaveTimer = null
let loopTimingSaveTimer = null
let configAutosaveTimer = null
let fsScanDebounceTimer = null
let fsScanRunning = false
let knownFilesystemFiles = new Map()
let clippyMode = false
let clippyUi = null
let clippyLastAssistantKey = ""
let clippyBubbleVariant = "full"
let clippyDragging = false
let clippyIdleTimer = null
let clippyIdleRunning = false
let clippyIdleLastActivityAt = 0
let clippyIdleBubbleRestore = null
let clippyIdleRaf = 0
let clippyActivityWired = false
let onboardingHedgey = null
let userName = ""
let voiceUiState = { enabled: false, supported: true, status: "off", text: "", error: "" }
let hitomiDesktopIcon = null
let hitomiIconObserver = null
let hitomiIconRelayoutQueued = false
let eventToastExpanded = false
let eventToastDismissedThroughId = 0
const thinkingThreadIds = new Set()

const CORE_AGENT_PANEL_IDS = ["chat", "openai", "telegram", "config", "shellrelay", "soul", "tools", "heartbeat", "events"]
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
  shellrelay: null,
  ollamaSetup: null,
}
const previewProviderState = {
  active: "openai",
  editor: "",
  openaiValidated: true,
  anthropicKey: "",
  anthropicModel: "claude-opus-4-6",
  anthropicValidated: false,
  xaiKey: "",
  xaiModel: "grok-4-0709",
  xaiValidated: false,
  zaiKey: "",
  zaiModel: "glm-4.7",
  zaiValidated: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  ollamaValidated: false,
  providerErrors: {
    openai: "",
    anthropic: "",
    xai: "",
    zai: "",
    ollama: "",
  },
}

function byId(id){ return document.getElementById(id) }

function normalizeUserName(value){
  const raw = String(value || "").trim().replace(/\s+/g, " ")
  if (!raw) return ""
  return raw.slice(0, 48).replace(/[\r\n\t]/g, " ").trim()
}

function defaultSoulWithUserName(name){
  const resolved = normalizeUserName(name) || "Unknown"
  return DEFAULT_SOUL.replaceAll("{user_name}", resolved)
}

async function setUserName(nextName){
  const normalized = normalizeUserName(nextName)
  if (!normalized) return false
  userName = normalized
  try {
    localStorage.setItem(USER_NAME_KEY, userName)
  } catch {}
  appState.agent.soulMd = defaultSoulWithUserName(userName)
  if (els.soulInput) els.soulInput.value = appState.agent.soulMd
  if (els.soulLineNums && els.soulInput) updateNotepadLineGutter(els.soulInput, els.soulLineNums)
  await persistState()
  return true
}

function loadPreviewProviderState(){
  try {
    const raw = localStorage.getItem(PREVIEW_PROVIDER_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return
    previewProviderState.active = ["openai", "anthropic", "xai", "zai", "ollama"].includes(parsed.active) ? parsed.active : previewProviderState.active
    previewProviderState.editor = parsed.editor === "" || ["openai", "anthropic", "xai", "zai", "ollama"].includes(parsed.editor)
      ? parsed.editor
      : previewProviderState.editor
    previewProviderState.openaiValidated = parsed.openaiValidated !== false
    previewProviderState.anthropicKey = ""
    previewProviderState.anthropicModel = String(parsed.anthropicModel || previewProviderState.anthropicModel)
    previewProviderState.anthropicValidated = Boolean(parsed.anthropicValidated)
    previewProviderState.xaiKey = ""
    previewProviderState.xaiModel = String(parsed.xaiModel || previewProviderState.xaiModel)
    previewProviderState.xaiValidated = Boolean(parsed.xaiValidated)
    previewProviderState.zaiKey = ""
    previewProviderState.zaiModel = String(parsed.zaiModel || previewProviderState.zaiModel)
    previewProviderState.zaiValidated = Boolean(parsed.zaiValidated)
    previewProviderState.ollamaBaseUrl = String(parsed.ollamaBaseUrl || previewProviderState.ollamaBaseUrl)
    previewProviderState.ollamaModel = String(parsed.ollamaModel || previewProviderState.ollamaModel)
    previewProviderState.ollamaValidated = Boolean(parsed.ollamaValidated)
    if (parsed.providerErrors && typeof parsed.providerErrors === "object") {
      previewProviderState.providerErrors = {
        openai: String(parsed.providerErrors.openai || ""),
        anthropic: String(parsed.providerErrors.anthropic || ""),
        xai: String(parsed.providerErrors.xai || ""),
        zai: String(parsed.providerErrors.zai || ""),
        ollama: String(parsed.providerErrors.ollama || ""),
      }
    }
  } catch {}
}

function persistPreviewProviderState(){
  try {
    localStorage.setItem(PREVIEW_PROVIDER_KEY, JSON.stringify({
      ...previewProviderState,
      anthropicKey: "",
      xaiKey: "",
      zaiKey: "",
    }))
  } catch {}
}

function extractErrorCode(err){
  const text = String(err instanceof Error ? err.message : err || "")
  const providerCode = /code[:=\s]+(\d{3,})/i.exec(text)
  if (providerCode?.[1]) return providerCode[1]
  const statusCode = /\((\d{3})\)/.exec(text)
  if (statusCode?.[1]) return statusCode[1]
  return "NET"
}

function setProviderApiError(provider, err){
  const kind = normalizeProvider(provider)
  previewProviderState.providerErrors[kind] = extractErrorCode(err)
  persistPreviewProviderState()
  refreshBadges().catch(() => {})
}

function clearProviderApiError(provider){
  const kind = normalizeProvider(provider)
  if (!previewProviderState.providerErrors[kind]) return
  previewProviderState.providerErrors[kind] = ""
  persistPreviewProviderState()
  refreshBadges().catch(() => {})
}

function refreshProviderPreviewUi(){
  const active = previewProviderState.active
  const editor = previewProviderState.editor
  const hasAnthropic = Boolean(previewProviderState.anthropicValidated)
  const hasXai = Boolean(previewProviderState.xaiValidated)
  const hasZai = Boolean(previewProviderState.zaiValidated)
  const hasOllama = Boolean(previewProviderState.ollamaValidated && String(previewProviderState.ollamaBaseUrl || "").trim())
  if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.value = active
  if (els.anthropicKeyInput) els.anthropicKeyInput.value = previewProviderState.anthropicKey
  if (els.anthropicModelInput) els.anthropicModelInput.value = previewProviderState.anthropicModel
  if (els.anthropicModelStored) els.anthropicModelStored.value = previewProviderState.anthropicModel
  if (els.xaiKeyInput) els.xaiKeyInput.value = previewProviderState.xaiKey
  if (els.xaiModelInput) els.xaiModelInput.value = previewProviderState.xaiModel
  if (els.xaiModelStored) els.xaiModelStored.value = previewProviderState.xaiModel
  if (els.zaiKeyInput) els.zaiKeyInput.value = previewProviderState.zaiKey
  if (els.zaiModelInput) els.zaiModelInput.value = previewProviderState.zaiModel
  if (els.zaiModelStored) els.zaiModelStored.value = previewProviderState.zaiModel
  if (els.ollamaBaseUrlInput) els.ollamaBaseUrlInput.value = previewProviderState.ollamaBaseUrl
  if (els.ollamaModelInput) els.ollamaModelInput.value = previewProviderState.ollamaModel
  if (els.ollamaModelStored) els.ollamaModelStored.value = previewProviderState.ollamaModel
  if (els.providerCardOpenai) els.providerCardOpenai.classList.toggle("active", editor === "openai")
  if (els.providerCardAnthropic) els.providerCardAnthropic.classList.toggle("active", editor === "anthropic")
  if (els.providerCardXai) els.providerCardXai.classList.toggle("active", editor === "xai")
  if (els.providerCardZai) els.providerCardZai.classList.toggle("active", editor === "zai")
  if (els.providerCardOllama) els.providerCardOllama.classList.toggle("active", editor === "ollama")
  if (els.providerNoteOpenai) els.providerNoteOpenai.classList.toggle("agent-hidden", editor === "openai")
  if (els.providerNoteAnthropic) els.providerNoteAnthropic.classList.toggle("agent-hidden", editor === "anthropic")
  if (els.providerNoteXai) els.providerNoteXai.classList.toggle("agent-hidden", editor === "xai")
  if (els.providerNoteZai) els.providerNoteZai.classList.toggle("agent-hidden", editor === "zai")
  if (els.providerNoteOllama) els.providerNoteOllama.classList.toggle("agent-hidden", editor === "ollama")
  if (els.providerSectionOpenai) els.providerSectionOpenai.classList.toggle("agent-hidden", editor !== "openai")
  if (els.providerSectionAnthropic) els.providerSectionAnthropic.classList.toggle("agent-hidden", editor !== "anthropic")
  if (els.providerSectionXai) els.providerSectionXai.classList.toggle("agent-hidden", editor !== "xai")
  if (els.providerSectionZai) els.providerSectionZai.classList.toggle("agent-hidden", editor !== "zai")
  if (els.providerSectionOllama) els.providerSectionOllama.classList.toggle("agent-hidden", editor !== "ollama")
  if (els.anthropicStoredRow && els.anthropicControls) {
    const showStored = hasAnthropic && !anthropicEditing
    els.anthropicStoredRow.classList.toggle("agent-hidden", !showStored)
    els.anthropicControls.classList.toggle("agent-hidden", showStored)
  }
  if (els.xaiStoredRow && els.xaiControls) {
    const showStored = hasXai && !xaiEditing
    els.xaiStoredRow.classList.toggle("agent-hidden", !showStored)
    els.xaiControls.classList.toggle("agent-hidden", showStored)
  }
  if (els.zaiStoredRow && els.zaiControls) {
    const showStored = hasZai && !zaiEditing
    els.zaiStoredRow.classList.toggle("agent-hidden", !showStored)
    els.zaiControls.classList.toggle("agent-hidden", showStored)
  }
  if (els.ollamaStoredRow && els.ollamaControls) {
    const showStored = hasOllama && !ollamaEditing
    els.ollamaStoredRow.classList.toggle("agent-hidden", !showStored)
    els.ollamaControls.classList.toggle("agent-hidden", showStored)
  }
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

function renderModelOptions(list){
  return list.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("")
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

async function getAllSecrets(){
  const db = await openDb()
  const tx = db.transaction(STORES.secrets, "readonly")
  return (await reqValue(tx.objectStore(STORES.secrets).getAll())) || []
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

function canAccessSecrets(){
  return Boolean(appState.unlocked || appState.unencryptedMode)
}

function setUnencryptedMode(enabled){
  appState.unencryptedMode = Boolean(enabled)
  try {
    if (appState.unencryptedMode) localStorage.setItem(UNENCRYPTED_MODE_KEY, "1")
    else localStorage.removeItem(UNENCRYPTED_MODE_KEY)
  } catch {}
}

async function saveProviderKey(provider, value){
  const cleaned = (value || "").trim()
  if (!cleaned) throw new Error("Value is required.")
  if (appState.unencryptedMode && (!appState.unlocked || !appState.sessionKey)) {
    await setSecret({ provider, plain: cleaned, unencrypted: true, updatedAt: Date.now() })
    return
  }
  if (!appState.unlocked || !appState.sessionKey) throw new Error("Unlock vault first.")
  const iv = randomB64(12)
  const encrypted = await encryptText(appState.sessionKey, cleaned, iv)
  await setSecret({ provider, iv, encrypted, unencrypted: false, updatedAt: Date.now() })
}

async function readProviderKey(provider){
  const record = await getSecret(provider)
  if (!record) return ""
  if (typeof record.plain === "string") return record.plain
  if (!appState.unlocked || !appState.sessionKey) return ""
  return decryptText(appState.sessionKey, record.encrypted, record.iv)
}

async function migratePlaintextSecretsToEncrypted(){
  if (!appState.unlocked || !appState.sessionKey) return
  const all = await getAllSecrets()
  for (const record of all) {
    if (!record || typeof record.provider !== "string") continue
    if (typeof record.plain !== "string" || !record.plain.trim()) continue
    const iv = randomB64(12)
    const encrypted = await encryptText(appState.sessionKey, record.plain.trim(), iv)
    await setSecret({ provider: record.provider, iv, encrypted, unencrypted: false, updatedAt: Date.now() })
  }
}

const XAI_BASE_URL = "https://api.x.ai/v1"
const ZAI_BASE_URL = "https://api.z.ai/api/coding/paas/v4"

function normalizeOllamaBaseUrl(value){
  const source = String(value || "").trim()
  if (!source) return ""
  return source.replace(/\/+$/, "")
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

async function anthropicChat({ apiKey, model, temperature, systemPrompt, messages }){
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

async function xaiChat({ apiKey, model, temperature, systemPrompt, messages }){
  const response = await fetch(`${XAI_BASE_URL}/chat/completions`, {
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
  if (!response.ok) throw new Error(`xAI call failed (${response.status})`)
  const json = await response.json()
  const text = json?.choices?.[0]?.message?.content
  if (!text) throw new Error("xAI returned no message.")
  return String(text).trim()
}

async function zaiChat({ apiKey, model, temperature, systemPrompt, messages }){
  const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
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

async function ollamaChat({ baseUrl, model, temperature, systemPrompt, messages }){
  const endpoint = `${normalizeOllamaBaseUrl(baseUrl)}/api/chat`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature },
      messages: [{ role: "system", content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))],
    }),
  })
  if (!response.ok) throw new Error(`Ollama call failed (${response.status})`)
  const json = await response.json()
  const text = json?.message?.content
  if (!text) throw new Error("Ollama returned no message.")
  return String(text).trim()
}

function normalizeProvider(value){
  const provider = String(value || "").toLowerCase()
  return ["openai", "anthropic", "xai", "zai", "ollama"].includes(provider) ? provider : "openai"
}

function activeProviderModel(provider){
  if (provider === "anthropic") return previewProviderState.anthropicModel || FALLBACK_ANTHROPIC_MODELS[0]
  if (provider === "xai") return previewProviderState.xaiModel || FALLBACK_XAI_MODELS[0]
  if (provider === "zai") return previewProviderState.zaiModel || FALLBACK_ZAI_MODELS[0]
  if (provider === "ollama") return previewProviderState.ollamaModel || "llama3.1"
  return appState.config.model
}

function providerDisplayName(provider){
  if (provider === "anthropic") return "Anthropic"
  if (provider === "xai") return "xAI (Grok)"
  if (provider === "zai") return "z.ai"
  if (provider === "ollama") return "Ollama"
  return "OpenAI"
}

async function resolveActiveProviderRuntime(){
  const provider = normalizeProvider(previewProviderState.active || "openai")
  const model = activeProviderModel(provider)
  const secretKey = provider === "openai" || provider === "anthropic" || provider === "xai" || provider === "zai"
    ? await readProviderKey(provider)
    : ""
  return {
    provider,
    model,
    apiKey: String(secretKey || "").trim(),
    ollamaBaseUrl: normalizeOllamaBaseUrl(previewProviderState.ollamaBaseUrl),
    name: providerDisplayName(provider),
  }
}

async function providerHasKey(provider){
  const kind = normalizeProvider(provider)
  if (kind === "anthropic" || kind === "xai" || kind === "zai" || kind === "openai") {
    return Boolean((await readProviderKey(kind)).trim())
  }
  return Boolean(previewProviderState.ollamaValidated && String(previewProviderState.ollamaBaseUrl || "").trim())
}

async function providerChat({ provider, apiKey, model, temperature, systemPrompt, messages, ollamaBaseUrl }){
  const kind = normalizeProvider(provider)
  try {
    if (kind === "anthropic") {
      const text = await anthropicChat({ apiKey, model, temperature, systemPrompt, messages })
      clearProviderApiError(kind)
      return text
    }
    if (kind === "xai") {
      const text = await xaiChat({ apiKey, model, temperature, systemPrompt, messages })
      clearProviderApiError(kind)
      return text
    }
    if (kind === "zai") {
      const text = await zaiChat({ apiKey, model, temperature, systemPrompt, messages })
      clearProviderApiError(kind)
      return text
    }
    if (kind === "ollama") {
      const text = await ollamaChat({ baseUrl: ollamaBaseUrl, model, temperature, systemPrompt, messages })
      clearProviderApiError(kind)
      return text
    }
    const text = await openAiChat({ apiKey, model, temperature, systemPrompt, messages })
    clearProviderApiError("openai")
    return text
  } catch (err) {
    // z.ai GLM-5 can return 1113 for accounts without explicit GLM-5 access.
    // Fall back once to glm-4.7 and persist to avoid repeated user-facing failures.
    if (kind === "zai") {
      const errText = String(err instanceof Error ? err.message : err || "")
      const requestedModel = String(model || "").trim().toLowerCase()
      if ((/code[:=\s]*1113/i.test(errText) || /\(429\)/.test(errText)) && requestedModel === "glm-5") {
        try {
          const fallbackModel = "glm-4.7"
          const text = await zaiChat({ apiKey, model: fallbackModel, temperature, systemPrompt, messages })
          previewProviderState.zaiModel = fallbackModel
          if (els?.zaiModelInput) els.zaiModelInput.value = fallbackModel
          if (els?.zaiModelStored) els.zaiModelStored.value = fallbackModel
          persistPreviewProviderState()
          clearProviderApiError(kind)
          setStatus("z.ai model auto-switched to glm-4.7 after GLM-5 access error.")
          return text
        } catch {}
      }
    }
    setProviderApiError(kind, err)
    throw err
  }
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
    "- Use shell_exec only when user explicitly asks for local shell actions.",
    "- Never claim shell command success unless TOOL_RESULT shell_exec confirms it.",
    "- For desktop/window/app actions, emit wm_action tool calls.",
    "- For opening websites, use wm_action action=open_url so the native Browser visibly navigates.",
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

function inferWindowAction(text){
  const t = normalizeText(text)
  if (!t) return ""
  if (/\b(arrange|organi[sz]e|organize)\b[\s\S]{0,24}\b(windows?|desktop)\b/i.test(t)) return "arrange"
  if (/\b(tile)\b[\s\S]{0,24}\b(windows?|desktop)\b/i.test(t)) return "tile"
  return ""
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

function excerptForToolText(text, maxChars = 6000){
  const full = String(text || "")
  if (full.length <= maxChars) return full
  const head = full.slice(0, 3500)
  const tail = full.slice(-1800)
  return `${head}\n[...]\n${tail}`
}

async function wikiSearchTool(query){
  const q = String(query || "").trim()
  if (!q) return "TOOL_RESULT wiki_search: missing query"
  const url = `https://en.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=5`
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  })
  if (!response.ok) return `TOOL_RESULT wiki_search: request failed (${response.status})`
  const json = await response.json().catch(() => null)
  const pages = Array.isArray(json?.pages) ? json.pages : []
  if (!pages.length) return `TOOL_RESULT wiki_search (${q}): no results`
  const rows = pages.slice(0, 5).map((page, i) => {
    const title = String(page?.title || "untitled")
    const desc = String(page?.description || page?.excerpt || "").replace(/<[^>]+>/g, "").trim()
    return `${i + 1}. ${title}${desc ? ` - ${desc}` : ""}`
  })
  return `TOOL_RESULT wiki_search (${q}):\n${rows.join("\n")}`
}

async function wikiSummaryTool(title){
  const t = String(title || "").trim()
  if (!t) return "TOOL_RESULT wiki_summary: missing title"
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  })
  if (!response.ok) return `TOOL_RESULT wiki_summary (${t}): request failed (${response.status})`
  const json = await response.json().catch(() => null)
  const resolvedTitle = String(json?.title || t)
  const extract = String(json?.extract || "").trim()
  const pageUrl = String(json?.content_urls?.desktop?.page || "")
  if (!extract) return `TOOL_RESULT wiki_summary (${resolvedTitle}): no summary text`
  const body = excerptForToolText(extract, 5000)
  return `TOOL_RESULT wiki_summary (${resolvedTitle}):\n${body}${pageUrl ? `\nSource: ${pageUrl}` : ""}`
}

function parseRepoParts(text){
  const source = String(text || "")
  const match = source.match(/\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/)
  if (!match) return null
  return { owner: match[1], repo: match[2] }
}

function parseFirstNumberAfter(text, keyword){
  const source = String(text || "")
  const re = new RegExp(`\\b(?:${keyword})\\b\\s*#?\\s*(\\d+)\\b`, "i")
  const match = source.match(re)
  return match ? Number(match[1]) : null
}

function parsePathAfterKeyword(text, keyword){
  const source = String(text || "")
  const re = new RegExp(`\\b(?:${keyword})\\b\\s*[:=]?\\s*([^\\n]+)$`, "i")
  const match = source.match(re)
  if (!match) return ""
  return String(match[1] || "").trim().replace(/^["']|["']$/g, "")
}

function fromBase64Utf8(value){
  const raw = atob(String(value || ""))
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function githubGetJson(path){
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    const message = String(json?.message || "").trim()
    return { ok: false, status: response.status, json, message }
  }
  return { ok: true, status: response.status, json }
}

async function githubRepoReadTool(args){
  const request = String(args?.request || "").trim()
  const repoArg = String(args?.repo || "").trim()
  const pathArg = String(args?.path || "").trim()
  const branchArg = String(args?.branch || "").trim()
  const issueArg = String(args?.issue || "").trim()
  const prArg = String(args?.pr || "").trim()
  const merged = [request, repoArg, pathArg].filter(Boolean).join(" ")
  const repoParts = repoArg ? parseRepoParts(repoArg) : parseRepoParts(merged)
  if (!repoParts) {
    const q = request || repoArg || pathArg
    if (!q) return "TOOL_RESULT github_repo_read: missing request"
    const search = await githubGetJson(`/search/repositories?q=${encodeURIComponent(q)}&per_page=5`)
    if (!search.ok) return `TOOL_RESULT github_repo_read: search failed (${search.status})${search.message ? `: ${search.message}` : ""}`
    const rows = (Array.isArray(search.json?.items) ? search.json.items : []).slice(0, 5).map((item, i) => {
      const full = String(item?.full_name || "unknown/unknown")
      const desc = String(item?.description || "").trim()
      return `${i + 1}. ${full}${desc ? ` - ${desc}` : ""}`
    })
    return rows.length
      ? `TOOL_RESULT github_repo_read search (${q}):\n${rows.join("\n")}`
      : `TOOL_RESULT github_repo_read search (${q}): no repositories found`
  }
  const repoFull = `${repoParts.owner}/${repoParts.repo}`
  const issueNum = issueArg ? Number(issueArg) : parseFirstNumberAfter(request, "issue")
  const prNum = prArg ? Number(prArg) : parseFirstNumberAfter(request, "pr|pull request|pull")
  const pathText = pathArg || parsePathAfterKeyword(request, "path|file")
  if (issueNum) {
    const issue = await githubGetJson(`/repos/${repoFull}/issues/${issueNum}`)
    if (!issue.ok) return `TOOL_RESULT github_repo_read (${repoFull} issue ${issueNum}): failed (${issue.status})${issue.message ? `: ${issue.message}` : ""}`
    const title = String(issue.json?.title || "")
    const state = String(issue.json?.state || "")
    const body = excerptForToolText(String(issue.json?.body || "").trim(), 4500)
    return `TOOL_RESULT github_repo_read (${repoFull} issue ${issueNum}): ${title} [${state}]\n${body}`
  }
  if (prNum) {
    const pr = await githubGetJson(`/repos/${repoFull}/pulls/${prNum}`)
    if (!pr.ok) return `TOOL_RESULT github_repo_read (${repoFull} PR ${prNum}): failed (${pr.status})${pr.message ? `: ${pr.message}` : ""}`
    const title = String(pr.json?.title || "")
    const state = String(pr.json?.state || "")
    const body = excerptForToolText(String(pr.json?.body || "").trim(), 4500)
    return `TOOL_RESULT github_repo_read (${repoFull} PR ${prNum}): ${title} [${state}]\n${body}`
  }
  if (pathText) {
    const refQuery = branchArg ? `?ref=${encodeURIComponent(branchArg)}` : ""
    const content = await githubGetJson(`/repos/${repoFull}/contents/${encodeURIComponent(pathText).replaceAll("%2F", "/")}${refQuery}`)
    if (!content.ok) return `TOOL_RESULT github_repo_read (${repoFull} path ${pathText}): failed (${content.status})${content.message ? `: ${content.message}` : ""}`
    if (Array.isArray(content.json)) {
      const rows = content.json.slice(0, 20).map((item, i) => `${i + 1}. ${String(item?.name || "")} | type=${String(item?.type || "unknown")}`)
      return `TOOL_RESULT github_repo_read (${repoFull} path ${pathText}): directory listing\n${rows.join("\n")}`
    }
    const name = String(content.json?.name || pathText)
    const kind = String(content.json?.type || "file")
    const enc = String(content.json?.encoding || "")
    const rawContent = enc === "base64" ? fromBase64Utf8(String(content.json?.content || "").replace(/\s+/g, "")) : String(content.json?.content || "")
    const excerpt = excerptForToolText(rawContent, 7000)
    return `TOOL_RESULT github_repo_read (${repoFull} path ${name}): type=${kind}\n${excerpt}`
  }
  const repo = await githubGetJson(`/repos/${repoFull}`)
  if (!repo.ok) return `TOOL_RESULT github_repo_read (${repoFull}): failed (${repo.status})${repo.message ? `: ${repo.message}` : ""}`
  const desc = String(repo.json?.description || "").trim()
  const stars = Number(repo.json?.stargazers_count || 0)
  const forks = Number(repo.json?.forks_count || 0)
  const lang = String(repo.json?.language || "unknown")
  const updated = String(repo.json?.updated_at || "")
  return `TOOL_RESULT github_repo_read (${repoFull}):\nDescription: ${desc || "none"}\nStars: ${stars}\nForks: ${forks}\nLanguage: ${lang}\nUpdated: ${updated}`
}

async function maybeInjectAutoToolResults(messages){
  const text = latestUserText(messages).trim()
  if (!text) return []
  const out = []
  const wmAction = inferWindowAction(text)
  if (wmAction) {
    out.push(await runToolCall({ name: "wm_action", args: { action: wmAction } }))
  }
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
  // for Codex: this is the canonical tool dispatch path; review PHASE2_PLAN.md + agents.md before changing tool execution behavior. - Decentricity
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
  if (call.name === "wiki_search") {
    return wikiSearchTool(call.args?.query || "")
  }
  if (call.name === "wiki_summary") {
    return wikiSummaryTool(call.args?.title || "")
  }
  if (call.name === "github_repo_read") {
    return githubRepoReadTool(call.args || {})
  }
  if (call.name === "shell_exec") {
    return runShellExecTool({
      args: call.args || {},
      relayConfig: normalizeRelayConfig(appState.config),
      addEvent,
      excerptForToolText,
    })
  }
  if (call.name === "wm_action") {
    const args = call.args || {}
    const rawAction = String(args.action || "").trim().toLowerCase()
    const actionMap = {
      "tilewindows": "tile",
      "tile_visible_windows": "tile",
      "tile_visible": "tile",
      "arrangewindows": "arrange",
      "arrange_windows": "arrange",
      "arrange_visible_windows": "arrange",
      "arrangevisiblewindows": "arrange",
      "focus": "focus_window",
      "minimize": "minimize_window",
      "restore": "restore_window",
      "openapp": "open_app",
      "openurl": "open_url",
      "listwindows": "list_windows",
      "listapps": "list_apps",
    }
    const action = actionMap[rawAction.replace(/[^a-z0-9_]/g, "")] || rawAction
    if (!action) return "TOOL_RESULT wm_action: missing action"
    if (!wmRef) return `TOOL_RESULT wm_action ${action}: window manager unavailable`
    const rows = wmRef.listWindows?.() || []
    const findByTitle = (value) => {
      const needle = String(value || "").trim().toLowerCase()
      if (!needle) return null
      const exact = rows.find(w => String(w.title || "").trim().toLowerCase() === needle)
      if (exact) return exact
      return rows.find(w => String(w.title || "").toLowerCase().includes(needle)) || null
    }
    if (action === "list_windows") {
      if (!rows.length) return "TOOL_RESULT wm_action list_windows: no windows"
      const list = rows.map((w, i) => `${i + 1}. ${w.title} | id=${w.id} | minimized=${w.minimized ? "yes" : "no"} | kind=${w.kind || "window"}`)
      return `TOOL_RESULT wm_action list_windows:\n${list.join("\n")}`
    }
    if (action === "list_apps") {
      const apps = wmRef.listAvailableApps?.() || []
      if (!apps.length) return "TOOL_RESULT wm_action list_apps: no apps"
      const list = apps.map((app, i) => `${i + 1}. ${app.title} | id=${app.id} | source=${app.source}`)
      return `TOOL_RESULT wm_action list_apps:\n${list.join("\n")}`
    }
    if (action === "tile") {
      wmRef.tileVisibleWindows?.()
      await addEvent("wm_action", "tile")
      return "TOOL_RESULT wm_action tile: ok"
    }
    if (action === "arrange") {
      wmRef.arrangeVisibleWindows?.()
      await addEvent("wm_action", "arrange")
      return "TOOL_RESULT wm_action arrange: ok"
    }
    if (action === "focus_window") {
      const target = findByTitle(args.title || args.window || args.name)
      if (!target) return "TOOL_RESULT wm_action focus_window: window not found"
      wmRef.restore?.(target.id)
      wmRef.focus?.(target.id)
      await addEvent("wm_action", `focus ${target.title}`)
      return `TOOL_RESULT wm_action focus_window: ok (${target.title})`
    }
    if (action === "minimize_window") {
      const target = findByTitle(args.title || args.window || args.name)
      if (!target) return "TOOL_RESULT wm_action minimize_window: window not found"
      wmRef.minimize?.(target.id)
      await addEvent("wm_action", `minimize ${target.title}`)
      return `TOOL_RESULT wm_action minimize_window: ok (${target.title})`
    }
    if (action === "restore_window") {
      const target = findByTitle(args.title || args.window || args.name)
      if (!target) return "TOOL_RESULT wm_action restore_window: window not found"
      wmRef.restore?.(target.id)
      wmRef.focus?.(target.id)
      await addEvent("wm_action", `restore ${target.title}`)
      return `TOOL_RESULT wm_action restore_window: ok (${target.title})`
    }
    if (action === "open_app") {
      const appId = String(args.app || args.id || args.name || "").trim()
      if (!appId) return "TOOL_RESULT wm_action open_app: missing app id"
      const openedId = wmRef.openAppById?.(appId)
      if (!openedId) return `TOOL_RESULT wm_action open_app: app not found (${appId})`
      wmRef.restore?.(openedId)
      wmRef.focus?.(openedId)
      await addEvent("wm_action", `open_app ${appId}`)
      return `TOOL_RESULT wm_action open_app: ok (${appId})`
    }
    if (action === "open_url") {
      const rawUrl = String(args.url || args.link || "").trim()
      if (!rawUrl) return "TOOL_RESULT wm_action open_url: missing url"
      const opened = wmRef.openUrlInBrowser?.(rawUrl, { newWindow: false })
      if (!opened?.ok) return `TOOL_RESULT wm_action open_url: failed (${opened?.error || "unknown"})`
      await addEvent("wm_action", `open_url ${rawUrl}`)
      return `TOOL_RESULT wm_action open_url: ok (${opened.url})`
    }
    return `TOOL_RESULT wm_action ${action}: unsupported`
  }
  return `TOOL_RESULT ${call.name}: unsupported`
}

async function providerChatWithTools({ provider, apiKey, model, temperature, messages, ollamaBaseUrl }){
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
    const reply = await providerChat({
      provider,
      apiKey,
      model,
      temperature,
      systemPrompt,
      messages: working,
      ollamaBaseUrl: normalizeOllamaBaseUrl(ollamaBaseUrl || previewProviderState.ollamaBaseUrl),
    })
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
  const finalReply = await providerChat({
    provider,
    apiKey,
    model,
    temperature,
    systemPrompt,
    ollamaBaseUrl: normalizeOllamaBaseUrl(ollamaBaseUrl || previewProviderState.ollamaBaseUrl),
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

async function testAnthropicKey(apiKey, model){
  await anthropicChat({
    apiKey,
    model,
    temperature: 0,
    systemPrompt: "Respond with exactly: ok",
    messages: [{ role: "user", content: "ok" }],
  })
}

async function testXaiKey(apiKey, model){
  await xaiChat({
    apiKey,
    model,
    temperature: 0,
    systemPrompt: "Respond with exactly: ok",
    messages: [{ role: "user", content: "ok" }],
  })
}

async function testZaiKey(apiKey, model){
  await zaiChat({
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

function setThreadThinking(threadId, active){
  const id = String(threadId || "").trim()
  if (!id) return
  if (active) thinkingThreadIds.add(id)
  else thinkingThreadIds.delete(id)
}

function isThreadThinking(threadId){
  return thinkingThreadIds.has(String(threadId || "").trim())
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
  if (!canAccessSecrets()) return
  const runtime = await resolveActiveProviderRuntime()
  if (runtime.provider === "ollama" ? !runtime.ollamaBaseUrl : !runtime.apiKey) return
  const prompt = [
    "System Message: User has uploaded new file(s) into your filesystem.",
    ...files.map(file => `- ${fileMetaLabel(file)}`),
    "This upload summary is current context. Use it directly.",
    "Do not suggest listing files unless the user asks for a listing.",
    "For now, reply normally to acknowledge this.",
  ].join("\n")
  pushRolling("user", prompt)
  const reply = await providerChatWithTools({
    provider: runtime.provider,
    apiKey: runtime.apiKey,
    model: runtime.model,
    ollamaBaseUrl: runtime.ollamaBaseUrl,
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

function isOnboardingGuideActive(){
  return Boolean(onboardingHedgey?.isActive?.() && !onboardingComplete)
}

function clippySpawnBottomPosition(){
  const bounds = getClippyBounds()
  if (!bounds) return { left: 20, top: 390 }
  return {
    left: Math.max(bounds.minLeft, Math.min(20, bounds.maxLeft)),
    top: bounds.maxTop,
  }
}

function positionClippyAtBottom(){
  if (!clippyUi?.root) return
  const next = clippySpawnBottomPosition()
  setClippyPosition(next.left, next.top)
}

function nudgeOnboardingBubble({ compact = false } = {}){
  if (!isOnboardingGuideActive()) return
  if (!clippyMode) setClippyMode(true)
  const setupCompact = true
  clippyBubbleVariant = setupCompact ? "compact" : (compact ? "compact" : "full")
  showClippyBubble({ variant: clippyBubbleVariant, snapNoOverlap: true, preferAbove: true })
  renderClippyBubble()
}

function onboardingGuideUiContext(){
  return {
    providerInputs: {
      openai: String(els.openaiKeyInput?.value || "").trim(),
      anthropic: String(els.anthropicKeyInput?.value || "").trim(),
      xai: String(els.xaiKeyInput?.value || "").trim(),
      zai: String(els.zaiKeyInput?.value || "").trim(),
      ollama: String(els.ollamaBaseUrlInput?.value || "").trim(),
    },
  }
}

function getClippyChatHtml(){
  if (isOnboardingGuideActive()) {
    return onboardingHedgey?.getRenderedHtml?.() || `<div class="clippy-line">No setup messages yet.</div>`
  }
  const thread = getChatOneThread()
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const thinking = isThreadThinking(thread?.id)
  if (!messages.length && !thinking) return `<div class="clippy-line">No messages yet.</div>`
  const tail = messages.slice(-16)
  const rendered = tail.map(msg => {
    const who = msg.role === "assistant" ? "Hitomi" : "User"
    return `<div class="clippy-line"><strong>${who}:</strong> ${escapeHtml(msg.content)}</div>`
  })
  if (thinking) rendered.push(`<div class="clippy-line"><strong>Hitomi:</strong> Thinking...</div>`)
  return rendered.join("")
}

function getClippyCompactHtml(){
  if (isOnboardingGuideActive()) {
    return onboardingHedgey?.getRenderedHtml?.() || `<div class="clippy-line">No setup messages yet.</div>`
  }
  const thread = getChatOneThread()
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const thinking = isThreadThinking(thread?.id)
  if (thinking) return `<div class="clippy-line"><strong>Hitomi:</strong> Thinking...</div>`
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role !== "assistant") continue
    return `<div class="clippy-line"><strong>Hitomi:</strong> ${escapeHtml(msg.content)}</div>`
  }
  return `<div class="clippy-line">No messages yet.</div>`
}

function computeNextDesktopIconPosition({ excludeEl = null } = {}){
  const desktop = document.getElementById("desktop")
  if (!desktop) return { x: 10, y: 10 }
  const iconLayer = document.getElementById("iconLayer")
  const cs = getComputedStyle(document.documentElement)
  const cellW = parseInt(cs.getPropertyValue("--icon-cell-w"), 10) || 92
  const cellH = parseInt(cs.getPropertyValue("--icon-cell-h"), 10) || 86
  const pad = parseInt(cs.getPropertyValue("--icon-pad"), 10) || 10
  const dw = desktop.clientWidth || 0
  const dh = desktop.clientHeight || 0
  const cols = Math.max(1, Math.floor((Math.max(1, dw) - pad) / cellW))
  const rows = Math.max(1, Math.floor((Math.max(1, dh) - pad) / cellH))

  const occupied = new Set()
  const allIcons = Array.from(iconLayer?.querySelectorAll(".desk-icon") || [])
  for (const el of allIcons) {
    if (!el || el === excludeEl) continue
    const left = parseInt(el.style.left || "", 10)
    const top = parseInt(el.style.top || "", 10)
    if (!Number.isFinite(left) || !Number.isFinite(top)) continue
    const col = Math.round((left - pad) / cellW)
    const row = Math.round((dh - pad - cellH - top) / cellH)
    if (col < 0 || row < 0) continue
    occupied.add(`${col}:${row}`)
  }

  let selectedCol = 0
  let selectedRow = 0
  let found = false
  const maxScan = Math.max(allIcons.length + 8, cols * rows)
  for (let i = 0; i < maxScan; i += 1) {
    const col = i % cols
    const row = Math.floor(i / cols)
    if (row >= rows) break
    if (occupied.has(`${col}:${row}`)) continue
    selectedCol = col
    selectedRow = row
    found = true
    break
  }

  if (!found) {
    selectedCol = 0
    selectedRow = Math.max(0, rows - 1)
  }

  return {
    x: pad + selectedCol * cellW,
    y: dh - pad - cellH - selectedRow * cellH,
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
  ensureHitomiIconObserver()
  return el
}

function removeHitomiDesktopIcon(){
  if (hitomiDesktopIcon && hitomiDesktopIcon.isConnected) hitomiDesktopIcon.remove()
  hitomiDesktopIcon = null
}

function positionHitomiDesktopIcon(){
  if (!hitomiDesktopIcon || !hitomiDesktopIcon.isConnected) return
  const pos = computeNextDesktopIconPosition({ excludeEl: hitomiDesktopIcon })
  const nextLeft = `${pos.x}px`
  const nextTop = `${pos.y}px`
  if (hitomiDesktopIcon.style.left !== nextLeft) hitomiDesktopIcon.style.left = nextLeft
  if (hitomiDesktopIcon.style.top !== nextTop) hitomiDesktopIcon.style.top = nextTop
}

function ensureHitomiIconObserver(){
  const iconLayer = document.getElementById("iconLayer")
  if (!iconLayer || hitomiIconObserver) return
  hitomiIconObserver = new MutationObserver((mutations) => {
    if (!hitomiDesktopIcon || !hitomiDesktopIcon.isConnected) return
    let shouldRelayout = false
    for (const m of mutations) {
      if (m.type === "childList") {
        shouldRelayout = true
        break
      }
      if (m.type === "attributes") {
        if (m.target === hitomiDesktopIcon) continue
        shouldRelayout = true
        break
      }
    }
    if (!shouldRelayout || hitomiIconRelayoutQueued) return
    hitomiIconRelayoutQueued = true
    requestAnimationFrame(() => {
      hitomiIconRelayoutQueued = false
      positionHitomiDesktopIcon()
    })
  })
  hitomiIconObserver.observe(iconLayer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  })
}

async function hasAnyAiProviderKey(){
  const [openai, anthropic, xai, zai] = await Promise.all([
    getSecret("openai"),
    getSecret("anthropic"),
    getSecret("xai"),
    getSecret("zai"),
  ])
  const hasOllama = Boolean(previewProviderState.ollamaValidated && normalizeOllamaBaseUrl(previewProviderState.ollamaBaseUrl))
  return Boolean(openai || anthropic || xai || zai || hasOllama)
}

function storageLabelText(){
  return appState.unencryptedMode ? "Stored locally (not encrypted)" : "Stored in vault"
}

function encryptedLabelText(){
  return appState.unencryptedMode ? "Saved locally (not encrypted)" : "Saved in vault"
}

function providerSavedEventText(provider){
  const name = providerDisplayName(provider)
  return appState.unencryptedMode
    ? `${name} key saved locally (not encrypted)`
    : `${name} key stored in encrypted vault`
}

function telegramSavedEventText(){
  return appState.unencryptedMode
    ? "Telegram token saved locally (not encrypted)"
    : "Telegram token stored in encrypted vault"
}

async function refreshHitomiDesktopIcon(){
  const hasAiKey = await hasAnyAiProviderKey()
  const keepForOnboarding = !onboardingComplete
  if (!hasAiKey && !keepForOnboarding) {
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

function isHedgeyOsTheme(){
  return document.body?.classList?.contains("hedgeyOS")
}

function markClippyActivity(){
  clippyIdleLastActivityAt = Date.now()
  scheduleClippyIdleHop()
}

function getClippyBounds(){
  const desktop = document.getElementById("desktop")
  const ui = clippyUi
  if (!desktop || !ui?.root) return null
  const dw = desktop.clientWidth || 0
  const dh = desktop.clientHeight || 0
  const rw = ui.root.offsetWidth || 132
  const rh = ui.root.offsetHeight || 132
  const floorPad = isHedgeyOsTheme() ? 2 : 0
  return {
    minLeft: 0,
    maxLeft: Math.max(0, dw - rw),
    minTop: 0,
    maxTop: Math.max(0, dh - rh - floorPad),
  }
}

function clampClippyPosition(left, top){
  const bounds = getClippyBounds()
  if (!bounds) return { left, top }
  return {
    left: Math.max(bounds.minLeft, Math.min(left, bounds.maxLeft)),
    top: Math.max(bounds.minTop, Math.min(top, bounds.maxTop)),
  }
}

function setClippyPosition(left, top){
  const ui = clippyUi
  if (!ui?.root) return
  const next = clampClippyPosition(left, top)
  ui.root.style.left = `${Math.round(next.left)}px`
  ui.root.style.top = `${Math.round(next.top)}px`
  positionClippyBubble()
}

function setClippyFacingLeft(isLeft){
  if (!clippyUi?.root) return
  clippyUi.root.classList.toggle("facing-left", !!isLeft)
}

function stopClippyIdleAnimation(){
  if (clippyIdleRaf) cancelAnimationFrame(clippyIdleRaf)
  clippyIdleRaf = 0
  clippyIdleRunning = false
}

function scheduleClippyIdleHop(){
  if (clippyIdleTimer) clearTimeout(clippyIdleTimer)
  if (!clippyMode || !clippyUi?.root || clippyUi.root.classList.contains("clippy-hidden")) return
  const now = Date.now()
  const wait = Math.max(14000, 18000 - (now - clippyIdleLastActivityAt))
  clippyIdleTimer = setTimeout(() => {
    maybeStartClippyIdleHop()
  }, wait)
}

function maybeStartClippyIdleHop(){
  if (!clippyMode || !clippyUi?.root || clippyUi.root.classList.contains("clippy-hidden")) return
  if (clippyDragging || clippyIdleRunning) return
  if ((Date.now() - clippyIdleLastActivityAt) < 13500) {
    scheduleClippyIdleHop()
    return
  }
  startClippyIdleHopSequence()
}

function randomHopDestination(curLeft, curTop){
  const bounds = getClippyBounds()
  if (!bounds) return { left: curLeft, top: curTop }
  const tries = 20
  for (let i = 0; i < tries; i += 1) {
    const direction = Math.random() < 0.5 ? -1 : 1
    const dx = direction * (60 + Math.round(Math.random() * 120))
    const downChance = Math.random() < 0.4
    const dy = downChance
      ? (12 + Math.round(Math.random() * 90))
      : (-18 + Math.round(Math.random() * 42))
    const left = Math.max(bounds.minLeft, Math.min(curLeft + dx, bounds.maxLeft))
    const top = Math.max(bounds.minTop, Math.min(curTop + dy, bounds.maxTop))
    if (Math.abs(left - curLeft) + Math.abs(top - curTop) >= 36) return { left, top }
  }
  return {
    left: Math.max(bounds.minLeft, Math.min(curLeft + (Math.random() < 0.5 ? -48 : 48), bounds.maxLeft)),
    top: Math.max(bounds.minTop, Math.min(curTop + 24, bounds.maxTop)),
  }
}

function animateClippyHop(from, to, durationMs){
  return new Promise((resolve) => {
    const ui = clippyUi
    if (!ui?.root) {
      resolve()
      return
    }
    const startedAt = performance.now()
    const arc = 22 + Math.random() * 40
    const duration = Math.max(260, Math.min(640, Number(durationMs) || 420))
    const step = (now) => {
      if (!clippyMode || !clippyUi?.root || clippyUi.root.classList.contains("clippy-hidden")) {
        stopClippyIdleAnimation()
        resolve()
        return
      }
      const t = Math.max(0, Math.min(1, (now - startedAt) / duration))
      const baseX = from.left + (to.left - from.left) * t
      const baseY = from.top + (to.top - from.top) * t
      const hop = -4 * arc * t * (1 - t)
      setClippyPosition(baseX, baseY + hop)
      if (t >= 1) {
        resolve()
        return
      }
      clippyIdleRaf = requestAnimationFrame(step)
    }
    clippyIdleRaf = requestAnimationFrame(step)
  })
}

async function startClippyIdleHopSequence(){
  if (clippyIdleRunning || !clippyUi?.root) return
  clippyIdleRunning = true
  const bubbleWasVisible = !!(clippyUi.bubble && !clippyUi.bubble.classList.contains("clippy-hidden"))
  clippyIdleBubbleRestore = bubbleWasVisible ? clippyBubbleVariant : null
  if (bubbleWasVisible) hideClippyBubble()
  try {
    const hops = 1 + (Math.random() < 0.5 ? 1 : 0)
    for (let i = 0; i < hops; i += 1) {
      if (!clippyMode || clippyDragging) break
      const curLeft = parseFloat(clippyUi.root.style.left) || 0
      const curTop = parseFloat(clippyUi.root.style.top) || 0
      const to = randomHopDestination(curLeft, curTop)
      setClippyFacingLeft(to.left < curLeft)
      await animateClippyHop({ left: curLeft, top: curTop }, to, 360 + Math.random() * 180)
      if (i < hops - 1) {
        await new Promise(resolve => setTimeout(resolve, 120 + Math.random() * 220))
      }
    }
  } finally {
    stopClippyIdleAnimation()
    if (clippyMode && clippyUi?.root && clippyIdleBubbleRestore) {
      showClippyBubble({
        variant: clippyIdleBubbleRestore === "compact" ? "compact" : "full",
        snapNoOverlap: true,
        preferAbove: true,
      })
    }
    clippyIdleBubbleRestore = null
    clippyIdleLastActivityAt = Date.now()
    scheduleClippyIdleHop()
  }
}

function voiceStatusLabel(){
  const s = voiceUiState || {}
  if (!s.supported) return "🎤 Speech recognition unsupported"
  if (!s.enabled) return "🎙️ Voice is off"
  if (s.mode === "free" && s.status === "idle") return "🗣️ Always listening"
  if (s.status === "starting") return "🎤 Starting microphone..."
  if (s.status === "idle") return `🎤 ${s.text || "Waiting for \"agentic\""}` 
  if (s.status === "listening") return `🎧 ${s.text || "Listening..."}`
  if (s.status === "processing") return "📝 Sending to Hitomi..."
  if (s.status === "denied") return "🚫 Microphone permission denied"
  if (s.status === "error") return `⚠️ ${s.error || "Mic error"}`
  return "🎤 Voice ready"
}

function updateClippyVoiceBadge(){
  if (!clippyUi?.voice || !clippyUi?.root) return
  if (clippyUi.root.classList.contains("clippy-hidden")) {
    clippyUi.voice.classList.add("clippy-hidden")
    return
  }
  const visible = !!voiceUiState.enabled || !voiceUiState.supported || voiceUiState.status === "denied" || voiceUiState.status === "error"
  clippyUi.voice.classList.toggle("clippy-hidden", !visible)
  clippyUi.voice.classList.toggle("listening", voiceUiState.status === "listening")
  clippyUi.voice.classList.toggle("off", !voiceUiState.enabled)
  clippyUi.voice.textContent = voiceStatusLabel()
}

function rectOverlapArea(a, b){
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return x * y
}

function snapClippyOutOfBubble(opts = {}){
  const ui = clippyUi
  if (!ui?.root || !ui?.body || !ui?.bubble) return
  if (ui.bubble.classList.contains("clippy-hidden")) return
  const desktop = document.getElementById("desktop")
  if (!desktop) return
  const dw = desktop.clientWidth || 0
  const dh = desktop.clientHeight || 0
  if (!dw || !dh) return

  positionClippyBubble()
  const rootRect = ui.root.getBoundingClientRect()
  const bodyRect0 = ui.body.getBoundingClientRect()
  const bubbleRect0 = ui.bubble.getBoundingClientRect()
  if (!bodyRect0.width || !bodyRect0.height || !bubbleRect0.width || !bubbleRect0.height) return
  if (rectOverlapArea(bodyRect0, bubbleRect0) <= 0) return

  const pad = 0
  const bodyW = bodyRect0.width
  const bodyH = bodyRect0.height
  const bubble = bubbleRect0
  const curLeft = parseFloat(ui.root.style.left) || 0
  const curTop = parseFloat(ui.root.style.top) || 0
  const preferAbove = !!opts.preferAbove

  const anchorX = bubble.left + bubble.width * 0.5 - bodyW * 0.5
  const candidates = []
  const addCandidate = (x, y) => candidates.push({ x, y })
  addCandidate(curLeft, bubble.top - bodyH - 8)
  addCandidate(curLeft, bubble.bottom + 8)
  addCandidate(bubble.left - bodyW - 8, curTop)
  addCandidate(bubble.right + 8, curTop)
  addCandidate(anchorX, bubble.top - bodyH - 8)
  addCandidate(anchorX, bubble.bottom + 8)
  addCandidate(bubble.left - bodyW - 8, bubble.top - bodyH * 0.4)
  addCandidate(bubble.right + 8, bubble.top - bodyH * 0.4)
  if (preferAbove) {
    const aboveFirst = [
      { x: curLeft, y: bubble.top - bodyH - 8 },
      { x: anchorX, y: bubble.top - bodyH - 8 },
      ...candidates,
    ]
    candidates.splice(0, candidates.length, ...aboveFirst)
  }

  let best = { score: Infinity, x: curLeft, y: curTop }
  for (const c of candidates) {
    const nx = Math.max(pad, Math.min(c.x, Math.max(pad, dw - (ui.root.offsetWidth || 64))))
    const ny = Math.max(pad, Math.min(c.y, Math.max(pad, dh - (ui.root.offsetHeight || 64))))
    ui.root.style.left = `${nx}px`
    ui.root.style.top = `${ny}px`
    positionClippyBubble()
    const bodyRect = ui.body.getBoundingClientRect()
    const bubbleRect = ui.bubble.getBoundingClientRect()
    const overlap = rectOverlapArea(bodyRect, bubbleRect)
    const isAbove = bodyRect.bottom <= bubbleRect.top + 1
    const dist = Math.abs(nx - curLeft) + Math.abs(ny - curTop)
    const score = overlap * 1e6 + (preferAbove && !isAbove ? 1e5 : 0) + dist
    if (score < best.score) best = { score, x: nx, y: ny }
    if (overlap <= 0 && (!preferAbove || isAbove)) {
      best = { score, x: nx, y: ny }
      break
    }
  }

  ui.root.style.left = `${best.x}px`
  ui.root.style.top = `${best.y}px`
  positionClippyBubble()
}

function positionClippyBubble(){
  const ui = clippyUi
  if (!ui?.root || !ui?.bubble) return
  if (ui.bubble.classList.contains("clippy-hidden")) return
  const desktop = document.getElementById("desktop")
  if (!desktop) return
  const dw = desktop.clientWidth || 0
  const dh = desktop.clientHeight || 0
  if (!dw || !dh) return

  const rootLeft = parseFloat(ui.root.style.left) || 0
  const rootTop = parseFloat(ui.root.style.top) || 0
  const rootW = ui.root.offsetWidth || 132
  const rootH = ui.root.offsetHeight || 132
  const bubbleW = ui.bubble.offsetWidth || 280
  const bubbleH = ui.bubble.offsetHeight || 220
  const pad = 6
  const gap = 8

  // Hitomi head anchor inside clippy root (roughly center-top of hedgehog body).
  const anchorLocalX = Math.max(18, Math.min(rootW - 18, Math.round(rootW * 0.57)))
  const anchorGlobalX = rootLeft + anchorLocalX

  let bubbleGlobalLeft = Math.round(anchorGlobalX - bubbleW / 2)
  bubbleGlobalLeft = Math.max(pad, Math.min(bubbleGlobalLeft, Math.max(pad, dw - bubbleW - pad)))

  let place = "down"
  let bubbleGlobalTop = Math.round(rootTop - bubbleH - gap)
  if (bubbleGlobalTop < pad) {
    place = "up"
    bubbleGlobalTop = Math.round(rootTop + rootH + gap)
    bubbleGlobalTop = Math.min(bubbleGlobalTop, Math.max(pad, dh - bubbleH - pad))
  }
  bubbleGlobalTop = Math.max(pad, Math.min(bubbleGlobalTop, Math.max(pad, dh - bubbleH - pad)))

  const localLeft = bubbleGlobalLeft - rootLeft
  const localTop = bubbleGlobalTop - rootTop
  ui.bubble.style.left = `${localLeft}px`
  ui.bubble.style.top = `${localTop}px`
  ui.bubble.style.bottom = "auto"
  ui.bubble.style.transform = "none"
  ui.bubble.dataset.tail = place

  const tailX = Math.max(14, Math.min(bubbleW - 14, anchorGlobalX - bubbleGlobalLeft))
  ui.bubble.style.setProperty("--tail-left", `${tailX}px`)
}

function scrollClippyToBottom(){
  if (!clippyUi?.log) return
  const apply = () => { clippyUi.log.scrollTop = clippyUi.log.scrollHeight }
  apply()
  requestAnimationFrame(apply)
  setTimeout(apply, 0)
}

function renderOnboardingChips(){
  if (!clippyUi?.chips) return
  if (!isOnboardingGuideActive()) {
    clippyUi.chips.classList.add("clippy-hidden")
    clippyUi.chips.innerHTML = ""
    return
  }
  const groups = onboardingHedgey?.getPills?.() || { primary: [], secondary: [] }
  const primary = Array.isArray(groups.primary) ? groups.primary : []
  const secondary = Array.isArray(groups.secondary) ? groups.secondary : []
  const mk = (pill, cls = "") => {
    const klass = ["clippy-chip", cls].filter(Boolean).join(" ")
    return `<button class="${escapeHtml(klass)}" data-pill-id="${escapeHtml(pill.id)}" type="button">${escapeHtml(pill.label)}</button>`
  }
  const primaryHtml = primary.map(p => mk(p)).join("")
  const secondaryHtml = secondary.map(p => mk(p, "secondary")).join("")
  const html = [primaryHtml, secondaryHtml].filter(Boolean).join("")
  clippyUi.chips.innerHTML = html
  clippyUi.chips.classList.toggle("clippy-hidden", !html)
}

function renderClippyBubble(){
  if (!clippyUi?.log || !clippyUi?.bubble) return
  const compact = isOnboardingGuideActive() ? true : (clippyBubbleVariant === "compact")
  clippyUi.bubble.classList.toggle("compact", compact)
  clippyUi.log.innerHTML = compact ? getClippyCompactHtml() : getClippyChatHtml()
  renderOnboardingChips()
  scrollClippyToBottom()
  requestAnimationFrame(positionClippyBubble)
}

function showClippyBubble(opts = {}){
  if (!clippyUi?.bubble) return
  clippyBubbleVariant = opts.variant === "compact" ? "compact" : "full"
  renderClippyBubble()
  clippyUi.bubble.classList.remove("clippy-hidden")
  requestAnimationFrame(() => {
    positionClippyBubble()
    if (opts.snapNoOverlap) snapClippyOutOfBubble({ preferAbove: !!opts.preferAbove })
  })
}

function ensureClippyAssistant(){
  if (clippyUi?.root && clippyUi.root.isConnected) return clippyUi
  const desktop = document.getElementById("desktop")
  if (!desktop) return null
  const root = document.createElement("div")
  root.className = "clippy-assistant clippy-hidden"
  root.style.left = "20px"
  root.style.top = "20px"
  root.innerHTML = `
    <div class="clippy-voice clippy-hidden"></div>
    <div class="clippy-bubble clippy-hidden">
      <div class="clippy-bubble-title">Hitomi</div>
      <div class="clippy-bubble-content">
        <div class="clippy-log"></div>
        <div class="clippy-chips clippy-hidden"></div>
        <form class="clippy-form">
          <input class="clippy-input" type="text" placeholder="Write a message..." />
          <button class="clippy-send" type="submit">Send</button>
        </form>
      </div>
    </div>
    <div class="clippy-shadow" aria-hidden="true"></div>
    <img class="clippy-body" src="assets/hedgey1.png" alt="Hitomi hedgehog assistant" draggable="false" />
  `
  desktop.appendChild(root)
  const body = root.querySelector(".clippy-body")
  const voice = root.querySelector(".clippy-voice")
  const bubble = root.querySelector(".clippy-bubble")
  const log = root.querySelector(".clippy-log")
  const chips = root.querySelector(".clippy-chips")
  const form = root.querySelector(".clippy-form")
  const input = root.querySelector(".clippy-input")
  const menu = document.createElement("div")
  menu.className = "clippy-menu clippy-hidden"
  menu.innerHTML = `<button class="clippy-menu-item" type="button">Close</button>`
  desktop.appendChild(menu)
  const closeBtn = menu.querySelector(".clippy-menu-item")
  let alphaCanvas = null
  let alphaData = null
  let dragging = false
  let moved = false
  let startX = 0
  let startY = 0
  let baseLeft = 0
  let baseTop = 0
  function ensureBodyAlphaData(){
    if (alphaData || !body) return
    const iw = body.naturalWidth || body.width || 0
    const ih = body.naturalHeight || body.height || 0
    if (!iw || !ih) return
    alphaCanvas = document.createElement("canvas")
    alphaCanvas.width = iw
    alphaCanvas.height = ih
    const ctx = alphaCanvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    ctx.clearRect(0, 0, iw, ih)
    ctx.drawImage(body, 0, 0, iw, ih)
    alphaData = ctx.getImageData(0, 0, iw, ih).data
  }
  function isOpaqueBodyPixelAt(clientX, clientY){
    if (!body) return false
    ensureBodyAlphaData()
    if (!alphaCanvas || !alphaData) return true
    const rect = body.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const rx = (clientX - rect.left) / rect.width
    const ry = (clientY - rect.top) / rect.height
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return false
    const px = Math.max(0, Math.min(alphaCanvas.width - 1, Math.floor(rx * alphaCanvas.width)))
    const py = Math.max(0, Math.min(alphaCanvas.height - 1, Math.floor(ry * alphaCanvas.height)))
    const ai = (py * alphaCanvas.width + px) * 4 + 3
    return (alphaData[ai] || 0) > 18
  }
  function resolveUnderlyingTarget(clientX, clientY){
    if (!body || !root) return
    const prevRootPe = root.style.pointerEvents
    root.style.pointerEvents = "none"
    const target = document.elementFromPoint(clientX, clientY)
    root.style.pointerEvents = prevRootPe
    return target
  }
  function forwardClickToUnderlying(e){
    const target = resolveUnderlyingTarget(e.clientX, e.clientY)
    if (!target || target === body || target === root) return
    const mouseInit = {
      bubbles: true,
      cancelable: true,
      clientX: e.clientX,
      clientY: e.clientY,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    }
    try { target.dispatchEvent(new MouseEvent("mousedown", mouseInit)) } catch {}
    try { target.dispatchEvent(new MouseEvent("mouseup", mouseInit)) } catch {}
    try { target.dispatchEvent(new MouseEvent("click", mouseInit)) } catch {}
    try { target.focus?.() } catch {}
  }
  function clampPos(){
    const next = clampClippyPosition(baseLeft, baseTop)
    root.style.left = `${Math.round(next.left)}px`
    root.style.top = `${Math.round(next.top)}px`
    positionClippyBubble()
  }
  body?.addEventListener("pointerdown", (e) => {
    if (!isOpaqueBodyPixelAt(e.clientX, e.clientY)) {
      e.preventDefault()
      forwardClickToUnderlying(e)
      return
    }
    e.preventDefault()
    markClippyActivity()
    stopClippyIdleAnimation()
    clippyDragging = true
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
    clippyDragging = false
  }
  body?.addEventListener("pointerup", (e) => {
    if (!dragging) return
    if (!moved) {
      if (bubble?.classList.contains("clippy-hidden")) {
        const variant = isOnboardingGuideActive() ? "compact" : "full"
        showClippyBubble({ variant, snapNoOverlap: true, preferAbove: true })
      }
      else hideClippyBubble()
    } else if (bubble && !bubble.classList.contains("clippy-hidden")) {
      snapClippyOutOfBubble({ preferAbove: false })
    }
    endDrag()
    body.releasePointerCapture?.(e.pointerId)
  })
  body?.addEventListener("pointercancel", endDrag)
  body?.addEventListener("dragstart", (e) => {
    e.preventDefault()
  })
  body?.addEventListener("contextmenu", (e) => {
    if (!isOpaqueBodyPixelAt(e.clientX, e.clientY)) return
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
    markClippyActivity()
    if (input) input.value = ""
    if (isOnboardingGuideActive()) {
      try {
        await onboardingHedgey?.handleUserInput?.(text)
        clippyBubbleVariant = "compact"
        showClippyBubble({ variant: "compact", snapNoOverlap: true, preferAbove: true })
        renderClippyBubble()
        setStatus("Setup guide active.")
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Setup guide failed")
      }
      return
    }
    try {
      clippyBubbleVariant = "full"
      showClippyBubble({ variant: "full", snapNoOverlap: true, preferAbove: false })
      saveDraftFromInputs()
      setStatus("Thinking...")
      const chatOne = getChatOneThread()
      if (!chatOne?.id) throw new Error("Chat 1 not available.")
      await sendChat(text, { threadId: chatOne.id })
      setStatus("Reply received.")
      renderClippyBubble()
      showClippyBubble({ variant: "full", snapNoOverlap: true, preferAbove: false })
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Chat failed")
    }
  })
  chips?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-pill-id]")
    if (!btn) return
    const pillId = String(btn.getAttribute("data-pill-id") || "").trim()
    if (!pillId) return
    markClippyActivity()
    await onboardingHedgey?.handlePill?.(pillId)
    clippyBubbleVariant = "compact"
    showClippyBubble({ variant: "compact", snapNoOverlap: true, preferAbove: true })
    renderClippyBubble()
  })
  log?.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-open-url]")
    if (!link) return
    const target = String(link.getAttribute("data-open-url") || "").trim()
    if (!target) return
    e.preventDefault()
    markClippyActivity()
    onboardingHedgey?.onLinkClick?.(target)
  })
  clippyUi = { root, body, bubble, log, chips, form, input, menu, voice }
  positionClippyAtBottom()
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
  if (!clippyActivityWired) {
    clippyActivityWired = true
    const noteActivity = () => {
      if (!clippyMode) return
      markClippyActivity()
    }
    window.addEventListener("pointerdown", noteActivity, true)
    window.addEventListener("keydown", noteActivity, true)
    window.addEventListener("wheel", noteActivity, { passive: true, capture: true })
    window.addEventListener("touchstart", noteActivity, { passive: true, capture: true })
  }
  window.addEventListener("resize", () => {
    positionHitomiDesktopIcon()
    if (!clippyUi?.root) return
    baseLeft = parseFloat(clippyUi.root.style.left) || 0
    baseTop = parseFloat(clippyUi.root.style.top) || 0
    clampPos()
    positionClippyBubble()
  })
  markClippyActivity()
  updateClippyVoiceBadge()
  return clippyUi
}

function setClippyMode(next){
  const ui = next ? ensureClippyAssistant() : clippyUi
  if (!ui) return
  const wasHidden = ui.root.classList.contains("clippy-hidden")
  clippyMode = !!next
  ui.root.classList.toggle("clippy-hidden", !clippyMode)
  if (ui.menu) ui.menu.classList.add("clippy-hidden")
  if (clippyMode) {
    if (wasHidden) positionClippyAtBottom()
    if (wasHidden) animateHitomiWispsShow(ui.root)
    const thread = getChatOneThread()
    const messages = Array.isArray(thread?.messages) ? thread.messages : []
    clippyLastAssistantKey = latestAssistantMessageKey(messages)
    hideClippyBubble()
    updateClippyVoiceBadge()
    markClippyActivity()
    setStatus("Clippy mode enabled.")
  } else {
    if (clippyIdleTimer) clearTimeout(clippyIdleTimer)
    clippyIdleTimer = null
    stopClippyIdleAnimation()
    clippyDragging = false
    hideClippyBubble()
    updateClippyVoiceBadge()
    setStatus("Clippy mode disabled.")
  }
}

async function handleVoiceCommand(text){
  const spoken = String(text || "").trim()
  if (!spoken) return
  try {
    setClippyMode(true)
    markClippyActivity()
    if (clippyUi?.input) clippyUi.input.value = spoken
    clippyBubbleVariant = "full"
    showClippyBubble({ variant: "full", snapNoOverlap: true, preferAbove: false })
    setStatus("Thinking...")
    const chatOne = getChatOneThread()
    if (!chatOne?.id) throw new Error("Chat 1 not available.")
    await sendChat(spoken, { threadId: chatOne.id })
    setStatus("Reply received.")
    showClippyBubble({ variant: "full", snapNoOverlap: true, preferAbove: false })
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Voice message failed")
  }
}

function renderChat(){
  if (!els.chatLog) return
  ensureLocalThreadsInitialized()
  refreshThreadPickerSoon()
  const thread = getActiveLocalThread()
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const thinking = isThreadThinking(thread?.id)
  if (!messages.length && !thinking) {
    els.chatLog.innerHTML = `<div class="agent-muted">No messages yet.</div>`
  } else {
    const rendered = messages.map(msg => {
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
    })
    if (thinking) {
      rendered.push(`<div class="agent-bubble assistant"><div class="agent-bubble-head"><img class="agent-avatar" src="assets/hedgey1.png" alt="Hitomi avatar" /><div class="agent-bubble-role">Hitomi</div></div><div>Thinking...</div></div>`)
    }
    els.chatLog.innerHTML = rendered.join("")
  }
  if (clippyMode) renderClippyBubble()
  if (clippyMode && clippyUi?.root && !clippyUi.root.classList.contains("clippy-hidden")) {
    const chatOne = getChatOneThread()
    const chatOneMessages = Array.isArray(chatOne?.messages) ? chatOne.messages : []
    const latestKey = latestAssistantMessageKey(chatOneMessages)
    const bubbleHidden = clippyUi?.bubble?.classList.contains("clippy-hidden")
    if (latestKey && latestKey !== clippyLastAssistantKey && bubbleHidden) {
      showClippyBubble({ variant: "compact", snapNoOverlap: true, preferAbove: true })
    }
    clippyLastAssistantKey = latestKey || clippyLastAssistantKey
  }
  scrollChatToBottom()
}

function renderEvents(){
  if (!els.eventLog) return
  if (!appState.events.length) {
    els.eventLog.innerHTML = `<div class="agent-muted">No events yet.</div>`
    renderEventToasts()
    return
  }
  els.eventLog.innerHTML = appState.events.map(event => {
    return `<div class="agent-event"><div class="agent-event-head"><span>${escapeHtml(event.type)}</span><span>${escapeHtml(formatTime(event.createdAt))}</span></div><div>${escapeHtml(event.message)}</div></div>`
  }).join("")
  renderEventToasts()
}

function ensureEventToastUi(){
  if (els.eventToastRoot && els.eventToastList && els.eventToastHeader && els.eventToastCloseAllBtn) return
  let root = byId("agentEventToasts")
  if (!root) {
    root = document.createElement("section")
    root.id = "agentEventToasts"
    root.className = "agent-event-toasts"
    root.setAttribute("aria-live", "polite")
    root.setAttribute("aria-label", "Recent notifications")
    root.innerHTML = `
      <div id="agentEventToastHeader" class="agent-event-toast-header">
        <span>Notifications</span>
        <button id="agentEventToastCloseAll" type="button">Close All</button>
      </div>
      <div id="agentEventToastList" class="agent-event-toast-list"></div>
    `
    document.body.appendChild(root)
  }
  els.eventToastRoot = root
  els.eventToastHeader = byId("agentEventToastHeader")
  els.eventToastCloseAllBtn = byId("agentEventToastCloseAll")
  els.eventToastList = byId("agentEventToastList")
  if (!els.eventToastWired) {
    els.eventToastWired = true
    els.eventToastCloseAllBtn?.addEventListener("click", (e) => {
      e.preventDefault()
      const newest = appState.events[0]
      eventToastDismissedThroughId = Number(newest?.id || eventToastDismissedThroughId || 0)
      eventToastExpanded = false
      renderEventToasts()
    })
    els.eventToastList?.addEventListener("click", () => {
      const visible = appState.events.filter(event => Number(event.id || 0) > eventToastDismissedThroughId)
      if (!visible.length) return
      eventToastExpanded = !eventToastExpanded
      renderEventToasts()
    })
  }
}

function renderEventToasts(){
  ensureEventToastUi()
  if (!els.eventToastRoot || !els.eventToastList || !els.eventToastHeader) return
  const visible = appState.events.filter(event => Number(event.id || 0) > eventToastDismissedThroughId)
  if (!visible.length) {
    els.eventToastRoot.classList.remove("show")
    els.eventToastRoot.classList.remove("expanded")
    els.eventToastList.innerHTML = ""
    return
  }
  const rows = (eventToastExpanded ? visible.slice(0, 5) : visible.slice(0, 1))
  els.eventToastHeader.style.display = eventToastExpanded ? "flex" : "none"
  els.eventToastList.innerHTML = rows.map(event => `
    <article class="agent-event-toast-item">
      <div class="agent-event-toast-item-head">
        <span class="agent-event-toast-item-type">${escapeHtml(event.type)}</span>
        <span class="agent-event-toast-item-time">${escapeHtml(formatTime(event.createdAt))}</span>
      </div>
      <div class="agent-event-toast-item-body">${escapeHtml(event.message)}</div>
    </article>
  `).join("")
  els.eventToastRoot.classList.add("show")
  els.eventToastRoot.classList.toggle("expanded", eventToastExpanded)
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
  const [openAiSecret, anthropicSecret, xaiSecret, zaiSecret] = await Promise.all([
    getSecret("openai"),
    getSecret("anthropic"),
    getSecret("xai"),
    getSecret("zai"),
  ])
  const hasOpenAi = Boolean(openAiSecret)
  const hasTelegram = Boolean(await getSecret("telegram"))
  const selectedProvider = previewProviderState.editor
  if (anthropicSecret) previewProviderState.anthropicValidated = true
  if (xaiSecret) previewProviderState.xaiValidated = true
  if (zaiSecret) previewProviderState.zaiValidated = true
  const hasAnthropic = Boolean(anthropicSecret || previewProviderState.anthropicValidated)
  const hasXai = Boolean(xaiSecret || previewProviderState.xaiValidated)
  const hasZai = Boolean(zaiSecret || previewProviderState.zaiValidated)
  const hasOllama = Boolean(previewProviderState.ollamaValidated && String(previewProviderState.ollamaBaseUrl || "").trim())
  const providerErrors = previewProviderState.providerErrors || {}
  const openaiErr = String(providerErrors.openai || "")
  const anthropicErr = String(providerErrors.anthropic || "")
  const xaiErr = String(providerErrors.xai || "")
  const zaiErr = String(providerErrors.zai || "")
  const ollamaErr = String(providerErrors.ollama || "")
  if (els.openaiBadge) {
    els.openaiBadge.className = `agent-badge ${hasOpenAi ? "ok" : "warn"}`
    els.openaiBadge.textContent = hasOpenAi ? encryptedLabelText() : "Missing key"
  }
  if (els.anthropicBadge) {
    els.anthropicBadge.className = `agent-badge ${hasAnthropic ? "ok" : "warn"}`
    els.anthropicBadge.textContent = hasAnthropic ? "Stored" : "Missing key"
  }
  if (els.zaiBadge) {
    els.zaiBadge.className = `agent-badge ${hasZai ? "ok" : "warn"}`
    els.zaiBadge.textContent = hasZai ? "Stored" : "Missing key"
  }
  if (els.xaiBadge) {
    els.xaiBadge.className = `agent-badge ${hasXai ? "ok" : "warn"}`
    els.xaiBadge.textContent = hasXai ? "Stored" : "Missing key"
  }
  if (els.ollamaBadge) {
    els.ollamaBadge.className = `agent-badge ${hasOllama ? "ok" : "warn"}`
    els.ollamaBadge.textContent = hasOllama ? "Stored" : "Missing URL"
  }
  if (els.providerPillOpenai) {
    const mode = !hasOpenAi ? "warn" : (openaiErr ? "err" : "ok")
    els.providerPillOpenai.className = `agent-provider-pill ${mode}`
    els.providerPillOpenai.textContent = !hasOpenAi ? "Missing key" : (openaiErr ? `Error ${openaiErr}` : "Ready")
  }
  if (els.providerPillAnthropic) {
    const mode = !hasAnthropic ? "warn" : (anthropicErr ? "err" : "ok")
    els.providerPillAnthropic.className = `agent-provider-pill ${mode}`
    els.providerPillAnthropic.textContent = !hasAnthropic ? "Missing key" : (anthropicErr ? `Error ${anthropicErr}` : "Ready")
  }
  if (els.providerPillXai) {
    const mode = !hasXai ? "warn" : (xaiErr ? "err" : "ok")
    els.providerPillXai.className = `agent-provider-pill ${mode}`
    els.providerPillXai.textContent = !hasXai ? "Missing key" : (xaiErr ? `Error ${xaiErr}` : "Ready")
  }
  if (els.providerPillZai) {
    const mode = !hasZai ? "warn" : (zaiErr ? "err" : "ok")
    els.providerPillZai.className = `agent-provider-pill ${mode}`
    els.providerPillZai.textContent = !hasZai ? "Missing key" : (zaiErr ? `Error ${zaiErr}` : "Ready")
  }
  if (els.providerPillOllama) {
    const mode = !hasOllama ? "warn" : (ollamaErr ? "err" : "ok")
    els.providerPillOllama.className = `agent-provider-pill ${mode}`
    els.providerPillOllama.textContent = !hasOllama ? "Missing URL" : (ollamaErr ? `Error ${ollamaErr}` : "Ready")
  }
  if (els.telegramBadge) {
    els.telegramBadge.className = `agent-badge ${hasTelegram ? "ok" : "warn"}`
    els.telegramBadge.textContent = hasTelegram ? encryptedLabelText() : "Missing token"
  }
  if (els.openaiStoredLabel) {
    els.openaiStoredLabel.textContent = `OpenAI API Key ${storageLabelText()}`
  }
  if (els.anthropicStoredLabel) {
    els.anthropicStoredLabel.textContent = `Anthropic API Key ${storageLabelText()}`
  }
  if (els.xaiStoredLabel) {
    els.xaiStoredLabel.textContent = `xAI API Key ${storageLabelText()}`
  }
  if (els.zaiStoredLabel) {
    els.zaiStoredLabel.textContent = `z.ai API Key ${storageLabelText()}`
  }
  if (els.telegramStoredLabel) {
    els.telegramStoredLabel.textContent = `Telegram API Key ${storageLabelText()}`
  }
  if (els.openaiStoredRow && els.openaiControls) {
    if (selectedProvider !== "openai") {
      els.openaiStoredRow.classList.add("agent-hidden")
      els.openaiControls.classList.add("agent-hidden")
    } else {
      const showStored = hasOpenAi && !openAiEditing
      els.openaiStoredRow.classList.toggle("agent-hidden", !showStored)
      els.openaiControls.classList.toggle("agent-hidden", showStored)
    }
  }
  if (els.telegramStoredRow && els.telegramControls) {
    const hideTelegramControls = hasTelegram && !telegramEditing
    els.telegramStoredRow.classList.toggle("agent-hidden", !hideTelegramControls)
    els.telegramControls.classList.toggle("agent-hidden", hideTelegramControls)
  }
  await refreshHitomiDesktopIcon()
}

function refreshUi(){
  const canUse = canAccessSecrets()
  if (els.chatInput) {
    els.chatInput.disabled = false
    els.chatInput.placeholder = "Write a message..."
  }
  if (els.chatSendBtn) els.chatSendBtn.disabled = false
  if (els.openaiKeyInput) els.openaiKeyInput.disabled = !canUse
  if (els.telegramTokenInput) els.telegramTokenInput.disabled = !canUse
  if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.disabled = !canUse
  if (els.anthropicKeyInput) els.anthropicKeyInput.disabled = !canUse
  if (els.anthropicModelInput) els.anthropicModelInput.disabled = !canUse
  if (els.anthropicModelStored) els.anthropicModelStored.disabled = !canUse
  if (els.xaiKeyInput) els.xaiKeyInput.disabled = !canUse
  if (els.xaiModelInput) els.xaiModelInput.disabled = !canUse
  if (els.xaiModelStored) els.xaiModelStored.disabled = !canUse
  if (els.zaiKeyInput) els.zaiKeyInput.disabled = !canUse
  if (els.zaiModelInput) els.zaiModelInput.disabled = !canUse
  if (els.zaiModelStored) els.zaiModelStored.disabled = !canUse
  if (els.ollamaBaseUrlInput) els.ollamaBaseUrlInput.disabled = !canUse
  if (els.ollamaModelInput) els.ollamaModelInput.disabled = !canUse
  if (els.ollamaModelStored) els.ollamaModelStored.disabled = !canUse
  if (els.anthropicSavePreviewBtn) els.anthropicSavePreviewBtn.disabled = !canUse
  if (els.anthropicEditBtn) els.anthropicEditBtn.disabled = !canUse
  if (els.xaiSavePreviewBtn) els.xaiSavePreviewBtn.disabled = !canUse
  if (els.xaiEditBtn) els.xaiEditBtn.disabled = !canUse
  if (els.zaiSavePreviewBtn) els.zaiSavePreviewBtn.disabled = !canUse
  if (els.zaiEditBtn) els.zaiEditBtn.disabled = !canUse
  if (els.ollamaSavePreviewBtn) els.ollamaSavePreviewBtn.disabled = !canUse
  if (els.ollamaEditBtn) els.ollamaEditBtn.disabled = !canUse
  if (els.ollamaSetupBtn) els.ollamaSetupBtn.disabled = !canUse
  if (els.openShellRelayBtn) els.openShellRelayBtn.disabled = !canUse
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
  if (els.telegramSaveBtn) els.telegramSaveBtn.textContent = appState.unencryptedMode ? "Save Token (Local)" : "Save Token"
  renderChat()
  renderEvents()
  loadInputsFromState()
  refreshProviderPreviewUi()
  refreshBadges()
  publishBrowserRelayState()
}

function publishBrowserRelayState(){
  try {
    window.__agent1cRelayState = {
      enabled: Boolean(appState.config.relayEnabled),
      baseUrl: String(appState.config.relayBaseUrl || ""),
      timeoutMs: Number(appState.config.relayTimeoutMs || 30000),
      updatedAt: Date.now(),
    }
    window.dispatchEvent(new CustomEvent("agent1c:relay-state-updated", { detail: window.__agent1cRelayState }))
  } catch {}
}

function closeWindow(winObj){
  if (!winObj?.win) return
  const btn = winObj.win.querySelector("[data-close]")
  if (btn) btn.click()
}

function readSavedAgentPanelIds(){
  try {
    const raw = localStorage.getItem(WINDOW_LAYOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const panels = parsed && typeof parsed === "object" ? parsed.panels : null
    if (!panels || typeof panels !== "object") return null
    const ids = CORE_AGENT_PANEL_IDS.filter(id => Object.prototype.hasOwnProperty.call(panels, id))
    return ids.length ? new Set(ids) : null
  } catch {
    return null
  }
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

async function copyTextToClipboard(text){
  const value = String(text || "")
  if (!value) return false
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const ta = document.createElement("textarea")
      ta.value = value
      ta.setAttribute("readonly", "readonly")
      ta.style.position = "fixed"
      ta.style.left = "-9999px"
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand("copy")
      ta.remove()
      return Boolean(ok)
    } catch {
      return false
    }
  }
}

function wireOllamaSetupWindowDom(winObj){
  const root = winObj?.panelRoot
  if (!root) return
  const setupModels = {
    tiny: { label: "Tiny", model: "qwen2.5:0.5b" },
    small: { label: "Small", model: "qwen2.5:1.5b" },
    medium: { label: "Medium", model: "qwen2.5:3b" },
    large: { label: "Large", model: "qwen2.5:7b" },
    xl: { label: "XL", model: "glm-4.7-flash:latest" },
  }
  const modelSelect = root.querySelector("#ollamaSetupSizeSelect")
  const inferSizeFromModel = (value) => {
    const modelText = String(value || "").trim().toLowerCase()
    const entry = Object.entries(setupModels).find(([, meta]) => meta.model.toLowerCase() === modelText)
    return entry ? entry[0] : "tiny"
  }
  const applySelectedModel = () => {
    const key = String(modelSelect?.value || "tiny").toLowerCase()
    const choice = setupModels[key] || setupModels.tiny
    root.querySelectorAll("[data-ollama-model-command]").forEach(node => {
      node.textContent = `ollama pull ${choice.model}`
    })
    root.querySelectorAll("[data-ollama-model-inline]").forEach(node => {
      node.textContent = choice.model
    })
    previewProviderState.ollamaModel = choice.model
    if (els?.ollamaModelInput) els.ollamaModelInput.value = choice.model
    if (els?.ollamaModelStored) els.ollamaModelStored.value = choice.model
    persistPreviewProviderState()
    refreshProviderPreviewUi()
  }

  const setDevice = (device) => {
    const current = String(device || "").trim().toLowerCase()
    root.querySelectorAll("[data-device-tab]").forEach(btn => {
      const target = String(btn.getAttribute("data-device-tab") || "").trim().toLowerCase()
      const isActive = target === current
      btn.classList.toggle("active", isActive)
      btn.setAttribute("aria-selected", isActive ? "true" : "false")
    })
    root.querySelectorAll("[data-device-panel]").forEach(panel => {
      const target = String(panel.getAttribute("data-device-panel") || "").trim().toLowerCase()
      panel.classList.toggle("agent-hidden", target !== current)
    })
  }

  root.querySelectorAll("[data-device-tab]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = String(btn.getAttribute("data-device-tab") || "").trim()
      if (!target) return
      setDevice(target)
    })
  })

  root.querySelectorAll("[data-copy-target]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const targetId = btn.getAttribute("data-copy-target")
      const source = targetId ? root.querySelector(`#${targetId}`) : null
      const text = source?.textContent || ""
      const ok = await copyTextToClipboard(text)
      setStatus(ok ? "Copied command." : "Could not copy command.")
    })
  })

  root.querySelectorAll("[data-open-url]").forEach(btn => {
    btn.addEventListener("click", () => {
      const url = String(btn.getAttribute("data-open-url") || "").trim()
      if (!url) return
      window.open(url, "_blank", "noopener,noreferrer")
    })
  })

  if (modelSelect) {
    modelSelect.value = inferSizeFromModel(previewProviderState.ollamaModel)
    modelSelect.addEventListener("change", () => {
      applySelectedModel()
      const selected = setupModels[String(modelSelect.value || "tiny").toLowerCase()] || setupModels.tiny
      setStatus(`Ollama setup model selected: ${selected.label} (${selected.model}).`)
    })
  }
  applySelectedModel()

  const ua = String(navigator.userAgent || "").toLowerCase()
  if (ua.includes("android")) setDevice("android")
  else if (ua.includes("mac os x") || ua.includes("macintosh")) setDevice("mac")
  else setDevice("linux")
}

function openOllamaSetupWindow(){
  if (wins.ollamaSetup?.win?.isConnected) {
    restoreWindow(wins.ollamaSetup)
    focusWindow(wins.ollamaSetup)
    return
  }
  wins.ollamaSetup = wmRef.createAgentPanelWindow("Ollama Setup", {
    panelId: "ollama-setup",
    left: 140,
    top: 80,
    width: 620,
    height: 520,
    closeAsMinimize: true,
  })
  if (!wins.ollamaSetup?.panelRoot) return
  wins.ollamaSetup.panelRoot.innerHTML = ollamaSetupWindowHtml()
  wireOllamaSetupWindowDom(wins.ollamaSetup)
}

function wireShellRelayWindowDom(winObj){
  const root = winObj?.panelRoot
  if (!root) return
  wireShellRelayDom({
    root,
    els,
    getRelayConfig: () => normalizeRelayConfig(appState.config),
    onSaveRelayConfig: async (nextCfg) => {
      appState.config.relayEnabled = nextCfg.enabled
      appState.config.relayBaseUrl = nextCfg.baseUrl
      appState.config.relayToken = nextCfg.token
      appState.config.relayTimeoutMs = nextCfg.timeoutMs
      await persistState()
      refreshUi()
    },
    setStatus,
    addEvent,
  })
}

function openShellRelayWindow(){
  if (wins.shellrelay?.id && wmRef?.restore) {
    wmRef.restore(wins.shellrelay.id)
    wmRef.focus?.(wins.shellrelay.id)
    return
  }
  wins.shellrelay = wmRef.createAgentPanelWindow("Shell Relay", {
    panelId: "shellrelay",
    left: 1045,
    top: 360,
    width: 460,
    height: 470,
    closeAsMinimize: true,
  })
  if (!wins.shellrelay?.panelRoot) return
  wins.shellrelay.panelRoot.innerHTML = shellRelayWindowHtml()
  cacheElements()
  wireShellRelayWindowDom(wins.shellrelay)
}

function applyOnboardingWindowState(){
  restoreWindow(wins.openai)
  focusWindow(wins.openai)
  minimizeWindow(wins.chat)
  minimizeWindow(wins.config)
  minimizeWindow(wins.telegram)
  minimizeWindow(wins.shellrelay)
  minimizeWindow(wins.soul)
  minimizeWindow(wins.tools)
  minimizeWindow(wins.heartbeat)
  syncOnboardingGuideActivation()
}

function revealPostOpenAiWindows(){
  restoreWindow(wins.chat)
  restoreWindow(wins.config)
  restoreWindow(wins.telegram)
  minimizeWindow(wins.shellrelay)
  minimizeWindow(wins.soul)
  minimizeWindow(wins.tools)
  minimizeWindow(wins.heartbeat)
  focusWindow(wins.chat)
  setClippyMode(true)
}

function syncOnboardingGuideActivation(){
  if (!onboardingHedgey) return
  const shouldBeActive = !onboardingComplete
  onboardingHedgey.setActive(shouldBeActive)
  if (!shouldBeActive) return
  setClippyMode(true)
  positionClippyAtBottom()
  nudgeOnboardingBubble({ compact: false })
}

async function maybeCompleteOnboarding(){
  if (onboardingComplete) return true
  const hasAiSecret = await hasAnyAiProviderKey()
  if (!hasAiSecret || !onboardingOpenAiTested) return false
  onboardingComplete = true
  onboardingHedgey?.setActive?.(false)
  localStorage.setItem(ONBOARDING_KEY, "1")
  minimizeWindow(wins.openai)
  revealPostOpenAiWindows()
  await addEvent("onboarding_step", "AI key saved and validated. Chat is ready.")
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
        <button id="setupSkipBtn" class="btn agent-btn-danger" type="button">Skip for Now</button>
        <div class="agent-note agent-note-warn">Warning: If skipped, your API keys are stored locally without encryption.</div>
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
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="xai">xAI (Grok)</option>
              <option value="zai">z.ai</option>
              <option value="ollama">Ollama Local</option>
            </select>
          </label>
        </div>
        <div class="agent-provider-cards">
          <div id="providerCardOpenai" class="agent-provider-card" data-provider="openai">
            <div class="agent-provider-head"><strong>OpenAI</strong><span id="providerPillOpenai" class="agent-provider-pill warn">Missing</span></div>
            <div id="providerNoteOpenai" class="agent-note">Tap to configure OpenAI API key.</div>
            <div id="providerSectionOpenai" class="agent-provider-inline agent-hidden">
              <div id="openaiStoredRow" class="agent-row agent-row-tight agent-hidden">
                <span id="openaiStoredLabel" class="agent-note">OpenAI API Key Stored in Vault</span>
                <button id="openaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit OpenAI key">✎</button>
                <label class="agent-inline-mini">
                  <span>Model</span>
                  <select id="modelInput" class="field"></select>
                </label>
              </div>
              <div id="openaiControls">
                <form id="openaiForm" class="agent-row agent-row-tight">
                  <span class="agent-note">OpenAI key <span id="openaiBadge" class="agent-badge warn">Missing key</span></span>
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
          </div>
          <div id="providerCardAnthropic" class="agent-provider-card" data-provider="anthropic">
            <div class="agent-provider-head"><strong>Anthropic</strong><span id="providerPillAnthropic" class="agent-provider-pill warn">Missing key</span></div>
            <div id="providerNoteAnthropic" class="agent-note">Tap to configure Anthropic API key.</div>
            <div id="providerSectionAnthropic" class="agent-provider-inline agent-hidden">
              <div id="anthropicStoredRow" class="agent-row agent-row-tight agent-hidden">
                <span id="anthropicStoredLabel" class="agent-note">Anthropic API Key Stored in Vault</span>
                <button id="anthropicEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit Anthropic key">✎</button>
                <label class="agent-inline-mini">
                  <span>Model</span>
                  <select id="anthropicModelStored" class="field">${renderModelOptions(FALLBACK_ANTHROPIC_MODELS)}</select>
                </label>
              </div>
              <div id="anthropicControls">
                <div class="agent-row agent-row-tight">
                  <span class="agent-note">Anthropic key <span id="anthropicBadge" class="agent-badge warn">Missing key</span></span>
                  <div class="agent-inline-key agent-inline-key-wide">
                    <input id="anthropicKeyInput" class="field" type="password" placeholder="sk-ant-..." />
                    <button id="anthropicSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Save Anthropic key">></button>
                  </div>
                  <label class="agent-inline-mini">
                    <span>Model</span>
                    <select id="anthropicModelInput" class="field">${renderModelOptions(FALLBACK_ANTHROPIC_MODELS)}</select>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div id="providerCardXai" class="agent-provider-card" data-provider="xai">
            <div class="agent-provider-head"><strong>xAI (Grok)</strong><span id="providerPillXai" class="agent-provider-pill warn">Missing key</span></div>
            <div id="providerNoteXai" class="agent-note">Tap to configure xAI API key.</div>
            <div id="providerSectionXai" class="agent-provider-inline agent-hidden">
              <div id="xaiStoredRow" class="agent-row agent-row-tight agent-hidden">
                <span id="xaiStoredLabel" class="agent-note">xAI API Key Stored in Vault</span>
                <button id="xaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit xAI key">✎</button>
                <label class="agent-inline-mini">
                  <span>Model</span>
                  <select id="xaiModelStored" class="field">${renderModelOptions(FALLBACK_XAI_MODELS)}</select>
                </label>
              </div>
              <div id="xaiControls">
                <div class="agent-row agent-row-tight">
                  <span class="agent-note">xAI API key <span id="xaiBadge" class="agent-badge warn">Missing key</span></span>
                  <div class="agent-inline-key agent-inline-key-wide">
                    <input id="xaiKeyInput" class="field" type="password" placeholder="xai-..." />
                    <button id="xaiSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Save xAI key">></button>
                  </div>
                  <label class="agent-inline-mini">
                    <span>Model</span>
                    <select id="xaiModelInput" class="field">${renderModelOptions(FALLBACK_XAI_MODELS)}</select>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div id="providerCardZai" class="agent-provider-card" data-provider="zai">
            <div class="agent-provider-head"><strong>z.ai</strong><span id="providerPillZai" class="agent-provider-pill warn">Missing key</span></div>
            <div id="providerNoteZai" class="agent-note">Tap to configure z.ai API key.</div>
            <div id="providerSectionZai" class="agent-provider-inline agent-hidden">
              <div id="zaiStoredRow" class="agent-row agent-row-tight agent-hidden">
                <span id="zaiStoredLabel" class="agent-note">z.ai API Key Stored in Vault</span>
                <button id="zaiEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit z.ai key">✎</button>
                <label class="agent-inline-mini">
                  <span>Model</span>
                  <select id="zaiModelStored" class="field">${renderModelOptions(FALLBACK_ZAI_MODELS)}</select>
                </label>
              </div>
              <div id="zaiControls">
                <div class="agent-row agent-row-tight">
                  <span class="agent-note">z.ai API key <span id="zaiBadge" class="agent-badge warn">Missing key</span></span>
                  <div class="agent-inline-key agent-inline-key-wide">
                    <input id="zaiKeyInput" class="field" type="password" placeholder="zai-..." />
                    <button id="zaiSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Save z.ai key">></button>
                  </div>
                  <label class="agent-inline-mini">
                    <span>Model</span>
                    <select id="zaiModelInput" class="field">${renderModelOptions(FALLBACK_ZAI_MODELS)}</select>
                  </label>
                </div>
              </div>
            </div>
          </div>
          <div id="providerCardOllama" class="agent-provider-card" data-provider="ollama">
            <div class="agent-provider-head"><strong>Ollama (Local)</strong><span id="providerPillOllama" class="agent-provider-pill warn">Missing URL</span></div>
            <div id="providerNoteOllama" class="agent-note">Tap to configure local Ollama endpoint and model.</div>
            <div id="providerSectionOllama" class="agent-provider-inline agent-hidden">
              <div id="ollamaStoredRow" class="agent-row agent-row-tight agent-hidden">
                <span class="agent-note">Ollama Endpoint Stored</span>
                <button id="ollamaEditBtn" class="btn agent-icon-btn" type="button" aria-label="Edit Ollama endpoint">✎</button>
                <label class="agent-inline-mini">
                  <span>Model</span>
                  <input id="ollamaModelStored" class="field" type="text" placeholder="llama3.1" />
                </label>
              </div>
              <div id="ollamaControls">
                <div class="agent-row agent-row-tight">
                  <span class="agent-note">Ollama URL <span id="ollamaBadge" class="agent-badge warn">Missing URL</span></span>
                  <div class="agent-inline-key agent-inline-key-wide">
                    <input id="ollamaBaseUrlInput" class="field" type="text" placeholder="http://localhost:11434" />
                    <button id="ollamaSavePreviewBtn" class="btn agent-inline-key-btn" type="button" aria-label="Save Ollama endpoint">></button>
                  </div>
                  <label class="agent-inline-mini">
                    <span>Model</span>
                    <input id="ollamaModelInput" class="field" type="text" placeholder="llama3.1" />
                  </label>
                </div>
              </div>
              <div class="agent-row">
                <button id="ollamaSetupBtn" class="btn" type="button">Ollama Setup...</button>
                <span class="agent-note">Guided Linux/macOS setup with copyable commands.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
}

function ollamaSetupWindowHtml(){
  return `
    <div class="agent-stack agent-setup-stack">
      <div class="agent-setup-intro">
        <div class="agent-setup-title">Ollama Setup Guide</div>
        <div class="agent-note"><strong>Hi, I am Hitomi.</strong> First choose a model size preset, then pick your device. I will walk you through setup with copy-ready commands.</div>
        <div class="agent-setup-toolbar">
          <label class="agent-form-label">
            <span>Model size preset</span>
            <select id="ollamaSetupSizeSelect" class="field">
              <option value="tiny">Tiny (qwen2.5:0.5b)</option>
              <option value="small">Small (qwen2.5:1.5b)</option>
              <option value="medium">Medium (qwen2.5:3b)</option>
              <option value="large">Large (qwen2.5:7b)</option>
              <option value="xl">XL (glm-4.7-flash:latest)</option>
            </select>
          </label>
        </div>
        <div class="agent-note">Power users: you are not limited to these presets. You can set any Ollama model manually in AI APIs.</div>
      </div>
      <div class="agent-device-tabs" role="tablist" aria-label="Device selector">
        <button class="btn agent-device-tab" type="button" data-device-tab="linux" aria-selected="false">Linux</button>
        <button class="btn agent-device-tab" type="button" data-device-tab="mac" aria-selected="false">macOS</button>
        <button class="btn agent-device-tab" type="button" data-device-tab="android" aria-selected="false">Android</button>
      </div>

      <div class="agent-device-panel agent-hidden" data-device-panel="linux">
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 1: Install Ollama</div>
          <div class="agent-row">
            <button class="btn" type="button" data-open-url="https://ollama.com/download/linux">Open Linux Download</button>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Install command</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupInstallLinux">Copy</button></div>
            <pre id="ollamaSetupInstallLinux" class="agent-setup-code"><code>curl -fsSL https://ollama.com/install.sh | sh</code></pre>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 2: Start and pull model</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Start server</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupStartLinux">Copy</button></div>
            <pre id="ollamaSetupStartLinux" class="agent-setup-code"><code>ollama serve</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Pull selected model</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupPullLinux">Copy</button></div>
            <pre id="ollamaSetupPullLinux" class="agent-setup-code"><code data-ollama-model-command>ollama pull qwen2.5:0.5b</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Verify models</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupTagsLinux">Copy</button></div>
            <pre id="ollamaSetupTagsLinux" class="agent-setup-code"><code>curl http://127.0.0.1:11434/api/tags</code></pre>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 3: Allow browser CORS</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Edit systemd service</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupLinuxEdit">Copy</button></div>
            <pre id="ollamaSetupLinuxEdit" class="agent-setup-code"><code>sudo systemctl edit ollama.service</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Add environment block</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupLinuxEnv">Copy</button></div>
            <pre id="ollamaSetupLinuxEnv" class="agent-setup-code"><code>[Service]
Environment="OLLAMA_ORIGINS=https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000"
Environment="OLLAMA_HOST=127.0.0.1:11434"</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Reload + restart</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupLinuxRestart">Copy</button></div>
            <pre id="ollamaSetupLinuxRestart" class="agent-setup-code"><code>sudo systemctl daemon-reload
sudo systemctl restart ollama</code></pre>
          </div>
        </div>
      </div>

      <div class="agent-device-panel agent-hidden" data-device-panel="mac">
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 1: Install Ollama</div>
          <div class="agent-row">
            <button class="btn" type="button" data-open-url="https://ollama.com/download/mac">Open macOS Download</button>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 2: Start and pull model</div>
          <div class="agent-note">Open Terminal and run:</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Pull selected model</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupPullMac">Copy</button></div>
            <pre id="ollamaSetupPullMac" class="agent-setup-code"><code data-ollama-model-command>ollama pull qwen2.5:0.5b</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Verify models</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupTagsMac">Copy</button></div>
            <pre id="ollamaSetupTagsMac" class="agent-setup-code"><code>curl http://127.0.0.1:11434/api/tags</code></pre>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 3: Allow browser CORS</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Set launchctl env vars</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupMacEnv">Copy</button></div>
            <pre id="ollamaSetupMacEnv" class="agent-setup-code"><code>launchctl setenv OLLAMA_ORIGINS "https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000"
launchctl setenv OLLAMA_HOST "127.0.0.1:11434"</code></pre>
          </div>
          <div class="agent-note">Then quit and reopen the Ollama app.</div>
        </div>
      </div>

      <div class="agent-device-panel agent-hidden" data-device-panel="android">
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 0: Install Termux (from F-Droid)</div>
          <div class="agent-note">Install Termux from F-Droid first for best compatibility.</div>
          <div class="agent-row">
            <button class="btn" type="button" data-open-url="https://f-droid.org/packages/com.termux/">Open Termux on F-Droid</button>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 1: Install and run Ollama in Termux</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Install basics</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupAndroidPrep">Copy</button></div>
            <pre id="ollamaSetupAndroidPrep" class="agent-setup-code"><code>pkg update && pkg upgrade -y
pkg install curl -y</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Start server</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupAndroidStart">Copy</button></div>
            <pre id="ollamaSetupAndroidStart" class="agent-setup-code"><code>ollama serve</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Pull selected model</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupAndroidPull">Copy</button></div>
            <pre id="ollamaSetupAndroidPull" class="agent-setup-code"><code data-ollama-model-command>ollama pull qwen2.5:0.5b</code></pre>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 2: Allow browser CORS in Termux</div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Export runtime env vars</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupAndroidCors">Copy</button></div>
            <pre id="ollamaSetupAndroidCors" class="agent-setup-code"><code>export OLLAMA_ORIGINS="https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000"
export OLLAMA_HOST="127.0.0.1:11434"</code></pre>
          </div>
          <div class="agent-code-card">
            <div class="agent-code-head"><span class="agent-code-label">Restart server after export</span><button class="btn agent-copy-btn" type="button" data-copy-target="ollamaSetupAndroidRestart">Copy</button></div>
            <pre id="ollamaSetupAndroidRestart" class="agent-setup-code"><code>ollama serve</code></pre>
          </div>
        </div>
        <div class="agent-setup-section">
          <div class="agent-setup-title">Step 3: Configure Agent1c</div>
          <div class="agent-note">In AI APIs, set Ollama URL to your local endpoint and model to <code data-ollama-model-inline>qwen2.5:0.5b</code>, then save.</div>
        </div>
      </div>

      <div class="agent-setup-section">
        <div class="agent-setup-title">Final step in Agent1c</div>
        <div class="agent-note">Back in AI APIs, set Ollama URL to <code>http://127.0.0.1:11434</code>, set model to <code data-ollama-model-inline>qwen2.5:0.5b</code>, then save/test.</div>
      </div>
    </div>
  `
}

function telegramWindowHtml(){
  return `
    <div class="agent-stack">
      <div id="telegramStoredRow" class="agent-row agent-hidden">
        <span id="telegramStoredLabel" class="agent-note">Telegram API Key Stored in Vault</span>
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
            <button id="telegramSaveBtn" class="btn" type="submit">Save Token</button>
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
      <div class="agent-row agent-wrap-row">
        <button id="openShellRelayBtn" class="btn" type="button">Shell Relay...</button>
        <span class="agent-note">Open shell relay setup and controls.</span>
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
    setupSkipBtn: byId("setupSkipBtn"),
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
    providerCardXai: byId("providerCardXai"),
    providerCardZai: byId("providerCardZai"),
    providerCardOllama: byId("providerCardOllama"),
    providerNoteOpenai: byId("providerNoteOpenai"),
    providerNoteAnthropic: byId("providerNoteAnthropic"),
    providerNoteXai: byId("providerNoteXai"),
    providerNoteZai: byId("providerNoteZai"),
    providerNoteOllama: byId("providerNoteOllama"),
    providerPillOpenai: byId("providerPillOpenai"),
    providerPillAnthropic: byId("providerPillAnthropic"),
    providerPillXai: byId("providerPillXai"),
    providerPillZai: byId("providerPillZai"),
    providerPillOllama: byId("providerPillOllama"),
    providerSectionOpenai: byId("providerSectionOpenai"),
    providerSectionAnthropic: byId("providerSectionAnthropic"),
    providerSectionXai: byId("providerSectionXai"),
    providerSectionZai: byId("providerSectionZai"),
    providerSectionOllama: byId("providerSectionOllama"),
    anthropicStoredRow: byId("anthropicStoredRow"),
    anthropicStoredLabel: byId("anthropicStoredLabel"),
    anthropicControls: byId("anthropicControls"),
    anthropicKeyInput: byId("anthropicKeyInput"),
    anthropicBadge: byId("anthropicBadge"),
    anthropicModelInput: byId("anthropicModelInput"),
    anthropicModelStored: byId("anthropicModelStored"),
    anthropicSavePreviewBtn: byId("anthropicSavePreviewBtn"),
    anthropicEditBtn: byId("anthropicEditBtn"),
    xaiStoredRow: byId("xaiStoredRow"),
    xaiStoredLabel: byId("xaiStoredLabel"),
    xaiControls: byId("xaiControls"),
    xaiKeyInput: byId("xaiKeyInput"),
    xaiBadge: byId("xaiBadge"),
    xaiModelInput: byId("xaiModelInput"),
    xaiModelStored: byId("xaiModelStored"),
    xaiSavePreviewBtn: byId("xaiSavePreviewBtn"),
    xaiEditBtn: byId("xaiEditBtn"),
    zaiStoredRow: byId("zaiStoredRow"),
    zaiStoredLabel: byId("zaiStoredLabel"),
    zaiControls: byId("zaiControls"),
    zaiKeyInput: byId("zaiKeyInput"),
    zaiBadge: byId("zaiBadge"),
    zaiModelInput: byId("zaiModelInput"),
    zaiModelStored: byId("zaiModelStored"),
    zaiSavePreviewBtn: byId("zaiSavePreviewBtn"),
    zaiEditBtn: byId("zaiEditBtn"),
    ollamaStoredRow: byId("ollamaStoredRow"),
    ollamaControls: byId("ollamaControls"),
    ollamaBaseUrlInput: byId("ollamaBaseUrlInput"),
    ollamaBadge: byId("ollamaBadge"),
    ollamaModelInput: byId("ollamaModelInput"),
    ollamaModelStored: byId("ollamaModelStored"),
    ollamaSavePreviewBtn: byId("ollamaSavePreviewBtn"),
    ollamaEditBtn: byId("ollamaEditBtn"),
    ollamaSetupBtn: byId("ollamaSetupBtn"),
    openShellRelayBtn: byId("openShellRelayBtn"),
    openaiStoredRow: byId("openaiStoredRow"),
    openaiControls: byId("openaiControls"),
    openaiEditBtn: byId("openaiEditBtn"),
    openaiBadge: byId("openaiBadge"),
    telegramForm: byId("telegramForm"),
    telegramSaveBtn: byId("telegramSaveBtn"),
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
  Object.assign(els, cacheShellRelayElements(byId))
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

async function validateProviderKey(provider, key){
  const kind = normalizeProvider(provider)
  const candidate = (key || "").trim()
  if (!candidate) throw new Error(`No ${providerDisplayName(kind)} key available.`)
  try {
    if (kind === "anthropic") {
      await testAnthropicKey(candidate, activeProviderModel("anthropic"))
    } else if (kind === "xai") {
      await testXaiKey(candidate, activeProviderModel("xai"))
    } else if (kind === "zai") {
      await testZaiKey(candidate, activeProviderModel("zai"))
    } else {
      await testOpenAIKey(candidate, appState.config.model)
      await refreshModelDropdown(candidate)
    }
    clearProviderApiError(kind)
  } catch (err) {
    setProviderApiError(kind, err)
    throw err
  }
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
  const runtime = await resolveActiveProviderRuntime()
  if (runtime.provider === "ollama") {
    if (!runtime.ollamaBaseUrl) throw new Error("No Ollama endpoint stored.")
  } else if (!runtime.apiKey) {
    throw new Error(`No ${runtime.name} key stored.`)
  }
  appState.lastUserSeenAt = Date.now()
  const thread = threadId ? appState.agent.localThreads?.[threadId] : getActiveLocalThread()
  if (!thread) throw new Error("No active chat thread.")
  pushLocalMessage(thread.id, "user", text)
  await persistState()
  setThreadThinking(thread.id, true)
  renderChat()
  try {
    const promptMessages = appState.agent.localThreads[thread.id]?.messages || []
    const reply = await providerChatWithTools({
      provider: runtime.provider,
      apiKey: runtime.apiKey,
      model: runtime.model,
      ollamaBaseUrl: runtime.ollamaBaseUrl,
      temperature: appState.config.temperature,
      messages: promptMessages,
    })
    pushLocalMessage(thread.id, "assistant", reply)
    await addEvent("chat_replied", "Hitomi replied in chat")
    await persistState()
  } finally {
    setThreadThinking(thread.id, false)
    renderChat()
  }
}

async function heartbeatTick(){
  if (!appState.running) return
  if (!canAccessSecrets()) return
  appState.agent.lastTickAt = Date.now()
  if (els.lastTick) els.lastTick.textContent = formatTime(appState.agent.lastTickAt)
  const runtime = await resolveActiveProviderRuntime()
  if (runtime.provider === "ollama" ? !runtime.ollamaBaseUrl : !runtime.apiKey) {
    await addEvent("heartbeat_skipped", runtime.provider === "ollama" ? "No Ollama endpoint" : `No ${runtime.name} key`)
    return
  }
  const prompt = `${appState.agent.heartbeatMd.trim()}\n\nTime: ${new Date().toISOString()}\nRespond with a short check-in.`
  pushRolling("user", prompt)
  const reply = await providerChatWithTools({
    provider: runtime.provider,
    apiKey: runtime.apiKey,
    model: runtime.model,
    ollamaBaseUrl: runtime.ollamaBaseUrl,
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
  if (!canAccessSecrets() || !appState.telegramEnabled) return
  appState.telegramTimer = setInterval(() => {
    pollTelegram().catch(() => {})
  }, appState.telegramPollMs)
  pollTelegram().catch(() => {})
}

async function pollTelegram(){
  if (appState.telegramPolling || !canAccessSecrets() || !appState.telegramEnabled) return
  appState.telegramPolling = true
  try {
    const [token, runtime] = await Promise.all([readProviderKey("telegram"), resolveActiveProviderRuntime()])
    if (!token || (runtime.provider === "ollama" ? !runtime.ollamaBaseUrl : !runtime.apiKey)) return
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
      const reply = await providerChatWithTools({
        provider: runtime.provider,
        apiKey: runtime.apiKey,
        model: runtime.model,
        ollamaBaseUrl: runtime.ollamaBaseUrl,
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
      await migratePlaintextSecretsToEncrypted()
      setUnencryptedMode(false)
      closeWindow(setupWin)
      await addEvent("vault_unlocked", "Vault initialized and unlocked")
      onboardingHedgey?.handleTrigger?.("vault_initialized")
      await createWorkspace({ showUnlock: false, onboarding: true })
      await refreshModelDropdown()
      refreshTelegramLoop()
      refreshUi()
      applyOnboardingWindowState()
      nudgeOnboardingBubble({ compact: false })
      setStatus("Vault initialized and unlocked.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not initialize vault")
    }
  })
  els.setupSkipBtn?.addEventListener("click", async () => {
    try {
      onboardingHedgey?.handleTrigger?.("vault_skip_clicked")
      setUnencryptedMode(true)
      appState.unlocked = false
      appState.sessionKey = null
      await addEvent("vault_warning", "WARNING: Your APIs are not encrypted. Click on Create Vault to encrypt your APIs.")
      await createWorkspace({ showUnlock: false, onboarding: true })
      minimizeWindow(setupWin)
      applyOnboardingWindowState()
      nudgeOnboardingBubble({ compact: false })
      setStatus("Encryption skipped for now. Configure AI APIs to continue.")
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not skip vault setup")
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
      const hasAiSecret = await hasAnyAiProviderKey()
      if (!hasAiSecret || !onboardingComplete) {
        applyOnboardingWindowState()
        setStatus("Now connect an AI provider to start chatting.")
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
  if (!["openai", "anthropic", "xai", "zai", "ollama"].includes(provider)) return
  previewProviderState.editor = provider
  persistPreviewProviderState()
  refreshProviderPreviewUi()
  refreshBadges().catch(() => {})
}

function setActivePreviewProvider(provider){
  if (!["openai", "anthropic", "xai", "zai", "ollama"].includes(provider)) return
  previewProviderState.active = provider
  previewProviderState.editor = provider
  persistPreviewProviderState()
  refreshProviderPreviewUi()
  refreshBadges().catch(() => {})
}

function wireProviderPreviewDom(){
  const cardHandlers = [
    [els.providerCardOpenai, "openai"],
    [els.providerCardAnthropic, "anthropic"],
    [els.providerCardXai, "xai"],
    [els.providerCardZai, "zai"],
    [els.providerCardOllama, "ollama"],
  ]
  for (const [node, provider] of cardHandlers) {
    node?.addEventListener("click", () => {
      setPreviewProviderEditor(provider)
      onboardingHedgey?.handleTrigger?.(`provider_section_opened_${provider}`, { provider })
      nudgeOnboardingBubble({ compact: true })
    })
  }

  const wireProviderInputHint = (node, provider) => {
    node?.addEventListener("input", () => {
      const hasValue = Boolean(String(node.value || "").trim())
      if (!hasValue) return
      onboardingHedgey?.handleProviderInputStarted?.(provider)
      nudgeOnboardingBubble({ compact: true })
    })
  }
  wireProviderInputHint(els.openaiKeyInput, "openai")
  wireProviderInputHint(els.anthropicKeyInput, "anthropic")
  wireProviderInputHint(els.xaiKeyInput, "xai")
  wireProviderInputHint(els.zaiKeyInput, "zai")
  wireProviderInputHint(els.ollamaBaseUrlInput, "ollama")

  els.aiActiveProviderSelect?.addEventListener("change", async () => {
    const provider = els.aiActiveProviderSelect.value || "openai"
    if (provider === "openai") {
      setActivePreviewProvider("openai")
      setStatus("Active provider set to OpenAI.")
      return
    }
    const isReady = await providerHasKey(provider)
    if (!isReady) {
      setPreviewProviderEditor(provider)
      if (els.aiActiveProviderSelect) els.aiActiveProviderSelect.value = previewProviderState.active
      setStatus(`${providerDisplayName(provider)} selected for editing. Save a valid key to switch active provider.`)
      return
    }
    setActivePreviewProvider(provider)
    setStatus(`Active provider set to ${providerDisplayName(provider)}.`)
  })

  els.anthropicSavePreviewBtn?.addEventListener("click", async () => {
    try {
      previewProviderState.anthropicKey = String(els.anthropicKeyInput?.value || "").trim()
      if (!previewProviderState.anthropicKey) {
        previewProviderState.anthropicValidated = false
        anthropicEditing = true
        persistPreviewProviderState()
        refreshProviderPreviewUi()
        setStatus("Anthropic key missing.")
        return
      }
      await saveProviderKey("anthropic", previewProviderState.anthropicKey)
      await validateProviderKey("anthropic", previewProviderState.anthropicKey)
      onboardingHedgey?.handleTrigger?.("provider_test_success", {
        provider: "anthropic",
        model: previewProviderState.anthropicModel,
      })
      previewProviderState.anthropicValidated = true
      previewProviderState.anthropicKey = ""
      if (els.anthropicKeyInput) els.anthropicKeyInput.value = ""
      anthropicEditing = false
      setActivePreviewProvider("anthropic")
      persistPreviewProviderState()
      refreshProviderPreviewUi()
      await addEvent("provider_key_saved", "Anthropic key stored and validated.")
      onboardingHedgey?.handleTrigger?.("provider_key_saved", { provider: "anthropic" })
      onboardingHedgey?.handleTrigger?.("provider_ready_anthropic", {
        provider: "anthropic",
        model: previewProviderState.anthropicModel,
      })
      const completed = await maybeCompleteOnboarding()
      if (!completed) nudgeOnboardingBubble({ compact: true })
      setStatus(completed
        ? `Anthropic key saved. Onboarding continued (${previewProviderState.anthropicModel}).`
        : `Anthropic key saved. Active provider switched to Anthropic (${previewProviderState.anthropicModel}).`)
    } catch (err) {
      previewProviderState.anthropicValidated = false
      anthropicEditing = true
      refreshProviderPreviewUi()
      onboardingHedgey?.handleTrigger?.("provider_test_error", {
        provider: "anthropic",
        error: err instanceof Error ? err.message : "validation failed",
      })
      nudgeOnboardingBubble({ compact: true })
      setStatus(err instanceof Error ? err.message : "Could not save Anthropic key")
    }
  })
  els.anthropicEditBtn?.addEventListener("click", () => {
    anthropicEditing = true
    setPreviewProviderEditor("anthropic")
    els.anthropicKeyInput?.focus()
  })

  els.xaiSavePreviewBtn?.addEventListener("click", async () => {
    try {
      previewProviderState.xaiKey = String(els.xaiKeyInput?.value || "").trim()
      if (!previewProviderState.xaiKey) {
        previewProviderState.xaiValidated = false
        xaiEditing = true
        persistPreviewProviderState()
        refreshProviderPreviewUi()
        setStatus("xAI key missing.")
        return
      }
      await saveProviderKey("xai", previewProviderState.xaiKey)
      await validateProviderKey("xai", previewProviderState.xaiKey)
      onboardingHedgey?.handleTrigger?.("provider_test_success", {
        provider: "xai",
        model: previewProviderState.xaiModel,
      })
      previewProviderState.xaiValidated = true
      previewProviderState.xaiKey = ""
      if (els.xaiKeyInput) els.xaiKeyInput.value = ""
      xaiEditing = false
      setActivePreviewProvider("xai")
      persistPreviewProviderState()
      refreshProviderPreviewUi()
      await addEvent("provider_key_saved", "xAI key stored and validated.")
      onboardingHedgey?.handleTrigger?.("provider_key_saved", { provider: "xai" })
      onboardingHedgey?.handleTrigger?.("provider_ready_xai", {
        provider: "xai",
        model: previewProviderState.xaiModel,
      })
      const completed = await maybeCompleteOnboarding()
      if (!completed) nudgeOnboardingBubble({ compact: true })
      setStatus(completed
        ? `xAI key saved. Onboarding continued (${previewProviderState.xaiModel}).`
        : `xAI key saved. Active provider switched to xAI (${previewProviderState.xaiModel}).`)
    } catch (err) {
      previewProviderState.xaiValidated = false
      xaiEditing = true
      refreshProviderPreviewUi()
      onboardingHedgey?.handleTrigger?.("provider_test_error", {
        provider: "xai",
        error: err instanceof Error ? err.message : "validation failed",
      })
      nudgeOnboardingBubble({ compact: true })
      setStatus(err instanceof Error ? err.message : "Could not save xAI key")
    }
  })
  els.xaiEditBtn?.addEventListener("click", () => {
    xaiEditing = true
    setPreviewProviderEditor("xai")
    els.xaiKeyInput?.focus()
  })

  els.zaiSavePreviewBtn?.addEventListener("click", async () => {
    try {
      previewProviderState.zaiKey = String(els.zaiKeyInput?.value || "").trim()
      if (!previewProviderState.zaiKey) {
        previewProviderState.zaiValidated = false
        zaiEditing = true
        persistPreviewProviderState()
        refreshProviderPreviewUi()
        setStatus("z.ai key missing.")
        return
      }
      await saveProviderKey("zai", previewProviderState.zaiKey)
      await validateProviderKey("zai", previewProviderState.zaiKey)
      onboardingHedgey?.handleTrigger?.("provider_test_success", {
        provider: "zai",
        model: previewProviderState.zaiModel,
      })
      previewProviderState.zaiValidated = true
      previewProviderState.zaiKey = ""
      if (els.zaiKeyInput) els.zaiKeyInput.value = ""
      zaiEditing = false
      setActivePreviewProvider("zai")
      persistPreviewProviderState()
      refreshProviderPreviewUi()
      await addEvent("provider_key_saved", "z.ai key stored and validated.")
      onboardingHedgey?.handleTrigger?.("provider_key_saved", { provider: "zai" })
      onboardingHedgey?.handleTrigger?.("provider_ready_zai", {
        provider: "zai",
        model: previewProviderState.zaiModel,
      })
      const completed = await maybeCompleteOnboarding()
      if (!completed) nudgeOnboardingBubble({ compact: true })
      setStatus(completed
        ? `z.ai key saved. Onboarding continued (${previewProviderState.zaiModel}).`
        : `z.ai key saved. Active provider switched to z.ai (${previewProviderState.zaiModel}).`)
    } catch (err) {
      previewProviderState.zaiValidated = false
      zaiEditing = true
      refreshProviderPreviewUi()
      onboardingHedgey?.handleTrigger?.("provider_test_error", {
        provider: "zai",
        error: err instanceof Error ? err.message : "validation failed",
      })
      nudgeOnboardingBubble({ compact: true })
      setStatus(err instanceof Error ? err.message : "Could not save z.ai key")
    }
  })
  els.zaiEditBtn?.addEventListener("click", () => {
    zaiEditing = true
    setPreviewProviderEditor("zai")
    els.zaiKeyInput?.focus()
  })

  const syncAnthropicModel = () => {
    const chosen = String(els.anthropicModelInput?.value || els.anthropicModelStored?.value || previewProviderState.anthropicModel).trim()
    previewProviderState.anthropicModel = chosen || FALLBACK_ANTHROPIC_MODELS[0]
    if (els.anthropicModelInput) els.anthropicModelInput.value = previewProviderState.anthropicModel
    if (els.anthropicModelStored) els.anthropicModelStored.value = previewProviderState.anthropicModel
    persistPreviewProviderState()
  }
  const syncZaiModel = () => {
    const chosen = String(els.zaiModelInput?.value || els.zaiModelStored?.value || previewProviderState.zaiModel).trim()
    previewProviderState.zaiModel = chosen || FALLBACK_ZAI_MODELS[0]
    if (els.zaiModelInput) els.zaiModelInput.value = previewProviderState.zaiModel
    if (els.zaiModelStored) els.zaiModelStored.value = previewProviderState.zaiModel
    persistPreviewProviderState()
  }
  const syncXaiModel = () => {
    const chosen = String(els.xaiModelInput?.value || els.xaiModelStored?.value || previewProviderState.xaiModel).trim()
    previewProviderState.xaiModel = chosen || FALLBACK_XAI_MODELS[0]
    if (els.xaiModelInput) els.xaiModelInput.value = previewProviderState.xaiModel
    if (els.xaiModelStored) els.xaiModelStored.value = previewProviderState.xaiModel
    persistPreviewProviderState()
  }
  const syncOllamaModel = () => {
    const chosen = String(els.ollamaModelInput?.value || els.ollamaModelStored?.value || previewProviderState.ollamaModel).trim()
    previewProviderState.ollamaModel = chosen || "llama3.1"
    if (els.ollamaModelInput) els.ollamaModelInput.value = previewProviderState.ollamaModel
    if (els.ollamaModelStored) els.ollamaModelStored.value = previewProviderState.ollamaModel
    persistPreviewProviderState()
  }
  els.anthropicModelInput?.addEventListener("change", () => {
    syncAnthropicModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "anthropic",
      model: previewProviderState.anthropicModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`Anthropic model saved: ${previewProviderState.anthropicModel}.`)
  })
  els.anthropicModelStored?.addEventListener("change", () => {
    syncAnthropicModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "anthropic",
      model: previewProviderState.anthropicModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`Anthropic model saved: ${previewProviderState.anthropicModel}.`)
  })
  els.zaiModelInput?.addEventListener("change", () => {
    syncZaiModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "zai",
      model: previewProviderState.zaiModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`z.ai model saved: ${previewProviderState.zaiModel}.`)
  })
  els.zaiModelStored?.addEventListener("change", () => {
    syncZaiModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "zai",
      model: previewProviderState.zaiModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`z.ai model saved: ${previewProviderState.zaiModel}.`)
  })
  els.xaiModelInput?.addEventListener("change", () => {
    syncXaiModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "xai",
      model: previewProviderState.xaiModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`xAI model saved: ${previewProviderState.xaiModel}.`)
  })
  els.xaiModelStored?.addEventListener("change", () => {
    syncXaiModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "xai",
      model: previewProviderState.xaiModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`xAI model saved: ${previewProviderState.xaiModel}.`)
  })
  els.ollamaModelInput?.addEventListener("change", () => {
    syncOllamaModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "ollama",
      model: previewProviderState.ollamaModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`Ollama model saved: ${previewProviderState.ollamaModel}.`)
  })
  els.ollamaModelStored?.addEventListener("change", () => {
    syncOllamaModel()
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "ollama",
      model: previewProviderState.ollamaModel,
    })
    nudgeOnboardingBubble({ compact: true })
    setStatus(`Ollama model saved: ${previewProviderState.ollamaModel}.`)
  })
  syncAnthropicModel()
  syncXaiModel()
  syncZaiModel()
  syncOllamaModel()

  els.ollamaSavePreviewBtn?.addEventListener("click", async () => {
    previewProviderState.ollamaBaseUrl = String(els.ollamaBaseUrlInput?.value || "").trim()
    previewProviderState.ollamaValidated = Boolean(String(previewProviderState.ollamaBaseUrl || "").trim())
    ollamaEditing = false
    if (previewProviderState.ollamaValidated) setActivePreviewProvider("ollama")
    else setPreviewProviderEditor("ollama")
    persistPreviewProviderState()
    refreshProviderPreviewUi()
    if (previewProviderState.ollamaValidated) {
      await addEvent("provider_key_saved", "Ollama endpoint saved.")
      onboardingHedgey?.handleTrigger?.("provider_key_saved", { provider: "ollama" })
      onboardingHedgey?.handleTrigger?.("provider_test_success", {
        provider: "ollama",
        model: previewProviderState.ollamaModel,
      })
      onboardingHedgey?.handleTrigger?.("provider_ready_ollama", {
        provider: "ollama",
        model: previewProviderState.ollamaModel,
      })
      nudgeOnboardingBubble({ compact: true })
      setStatus(`Ollama endpoint saved. Active provider switched to ollama (${previewProviderState.ollamaModel}).`)
    } else {
      onboardingHedgey?.handleTrigger?.("provider_test_error", { provider: "ollama", code: "missing_url" })
      nudgeOnboardingBubble({ compact: true })
      setStatus("Ollama URL missing.")
    }
  })
  els.ollamaEditBtn?.addEventListener("click", () => {
    ollamaEditing = true
    setPreviewProviderEditor("ollama")
    els.ollamaBaseUrlInput?.focus()
  })
  els.ollamaSetupBtn?.addEventListener("click", (e) => {
    e.stopPropagation()
    openOllamaSetupWindow()
  })

  refreshProviderPreviewUi()
}

function wireMainDom(){
  if (wired) return
  wired = true

  window.addEventListener("agent1c:voice-state", (event) => {
    const detail = event?.detail || {}
    voiceUiState = {
      enabled: !!detail.enabled,
      supported: detail.supported !== false,
      status: String(detail.status || (detail.enabled ? "idle" : "off")),
      text: String(detail.text || ""),
      error: String(detail.error || ""),
    }
    updateClippyVoiceBadge()
  })
  window.addEventListener("agent1c:voice-command", (event) => {
    const text = String(event?.detail?.text || "").trim()
    if (!text) return
    handleVoiceCommand(text)
  })

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
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "openai",
      model: appState.config.model,
    })
    nudgeOnboardingBubble({ compact: true })
    scheduleConfigAutosave()
  })
  els.modelInputEdit?.addEventListener("change", () => {
    syncModelSelectors(els.modelInputEdit.value || appState.config.model)
    onboardingHedgey?.handleTrigger?.("provider_model_selected", {
      provider: "openai",
      model: appState.config.model,
    })
    nudgeOnboardingBubble({ compact: true })
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
  els.openShellRelayBtn?.addEventListener("click", () => {
    openShellRelayWindow()
  })
  window.addEventListener("agent1c:open-shell-relay", () => {
    openShellRelayWindow()
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
      await addEvent("provider_key_saved", providerSavedEventText("openai"))
      await validateProviderKey("openai", key)
      onboardingHedgey?.handleTrigger?.("provider_key_saved", { provider: "openai" })
      onboardingHedgey?.handleTrigger?.("provider_test_success", {
        provider: "openai",
        model: appState.config.model,
      })
      onboardingHedgey?.handleTrigger?.("provider_ready_openai", {
        provider: "openai",
        model: appState.config.model,
      })
      setActivePreviewProvider("openai")
      await refreshBadges()
      const completed = await maybeCompleteOnboarding()
      if (!completed) nudgeOnboardingBubble({ compact: true })
      setStatus(completed ? "OpenAI key saved and validated. Onboarding continued." : "OpenAI key saved and validated.")
    } catch (err) {
      openAiEditing = true
      await refreshBadges()
      onboardingHedgey?.handleTrigger?.("provider_test_error", {
        provider: "openai",
        error: err instanceof Error ? err.message : "validation failed",
      })
      nudgeOnboardingBubble({ compact: true })
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
      await addEvent("provider_key_saved", telegramSavedEventText())
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
    if (!canAccessSecrets()) {
      setStatus("Initialize or unlock vault first.")
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
  const { w, h } = getDesktopViewport()
  const compact = w <= 560
  const opts = compact
    ? { panelId: "setup", left: 0, top: 0, width: Math.max(300, w - 8), height: Math.max(240, Math.min(360, h - 24)), closeAsMinimize: true }
    : { panelId: "setup", left: 340, top: 90, width: 520, height: 260, closeAsMinimize: true }
  setupWin = wmRef.createAgentPanelWindow("Create Vault", opts)
  if (!setupWin?.panelRoot) return
  setupWin.panelRoot.innerHTML = setupWindowHtml()
  cacheElements()
  wireSetupDom()
  setStatus("Create a vault to continue.")
}

function getDesktopViewport(){
  const desktopEl = document.getElementById("desktop")
  const w = Math.max(320, Number(desktopEl?.clientWidth) || window.innerWidth || 1024)
  const h = Math.max(220, Number(desktopEl?.clientHeight) || window.innerHeight || 768)
  return { w, h }
}

function getOpenAiWindowOpts(){
  const { w, h } = getDesktopViewport()
  const compact = w <= 560
  if (!compact) {
    return { panelId: "openai", left: 510, top: 28, width: 500, height: 320, closeAsMinimize: true }
  }
  const width = Math.max(300, w - 16)
  const height = Math.max(280, Math.min(420, h - 58))
  return { panelId: "openai", left: 8, top: 28, width, height, closeAsMinimize: true }
}

async function createWorkspace({ showUnlock, onboarding }) {
  if (workspaceReady) return
  workspaceReady = true

  const savedPanelIds = readSavedAgentPanelIds()
  const shouldSpawnPanel = (panelId) => {
    if (!savedPanelIds) return true
    if (panelId === "shellrelay" || panelId === "soul" || panelId === "tools" || panelId === "heartbeat") return true
    if (onboarding && panelId === "openai") return true
    return savedPanelIds.has(panelId)
  }

  if (shouldSpawnPanel("chat")) wins.chat = wmRef.createAgentPanelWindow("Chat", { panelId: "chat", left: 20, top: 28, width: 480, height: 320, closeAsMinimize: true })
  if (wins.chat?.panelRoot) wins.chat.panelRoot.innerHTML = chatWindowHtml()

  if (shouldSpawnPanel("openai")) wins.openai = wmRef.createAgentPanelWindow("AI APIs", getOpenAiWindowOpts())
  if (wins.openai?.panelRoot) wins.openai.panelRoot.innerHTML = openAiWindowHtml()

  if (shouldSpawnPanel("telegram")) wins.telegram = wmRef.createAgentPanelWindow("Telegram API", { panelId: "telegram", left: 510, top: 360, width: 500, height: 280, closeAsMinimize: true })
  if (wins.telegram?.panelRoot) wins.telegram.panelRoot.innerHTML = telegramWindowHtml()

  if (shouldSpawnPanel("config")) wins.config = wmRef.createAgentPanelWindow("Config", { panelId: "config", left: 20, top: 356, width: 430, height: 220, closeAsMinimize: true })
  if (wins.config?.panelRoot) wins.config.panelRoot.innerHTML = configWindowHtml()

  if (shouldSpawnPanel("shellrelay")) wins.shellrelay = wmRef.createAgentPanelWindow("Shell Relay", { panelId: "shellrelay", left: 1045, top: 360, width: 460, height: 470, closeAsMinimize: true })
  if (wins.shellrelay?.panelRoot) wins.shellrelay.panelRoot.innerHTML = shellRelayWindowHtml()

  if (shouldSpawnPanel("soul")) wins.soul = wmRef.createAgentPanelWindow("SOUL.md", { panelId: "soul", left: 20, top: 644, width: 320, height: 330, closeAsMinimize: true })
  if (wins.soul?.panelRoot) wins.soul.panelRoot.innerHTML = soulWindowHtml()

  if (shouldSpawnPanel("tools")) wins.tools = wmRef.createAgentPanelWindow("TOOLS.md", { panelId: "tools", left: 680, top: 360, width: 360, height: 280, closeAsMinimize: true })
  if (wins.tools?.panelRoot) wins.tools.panelRoot.innerHTML = toolsWindowHtml()

  if (shouldSpawnPanel("heartbeat")) wins.heartbeat = wmRef.createAgentPanelWindow("heartbeat.md", { panelId: "heartbeat", left: 350, top: 644, width: 320, height: 330, closeAsMinimize: true })
  if (wins.heartbeat?.panelRoot) wins.heartbeat.panelRoot.innerHTML = heartbeatWindowHtml()

  if (shouldSpawnPanel("events")) wins.events = wmRef.createAgentPanelWindow("Events", { panelId: "events", left: 680, top: 644, width: 360, height: 330, closeAsMinimize: true })
  if (wins.events?.panelRoot) wins.events.panelRoot.innerHTML = eventsWindowHtml()

  if (showUnlock) {
    unlockWin = wmRef.createAgentPanelWindow("Unlock Vault", { panelId: "unlock", left: 280, top: 100, width: 420, height: 210 })
    if (unlockWin?.panelRoot) unlockWin.panelRoot.innerHTML = unlockWindowHtml()
  }

  cacheElements()
  wireMainDom()
  wireUnlockDom()
  wireShellRelayWindowDom(wins.shellrelay)
  loadInputsFromState()
  requestAnimationFrame(() => syncNotepadGutters())
  setTimeout(() => syncNotepadGutters(), 0)
  renderChat()
  renderEvents()
  refreshUi()
  await refreshKnownFilesystemFiles()

  if (!savedPanelIds && wins.events?.id) {
    minimizeWindow(wins.events)
  }

  if (onboarding) {
    applyOnboardingWindowState()
  }
}

async function loadPersistentState(){
  const [meta, cfg, savedState, events] = await Promise.all([getVaultMeta(), getConfig(), getState(), getRecentEvents()])
  appState.vaultReady = Boolean(meta)
  try {
    userName = normalizeUserName(localStorage.getItem(USER_NAME_KEY) || "")
  } catch {
    userName = ""
  }
  try {
    appState.unencryptedMode = localStorage.getItem(UNENCRYPTED_MODE_KEY) === "1"
  } catch {
    appState.unencryptedMode = false
  }
  appState.unlocked = false
  appState.sessionKey = null
  if (cfg) {
    appState.config.model = cfg.model || appState.config.model
    appState.config.heartbeatIntervalMs = Math.max(5000, Number(cfg.heartbeatIntervalMs) || appState.config.heartbeatIntervalMs)
    appState.config.maxContextMessages = Math.max(4, Math.min(64, Number(cfg.maxContextMessages) || appState.config.maxContextMessages))
    appState.config.temperature = Math.max(0, Math.min(1.5, Number(cfg.temperature) || appState.config.temperature))
    const relayCfg = normalizeRelayConfig(cfg)
    appState.config.relayEnabled = relayCfg.enabled
    appState.config.relayBaseUrl = relayCfg.baseUrl
    appState.config.relayToken = relayCfg.token
    appState.config.relayTimeoutMs = relayCfg.timeoutMs
    appState.telegramEnabled = cfg.telegramEnabled !== false
    appState.telegramPollMs = Math.max(5000, Number(cfg.telegramPollMs) || appState.telegramPollMs)
  }
  if (savedState) {
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
  // Phase 2b policy: shipped SOUL/TOOLS/heartbeat defaults are authoritative on reload.
  appState.agent.soulMd = defaultSoulWithUserName(userName)
  appState.agent.toolsMd = DEFAULT_TOOLS
  appState.agent.heartbeatMd = DEFAULT_HEARTBEAT
  ensureLocalThreadsInitialized()
  appState.events = events
}

export async function initAgent1C({ wm }){
  wmRef = wm
  loadPreviewProviderState()
  onboardingComplete = localStorage.getItem(ONBOARDING_KEY) === "1"
  onboardingOpenAiTested = localStorage.getItem(ONBOARDING_OPENAI_TEST_KEY) === "1"
  await loadPersistentState()
  // for Codex: onboarding runtime must stay data-driven from onboarding-hedgey-phase1.json.
  // If context was compacted, re-read PHASE_ONBOARDING_HEDGEY_PLAN.md + agents.md section 20 before changing this wiring.
  onboardingHedgey = await createOnboardingHedgey({
    openUrl: (url) => {
      const opened = wmRef?.openUrlInBrowser?.(url, { newWindow: false })
      return Boolean(opened?.ok)
    },
    onEmitAction: (action) => {
      if (action === "open_ollama_setup_window") {
        openOllamaSetupWindow()
        setStatus("Opened Ollama setup.")
      }
    },
    getUiContext: onboardingGuideUiContext,
    getUserName: () => userName,
    onCaptureName: async (name) => {
      const ok = await setUserName(name)
      if (!ok) return false
      if (setupWin?.id) {
        restoreWindow(setupWin)
        focusWindow(setupWin)
      }
      setStatus(`Nice to meet you, ${normalizeUserName(name)}.`)
      return true
    },
  })
  onboardingHedgey.setActive(!onboardingComplete)
  if (!onboardingComplete && (appState.vaultReady || appState.unencryptedMode)) {
    onboardingHedgey.handleTrigger("vault_initialized")
  }
  const hasAiSecret = await hasAnyAiProviderKey()
  const onboarding = !hasAiSecret || !onboardingComplete

  if (!appState.vaultReady) {
    createSetupWindow()
    if (!userName && setupWin?.id) {
      minimizeWindow(setupWin)
    }
    if (appState.unencryptedMode) {
      await createWorkspace({ showUnlock: false, onboarding: true })
      minimizeWindow(setupWin)
      applyOnboardingWindowState()
      await addEvent("vault_warning", "WARNING: Your APIs are not encrypted. Click on Create Vault to encrypt your APIs.")
      setStatus("Unencrypted mode is active. You can configure APIs now.")
    }
    syncOnboardingGuideActivation()
    return
  }

  await createWorkspace({ showUnlock: true, onboarding })
  if (appState.unencryptedMode) {
    await addEvent("vault_warning", "WARNING: Your APIs are not encrypted. Click on Create Vault to encrypt your APIs.")
  }
  if (onboarding) {
    applyOnboardingWindowState()
    setStatus("Unlock vault, then connect an AI provider to start.")
  } else {
    setStatus("Vault locked. Unlock to continue.")
  }
  syncOnboardingGuideActivation()
}
