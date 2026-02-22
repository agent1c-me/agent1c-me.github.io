// for Codex: when implementing Tor relay, keep this file modular and separate from agent1c.js.
// for Codex: mirror shell relay UX patterns, but keep Linux/macOS only in v1. - Decentricity

import { RELAY_DEFAULTS, normalizeRelayConfig } from "./agent1crelay.js"

const TOR_RELAY_CONNECTED_ONCE_KEY = "agent1c_tor_relay_connected_once_v1"

function clamp(value, low, high){
  return Math.max(low, Math.min(high, Number(value) || low))
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

function relayJsonFetch(url, { method = "GET", token = "", body = null, timeoutMs = RELAY_DEFAULTS.timeoutMs } = {}){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clamp(timeoutMs, 1000, 120000))
  return fetch(url, {
    method,
    mode: "cors",
    headers: {
      ...(token ? { "x-agent1c-token": token } : {}),
      ...(body !== null ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== null ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  })
    .then(async (response) => {
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        const msg = String(json?.error || json?.message || "").trim()
        throw new Error(`relay failed (${response.status})${msg ? `: ${msg}` : ""}`)
      }
      return json || {}
    })
    .catch((err) => {
      if (err?.name === "AbortError") throw new Error("relay timeout")
      throw err
    })
    .finally(() => clearTimeout(timer))
}

function torRelayConnectedOnce(){
  try { return localStorage.getItem(TOR_RELAY_CONNECTED_ONCE_KEY) === "1" } catch { return false }
}
function setTorRelayConnectedOnce(value){
  try {
    if (value) localStorage.setItem(TOR_RELAY_CONNECTED_ONCE_KEY, "1")
    else localStorage.removeItem(TOR_RELAY_CONNECTED_ONCE_KEY)
  } catch {}
}

function torInstallBaseUrl(){
  try {
    const origin = String(window.location?.origin || "").trim().replace(/\/+$/, "")
    if (origin) return `${origin}/shell-relay`
  } catch {}
  return "https://agent1c.me/shell-relay"
}

function torSetupByOs(os){
  const base = torInstallBaseUrl()
  const installRelayCmd = `curl -fsSL ${base}/install.sh | sh`
  const relayStartTorCmd = `~/.agent1c-relay/agent1c-tor-relay.sh`
  const relayHealthCmd = `curl -s -H "Origin: https://agent1c.me" http://127.0.0.1:8766/v1/health`
  const torStatusCmd = `curl -s -H "Origin: https://agent1c.me" http://127.0.0.1:8766/v1/tor/status`
  if (os === "mac") {
    return {
      label: "macOS",
      cards: [
        ["Step 1: Install Tor + relay deps", "brew install tor jq socat"],
        ["Step 2: Start Tor", "brew services start tor"],
        ["Step 3: Verify Tor SOCKS", "nc -z 127.0.0.1 9050 && echo \"Tor SOCKS ready\""],
        ["Step 4: Install Agent1c relay", installRelayCmd],
        ["Step 5: Start relay in Tor mode", relayStartTorCmd],
        ["Step 6: Verify relay + Tor", `${relayHealthCmd}\n${torStatusCmd}`],
      ],
      caveat: "Tor mode affects relay HTTP fetch path only. Shell commands still run locally without Tor routing.",
    }
  }
  return {
    label: "Linux",
    cards: [
      ["Step 1: Install Tor + relay deps", "sudo apt update && sudo apt install -y tor jq socat curl"],
      ["Step 2: Start Tor service", "sudo systemctl enable --now tor\nsudo systemctl status --no-pager tor"],
      ["Step 3: Verify Tor SOCKS", "ss -ltn | grep ':9050' || sudo journalctl -u tor -n 50 --no-pager"],
      ["Step 4: Install Agent1c relay", installRelayCmd],
      ["Step 5: Start relay in Tor mode", relayStartTorCmd],
      ["Step 6: Verify relay + Tor", `${relayHealthCmd}\n${torStatusCmd}`],
      ["Optional: user systemd relay in Tor mode", `mkdir -p ~/.config/systemd/user\ncat > ~/.config/systemd/user/agent1c-relay-tor.service <<'EOF'\n[Unit]\nDescription=Agent1c Local Relay (Tor)\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=%h/.agent1c-relay/agent1c-tor-relay.sh\nRestart=always\nRestartSec=2\nEnvironment=AGENT1C_RELAY_ALLOW_ORIGINS=https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000\n\n[Install]\nWantedBy=default.target\nEOF\nsystemctl --user daemon-reload\nsystemctl --user enable --now agent1c-relay-tor.service\nsystemctl --user status --no-pager agent1c-relay-tor.service`],
    ],
    caveat: "Tor mode affects relay HTTP fetch path only. Shell commands still run locally without Tor routing.",
  }
}

function codeCard(title, code, copyKey){
  return `
    <div class="agent-code-card">
      <div class="agent-code-head">
        <span class="agent-code-label">${title}</span>
        <button class="btn agent-copy-btn" type="button" data-tor-relay-copy="${copyKey}">Copy</button>
      </div>
      <pre class="agent-setup-code" data-tor-relay-code="${copyKey}">${code}</pre>
    </div>
  `
}

function renderTorSetupBody(os){
  const info = torSetupByOs(os)
  const cards = info.cards.map(([title, code], idx) => codeCard(title, code, `card-${idx}`)).join("")
  return `
    <div class="agent-setup-section">
      <div class="agent-setup-title">${info.label}</div>
      ${cards}
      <div class="agent-note">${info.caveat}</div>
    </div>
  `
}

export function torRelayWindowHtml(){
  const os = torSetupByOs("linux")
  return `
    <div class="agent-stack agent-setup-stack">
      <div class="agent-main-tabs">
        <button id="torRelayMainTabSetup" class="agent-main-tab active" type="button">Setup</button>
        <button id="torRelayMainTabConnect" class="agent-main-tab" type="button">Connect</button>
        <button id="torRelayMainTabTerminal" class="agent-main-tab" type="button">Terminal</button>
      </div>
      <div id="torRelayPageSetup" class="agent-relay-page">
        <div class="agent-setup-intro">
          <div class="agent-setup-title">Tor Relay Setup</div>
          <div class="agent-note">Set up Tor-routed HTTP fetch for Agent1c via the local relay.</div>
          <div class="agent-note agent-note-warn">Linux/macOS only in this version. Run as non-root/non-sudo user.</div>
        </div>
        <div class="agent-device-tabs">
          <button class="btn agent-device-tab active" type="button" data-tor-relay-os="linux">Linux</button>
          <button class="btn agent-device-tab" type="button" data-tor-relay-os="mac">macOS</button>
        </div>
        <div class="agent-note">Pick your device, then copy commands.</div>
        <div id="torRelaySetupBody">${renderTorSetupBody("linux")}</div>
        <div class="agent-setup-section agent-setup-section-stop">
          <div class="agent-setup-title">Stop / Restart Tor Relay</div>
          <div class="agent-note">If port 8766 is stuck or Tor mode fails, stop listeners and restart in Tor mode.</div>
          ${codeCard("Stop running relay", "pkill -f \"agent1c-tor-relay.sh\" || true\npkill -f \"socat.*8766\" || true\nfuser -k 8766/tcp 2>/dev/null || true", "stop")}
          ${codeCard("Restart relay (Tor mode)", "~/.agent1c-relay/agent1c-tor-relay.sh", "restart")}
        </div>
        <div class="agent-row">
          <button id="torRelayNextBtn" class="btn" type="button">Next: Connect</button>
        </div>
      </div>
      <div id="torRelayPageConnect" class="agent-relay-page agent-hidden">
        <div class="agent-grid2">
          <label class="agent-form-label">
            <span>Relay</span>
            <select id="torRelayEnabledSelect" class="field">
              <option value="off">Disabled</option>
              <option value="on">Enabled</option>
            </select>
          </label>
          <label class="agent-form-label">
            <span>Timeout (ms)</span>
            <input id="torRelayTimeoutInput" class="field" type="number" min="1000" max="120000" step="1000" />
          </label>
        </div>
        <label class="agent-form-label">
          <span>Relay URL</span>
          <input id="torRelayBaseUrlInput" class="field" type="text" placeholder="http://127.0.0.1:8766" />
        </label>
        <label class="agent-form-label">
          <span>Relay token (optional)</span>
          <input id="torRelayTokenInput" class="field" type="password" placeholder="change-me" />
        </label>
        <div class="agent-row agent-wrap-row">
          <button id="torRelaySaveBtn" class="btn" type="button">Save Relay Settings</button>
          <button id="torRelayTestBtn" class="btn" type="button">Test Tor Relay</button>
          <span id="torRelayStatus" class="agent-note">Tor relay idle.</span>
        </div>
      </div>
      <div id="torRelayPageTerminal" class="agent-relay-page agent-hidden">
        <div id="torRelayTestWarning" class="agent-note agent-note-warn">Relay not connected yet. Configure and test relay in Connect tab first.</div>
        <div class="agent-terminal">
          <div class="agent-terminal-head">agent1c tor relay terminal</div>
          <pre id="torRelayTestOutput" class="agent-terminal-output"></pre>
          <div class="agent-terminal-row">
            <span class="agent-terminal-prompt">$</span>
            <input id="torRelayCommandInput" class="agent-terminal-input" type="text" placeholder="curl -s -H 'Origin: https://agent1c.me' http://127.0.0.1:8766/v1/tor/status" />
            <button id="torRelayRunBtn" class="btn" type="button">Run</button>
            <button id="torRelayClearBtn" class="btn" type="button">Clear</button>
          </div>
        </div>
      </div>
    </div>
  `
}

export function cacheTorRelayElements(byId){
  return {
    torRelayMainTabSetup: byId("torRelayMainTabSetup"),
    torRelayMainTabConnect: byId("torRelayMainTabConnect"),
    torRelayMainTabTerminal: byId("torRelayMainTabTerminal"),
    torRelayPageSetup: byId("torRelayPageSetup"),
    torRelayPageConnect: byId("torRelayPageConnect"),
    torRelayPageTerminal: byId("torRelayPageTerminal"),
    torRelayNextBtn: byId("torRelayNextBtn"),
    torRelayEnabledSelect: byId("torRelayEnabledSelect"),
    torRelayTimeoutInput: byId("torRelayTimeoutInput"),
    torRelayBaseUrlInput: byId("torRelayBaseUrlInput"),
    torRelayTokenInput: byId("torRelayTokenInput"),
    torRelaySaveBtn: byId("torRelaySaveBtn"),
    torRelayTestBtn: byId("torRelayTestBtn"),
    torRelayStatus: byId("torRelayStatus"),
    torRelayTestWarning: byId("torRelayTestWarning"),
    torRelayCommandInput: byId("torRelayCommandInput"),
    torRelayRunBtn: byId("torRelayRunBtn"),
    torRelayClearBtn: byId("torRelayClearBtn"),
    torRelayTestOutput: byId("torRelayTestOutput"),
    torRelaySetupBody: byId("torRelaySetupBody"),
  }
}

async function testTorRelayStatus(relayConfig){
  const cfg = normalizeRelayConfig(relayConfig)
  if (!cfg.baseUrl) throw new Error("Relay URL is missing.")
  const health = await relayJsonFetch(`${cfg.baseUrl}/v1/health`, { token: cfg.token, timeoutMs: cfg.timeoutMs })
  const tor = await relayJsonFetch(`${cfg.baseUrl}/v1/tor/status`, { token: cfg.token, timeoutMs: cfg.timeoutMs })
  return { health, tor }
}

export function wireTorRelayDom({ root, els, getRelayConfig, onSaveRelayConfig, setStatus, addEvent }){
  if (!root) return
  const cfg = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
  if (els.torRelayEnabledSelect) els.torRelayEnabledSelect.value = cfg.enabled ? "on" : "off"
  if (els.torRelayTimeoutInput) els.torRelayTimeoutInput.value = String(cfg.timeoutMs)
  if (els.torRelayBaseUrlInput) els.torRelayBaseUrlInput.value = cfg.baseUrl
  if (els.torRelayTokenInput) els.torRelayTokenInput.value = cfg.token
  if (els.torRelayStatus) els.torRelayStatus.textContent = cfg.enabled ? "Relay enabled (Tor mode expected)." : "Relay disabled."
  const stackEl = root.querySelector(".agent-setup-stack")

  const setMainTab = (tab) => {
    const isSetup = tab === "setup"
    const isConnect = tab === "connect"
    const isTerminal = tab === "terminal"
    stackEl?.classList.toggle("relay-terminal-mode", isTerminal)
    els.torRelayMainTabSetup?.classList.toggle("active", isSetup)
    els.torRelayMainTabConnect?.classList.toggle("active", isConnect)
    els.torRelayMainTabTerminal?.classList.toggle("active", isTerminal)
    els.torRelayPageSetup?.classList.toggle("agent-hidden", !isSetup)
    els.torRelayPageConnect?.classList.toggle("agent-hidden", !isConnect)
    els.torRelayPageTerminal?.classList.toggle("agent-hidden", !isTerminal)
  }

  const saveFromInputs = async () => {
    const nextCfg = normalizeRelayConfig({
      relayEnabled: els.torRelayEnabledSelect?.value === "on",
      relayTimeoutMs: Number(els.torRelayTimeoutInput?.value || cfg.timeoutMs),
      relayBaseUrl: String(els.torRelayBaseUrlInput?.value || cfg.baseUrl),
      relayToken: String(els.torRelayTokenInput?.value || ""),
    })
    await onSaveRelayConfig?.(nextCfg)
    if (els.torRelayStatus) els.torRelayStatus.textContent = nextCfg.enabled ? "Relay enabled (Tor mode expected)." : "Relay disabled."
    setStatus?.("Tor Relay settings saved.")
  }

  setMainTab(torRelayConnectedOnce() ? "connect" : "setup")
  els.torRelayMainTabSetup?.addEventListener("click", () => setMainTab("setup"))
  els.torRelayMainTabConnect?.addEventListener("click", () => setMainTab("connect"))
  els.torRelayMainTabTerminal?.addEventListener("click", () => setMainTab("terminal"))
  els.torRelayNextBtn?.addEventListener("click", () => setMainTab("connect"))

  const tabs = Array.from(root.querySelectorAll(".agent-device-tab[data-tor-relay-os]"))
  const setOs = (os) => {
    for (const tab of tabs) tab.classList.toggle("active", tab.dataset.torRelayOs === os)
    if (els.torRelaySetupBody) els.torRelaySetupBody.innerHTML = renderTorSetupBody(os)
  }
  tabs.forEach(tab => tab.addEventListener("click", () => setOs(String(tab.dataset.torRelayOs || "linux"))))

  root.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.("[data-tor-relay-copy]")
    if (!btn) return
    const key = String(btn.getAttribute("data-tor-relay-copy") || "")
    const code = root.querySelector(`[data-tor-relay-code="${key}"]`)
    const text = code?.textContent || ""
    const ok = await copyTextToClipboard(text)
    if (ok) {
      btn.textContent = "Copied"
      setTimeout(() => { btn.textContent = "Copy" }, 900)
    }
  })

  els.torRelaySaveBtn?.addEventListener("click", async () => {
    try { await saveFromInputs() } catch (err) { setStatus?.(err instanceof Error ? err.message : "Could not save Tor Relay settings") }
  })

  els.torRelayTestBtn?.addEventListener("click", async () => {
    try {
      await saveFromInputs()
      if (els.torRelayStatus) els.torRelayStatus.textContent = "Testing Tor relay..."
      const current = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
      const result = await testTorRelayStatus(current)
      const isTor = Boolean(result?.tor?.isTor)
      const summary = isTor ? `Tor active (${String(result?.tor?.ip || "ip unknown")})` : `Tor not active (${String(result?.tor?.error || "proxy/direct mode")})`
      if (els.torRelayStatus) els.torRelayStatus.textContent = summary
      setTorRelayConnectedOnce(true)
      setMainTab("connect")
      await addEvent?.("tor_relay_test", summary)
      setStatus?.(summary)
    } catch (err) {
      if (els.torRelayStatus) els.torRelayStatus.textContent = "Tor relay test failed."
      await addEvent?.("tor_relay_test_failed", err instanceof Error ? err.message : "Tor relay test failed")
      setStatus?.(err instanceof Error ? err.message : "Tor relay test failed")
    }
  })

  const updateWarning = () => els.torRelayTestWarning?.classList.toggle("agent-hidden", torRelayConnectedOnce())
  const appendTerminal = (line = "") => {
    if (!els.torRelayTestOutput) return
    els.torRelayTestOutput.textContent = els.torRelayTestOutput.textContent ? `${els.torRelayTestOutput.textContent}\n${line}` : String(line)
    els.torRelayTestOutput.scrollTop = els.torRelayTestOutput.scrollHeight
  }
  updateWarning()
  els.torRelayClearBtn?.addEventListener("click", () => { if (els.torRelayTestOutput) els.torRelayTestOutput.textContent = "" })
  els.torRelayCommandInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return
    event.preventDefault()
    els.torRelayRunBtn?.click()
  })
  els.torRelayRunBtn?.addEventListener("click", async () => {
    const command = String(els.torRelayCommandInput?.value || "").trim()
    if (!command) return setStatus?.("Enter a command first.")
    try {
      await saveFromInputs()
      updateWarning()
      appendTerminal(`$ ${command}`)
      const current = normalizeRelayConfig(getRelayConfig?.() || RELAY_DEFAULTS)
      const result = await relayJsonFetch(`${current.baseUrl}/v1/shell/exec`, {
        method: "POST",
        token: current.token,
        timeoutMs: current.timeoutMs + 1000,
        body: { command, timeout_ms: current.timeoutMs },
      })
      appendTerminal(`exit ${Number(result?.exitCode ?? -1)}${result?.timedOut ? " timedOut=true" : ""}${result?.truncated ? " truncated=true" : ""}`)
      if (result?.stdout) appendTerminal(String(result.stdout))
      if (result?.stderr) appendTerminal(`[stderr]\n${String(result.stderr)}`)
      appendTerminal("")
      setStatus?.("Tor Relay command completed.")
    } catch (err) {
      appendTerminal(`[error] ${err instanceof Error ? err.message : "Command failed."}`)
      appendTerminal("")
      setStatus?.(err instanceof Error ? err.message : "Command failed.")
    }
  })
}
