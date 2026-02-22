// for Codex: when implementing shell relay, please always refer back to PHASE1_CONTRACT.md first.
// for Codex: especially if your context was recently compacted, re-read PHASE1_CONTRACT.md before edits.
// for Codex: keep relay logic modular in this file; do not spread core relay behavior across agent1c.js.
// for Codex: cross-check agents.md and PHASE2_PLAN.md before extending relay for WM/CORS phase-2 actions. - Decentricity

export const AGENT1C_RELAY_CONTRACT_PATH = "PHASE1_CONTRACT.md"
const RELAY_CONNECTED_ONCE_KEY = "agent1c_relay_connected_once_v1"

export const RELAY_DEFAULTS = {
  enabled: false,
  baseUrl: "http://127.0.0.1:8765",
  token: "",
  timeoutMs: 30000,
}

function clamp(value, low, high){
  return Math.max(low, Math.min(high, Number(value) || low))
}

export function normalizeRelayBaseUrl(value){
  const source = String(value || "").trim()
  if (!source) return ""
  return source.replace(/\/+$/, "")
}

export function normalizeRelayConfig(config){
  const source = config && typeof config === "object" ? config : {}
  return {
    enabled: source.relayEnabled === true || source.enabled === true,
    baseUrl: normalizeRelayBaseUrl(source.relayBaseUrl || source.baseUrl || RELAY_DEFAULTS.baseUrl) || RELAY_DEFAULTS.baseUrl,
    token: String(source.relayToken || source.token || "").trim(),
    timeoutMs: clamp(source.relayTimeoutMs || source.timeoutMs || RELAY_DEFAULTS.timeoutMs, 1000, 120000),
  }
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

function relayInstallBaseUrl(){
  try {
    const origin = String(window.location?.origin || "").trim().replace(/\/+$/, "")
    if (origin) return `${origin}/shell-relay`
  } catch {}
  return "https://agent1c.me/shell-relay"
}

function relaySetupByOs(os){
  const base = relayInstallBaseUrl()
  const installCmd = `curl -fsSL ${base}/install.sh | sh`
  const healthNoToken = `curl -s -H "Origin: https://agent1c.me" http://127.0.0.1:8765/v1/health`
  if (os === "mac") {
    return {
      label: "macOS",
      depsTitle: "Step 1: Install dependencies",
      depsCmd: "brew install jq socat",
      installTitle: "Step 2: Install relay scripts",
      installCmd,
      startTitle: "Step 3: Start relay",
      startCmd: "~/.agent1c-relay/agent1c-shell-relay.sh",
      verifyTitle: "Step 4: Verify relay is alive",
      verifyCmd: healthNoToken,
      persistTitle: "Optional: persist on startup (launchd)",
      persistCmd: "Create a launchd plist that runs ~/.agent1c-relay/agent1c-shell-relay.sh at login.",
      uninstallTitle: "Optional: uninstall relay scripts",
      uninstallCmd: "rm -rf ~/.agent1c-relay",
      caveat: "Run as normal user (not sudo). If browser blocks local private-network requests, use a browser build that allows localhost private-network CORS from HTTPS origin.",
    }
  }
  if (os === "android") {
    return {
      label: "Android (Termux)",
      depsTitle: "Step 0: Install Termux (F-Droid preferred)",
      depsCmd: "https://f-droid.org/packages/com.termux/",
      installTitle: "Step 1: Install dependencies in Termux",
      installCmd: "pkg update && pkg install -y curl jq socat",
      startTitle: "Step 2: Install and start relay",
      startCmd: `${installCmd}\n~/.agent1c-relay/agent1c-shell-relay.sh`,
      verifyTitle: "Step 3: Verify + browser private-network note",
      verifyCmd: healthNoToken,
      persistTitle: "Optional: persist on startup (Termux)",
      persistCmd: "pkg install -y termux-services termux-api termux-tools\n# Use Termux:Boot or termux-wake-lock to keep relay available.",
      uninstallTitle: "Optional: uninstall relay scripts",
      uninstallCmd: "rm -rf ~/.agent1c-relay",
      caveat: "Android browsers may block HTTPS->localhost private-network requests. Ensure your browser permits local private-network CORS for agent1c.me.",
    }
  }
  return {
    label: "Linux",
    depsTitle: "Step 1: Install dependencies",
    depsCmd: "sudo apt update && sudo apt install -y curl jq socat",
    installTitle: "Step 2: Install relay scripts",
    installCmd,
    startTitle: "Step 3: Start relay",
    startCmd: "~/.agent1c-relay/agent1c-shell-relay.sh",
    verifyTitle: "Step 4: Verify relay is alive",
    verifyCmd: healthNoToken,
    persistTitle: "Optional: persist as user systemd service",
    persistCmd: `mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/agent1c-relay.service <<'EOF'
[Unit]
Description=Agent1c Local Relay
After=network.target

[Service]
Type=simple
ExecStart=%h/.agent1c-relay/agent1c-shell-relay.sh
Restart=always
RestartSec=2
Environment=AGENT1C_RELAY_ALLOW_ORIGINS=https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now agent1c-relay.service
systemctl --user status --no-pager agent1c-relay.service`,
    uninstallTitle: "Optional: uninstall relay + service",
    uninstallCmd: `systemctl --user disable --now agent1c-relay.service || true
rm -f ~/.config/systemd/user/agent1c-relay.service
systemctl --user daemon-reload
rm -rf ~/.agent1c-relay`,
    caveat: "Run as normal user (not sudo). If your distro does not use apt, install jq+socat using your package manager.",
  }
}

function relayConnectedOnce(){
  try {
    return localStorage.getItem(RELAY_CONNECTED_ONCE_KEY) === "1"
  } catch {
    return false
  }
}

function setRelayConnectedOnce(value){
  try {
    if (value) localStorage.setItem(RELAY_CONNECTED_ONCE_KEY, "1")
    else localStorage.removeItem(RELAY_CONNECTED_ONCE_KEY)
  } catch {}
}

function codeCard(title, code, copyKey){
  return `
    <div class="agent-code-card">
      <div class="agent-code-head">
        <span class="agent-code-label">${title}</span>
        <button class="btn agent-copy-btn" type="button" data-relay-copy="${copyKey}">Copy</button>
      </div>
      <pre class="agent-setup-code" data-relay-code="${copyKey}">${code}</pre>
    </div>
  `
}

export function shellRelayWindowHtml(){
  // for Codex: when changing Shell Relay UI/flow, always re-read PHASE1_CONTRACT.md first.
  const os = relaySetupByOs("linux")
  return `
    <div class="agent-stack agent-setup-stack">
      <div class="agent-main-tabs">
        <button id="relayMainTabSetup" class="agent-main-tab active" type="button" data-relay-main-tab="setup">Setup</button>
        <button id="relayMainTabConnect" class="agent-main-tab" type="button" data-relay-main-tab="connect">Connect</button>
        <button id="relayMainTabTerminal" class="agent-main-tab" type="button" data-relay-main-tab="terminal">Terminal</button>
      </div>
      <div id="relayPageSetup" class="agent-relay-page">
        <div class="agent-setup-intro">
          <div class="agent-setup-title">Shell Relay Setup</div>
          <div class="agent-note">Set up local shell access for Hitomi on this device.</div>
          <div class="agent-note agent-note-warn">Run relay as non-root/non-sudo user.</div>
        </div>
        <div class="agent-device-tabs">
          <button class="btn agent-device-tab active" type="button" data-relay-os="linux">Linux</button>
          <button class="btn agent-device-tab" type="button" data-relay-os="mac">macOS</button>
          <button class="btn agent-device-tab" type="button" data-relay-os="android">Android</button>
        </div>
        <div class="agent-note">Pick device first, then copy commands.</div>
        <div id="relaySetupBody">
          <div class="agent-setup-section">
            <div class="agent-setup-title">${os.label}</div>
            ${codeCard(os.depsTitle, os.depsCmd, "deps")}
            ${codeCard(os.installTitle, os.installCmd, "install")}
            ${codeCard(os.startTitle, os.startCmd, "start")}
            ${codeCard(os.verifyTitle, os.verifyCmd, "verify")}
            <div class="agent-note">${os.caveat}</div>
          </div>
        </div>
        <div class="agent-setup-section agent-setup-section-stop">
          <div class="agent-setup-title">Stop / Restart Relay</div>
          <div class="agent-note">If anything looks broken or port 8765 is stuck, stop all relay listeners and start again.</div>
          ${codeCard("Stop running relay", "pkill -f \"agent1c-shell-relay.sh\" || true\npkill -f \"socat.*8765\" || true\nfuser -k 8765/tcp 2>/dev/null || true", "stop")}
          ${codeCard("Restart relay", "~/.agent1c-relay/agent1c-shell-relay.sh", "restart")}
        </div>
        <div class="agent-row">
          <button id="relayNextBtn" class="btn" type="button">Next: Connect</button>
        </div>
      </div>
      <div id="relayPageConnect" class="agent-relay-page agent-hidden">
        <div class="agent-grid2">
          <label class="agent-form-label">
            <span>Relay</span>
            <select id="relayWindowEnabledSelect" class="field">
              <option value="off">Disabled</option>
              <option value="on">Enabled</option>
            </select>
          </label>
          <label class="agent-form-label">
            <span>Timeout (ms)</span>
            <input id="relayWindowTimeoutInput" class="field" type="number" min="1000" max="120000" step="1000" />
          </label>
        </div>
        <label class="agent-form-label">
          <span>Relay URL</span>
          <input id="relayWindowBaseUrlInput" class="field" type="text" placeholder="http://127.0.0.1:8765" />
        </label>
        <label class="agent-form-label">
          <span>Relay token (optional)</span>
          <input id="relayWindowTokenInput" class="field" type="password" placeholder="change-me" />
        </label>
        <div class="agent-row agent-wrap-row">
          <button id="relayWindowSaveBtn" class="btn" type="button">Save Relay Settings</button>
          <button id="relayWindowTestBtn" class="btn" type="button">Test Relay</button>
          <span id="relayWindowStatus" class="agent-note">Relay idle.</span>
        </div>
      </div>
      <div id="relayPageTerminal" class="agent-relay-page agent-hidden">
        <div id="relayTestWarning" class="agent-note agent-note-warn">Relay not connected yet. Configure and test relay in Connect tab first.</div>
        <div class="agent-terminal">
          <div class="agent-terminal-head">agent1c relay terminal</div>
          <pre id="relayTestOutput" class="agent-terminal-output"></pre>
          <div class="agent-terminal-row">
            <span class="agent-terminal-prompt">$</span>
            <input id="relayTestCommandInput" class="agent-terminal-input" type="text" placeholder="uname -a" />
            <button id="relayTestRunBtn" class="btn" type="button">Run</button>
            <button id="relayTestClearBtn" class="btn" type="button">Clear</button>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderRelaySetupBody(os){
  const info = relaySetupByOs(os)
  return `
      <div class="agent-setup-section">
        <div class="agent-setup-title">${info.label}</div>
      ${codeCard(info.depsTitle, info.depsCmd, "deps")}
      ${codeCard(info.installTitle, info.installCmd, "install")}
      ${codeCard(info.startTitle, info.startCmd, "start")}
      ${codeCard(info.verifyTitle, info.verifyCmd, "verify")}
      ${info.persistTitle && info.persistCmd ? codeCard(info.persistTitle, info.persistCmd, "persist") : ""}
      ${info.uninstallTitle && info.uninstallCmd ? codeCard(info.uninstallTitle, info.uninstallCmd, "uninstall") : ""}
      <div class="agent-note">${info.caveat}</div>
    </div>
  `
}

export function cacheShellRelayElements(byId){
  return {
    relayMainTabSetup: byId("relayMainTabSetup"),
    relayMainTabConnect: byId("relayMainTabConnect"),
    relayMainTabTerminal: byId("relayMainTabTerminal"),
    relayPageSetup: byId("relayPageSetup"),
    relayPageConnect: byId("relayPageConnect"),
    relayPageTerminal: byId("relayPageTerminal"),
    relayNextBtn: byId("relayNextBtn"),
    relayWindowEnabledSelect: byId("relayWindowEnabledSelect"),
    relayWindowTimeoutInput: byId("relayWindowTimeoutInput"),
    relayWindowBaseUrlInput: byId("relayWindowBaseUrlInput"),
    relayWindowTokenInput: byId("relayWindowTokenInput"),
    relayWindowSaveBtn: byId("relayWindowSaveBtn"),
    relayWindowTestBtn: byId("relayWindowTestBtn"),
    relayWindowStatus: byId("relayWindowStatus"),
    relayTestWarning: byId("relayTestWarning"),
    relayTestCommandInput: byId("relayTestCommandInput"),
    relayTestRunBtn: byId("relayTestRunBtn"),
    relayTestClearBtn: byId("relayTestClearBtn"),
    relayTestOutput: byId("relayTestOutput"),
    relaySetupBody: byId("relaySetupBody"),
  }
}

async function relayJsonFetch(url, { method = "GET", token = "", body = null, timeoutMs = RELAY_DEFAULTS.timeoutMs } = {}){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clamp(timeoutMs, 1000, 120000))
  try {
    const headers = {}
    if (token) headers["x-agent1c-token"] = token
    if (body !== null) headers["Content-Type"] = "application/json"
    const response = await fetch(url, {
      method,
      mode: "cors",
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const json = await response.json().catch(() => null)
    if (!response.ok) {
      const msg = String(json?.error || json?.message || "").trim()
      throw new Error(`relay failed (${response.status})${msg ? `: ${msg}` : ""}`)
    }
    return json || {}
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("relay timeout")
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function testRelayHealth(relayConfig){
  const cfg = normalizeRelayConfig(relayConfig)
  if (!cfg.baseUrl) throw new Error("Relay URL is missing.")
  return relayJsonFetch(`${cfg.baseUrl}/v1/health`, {
    method: "GET",
    token: cfg.token,
    timeoutMs: cfg.timeoutMs,
  })
}

export async function runShellExecTool({ args, relayConfig, addEvent, excerptForToolText }){
  // for Codex: when changing shell execution behavior, always re-read PHASE1_CONTRACT.md first.
  const cfg = normalizeRelayConfig(relayConfig)
  if (!cfg.enabled) return "TOOL_RESULT shell_exec: local relay is disabled."
  if (!cfg.baseUrl) return "TOOL_RESULT shell_exec: relay URL is missing."
  const command = String(args?.command || args?.cmd || "").trim()
  if (!command) return "TOOL_RESULT shell_exec: missing command parameter"
  const timeoutMs = clamp(Number(args?.timeout_ms) || cfg.timeoutMs, 1000, 120000)
  await addEvent?.("shell_exec_requested", command.slice(0, 160))
  const json = await relayJsonFetch(`${cfg.baseUrl}/v1/shell/exec`, {
    method: "POST",
    token: cfg.token,
    timeoutMs: timeoutMs + 1000,
    body: { command, timeout_ms: timeoutMs },
  })
  const exitCode = Number(json?.exitCode ?? -1)
  const timedOut = Boolean(json?.timedOut)
  const truncated = Boolean(json?.truncated)
  const stdoutRaw = String(json?.stdout || "")
  const stderrRaw = String(json?.stderr || "")
  const stdout = excerptForToolText ? excerptForToolText(stdoutRaw, 7000) : stdoutRaw
  const stderr = excerptForToolText ? excerptForToolText(stderrRaw, 5000) : stderrRaw
  await addEvent?.("shell_exec_result", `exit=${exitCode}${timedOut ? " timeout" : ""}${truncated ? " truncated" : ""}`)
  return [
    `TOOL_RESULT shell_exec: exitCode=${exitCode}${timedOut ? " timedOut=true" : ""}${truncated ? " truncated=true" : ""}`,
    "[STDOUT]",
    stdout || "(empty)",
    "[STDERR]",
    stderr || "(empty)",
  ].join("\n")
}

export function wireShellRelayDom({ root, els, getRelayConfig, onSaveRelayConfig, setStatus, addEvent }){
  // for Codex: when changing relay window interactions, always re-read PHASE1_CONTRACT.md first.
  if (!root) return
  const cfg = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
  if (els.relayWindowEnabledSelect) els.relayWindowEnabledSelect.value = cfg.enabled ? "on" : "off"
  if (els.relayWindowTimeoutInput) els.relayWindowTimeoutInput.value = String(cfg.timeoutMs)
  if (els.relayWindowBaseUrlInput) els.relayWindowBaseUrlInput.value = cfg.baseUrl
  if (els.relayWindowTokenInput) els.relayWindowTokenInput.value = cfg.token
  if (els.relayWindowStatus) els.relayWindowStatus.textContent = cfg.enabled ? "Relay enabled." : "Relay disabled."
  const stackEl = root.querySelector(".agent-setup-stack")

  const setMainTab = (tab) => {
    const isSetup = tab === "setup"
    const isConnect = tab === "connect"
    const isTerminal = tab === "terminal"
    stackEl?.classList.toggle("relay-terminal-mode", isTerminal)
    els.relayMainTabSetup?.classList.toggle("active", isSetup)
    els.relayMainTabConnect?.classList.toggle("active", isConnect)
    els.relayMainTabTerminal?.classList.toggle("active", isTerminal)
    els.relayPageSetup?.classList.toggle("agent-hidden", !isSetup)
    els.relayPageConnect?.classList.toggle("agent-hidden", !isConnect)
    els.relayPageTerminal?.classList.toggle("agent-hidden", !isTerminal)
  }

  const saveFromInputs = async () => {
    const nextCfg = normalizeRelayConfig({
      relayEnabled: els.relayWindowEnabledSelect?.value === "on",
      relayTimeoutMs: Number(els.relayWindowTimeoutInput?.value || cfg.timeoutMs),
      relayBaseUrl: String(els.relayWindowBaseUrlInput?.value || cfg.baseUrl),
      relayToken: String(els.relayWindowTokenInput?.value || ""),
    })
    await onSaveRelayConfig?.(nextCfg)
    if (els.relayWindowStatus) els.relayWindowStatus.textContent = nextCfg.enabled ? "Relay enabled." : "Relay disabled."
    setStatus?.("Relay settings saved.")
  }

  const defaultMainTab = relayConnectedOnce() ? "connect" : "setup"
  setMainTab(defaultMainTab)
  els.relayMainTabSetup?.addEventListener("click", () => setMainTab("setup"))
  els.relayMainTabConnect?.addEventListener("click", () => setMainTab("connect"))
  els.relayMainTabTerminal?.addEventListener("click", () => setMainTab("terminal"))
  els.relayNextBtn?.addEventListener("click", () => setMainTab("connect"))

  const tabs = Array.from(root.querySelectorAll(".agent-device-tab[data-relay-os]"))
  const setOs = (os) => {
    for (const tab of tabs) tab.classList.toggle("active", tab.dataset.relayOs === os)
    if (els.relaySetupBody) els.relaySetupBody.innerHTML = renderRelaySetupBody(os)
  }
  tabs.forEach(tab => {
    tab.addEventListener("click", () => setOs(String(tab.dataset.relayOs || "linux")))
  })

  root.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.("[data-relay-copy]")
    if (!btn) return
    const key = String(btn.getAttribute("data-relay-copy") || "")
    const code = root.querySelector(`[data-relay-code="${key}"]`)
    const text = code?.textContent || ""
    const ok = await copyTextToClipboard(text)
    if (ok) {
      btn.textContent = "Copied"
      setTimeout(() => { btn.textContent = "Copy" }, 900)
    } else {
      setStatus?.("Copy failed.")
    }
  })

  els.relayWindowSaveBtn?.addEventListener("click", async () => {
    try {
      await saveFromInputs()
    } catch (err) {
      setStatus?.(err instanceof Error ? err.message : "Could not save relay settings")
    }
  })

  els.relayWindowTestBtn?.addEventListener("click", async () => {
    try {
      await saveFromInputs()
      if (els.relayWindowStatus) els.relayWindowStatus.textContent = "Testing relay..."
      const current = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
      const health = await testRelayHealth(current)
      if (els.relayWindowStatus) els.relayWindowStatus.textContent = `Relay ok (${String(health?.version || "unknown")}).`
      setRelayConnectedOnce(true)
      setMainTab("connect")
      await addEvent?.("relay_test_ok", `Relay healthy at ${current.baseUrl}`)
      setStatus?.("Relay test passed.")
    } catch (err) {
      if (els.relayWindowStatus) els.relayWindowStatus.textContent = "Relay test failed."
      await addEvent?.("relay_test_failed", err instanceof Error ? err.message : "Relay test failed")
      setStatus?.(err instanceof Error ? err.message : "Relay test failed")
    }
  })

  const updateTestWarning = () => {
    const isConnected = relayConnectedOnce()
    els.relayTestWarning?.classList.toggle("agent-hidden", isConnected)
  }
  const appendTerminal = (line = "") => {
    if (!els.relayTestOutput) return
    const text = String(line || "")
    els.relayTestOutput.textContent = els.relayTestOutput.textContent
      ? `${els.relayTestOutput.textContent}\n${text}`
      : text
    els.relayTestOutput.scrollTop = els.relayTestOutput.scrollHeight
  }
  updateTestWarning()
  els.relayTestClearBtn?.addEventListener("click", () => {
    if (els.relayTestOutput) els.relayTestOutput.textContent = ""
  })
  els.relayTestCommandInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    els.relayTestRunBtn?.click()
  })
  els.relayTestRunBtn?.addEventListener("click", async () => {
    const command = String(els.relayTestCommandInput?.value || "").trim()
    if (!command) {
      setStatus?.("Enter a command first.")
      return
    }
    try {
      await saveFromInputs()
      updateTestWarning()
      appendTerminal(`$ ${command}`)
      const current = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
      const result = await relayJsonFetch(`${current.baseUrl}/v1/shell/exec`, {
        method: "POST",
        token: current.token,
        timeoutMs: current.timeoutMs + 1000,
        body: {
          command,
          timeout_ms: current.timeoutMs,
        },
      })
      const exitCode = Number(result?.exitCode ?? -1)
      const timedOut = Boolean(result?.timedOut)
      const truncated = Boolean(result?.truncated)
      const out = String(result?.stdout || "")
      const err = String(result?.stderr || "")
      appendTerminal(`exit ${exitCode}${timedOut ? " timedOut=true" : ""}${truncated ? " truncated=true" : ""}`)
      if (out) appendTerminal(out)
      if (err) appendTerminal(`[stderr]\n${err}`)
      appendTerminal("")
      setStatus?.("Relay test command completed.")
    } catch (err) {
      appendTerminal(`[error] ${err instanceof Error ? err.message : "Command failed."}`)
      appendTerminal("")
      setStatus?.(err instanceof Error ? err.message : "Command failed.")
    }
  })
}
