// v86 terminal implementation and Arch profile settings are derived from copy.sh v86:
// https://github.com/copy/v86
(() => {
  const screen = document.getElementById("screen");
  const statusEl = document.getElementById("status");
  const capture = document.getElementById("capture");
  const keyOverlay = document.getElementById("keys");
  const keyboardBtn = document.getElementById("keyboard");
  const installPanel = document.getElementById("installPanel");
  const installArchBtn = document.getElementById("installArchBtn");
  const reinstallArchBtn = document.getElementById("reinstallArchBtn");
  const clearArchBtn = document.getElementById("clearArchBtn");
  const installProgressWrap = document.getElementById("installProgressWrap");
  const installProgressFill = document.getElementById("installProgressFill");
  const installProgressText = document.getElementById("installProgressText");

  const ARCH_STATE_URL = "https://i.copy.sh/arch_state-v3.bin.zst";
  const ARCH_FS_BASEURL = "https://i.copy.sh/arch/";
  const OPFS_STATE_FILE = "agent1c-v86-arch-state-v3.bin.zst";
  const OPFS_STATE_VERSION = "arch_state-v3";

  let emulator = null;
  let installInProgress = false;
  let cachedStateBuffer = null;

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  const setInstallProgress = (loaded, total, extraText = "") => {
    if (!installProgressWrap || !installProgressFill || !installProgressText) return;
    installProgressWrap.hidden = false;
    let pctText = "";
    if (Number.isFinite(total) && total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
      installProgressFill.style.width = `${pct}%`;
      pctText = `${pct}%`;
    } else {
      installProgressFill.style.width = "0%";
    }
    const mbLoaded = (loaded / (1024 * 1024)).toFixed(1);
    const mbTotal = Number.isFinite(total) && total > 0 ? (total / (1024 * 1024)).toFixed(1) : "?";
    installProgressText.textContent = `${extraText || "Downloading Arch state..."} ${pctText} (${mbLoaded} / ${mbTotal} MB)`.trim();
  };

  const setInstallPanelVisible = (visible) => {
    if (!installPanel) return;
    installPanel.classList.toggle("hidden", !visible);
  };

  const isOpfsSupported = () => Boolean(navigator.storage && navigator.storage.getDirectory);

  const getOpfsRoot = async () => {
    return navigator.storage.getDirectory();
  };

  const getOrCreateStateDir = async () => {
    const root = await getOpfsRoot();
    return root.getDirectoryHandle("agent1c_v86", { create: true });
  };

  const readInstalledVersion = async () => {
    try {
      const dir = await getOrCreateStateDir();
      const handle = await dir.getFileHandle("version.txt");
      const file = await handle.getFile();
      return (await file.text()).trim();
    } catch (_) {
      return "";
    }
  };

  const writeInstalledVersion = async (version) => {
    const dir = await getOrCreateStateDir();
    const handle = await dir.getFileHandle("version.txt", { create: true });
    const writable = await handle.createWritable();
    await writable.write(String(version || ""));
    await writable.close();
  };

  const clearInstalledArch = async () => {
    const dir = await getOrCreateStateDir();
    try {
      await dir.removeEntry(OPFS_STATE_FILE);
    } catch (_) {}
    try {
      await dir.removeEntry("version.txt");
    } catch (_) {}
    cachedStateBuffer = null;
  };

  const readStateFromOpfs = async () => {
    try {
      const dir = await getOrCreateStateDir();
      const version = await readInstalledVersion();
      if (version !== OPFS_STATE_VERSION) return null;
      const handle = await dir.getFileHandle(OPFS_STATE_FILE);
      const file = await handle.getFile();
      if (!file || file.size <= 0) return null;
      return await file.arrayBuffer();
    } catch (_) {
      return null;
    }
  };

  const writeStateToOpfs = async (buffer) => {
    const dir = await getOrCreateStateDir();
    const handle = await dir.getFileHandle(OPFS_STATE_FILE, { create: true });
    const writable = await handle.createWritable();
    await writable.write(buffer);
    await writable.close();
    await writeInstalledVersion(OPFS_STATE_VERSION);
  };

  const fetchArchState = async () => {
    const response = await fetch(ARCH_STATE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Arch state download failed (${response.status})`);
    }

    const total = Number(response.headers.get("content-length")) || 0;
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      setInstallProgress(buffer.byteLength, buffer.byteLength || total, "Downloading Arch state...");
      return buffer;
    }

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      loaded += value.byteLength;
      setInstallProgress(loaded, total, "Downloading Arch state...");
    }

    const result = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  };

  const showInstallRequired = (message) => {
    setInstallPanelVisible(true);
    if (installArchBtn) installArchBtn.disabled = false;
    if (reinstallArchBtn) reinstallArchBtn.disabled = false;
    if (clearArchBtn) clearArchBtn.disabled = false;
    if (installProgressWrap) installProgressWrap.hidden = true;
    if (installProgressFill) installProgressFill.style.width = "0%";
    setStatus(message || "Your distro has not been downloaded yet. Install Arch Linux to continue.");
  };

  const bootArchFromState = async (stateBuffer) => {
    if (emulator) return emulator;
    setInstallPanelVisible(false);
    setStatus("Preparing Arch Linux (local install)...");

    emulator = new window.V86Starter({
      wasm_path: "../../vendor/v86/v86.wasm",
      screen_container: screen,
      bios: { url: "../../vendor/v86/bios/seabios.bin" },
      vga_bios: { url: "../../vendor/v86/bios/vgabios.bin" },
      initial_state: { buffer: stateBuffer },
      filesystem: { baseurl: ARCH_FS_BASEURL },
      autostart: true,
      memory_size: 512 * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
    });

    emulator.add_listener("download-progress", (evt) => {
      if (!evt.lengthComputable) {
        setStatus("Loading Arch Linux assets...");
        return;
      }
      const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
      setStatus(`Loading Arch Linux assets... ${pct}%`);
    });

    emulator.add_listener("download-error", () => {
      setStatus("Failed to download v86/Arch assets.");
    });

    emulator.add_listener("emulator-loaded", () => {
      setStatus("Arch Linux booting...");
    });

    return emulator;
  };

  const ensureArchInstalledAndBoot = async () => {
    if (!window.V86Starter) {
      setStatus("v86 engine not available.");
      return;
    }
    if (!isOpfsSupported()) {
      showInstallRequired("This browser does not support local OPFS storage for Arch Linux.");
      if (installArchBtn) installArchBtn.disabled = true;
      return;
    }

    setStatus("Checking local Arch Linux install...");
    cachedStateBuffer = await readStateFromOpfs();
    if (!cachedStateBuffer) {
      showInstallRequired("Your distro has not been downloaded yet. Install Arch Linux to continue.");
      return;
    }

    await bootArchFromState(cachedStateBuffer);
  };

  const installArch = async () => {
    if (installInProgress) return;
    installInProgress = true;
    if (installArchBtn) installArchBtn.disabled = true;
    if (reinstallArchBtn) reinstallArchBtn.disabled = true;
    if (clearArchBtn) clearArchBtn.disabled = true;
    try {
      setStatus("Downloading Arch Linux install image...");
      const buffer = await fetchArchState();
      setInstallProgress(buffer.byteLength, buffer.byteLength, "Saving local Arch install...");
      await writeStateToOpfs(buffer);
      cachedStateBuffer = buffer;
      if (installProgressText) {
        installProgressText.textContent = "Arch Linux installed locally. Booting...";
      }
      setStatus("Arch Linux installed locally. Booting...");
      await bootArchFromState(buffer);
    } catch (error) {
      console.error(error);
      showInstallRequired(`Install failed: ${error?.message || "Unknown error"}`);
    } finally {
      installInProgress = false;
      if (!emulator) {
        if (installArchBtn) installArchBtn.disabled = false;
        if (reinstallArchBtn) reinstallArchBtn.disabled = false;
        if (clearArchBtn) clearArchBtn.disabled = false;
      }
    }
  };

  const reinstallArch = async () => {
    if (installInProgress) return;
    try {
      setStatus("Clearing local Arch install...");
      await clearInstalledArch();
    } catch (error) {
      console.error(error);
      showInstallRequired(`Failed to clear local Arch: ${error?.message || "Unknown error"}`);
      return;
    }
    await installArch();
  };

  const clearArchOnly = async () => {
    if (installInProgress) return;
    try {
      setStatus("Clearing local Arch install...");
      await clearInstalledArch();
      showInstallRequired("Local Arch install cleared. Install Arch to continue.");
    } catch (error) {
      console.error(error);
      showInstallRequired(`Failed to clear local Arch: ${error?.message || "Unknown error"}`);
    }
  };

  const focusScreen = () => {
    if (capture) capture.focus();
    screen?.focus();
    emulator?.keyboard_set_status?.(true);
  };

  const sendSpecialKey = (key) => {
    const map = {
      Enter: 13,
      Backspace: 8,
      Tab: 9,
      Escape: 27,
      ArrowUp: 38,
      ArrowDown: 40,
      ArrowLeft: 37,
      ArrowRight: 39,
      Insert: 45,
      Delete: 46,
      Home: 36,
      End: 35,
      PageUp: 33,
      PageDown: 34,
    };
    const keyCode = map[key];
    if (!keyCode) return false;
    if (key === "Enter" && emulator?.keyboard_send_scancodes) {
      emulator.keyboard_send_scancodes([0x1c, 0x9c]);
    } else {
      emulator?.keyboard_send_keys?.([keyCode]);
    }
    return true;
  };

  if (!screen) return;
  screen.tabIndex = 0;

  document.addEventListener("pointerdown", focusScreen);
  screen.addEventListener("pointerdown", focusScreen);

  if (capture) {
    capture.tabIndex = 0;
    capture.setAttribute("aria-label", "Terminal input capture");
    capture.setAttribute("autocapitalize", "off");
    capture.setAttribute("autocomplete", "off");
    capture.setAttribute("autocorrect", "off");
    capture.setAttribute("inputmode", "text");
    capture.spellcheck = false;
    capture.addEventListener("pointerdown", focusScreen);
    capture.addEventListener("touchstart", focusScreen, { passive: true });
    capture.addEventListener("keydown", (e) => {
      const sentSpecial = sendSpecialKey(e.key);
      if (!sentSpecial && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        emulator?.keyboard_send_text?.(e.key);
      }
      if (keyOverlay) {
        keyOverlay.textContent = `Key: ${e.key}  Code: ${e.code || "n/a"}  KeyCode: ${e.keyCode || 0}`;
      }
      e.preventDefault();
    });
    capture.addEventListener("input", (e) => {
      const value = e.target.value;
      if (!value) return;
      emulator?.keyboard_send_text?.(value);
      if (keyOverlay) {
        keyOverlay.textContent = `Input: ${value}`;
      }
      e.target.value = "";
    });
  }

  if (keyboardBtn && capture) {
    const showKeyboard = () => {
      focusScreen();
      setTimeout(() => capture.focus(), 0);
    };
    keyboardBtn.addEventListener("click", showKeyboard);
    keyboardBtn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      showKeyboard();
    }, { passive: false });
  }

  installArchBtn?.addEventListener("click", () => {
    void installArch();
  });
  reinstallArchBtn?.addEventListener("click", () => {
    void reinstallArch();
  });
  clearArchBtn?.addEventListener("click", () => {
    void clearArchOnly();
  });

  void ensureArchInstalledAndBoot();
})();
