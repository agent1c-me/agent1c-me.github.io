const LS_VOICE_CONSENT = "agent1c_voice_stt_consent_v1";
const LS_VOICE_ENABLED = "agent1c_voice_stt_enabled_v1";
const LS_VOICE_MODE = "agent1c_voice_stt_mode_v1";
const FOLLOWUP_WINDOW_MS = 45000;
const FIRST_WAKE_IDLE_MS = 7000;
const FIRST_WAKE_SILENCE_MS = 2200;
const DEFAULT_IDLE_CAPTURE_MS = 2600;
const DEFAULT_SILENCE_MS_FINAL = 1200;
const DEFAULT_SILENCE_MS_INTERIM = 1400;

function normalizeSpaces(text){
  return String(text || "").replace(/\s+/g, " ").trim();
}

function wakeRegex(){
  return /\b(?:agentic|agentik|agentec)\b/i;
}

function extractAfterWake(text){
  const raw = normalizeSpaces(text);
  if (!raw) return null;
  const m = raw.match(wakeRegex());
  if (!m || typeof m.index !== "number") return null;
  return normalizeSpaces(raw.slice(m.index + m[0].length));
}

function stripLeadingWake(text){
  return normalizeSpaces(String(text || "").replace(wakeRegex(), " "));
}

export function createVoiceSttController({ button, modal, btnYes, btnNo } = {}){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const supported = typeof SR === "function";
  let consented = localStorage.getItem(LS_VOICE_CONSENT) === "1";
  const storedMode = String(localStorage.getItem(LS_VOICE_MODE) || "").toLowerCase();
  const legacyEnabled = localStorage.getItem(LS_VOICE_ENABLED) === "1";
  let mode = "off";
  if (consented) {
    if (storedMode === "wake" || storedMode === "free") mode = storedMode;
    else if (legacyEnabled) mode = "wake";
  }
  let enabled = mode !== "off";
  let recognition = null;
  let recognizing = false;
  let starting = false;
  let restarting = false;
  let captureActive = false;
  let captureFinalParts = [];
  let captureInterim = "";
  let silenceTimer = null;
  let idleCaptureTimer = null;
  let networkErrorCount = 0;
  let networkErrorWindowStart = 0;
  let lastDispatchedText = "";
  let lastDispatchedAt = 0;
  let heardHintTimer = null;
  let followupUntil = 0;
  let followupTimer = null;
  let currentStatus = "off";
  let currentText = "";
  let currentError = "";
  let wakeCapturePrimed = false;
  let audioCtx = null;
  let pttActive = false;
  let pttPrevMode = "off";

  function emitState(){
    const detail = {
      enabled: !!enabled,
      mode,
      supported: !!supported,
      consented: !!consented,
      status: currentStatus,
      text: currentText,
      error: currentError,
    };
    window.dispatchEvent(new CustomEvent("agent1c:voice-state", { detail }));
  }

  function setStatus(status, text = "", error = ""){
    currentStatus = status;
    currentText = text;
    currentError = error;
    emitState();
    updateButton();
  }

  function updateButton(){
    if (!button) return;
    button.classList.toggle("voice-on", !!enabled);
    button.classList.toggle("voice-off", !enabled);
    if (!supported) {
      button.textContent = "🎤";
      button.title = "Speech recognition not supported in this browser.";
      button.setAttribute("aria-label", button.title);
      button.disabled = true;
      return;
    }
    button.disabled = false;
    if (enabled) {
      if (mode === "free") {
        button.textContent = "🗣️";
        button.title = "Voice is ON (always listening). Click to turn off.";
      } else {
        button.textContent = "🎤";
        button.title = "Voice is ON (wake-word mode). Click for always-listening mode.";
      }
    } else {
      button.textContent = "🎙️";
      button.title = "Voice is OFF. Click to turn on wake-word mode.";
    }
    button.setAttribute("aria-label", button.title);
  }

  function clearCaptureTimers(){
    if (silenceTimer) clearTimeout(silenceTimer);
    if (idleCaptureTimer) clearTimeout(idleCaptureTimer);
    silenceTimer = null;
    idleCaptureTimer = null;
  }

  function isFollowupActive(){
    return Date.now() < followupUntil;
  }

  function updateIdleStatus(){
    if (!enabled) return;
    if (pttActive) {
      setStatus("listening", "Push-to-talk listening...");
      return;
    }
    if (mode === "free") {
      setStatus("idle", "Always listening (no wake-word)");
    } else if (isFollowupActive()) {
      setStatus("idle", "Listening for follow-up...");
    } else {
      setStatus("idle", "Waiting for \"agentic\"");
    }
  }

  function armFollowupWindow(){
    followupUntil = Date.now() + FOLLOWUP_WINDOW_MS;
    if (followupTimer) clearTimeout(followupTimer);
    followupTimer = setTimeout(() => {
      followupUntil = 0;
      if (!enabled || captureActive) return;
      updateIdleStatus();
    }, FOLLOWUP_WINDOW_MS + 40);
    if (!captureActive) updateIdleStatus();
  }

  function clearFollowupWindow(){
    followupUntil = 0;
    if (followupTimer) clearTimeout(followupTimer);
    followupTimer = null;
  }

  function showHeardHint(text){
    if (!enabled || captureActive) return;
    if (heardHintTimer) clearTimeout(heardHintTimer);
    const heard = normalizeSpaces(text);
    if (!heard) return;
    setStatus("idle", `Heard: ${heard}`);
    heardHintTimer = setTimeout(() => {
      if (!enabled || captureActive) return;
      updateIdleStatus();
    }, 1200);
  }

  function resetCapture(){
    clearCaptureTimers();
    if (heardHintTimer) clearTimeout(heardHintTimer);
    heardHintTimer = null;
    captureActive = false;
    captureFinalParts = [];
    captureInterim = "";
    wakeCapturePrimed = false;
  }

  function playWakeChime(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      const now = audioCtx.currentTime;
      const oscA = audioCtx.createOscillator();
      const oscB = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscA.type = "sine";
      oscB.type = "sine";
      oscA.frequency.setValueAtTime(880, now);
      oscB.frequency.setValueAtTime(1175, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      oscA.connect(gain);
      oscB.connect(gain);
      gain.connect(audioCtx.destination);
      oscA.start(now);
      oscA.stop(now + 0.11);
      oscB.start(now + 0.08);
      oscB.stop(now + 0.22);
    } catch {}
  }

  function openConsentModal(){
    if (!modal) return;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeConsentModal(){
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  function persistEnabled(){
    localStorage.setItem(LS_VOICE_ENABLED, enabled ? "1" : "0");
  }

  function persistMode(){
    localStorage.setItem(LS_VOICE_MODE, mode);
    persistEnabled();
  }

  function composeCaptureText(){
    return normalizeSpaces([captureFinalParts.join(" "), captureInterim].join(" "));
  }

  function dispatchVoiceCommand(text){
    const clean = normalizeSpaces(text);
    if (!clean) return;
    const now = Date.now();
    if (clean === lastDispatchedText && now - lastDispatchedAt < 1000) return;
    lastDispatchedText = clean;
    lastDispatchedAt = now;
    window.dispatchEvent(new CustomEvent("agent1c:voice-command", {
      detail: { text: clean, wake: true },
    }));
  }

  function finishCapture(){
    const command = composeCaptureText();
    resetCapture();
    if (command) {
      setStatus("processing", command);
      dispatchVoiceCommand(command);
      armFollowupWindow();
      setTimeout(() => {
        if (!enabled) return;
        updateIdleStatus();
      }, 120);
      return;
    }
    if (enabled) updateIdleStatus();
  }

  function restartSilenceTimer(ms = DEFAULT_SILENCE_MS_FINAL){
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => finishCapture(), ms);
  }

  function restartIdleCaptureTimer(ms = DEFAULT_IDLE_CAPTURE_MS){
    if (idleCaptureTimer) clearTimeout(idleCaptureTimer);
    idleCaptureTimer = setTimeout(() => finishCapture(), ms);
  }

  function wireRecognitionEvents(){
    if (!recognition) return;
    recognition.onstart = () => {
      recognizing = true;
      starting = false;
      networkErrorCount = 0;
      networkErrorWindowStart = 0;
      currentError = "";
      if (enabled) updateIdleStatus();
    };
    recognition.onerror = (event) => {
      const err = String(event?.error || "").toLowerCase();
      if (err === "not-allowed" || err === "service-not-allowed") {
        enabled = false;
        persistEnabled();
        resetCapture();
        setStatus("denied", "", "Microphone permission denied.");
        updateButton();
        return;
      }
      if (err === "network") {
        const now = Date.now();
        if (!networkErrorWindowStart || now - networkErrorWindowStart > 8000) {
          networkErrorWindowStart = now;
          networkErrorCount = 1;
        } else {
          networkErrorCount += 1;
        }
        if (networkErrorCount >= 2) {
          enabled = false;
          persistEnabled();
          resetCapture();
          clearFollowupWindow();
          stopRecognition();
          setStatus("error", "", "Mic error: network. Browser speech service unavailable. Voice turned off.");
          updateButton();
          return;
        }
      }
      if (enabled) {
        const msg = err ? `Mic error: ${err}` : "Mic error";
        setStatus("error", currentText, msg);
      }
    };
    recognition.onresult = (event) => {
      if (!enabled) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const txt = normalizeSpaces(result?.[0]?.transcript || "");
        if (!txt) continue;
        if (!captureActive) {
          const bypassWake = mode === "free" || pttActive;
          const afterWake = extractAfterWake(txt);
          if (!bypassWake && afterWake === null && !isFollowupActive()) {
            showHeardHint(txt);
            continue;
          }
          captureActive = true;
          wakeCapturePrimed = afterWake !== null && !bypassWake;
          if (wakeCapturePrimed) playWakeChime();
          captureFinalParts = [];
          captureInterim = "";
          const seedText = afterWake === null ? txt : afterWake;
          if (seedText) {
            if (result.isFinal) {
              captureFinalParts.push(seedText);
              restartSilenceTimer(wakeCapturePrimed ? FIRST_WAKE_SILENCE_MS : 900);
            } else {
              captureInterim = seedText;
              restartSilenceTimer(wakeCapturePrimed ? FIRST_WAKE_SILENCE_MS : DEFAULT_SILENCE_MS_INTERIM);
            }
          } else {
            restartIdleCaptureTimer(wakeCapturePrimed ? FIRST_WAKE_IDLE_MS : DEFAULT_IDLE_CAPTURE_MS);
          }
          setStatus("listening", composeCaptureText() || "Listening...");
          continue;
        }

        const cleaned = stripLeadingWake(txt);
        if (result.isFinal) {
          if (cleaned) captureFinalParts.push(cleaned);
          captureInterim = "";
          restartSilenceTimer(wakeCapturePrimed ? FIRST_WAKE_SILENCE_MS : DEFAULT_SILENCE_MS_FINAL);
        } else {
          captureInterim = cleaned;
          restartSilenceTimer(wakeCapturePrimed ? FIRST_WAKE_SILENCE_MS : DEFAULT_SILENCE_MS_INTERIM);
        }
        setStatus("listening", composeCaptureText() || "Listening...");
      }
    };
    recognition.onend = () => {
      recognizing = false;
      starting = false;
      if (!enabled) return;
      if (restarting) return;
      restarting = true;
      setTimeout(() => {
        restarting = false;
        startRecognition();
      }, 260);
    };
  }

  function ensureRecognition(){
    if (!supported) return;
    if (recognition) return;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;
    wireRecognitionEvents();
  }

  function startRecognition(){
    if (!enabled || !supported) return;
    ensureRecognition();
    if (!recognition || recognizing || starting) return;
    try {
      starting = true;
      recognition.start();
    } catch {
      starting = false;
    }
  }

  function stopRecognition(){
    resetCapture();
    clearFollowupWindow();
    if (!recognition) return;
    try {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onstart = null;
      recognition.onend = null;
      recognition.stop();
    } catch {}
    recognition = null;
    recognizing = false;
    starting = false;
    restarting = false;
  }

  function setMode(nextMode, options = {}){
    if (!supported) {
      mode = "off";
      enabled = false;
      setStatus("unsupported", "", "Speech recognition is not supported in this browser.");
      updateButton();
      return;
    }
    const next = String(nextMode || "").toLowerCase();
    mode = next === "free" ? "free" : (next === "wake" ? "wake" : "off");
    enabled = mode !== "off";
    if (options.persist !== false) persistMode();
    if (enabled) {
      setStatus("starting", "Starting microphone...");
      startRecognition();
    } else {
      stopRecognition();
      setStatus("off", "", "");
    }
    updateButton();
  }

  function startPushToTalk(){
    if (!supported) return false;
    if (!consented) {
      openConsentModal();
      return false;
    }
    if (pttActive) return true;
    pttActive = true;
    pttPrevMode = mode;
    if (!enabled) {
      setMode("wake", { persist: false });
    } else {
      startRecognition();
    }
    setStatus("listening", "Push-to-talk listening...");
    return true;
  }

  function stopPushToTalk(){
    if (!pttActive) return false;
    if (captureActive) finishCapture();
    const restoreMode = pttPrevMode || "off";
    pttActive = false;
    pttPrevMode = "off";
    if (restoreMode !== mode) {
      setMode(restoreMode, { persist: false });
    } else if (enabled) {
      updateIdleStatus();
    }
    return true;
  }

  function onButtonClick(){
    if (!supported) return;
    if (mode === "wake") {
      setMode("free");
      return;
    }
    if (mode === "free") {
      setMode("off");
      return;
    }
    if (!consented) {
      openConsentModal();
      return;
    }
    setMode("wake");
  }

  function initModalWiring(){
    if (!btnYes || !btnNo || !modal) return;
    btnYes.addEventListener("click", () => {
      consented = true;
      localStorage.setItem(LS_VOICE_CONSENT, "1");
      closeConsentModal();
      setMode("wake");
    });
    btnNo.addEventListener("click", () => {
      closeConsentModal();
      setMode("off");
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeConsentModal();
    });
  }

  function init(){
    initModalWiring();
    if (button) button.addEventListener("click", onButtonClick);
    updateButton();
    if (!supported) {
      setStatus("unsupported", "", "Speech recognition is not supported in this browser.");
      return;
    }
    if (enabled) {
      setStatus("starting", "Starting microphone...");
      startRecognition();
    } else {
      setStatus("off", "", "");
    }
  }

  return {
    init,
    setEnabled: (next) => setMode(next ? "wake" : "off"),
    setMode,
    startPushToTalk,
    stopPushToTalk,
    getState: () => ({
      enabled: !!enabled,
      mode,
      consented: !!consented,
      supported: !!supported,
      status: currentStatus,
      text: currentText,
      error: currentError,
    }),
  };
}
