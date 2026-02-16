const LS_VOICE_CONSENT = "agent1c_voice_stt_consent_v1";
const LS_VOICE_ENABLED = "agent1c_voice_stt_enabled_v1";

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
  let enabled = consented && localStorage.getItem(LS_VOICE_ENABLED) === "1";
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
  let currentStatus = "off";
  let currentText = "";
  let currentError = "";

  function emitState(){
    const detail = {
      enabled: !!enabled,
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
      button.textContent = "🎤";
      button.title = "Voice wake-word is ON. Click to turn off.";
    } else {
      button.textContent = "🎙️";
      button.title = "Voice wake-word is OFF. Click to turn on.";
    }
    button.setAttribute("aria-label", button.title);
  }

  function clearCaptureTimers(){
    if (silenceTimer) clearTimeout(silenceTimer);
    if (idleCaptureTimer) clearTimeout(idleCaptureTimer);
    silenceTimer = null;
    idleCaptureTimer = null;
  }

  function showHeardHint(text){
    if (!enabled || captureActive) return;
    if (heardHintTimer) clearTimeout(heardHintTimer);
    const heard = normalizeSpaces(text);
    if (!heard) return;
    setStatus("idle", `Heard: ${heard}`);
    heardHintTimer = setTimeout(() => {
      if (!enabled || captureActive) return;
      setStatus("idle", "Waiting for \"agentic\"");
    }, 1200);
  }

  function resetCapture(){
    clearCaptureTimers();
    if (heardHintTimer) clearTimeout(heardHintTimer);
    heardHintTimer = null;
    captureActive = false;
    captureFinalParts = [];
    captureInterim = "";
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
      setTimeout(() => {
        if (!enabled) return;
        setStatus("idle", "Waiting for \"agentic\"");
      }, 120);
      return;
    }
    if (enabled) setStatus("idle", "Waiting for \"agentic\"");
  }

  function restartSilenceTimer(ms = 1200){
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => finishCapture(), ms);
  }

  function restartIdleCaptureTimer(ms = 2600){
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
      if (enabled) setStatus("idle", "Waiting for \"agentic\"");
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
          const afterWake = extractAfterWake(txt);
          if (afterWake === null) {
            showHeardHint(txt);
            continue;
          }
          captureActive = true;
          captureFinalParts = [];
          captureInterim = "";
          if (afterWake) {
            if (result.isFinal) {
              captureFinalParts.push(afterWake);
              restartSilenceTimer(900);
            } else {
              captureInterim = afterWake;
              restartSilenceTimer(1400);
            }
          } else {
            restartIdleCaptureTimer(2600);
          }
          setStatus("listening", composeCaptureText() || "Listening...");
          continue;
        }

        const cleaned = stripLeadingWake(txt);
        if (result.isFinal) {
          if (cleaned) captureFinalParts.push(cleaned);
          captureInterim = "";
          restartSilenceTimer(1200);
        } else {
          captureInterim = cleaned;
          restartSilenceTimer(1400);
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

  function setEnabled(next){
    if (!supported) {
      enabled = false;
      setStatus("unsupported", "", "Speech recognition is not supported in this browser.");
      updateButton();
      return;
    }
    enabled = !!next;
    persistEnabled();
    if (enabled) {
      setStatus("starting", "Starting microphone...");
      startRecognition();
    } else {
      stopRecognition();
      setStatus("off", "", "");
    }
    updateButton();
  }

  function onButtonClick(){
    if (!supported) return;
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (!consented) {
      openConsentModal();
      return;
    }
    setEnabled(true);
  }

  function initModalWiring(){
    if (!btnYes || !btnNo || !modal) return;
    btnYes.addEventListener("click", () => {
      consented = true;
      localStorage.setItem(LS_VOICE_CONSENT, "1");
      closeConsentModal();
      setEnabled(true);
    });
    btnNo.addEventListener("click", () => {
      closeConsentModal();
      setEnabled(false);
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
    setEnabled,
    getState: () => ({
      enabled: !!enabled,
      consented: !!consented,
      supported: !!supported,
      status: currentStatus,
      text: currentText,
      error: currentError,
    }),
  };
}
