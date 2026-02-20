import { createSaveDialog } from "./save-dialog.js";
import { createAppsMenu } from "./apps-menu.js";
import { createWindowManager } from "./wm.js";
import { initMenuDropdowns, initMenuActions } from "./menubar.js";
import { saveUpload, hasWrappedKey, setPassphrase, unlockWithPassphrase } from "./filesystem.js";
import { initThemeToggle, initThemeState, applyTheme, getTheme } from "./theme.js";
import { createHud } from "./hud.js";
import { initAgent1C } from "./agent1c.js";
import { createVoiceSttController } from "./voice-stt.js";

const menubar = document.getElementById("menubar");
const desktop = document.getElementById("desktop");
const iconLayer = document.getElementById("iconLayer");
const openWindowsList = document.getElementById("openWindowsList");

async function loadAppsConfig(){
  try{
    const resp = await fetch("apps.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`apps.json failed: ${resp.status}`);
    const data = await resp.json();
    if (!data || !Array.isArray(data.apps)) throw new Error("apps.json missing apps");
    return data;
  } catch (err){
    console.error(err);
    return { apps: [] };
  }
}

function toAppsMap(appsConfig){
  const map = {};
  for (const app of appsConfig.apps || []){
    if (!app || !app.id) continue;
    map[app.id] = { title: app.title || app.id, url: app.url || "" };
  }
  return map;
}

async function boot(){
  const appsConfig = await loadAppsConfig();
  const appsMap = toAppsMap(appsConfig);

  const appsMenu = createAppsMenu({
    savedAppsList: document.getElementById("savedAppsList"),
    appsList: document.getElementById("appsList"),
    appsConfig,
  });

  const saveDialog = createSaveDialog({
    modal: document.getElementById("saveModal"),
    nameField: document.getElementById("saveAppName"),
    urlField: document.getElementById("saveAppUrl"),
    btnNo: document.getElementById("saveNo"),
    btnYes: document.getElementById("saveYes"),
    onSaved: () => appsMenu.renderSavedApps(),
  });

  const wm = createWindowManager({
    desktop,
    iconLayer,
    templates: {
      finderTpl: document.getElementById("finderTemplate"),
      appTpl: document.getElementById("appTemplate"),
      browserTpl: document.getElementById("browserTemplate"),
      notesTpl: document.getElementById("notesTemplate"),
      themesTpl: document.getElementById("themesTemplate"),
    },
    openWindowsList,
    saveDialog,
    appsMenu,
    appsMap,
    theme: { applyTheme, getTheme },
  });

  const hud = createHud({
    video: document.getElementById("hudFeed"),
    body: document.body,
    switchButton: document.getElementById("hudSwitch"),
  });

  initMenuDropdowns({ menubar });
  initMenuActions({ menubar, wm, appsMenu, defaultApps: appsMap, hud });
  initThemeToggle({ button: document.getElementById("modebtn") });
  initThemeState();

  const voice = createVoiceSttController({
    button: document.getElementById("voicebtn"),
    modal: document.getElementById("voiceModal"),
    btnYes: document.getElementById("voiceYes"),
    btnNo: document.getElementById("voiceNo"),
  });
  voice.init();
  window.__agent1cVoiceController = voice;

  appsMenu.renderAppsMenu();
  appsMenu.renderSavedApps();
  wm.restoreLayoutSession?.();
  await initAgent1C({ wm });

  const toast = document.getElementById("toast");
  const toastBody = document.getElementById("toastBody");
  let toastTimer = null;
  function showToast(message){
    if (!toast || !toastBody) return;
    toastBody.innerHTML = message;
    toast.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 8000);
  }

  window.addEventListener("hedgey:encryption-notice", () => {
    showToast('Your files are encrypted. <span class="toast-link">Click here for key operations.</span>');
  });

  function openKeyOperations(){
    openKeyModal(true);
  }

  if (toast) {
    toast.addEventListener("click", () => {
      openKeyOperations();
    });
  }

  const keyBtn = document.getElementById("keybtn");
  if (keyBtn) {
    keyBtn.addEventListener("click", () => openKeyOperations());
  }

  const keyModal = document.getElementById("keyModal");
  const keyTitle = document.getElementById("keyTitle");
  const keyDesc = document.getElementById("keyDesc");
  const keyPass1 = document.getElementById("keyPass1");
  const keyPass2 = document.getElementById("keyPass2");
  const keyPassRow2 = document.getElementById("keyPassRow2");
  const keyError = document.getElementById("keyError");
  const keyConfirm = document.getElementById("keyConfirm");
  const keyKeep = document.getElementById("keyKeep");
  const keyInfo = document.getElementById("keyInfo");

  async function openKeyModal(force){
    if (!keyModal) return;
    const wrapped = await hasWrappedKey();
    if (!wrapped && !force) return;
    keyTitle.textContent = wrapped ? "Unlock Encryption" : "Set Passphrase";
    keyDesc.textContent = wrapped ? "Enter your passphrase to unlock encrypted files." : "";
    if (keyInfo) keyInfo.style.display = wrapped ? "none" : "block";
    if (keyPassRow2) keyPassRow2.style.display = wrapped ? "none" : "grid";
    if (keyError) keyError.textContent = "";
    if (keyPass1) keyPass1.value = "";
    if (keyPass2) keyPass2.value = "";
    keyModal.classList.add("open");
    keyModal.setAttribute("aria-hidden", "false");
    setTimeout(() => keyPass1?.focus(), 0);

    keyConfirm.onclick = async () => {
      const p1 = (keyPass1?.value || "").trim();
      const p2 = (keyPass2?.value || "").trim();
      if (!p1) {
        if (keyError) keyError.textContent = "Passphrase required.";
        return;
      }
      if (!wrapped && p1 !== p2) {
        if (keyError) keyError.textContent = "Passphrases do not match.";
        return;
      }
      try {
        const ok = wrapped ? await unlockWithPassphrase(p1) : await setPassphrase(p1);
        if (!ok) {
          if (keyError) keyError.textContent = "Could not unlock. Try again.";
          return;
        }
        keyModal.classList.remove("open");
        keyModal.setAttribute("aria-hidden", "true");
      } catch {
        if (keyError) keyError.textContent = "Could not unlock. Try again.";
      }
    };

    const onEnter = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        keyConfirm.click();
      }
    };
    if (keyPass1) keyPass1.onkeydown = onEnter;
    if (keyPass2) keyPass2.onkeydown = onEnter;

    if (keyKeep) {
      keyKeep.style.display = wrapped ? "none" : "inline-flex";
      keyKeep.onclick = () => {
        keyModal.classList.remove("open");
        keyModal.setAttribute("aria-hidden", "true");
      };
    }
  }

  openKeyModal(false);

  async function handleDroppedFiles(files){
    const list = Array.from(files || []).filter(f => f instanceof File);
    if (!list.length) return;
    for (const file of list){
      await saveUpload(file);
    }
    window.dispatchEvent(new Event("hedgey:docs-changed"));
    if (typeof wm.focusDocumentsWindow === "function") {
      wm.focusDocumentsWindow();
    }
  }

  let dragDepth = 0;

  function findDropTarget(x, y){
    const wins = Array.from(document.querySelectorAll("[data-win]"))
      .filter(win => ["app", "browser"].includes(win.dataset.kind || ""))
      .sort((a, b) => {
        const za = parseInt(a.style.zIndex || "0", 10);
        const zb = parseInt(b.style.zIndex || "0", 10);
        return zb - za;
      });
    for (const win of wins){
      const rect = win.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return win;
      }
    }
    return null;
  }

  function ensureDropShield(win){
    if (!win) return null;
    let shield = win.querySelector("[data-drop-shield]");
    if (shield) return shield;
    const wrap = win.querySelector(".appwrap, .browserwrap");
    if (!wrap) return null;
    shield = document.createElement("div");
    shield.className = "drop-shield";
    shield.textContent = "Drop to upload";
    shield.setAttribute("data-drop-shield", "");
    wrap.appendChild(shield);
    return shield;
  }

  function updateDropShield(x, y){
    const target = findDropTarget(x, y);
    if (target) ensureDropShield(target);
    document.querySelectorAll("[data-drop-shield]").forEach(el => {
      el.classList.toggle("show", el.closest("[data-win]") === target);
    });
  }

  document.addEventListener("dragenter", (e) => {
    dragDepth += 1;
  });
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    updateDropShield(e.clientX, e.clientY);
  });
  document.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      document.querySelectorAll("[data-drop-shield]").forEach(el => el.classList.remove("show"));
    }
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    document.querySelectorAll("[data-drop-shield]").forEach(el => el.classList.remove("show"));
    handleDroppedFiles(e.dataTransfer?.files);
  });

}

boot();
