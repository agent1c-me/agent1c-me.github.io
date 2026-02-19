import { toEmbedUrl } from "./embedify.js";
import { NOTES_KEY } from "./constants.js";
import { createDesktopIcons } from "./desktop-icons.js";
import { createDesktopFolders } from "./desktopfolders.js";
import { loadSavedApps } from "./storage.js";
import { listFiles, listNotes, getFileById, readNoteText, readFileBlob, saveNote, downloadFile, listDesktopTags, addDesktopTag } from "./filesystem.js";
import { animateWindowCloseMatrix, animateWindowOpenMatrix } from "./window-close-fx.js";
// for Codex: WM behavior is HedgeyOS core; before adding agent-driven WM actions, review PHASE2_PLAN.md and agents.md section 19. - Decentricity

export function createWindowManager({ desktop, iconLayer, templates, openWindowsList, saveDialog, appsMenu, appsMap, theme }){
  const { finderTpl, appTpl, browserTpl, notesTpl, themesTpl } = templates;
  const DesktopIcons = createDesktopIcons({ iconLayer, desktop });
  const DesktopFolders = createDesktopFolders({ desktop });
  const downloadModal = document.getElementById("downloadModal");
  const downloadDesc = document.getElementById("downloadDesc");
  const downloadNo = document.getElementById("downloadNo");
  const downloadYes = document.getElementById("downloadYes");

  let zTop = 20;
  let idSeq = 1;
  let activeId = null;
  const state = new Map();
  let tileSnapshot = null;
  const LAYOUT_MIN_W = 160;
  const LAYOUT_MIN_H = 96;
  const WINDOW_LAYOUT_KEY = "hedgey_window_layout_v1";
  let layoutSaveTimer = null;
  let suppressLayoutSave = false;
  let loadedLayoutSnapshot = null;
  let pendingPanelLayouts = new Map();

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
  function deskRect(){ return desktop.getBoundingClientRect(); }
  function deskSize(){ return { w: desktop.clientWidth, h: desktop.clientHeight }; }
  function readLayoutSnapshot(){
    try {
      const raw = localStorage.getItem(WINDOW_LAYOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }
  function writeLayoutSnapshot(snapshot){
    try {
      localStorage.setItem(WINDOW_LAYOUT_KEY, JSON.stringify(snapshot));
    } catch {}
  }
  function getWindowRect(st){
    const win = st?.win;
    if (!win) return null;
    const left = parseFloat(win.style.left) || win.offsetLeft || 0;
    const top = parseFloat(win.style.top) || win.offsetTop || 0;
    const width = parseFloat(win.style.width) || win.offsetWidth || 360;
    const height = parseFloat(win.style.height) || win.offsetHeight || 240;
    return { left, top, width, height };
  }
  function scheduleLayoutSave(){
    if (suppressLayoutSave) return;
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    layoutSaveTimer = setTimeout(() => {
      const snapshot = {
        version: 1,
        windows: [],
        panels: {},
      };
      for (const [panelId, layout] of pendingPanelLayouts.entries()){
        snapshot.panels[panelId] = { ...layout };
      }
      for (const [, st] of state.entries()){
        const rect = getWindowRect(st);
        if (!rect) continue;
        const base = {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          minimized: !!st.minimized,
          maximized: !!st.maximized,
          zIndex: parseInt(st.win.style.zIndex || "0", 10) || 0,
          restoreRect: st.restoreRect || null,
        };
        if (st.panelId) {
          snapshot.panels[st.panelId] = base;
          continue;
        }
        if (!st.restoreType) continue;
        snapshot.windows.push({
          ...base,
          spawn: {
            type: st.restoreType,
            title: st.title || "",
            url: st.url || "",
            notesFileId: st.notesFileId || "",
          },
        });
      }
      writeLayoutSnapshot(snapshot);
    }, 120);
  }
  function applyLayoutToWindow(id, saved){
    const st = state.get(id);
    if (!st || !saved) return;
    if (typeof saved.left === "number") st.win.style.left = `${saved.left}px`;
    if (typeof saved.top === "number") st.win.style.top = `${saved.top}px`;
    if (typeof saved.width === "number") st.win.style.width = `${saved.width}px`;
    if (typeof saved.height === "number") st.win.style.height = `${saved.height}px`;
    st.maximized = !!saved.maximized;
    st.restoreRect = saved.restoreRect || null;
    st.minimized = !!saved.minimized;
    st.win.style.display = st.minimized ? "none" : "grid";
    if (typeof saved.zIndex === "number" && saved.zIndex > 0) {
      st.win.style.zIndex = String(saved.zIndex);
      zTop = Math.max(zTop, saved.zIndex);
    }
  }
  function loadPendingPanelLayouts(){
    loadedLayoutSnapshot = loadedLayoutSnapshot || readLayoutSnapshot() || { windows: [], panels: {} };
    const panels = loadedLayoutSnapshot.panels || {};
    pendingPanelLayouts = new Map(Object.entries(panels));
  }
  function restoreNonAgentWindowsFromSnapshot(){
    loadedLayoutSnapshot = loadedLayoutSnapshot || readLayoutSnapshot();
    if (!loadedLayoutSnapshot?.windows?.length) return;
    suppressLayoutSave = true;
    try {
      for (const rec of loadedLayoutSnapshot.windows) {
        const spawn = rec?.spawn || {};
        let id = null;
        if (spawn.type === "files") id = createFilesWindow({ disableOpenFx: true });
        else if (spawn.type === "browser") id = createBrowserWindow({ disableOpenFx: true });
        else if (spawn.type === "themes") id = createThemesWindow({ disableOpenFx: true });
        else if (spawn.type === "terminal") id = createTerminalWindow({ disableOpenFx: true });
        else if (spawn.type === "notes") id = createNotesWindow(spawn.notesFileId ? { fileId: spawn.notesFileId } : null, { disableOpenFx: true });
        else if (spawn.type === "app" && spawn.url) id = createAppWindow(spawn.title || "App", spawn.url, { disableOpenFx: true });
        if (!id) continue;
        applyLayoutToWindow(id, rec);
      }
    } finally {
      suppressLayoutSave = false;
      refreshIcons();
      refreshOpenWindowsMenu();
      scheduleLayoutSave();
    }
  }
  function getIconReserveHeight(){
    const iconCount = iconLayer?.querySelectorAll(".desk-icon")?.length || 0;
    if (!iconCount) return 0;
    const cs = getComputedStyle(document.documentElement);
    const cellW = parseInt(cs.getPropertyValue("--icon-cell-w"), 10) || 92;
    const cellH = parseInt(cs.getPropertyValue("--icon-cell-h"), 10) || 86;
    const pad = parseInt(cs.getPropertyValue("--icon-pad"), 10) || 10;
    const dw = desktop.clientWidth || 0;
    const cols = Math.max(1, Math.floor(Math.max(1, dw - pad) / cellW));
    const rows = Math.max(1, Math.ceil(iconCount / cols));
    return pad + rows * cellH;
  }
  function getLayoutBounds(){
    const { w: dw, h: dh } = deskSize();
    const reserveBottom = getIconReserveHeight();
    const usableH = Math.max(LAYOUT_MIN_H, dh - reserveBottom);
    return { dw, dh, usableH };
  }

  function getTitle(win){
    return win.querySelector("[data-titletext]")?.textContent?.trim() || "Window";
  }

  function refreshOpenWindowsMenu(){
    openWindowsList.innerHTML = "";
    const entries = Array.from(state.entries());

    if (!entries.length){
      const empty = document.createElement("div");
      empty.className = "menu-item";
      empty.textContent = "(none)";
      empty.style.pointerEvents = "none";
      empty.style.opacity = "0.75";
      openWindowsList.appendChild(empty);
      return;
    }

    entries.sort((a,b) => {
      const za = parseInt(a[1].win.style.zIndex || "0", 10);
      const zb = parseInt(b[1].win.style.zIndex || "0", 10);
      return zb - za;
    });

    for (const [id, st] of entries){
      const item = document.createElement("div");
      item.className = "menu-item";
      item.textContent = (st.minimized ? "◊ " : "") + st.title;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        restore(id);
        focus(id);
        document.querySelectorAll("#menubar .menu").forEach(m => m.classList.remove("open"));
      });
      openWindowsList.appendChild(item);
    }
  }

  function promptDownload(file){
    if (!downloadModal || !downloadYes || !downloadNo) {
      downloadFile(file.id);
      return;
    }
    if (downloadDesc) {
      const name = file?.name || "this file";
      downloadDesc.textContent = `Decrypt and download ${name}?`;
    }
    downloadModal.classList.add("open");
    downloadModal.setAttribute("aria-hidden", "false");
    const close = () => {
      downloadModal.classList.remove("open");
      downloadModal.setAttribute("aria-hidden", "true");
    };
    downloadNo.onclick = () => close();
    downloadYes.onclick = () => {
      close();
      downloadFile(file.id);
    };
  }

  async function refreshIcons(){
    const metaById = new Map();
    const order = Array.from(state.entries())
      .sort((a,b) => a[1].createdAt - b[1].createdAt)
      .map(([id, st]) => {
        metaById.set(id, { title: st.title, kind: st.kind, panelId: st.panelId || "" });
        return id;
      });

    const tagIds = await listDesktopTags();
    if (tagIds.length) {
      const files = await listFiles();
      tagIds.forEach((fileId) => {
        const file = files.find(f => f.id === fileId);
        if (!file) return;
        const ext = (file.name || "").split(".").pop() || "";
        const iconId = `file:${file.id}`;
        metaById.set(iconId, {
          title: file.name || "File",
          kind: file.kind === "note" ? "note" : "file",
          type: file.type || "",
          ext,
          fileId: file.id,
        });
        order.push(iconId);
      });
    }

    const transformed = DesktopFolders.transform(order, metaById);
    DesktopIcons.render(transformed.order, transformed.metaById, (id, iconEl) => {
      const folded = transformed.metaById.get(id);
      if (folded?.kind === "folder") {
        DesktopFolders.toggle(folded, iconEl, (childId) => {
          const childMeta = metaById.get(childId);
          if (childMeta?.fileId) {
            openFileById(childMeta.fileId);
            return;
          }
          restore(childId);
          focus(childId);
        });
        return;
      }
      const meta = metaById.get(id);
      if (meta?.fileId) {
        openFileById(meta.fileId);
        return;
      }
      restore(id);
      focus(id);
    });
  }

  function animateMinimizeToIcon(id, win){
    const icon = iconLayer?.querySelector(`.desk-icon[data-win-id="${id}"]`);
    if (!icon || !win) return Promise.resolve();
    const from = win.getBoundingClientRect();
    const to = icon.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return Promise.resolve();

    const ghost = win.cloneNode(true);
    ghost.style.position = "fixed";
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    ghost.style.margin = "0";
    ghost.style.minWidth = "0";
    ghost.style.minHeight = "0";
    ghost.style.maxWidth = "none";
    ghost.style.maxHeight = "none";
    ghost.style.zIndex = "9999";
    ghost.style.pointerEvents = "none";
    ghost.style.visibility = "visible";
    ghost.style.opacity = "0.96";
    ghost.style.transformOrigin = "top left";
    ghost.style.transition = "transform 180ms ease-in, opacity 180ms ease-in";
    ghost.style.overflow = "hidden";
    document.body.appendChild(ghost);

    const sx = Math.max(0.12, to.width / Math.max(1, from.width));
    const sy = Math.max(0.12, to.height / Math.max(1, from.height));
    const dx = to.left - from.left;
    const dy = to.top - from.top;

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        ghost.remove();
        resolve();
      };
      const timer = setTimeout(finish, 260);
      ghost.addEventListener("transitionend", () => {
        clearTimeout(timer);
        finish();
      }, { once: true });
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        ghost.style.opacity = "0.25";
      });
    });
  }

  function animateRestoreFromIcon(id, win){
    const icon = iconLayer?.querySelector(`.desk-icon[data-win-id="${id}"]`);
    if (!icon || !win) return Promise.resolve();
    const from = icon.getBoundingClientRect();
    const to = win.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return Promise.resolve();

    const ghost = document.createElement("div");
    const winStyle = getComputedStyle(win);
    const titlebar = win.querySelector(".titlebar");
    const titleStyle = titlebar ? getComputedStyle(titlebar) : null;
    ghost.style.all = "initial";
    ghost.style.position = "fixed";
    ghost.style.left = `${from.left}px`;
    ghost.style.top = `${from.top}px`;
    ghost.style.width = `${from.width}px`;
    ghost.style.height = `${from.height}px`;
    ghost.style.zIndex = "9999";
    ghost.style.pointerEvents = "none";
    ghost.style.visibility = "visible";
    ghost.style.opacity = "0.28";
    ghost.style.transition = "left 190ms ease-out, top 190ms ease-out, width 190ms ease-out, height 190ms ease-out, opacity 190ms ease-out";
    ghost.style.border = winStyle.border || "1px solid rgba(0,0,0,0.35)";
    ghost.style.background = winStyle.backgroundColor || "rgba(245,245,245,0.9)";
    ghost.style.boxShadow = winStyle.boxShadow || "0 2px 8px rgba(0,0,0,0.25)";
    ghost.style.overflow = "hidden";
    ghost.style.boxSizing = "border-box";
    const cap = document.createElement("div");
    cap.style.all = "initial";
    cap.style.display = "block";
    cap.style.height = "16px";
    cap.style.borderBottom = "1px solid rgba(0,0,0,0.2)";
    cap.style.background = titleStyle?.background || titleStyle?.backgroundColor || "rgba(220,220,220,0.95)";
    ghost.appendChild(cap);
    document.body.appendChild(ghost);

    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        ghost.remove();
        resolve();
      };
      const timer = setTimeout(finish, 280);
      ghost.addEventListener("transitionend", () => {
        clearTimeout(timer);
        finish();
      }, { once: true });
      requestAnimationFrame(() => {
        ghost.style.left = `${to.left}px`;
        ghost.style.top = `${to.top}px`;
        ghost.style.width = `${to.width}px`;
        ghost.style.height = `${to.height}px`;
        ghost.style.opacity = "0.96";
      });
    });
  }

  function focus(id){
    for (const [wid, st] of state.entries()){
      st.win.classList.toggle("inactive", wid !== id);
    }
    const st = state.get(id);
    if (!st) return;
    activeId = id;
    st.win.style.zIndex = String(++zTop);
    if (st.term) st.term.focus();
    if (st.term) {
      st.term.focus();
    }
    refreshOpenWindowsMenu();
  }


  function minimize(id){
    const st = state.get(id);
    if (!st || st.minimized) return;
    st.minimized = true;
    refreshIcons();
    const run = async () => {
      const win = st.win;
      if (!win) return;
      const prevVisibility = win.style.visibility;
      win.style.visibility = "hidden";
      try {
        await animateMinimizeToIcon(id, win);
      } finally {
        win.style.display = "none";
        win.style.visibility = prevVisibility;
        refreshOpenWindowsMenu();
        scheduleLayoutSave();
      }
    };
    run();
  }

  function restore(id){
    const st = state.get(id);
    if (!st || !st.minimized) return;
    st.minimized = false;
    st.win.style.display = "grid";
    const run = async () => {
      const win = st.win;
      if (!win) return;
      const prevVisibility = win.style.visibility;
      win.style.visibility = "hidden";
      try {
        await animateRestoreFromIcon(id, win);
      } finally {
        win.style.visibility = prevVisibility;
      }
    };
    run();
    refreshOpenWindowsMenu();
    refreshIcons();
    scheduleLayoutSave();
  }

  async function close(id){
    const st = state.get(id);
    if (!st) return;
    const win = st.win;
    if (win && win.isConnected) {
      await animateWindowCloseMatrix(win, { color: "#ff4fb8" });
    }
    if (st.emulator) {
      st.emulator.destroy?.();
      st.emulator = null;
    }
    st.win.remove();
    state.delete(id);
    DesktopIcons.removeIcon(id);

    const last = Array.from(state.keys()).pop();
    if (last) focus(last);

    refreshOpenWindowsMenu();
    refreshIcons();
    scheduleLayoutSave();
  }

  function applyDefaultSize(win){
    const { w: dw, h: dh } = deskSize();
    const isDesktop = dw >= 900;
    const kind = win.dataset.kind || "";
    const wRatio = isDesktop ? 0.45 : 0.8;
    const hRatio = (kind === "notes" && isDesktop) ? 0.45 : 0.5;
    const w = Math.max(320, Math.floor(dw * wRatio));
    const h = Math.max(240, Math.floor(dh * hRatio));
    win.style.width = w + "px";
    win.style.height = h + "px";
  }

  function toggleZoom(id){
    const st = state.get(id);
    if (!st) return;

    const { w: dw, h: dh } = deskSize();

    if (!st.maximized){
      const rect = st.win.getBoundingClientRect();
      const dr = deskRect();
      st.restoreRect = {
        left: rect.left - dr.left,
        top: rect.top - dr.top,
        width: rect.width,
        height: rect.height
      };

      const pad = 6;
      st.win.style.left = pad + "px";
      st.win.style.top = pad + "px";
      st.win.style.width = Math.max(320, dw - pad * 2) + "px";
      st.win.style.height = Math.max(240, dh - pad * 2) + "px";
      st.maximized = true;
    } else {
      const r = st.restoreRect;
      if (r){
        st.win.style.left = r.left + "px";
        st.win.style.top = r.top + "px";
        st.win.style.width = r.width + "px";
        st.win.style.height = r.height + "px";
      }
      st.maximized = false;
    }
    focus(id);
    refreshIcons();
    scheduleLayoutSave();
  }

  function dragBounds(){
    const { w: dw, h: dh } = deskSize();
    const keep = 40;
    const offX = Math.floor(dw * 0.4);
    const offY = Math.floor(dh * 0.4);
    return {
      minLeft: -offX,
      maxLeft: (dw - keep),
      minTop: -offY,
      maxTop: (dh - keep),
    };
  }

  function makeDraggable(id, win){
    const bar = win.querySelector("[data-titlebar]");
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let currentLeft = 0, currentTop = 0;
    let raf = null;
    let pendingDx = 0, pendingDy = 0;
    let currentTilt = 0;
    const maxTilt = 15;

    win.addEventListener("pointerdown", () => focus(id), { capture: true });

    bar.addEventListener("pointerdown", (e) => {
      const onControl = e.target.closest("[data-close],[data-minimize],[data-zoom]");
      if (onControl) return;
      if (state.get(id)?.maximized) return;

      e.preventDefault();
      dragging = true;
      bar.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;

      const rect = win.getBoundingClientRect();
      const dr = deskRect();
      startLeft = rect.left - dr.left;
      startTop  = rect.top - dr.top;
      currentLeft = startLeft;
      currentTop = startTop;
      currentTilt = 0;
      win.style.willChange = "transform";
    }, { passive: false });

    bar.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      e.preventDefault();

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const b = dragBounds();
      const newLeft = clamp(startLeft + dx, b.minLeft, b.maxLeft);
      const newTop  = clamp(startTop + dy, b.minTop, b.maxTop);

      currentLeft = newLeft;
      currentTop = newTop;
      pendingDx = newLeft - startLeft;
      pendingDy = newTop - startTop;
      const tiltRaw = pendingDx / 9 + pendingDy / 80;
      currentTilt = Math.max(-maxTilt, Math.min(maxTilt, tiltRaw));

      if (!raf) {
        raf = requestAnimationFrame(() => {
          win.style.transform = `translate3d(${pendingDx}px, ${pendingDy}px, 0) rotate(${currentTilt}deg)`;
          raf = null;
        });
      }
    }, { passive: false });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = null;
      }
      win.style.left = currentLeft + "px";
      win.style.top = currentTop + "px";
      win.style.transform = "";
      win.style.willChange = "";
      scheduleLayoutSave();
    };
    bar.addEventListener("pointerup", endDrag);
    bar.addEventListener("pointercancel", endDrag);
    bar.addEventListener("lostpointercapture", endDrag);
    bar.addEventListener("dblclick", () => toggleZoom(id));
  }

  function makeResizable(id, win){
    const grip = win.querySelector("[data-grip]");
    let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;

    grip.addEventListener("pointerdown", (e) => {
      if (state.get(id)?.maximized) return;
      e.preventDefault();

      resizing = true;
      grip.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;

      const rect = win.getBoundingClientRect();
      startW = rect.width;
      startH = rect.height;
    }, { passive: false });

    grip.addEventListener("pointermove", (e) => {
      if (!resizing) return;
      e.preventDefault();

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const rect = win.getBoundingClientRect();
      const dr = deskRect();
      const left = rect.left - dr.left;
      const top  = rect.top - dr.top;

      const { w: dw, h: dh } = deskSize();
      const maxW = dw + Math.max(0, -left);
      const maxH = dh + Math.max(0, -top);

      const newW = clamp(startW + dx, 320, Math.max(320, maxW));
      const newH = clamp(startH + dy, 240, Math.max(240, maxH));

      win.style.width = newW + "px";
      win.style.height = newH + "px";
    }, { passive: false });

    grip.addEventListener("pointerup", () => {
      if (!resizing) return;
      resizing = false;
      scheduleLayoutSave();
    });
    grip.addEventListener("pointercancel", () => resizing = false);
    grip.addEventListener("lostpointercapture", () => {
      if (!resizing) return;
      resizing = false;
      scheduleLayoutSave();
    });
  }

  function buildFinderRows(tbody, rows){
    tbody.innerHTML = "";
    rows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.className = "row" + (idx === 0 ? " selected" : "");
      if (r.open) tr.dataset.open = r.open;
      if (r.url) tr.dataset.url = r.url;
      if (r.title) tr.dataset.title = r.title;
      if (r.fileId) tr.dataset.fileId = r.fileId;
      tr.innerHTML = `
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.date)}</td>
        <td>${escapeHtml(r.size)}</td>
        <td>${escapeHtml(r.kind)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
    }[c]));
  }

  function wireFinderUI(win){
    const nav = win.querySelector("[data-nav]");
    const list = win.querySelector("[data-list]");
    const status = win.querySelector("[data-status]");
    const tbody = win.querySelector("[data-finder-rows]");
    const navItems = Array.from(nav.querySelectorAll(".navitem"));

    function activateNav(label){
      const item = navItems.find(x => x.textContent.trim() === label);
      if (!item) return;
      navItems.forEach(x => x.classList.remove("active"));
      item.classList.add("active");
      renderSection(label);
    }

    const appRows = () => {
      const defaults = Object.values(appsMap || {}).map(app => ({
        name: app.title,
        date: "Just now",
        size: "--",
        kind: "application",
        open: "app",
        url: app.url,
        title: app.title,
      })).filter(row => row.url);
      const saved = loadSavedApps().map(app => ({
        name: app.name,
        date: "Just now",
        size: "--",
        kind: "application",
        open: "app",
        url: app.url,
        title: app.name,
      }));
      return defaults.concat(saved).sort((a, b) => a.name.localeCompare(b.name));
    };

    const systemRows = () => ([
      { name: "Terminal", date: "Just now", size: "--", kind: "system app", open: "terminal" },
      { name: "Files", date: "Just now", size: "--", kind: "system app", open: "files" },
    ]);

    const docsRows = async () => {
      const files = await listFiles();
      return files
        .map(file => ({
          name: file.name,
          date: new Date(file.updatedAt).toLocaleString(),
          size: `${file.size || 0} B`,
          kind: file.kind === "note" ? "note" : (file.type || "file"),
          open: file.kind === "note" ? "note" : "download",
          fileId: file.id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    const desktopRows = async () => {
      const tags = await listDesktopTags();
      if (!tags.length) return [];
      const files = await listFiles();
      return tags
        .map(id => files.find(f => f.id === id))
        .filter(Boolean)
        .map(file => ({
          name: file.name,
          date: new Date(file.updatedAt).toLocaleString(),
          size: `${file.size || 0} B`,
          kind: file.kind === "note" ? "note" : (file.type || "file"),
          open: file.kind === "note" ? "note" : "download",
          fileId: file.id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    const emptyRows = () => ([]);

    const sections = {
      Applications: appRows,
      "Encrypted Files": docsRows,
      "System Folder": systemRows,
      Desktop: desktopRows,
    };

    const renderSection = async (label) => {
      const rows = await Promise.resolve((sections[label] || emptyRows)());
      buildFinderRows(tbody, rows);
      if (status) status.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"}`;
    };

    const active = nav.querySelector(".navitem.active")?.textContent?.trim() || "Applications";
    renderSection(active);

    nav.addEventListener("click", (e) => {
      const li = e.target.closest(".navitem");
      if (!li) return;
      navItems.forEach(x => x.classList.remove("active"));
      li.classList.add("active");
      renderSection(li.textContent.trim());
    });

    list.addEventListener("click", (e) => {
      const tr = e.target.closest("tr.row");
      if (!tr) return;
      list.querySelectorAll("tr.row").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
      if (status) status.textContent = "Selected: " + tr.children[0].textContent;
    });

    list.addEventListener("dblclick", (e) => {
      const tr = e.target.closest("tr.row");
      if (!tr) return;
      const open = tr.dataset.open;
      if (open === "terminal") {
        createTerminalWindow();
      } else if (open === "files") {
        createFilesWindow();
      } else if (open === "note") {
        const fileId = tr.dataset.fileId || "";
        createNotesWindow({ fileId });
      } else if (open === "download") {
        const fileId = tr.dataset.fileId || "";
        if (!fileId) return;
        openFileById(fileId);
      } else if (open === "app") {
        const title = tr.dataset.title || tr.children[0].textContent || "App";
        const url = tr.dataset.url || "about:blank";
        createAppWindow(title, url);
      }
    });

    const showContextMenu = (x, y, fileId) => {
      document.querySelectorAll(".context-menu").forEach(m => m.remove());
      const menu = document.createElement("div");
      menu.className = "menu-dropdown bevel-out hairline context-menu";
      menu.style.display = "block";
      menu.style.position = "fixed";
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      const item = document.createElement("div");
      item.className = "menu-item";
      item.textContent = "Add to Desktop";
      item.addEventListener("click", async () => {
        await addDesktopTag(fileId);
        window.dispatchEvent(new Event("hedgey:docs-changed"));
        refreshIcons();
        menu.remove();
      });
      menu.appendChild(item);
      document.body.appendChild(menu);
      const cleanup = () => { menu.remove(); document.removeEventListener("click", cleanup); };
      setTimeout(() => document.addEventListener("click", cleanup), 0);
    };

    list.addEventListener("contextmenu", (e) => {
      const activeLabel = nav.querySelector(".navitem.active")?.textContent?.trim() || "";
      if (!/encrypted files/i.test(activeLabel)) return;
      const tr = e.target.closest("tr.row");
      if (!tr || !tr.dataset.fileId) return;
      e.preventDefault();
      showContextMenu(e.clientX, e.clientY, tr.dataset.fileId);
    });

    let longPressTimer = null;
    let longPressRow = null;
    list.addEventListener("touchstart", (e) => {
      const activeLabel = nav.querySelector(".navitem.active")?.textContent?.trim() || "";
      if (!/encrypted files/i.test(activeLabel)) return;
      const tr = e.target.closest("tr.row");
      if (!tr || !tr.dataset.fileId) return;
      longPressRow = tr;
      const touch = e.touches[0];
      longPressTimer = setTimeout(() => {
        showContextMenu(touch.clientX, touch.clientY, tr.dataset.fileId);
      }, 600);
    }, { passive: true });
    list.addEventListener("touchmove", () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressRow = null;
    }, { passive: true });
    list.addEventListener("touchend", () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressRow = null;
    });

    const newWinBtn = win.querySelector("[data-newwin]");
    if (newWinBtn) newWinBtn.addEventListener("click", () => createFilesWindow());
    const uploadBtn = win.querySelector("[data-upload]");
    if (uploadBtn) uploadBtn.addEventListener("click", () => createAppWindow("Upload", "apps/upload/index.html"));

    const onDocsChanged = () => {
      const activeLabel = nav.querySelector(".navitem.active")?.textContent?.trim() || "";
      if (/encrypted files/i.test(activeLabel) || /desktop/i.test(activeLabel)) renderSection(activeLabel);
    };
    window.addEventListener("hedgey:docs-changed", onDocsChanged);

    win._setFinderSection = activateNav;
  }

  function normalizedBrowserUrl(raw){
    const val = String(raw || "").trim();
    if (!val) return "";
    if (/^(about:|data:|blob:)/i.test(val)) return val;
    if (/^https?:\/\//i.test(val)) return val;
    if (/^(\/|\.\/|\.\.\/)/.test(val)) {
      try { return new URL(val, location.origin).href; } catch {}
    }
    if (/^(localhost|127\.0\.0\.1)(:\d+)?([/?#]|$)/i.test(val)) {
      return `http://${val}`;
    }
    if (/^[a-z0-9.-]+\.[a-z]{2,}([/:?#]|$)/i.test(val)) {
      return "https://" + val;
    }
    try {
      return new URL(val, location.origin + "/").href;
    } catch {
      return "https://" + val;
    }
  }

  function shouldProbeRelay(url){
    if (!url) return false;
    if (!/^https?:\/\//i.test(url)) return false;
    try {
      const parsed = new URL(url);
      return parsed.origin !== location.origin;
    } catch {
      return false;
    }
  }

  function getRelayState(){
    try {
      const relay = window.__agent1cRelayState || {};
      const enabled = relay.enabled === true;
      const baseUrl = String(relay.baseUrl || "http://127.0.0.1:8765").replace(/\/+$/, "");
      return { enabled, baseUrl };
    } catch {
      return { enabled: false, baseUrl: "http://127.0.0.1:8765" };
    }
  }

  function parseHeaderValue(headers, key){
    const source = String(headers || "");
    const line = source.split(/\r?\n/).find(row => row.toLowerCase().startsWith(`${String(key || "").toLowerCase()}:`));
    if (!line) return "";
    return line.slice(line.indexOf(":") + 1).trim();
  }

  function isFrameBlockedByHeaders(headers){
    const xfo = parseHeaderValue(headers, "x-frame-options").toLowerCase();
    if (xfo.includes("deny") || xfo.includes("sameorigin")) return true;
    const csp = parseHeaderValue(headers, "content-security-policy").toLowerCase();
    if (!csp.includes("frame-ancestors")) return false;
    if (csp.includes("frame-ancestors *")) return false;
    if (csp.includes("frame-ancestors 'self'")) return true;
    return true;
  }

  function extractHtmlTitle(html){
    const text = String(html || "");
    const m = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) return "";
    const plain = String(m[1] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return plain.slice(0, 120);
  }

  async function relayFetch(url, mode, maxBytes){
    const relay = getRelayState();
    if (!relay.enabled) throw new Error("relay disabled");
    const resp = await fetch(`${relay.baseUrl}/v1/http/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        mode: mode || "get",
        max_bytes: Math.max(80000, Number(maxBytes) || 300000),
      }),
    });
    if (!resp.ok) throw new Error(`relay ${resp.status}`);
    const json = await resp.json();
    return json || {};
  }

  function renderRelayBody(iframe, targetUrl, page){
    const body = String(page?.body || "");
    const contentType = String(page?.contentType || "").toLowerCase();
    if (contentType.includes("text/html") || body.trim().startsWith("<!doctype") || body.trim().startsWith("<html")) {
      const html = `<base href="${targetUrl}">\n${body}`;
      iframe.removeAttribute("srcdoc");
      iframe.src = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
      return;
    }
    const safe = body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = `<html><head><meta charset="utf-8" /><base href="${targetUrl}"></head><body><pre>${safe}</pre></body></html>`;
    iframe.removeAttribute("srcdoc");
    iframe.src = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  async function loadUrlIntoIframe(iframe, rawUrl, opts = {}){
    const setStatus = typeof opts.onStatus === "function" ? opts.onStatus : () => {};
    const onRelayPage = typeof opts.onRelayPage === "function" ? opts.onRelayPage : null;
    const raw = String(rawUrl || "").trim();
    if (!raw) {
      setStatus("Enter a URL");
      return { ok: false, finalUrl: "" };
    }

    const conv = toEmbedUrl(raw, { twitchParent: location.hostname || "localhost" });
    if (conv.ok){
      iframe.removeAttribute("srcdoc");
      iframe.src = conv.embedUrl;
      setStatus("Embedded via " + conv.provider);
      return { ok: true, finalUrl: raw, title: "", viaRelay: false };
    }

    const norm = normalizedBrowserUrl(raw);
    let openedViaRelay = false;
    if (shouldProbeRelay(norm)) {
      try {
        const probe = await relayFetch(norm, "head", opts.maxBytes || 300000);
        if (probe.ok && isFrameBlockedByHeaders(probe.headers || "")) {
          const page = await relayFetch(norm, "get", opts.maxBytes || 300000);
          if (page.ok) {
            openedViaRelay = true;
            const resolvedUrl = String(page.finalUrl || norm);
            renderRelayBody(iframe, resolvedUrl, page);
            setStatus("Opened via local relay fallback");
            const title = extractHtmlTitle(page.body || "");
            if (onRelayPage) onRelayPage({ page, title, finalUrl: resolvedUrl });
            return { ok: true, finalUrl: resolvedUrl, title, viaRelay: true };
          }
        }
      } catch {
        // Direct path fallback below.
      }
    }
    if (!openedViaRelay) {
      iframe.removeAttribute("srcdoc");
      iframe.src = norm;
      if (conv.reason === "twitch_requires_parent"){
        setStatus("Twitch needs a parent domain; opened raw URL");
      } else {
        setStatus("Opened direct URL (no embed)");
      }
      return { ok: true, finalUrl: norm, title: "", viaRelay: false };
    }
    return { ok: false, finalUrl: norm, title: "", viaRelay: false };
  }

  function wireAppUI(win, url){
    const iframe = win.querySelector("[data-iframe]");
    loadUrlIntoIframe(iframe, url, { maxBytes: 500000 }).catch(() => {
      iframe.src = normalizedBrowserUrl(url);
    });
  }

  function wireBrowserUI(win){
    const field = win.querySelector("[data-urlfield]");
    const goBtn = win.querySelector("[data-go]");
    const saveBtn = win.querySelector("[data-save]");
    const backBtn = win.querySelector("[data-back]");
    const iframe = win.querySelector("[data-iframe]");
    const status = win.querySelector("[data-browser-status]");
    const historyStack = [];
    let historyIndex = -1;
    let suppressHistory = false;
    let navSeq = 0;

    function setStatus(txt){
      if (status) status.textContent = txt;
    }

    let lastResolvedUrl = "";
    let lastResolvedTitle = "";

    async function setUrl(u, opts){
      const raw = (u || "").trim();
      if (!raw){
        setStatus("Enter a URL");
        return;
      }
      const seq = ++navSeq;

      const conv = toEmbedUrl(raw, { twitchParent: location.hostname || "localhost" });
      if (conv.ok){
        field.value = raw;
        iframe.removeAttribute("srcdoc");
        iframe.src = conv.embedUrl;
        setStatus("Embedded via " + conv.provider);
        lastResolvedUrl = raw;
        lastResolvedTitle = "";
      } else {
        const result = await loadUrlIntoIframe(iframe, raw, {
          onStatus: setStatus,
          maxBytes: 500000,
          onRelayPage: ({ title }) => {
            lastResolvedTitle = title || "";
          },
        });
        if (seq !== navSeq) return;
        if (result?.ok) {
          const finalUrl = String(result.finalUrl || normalizedBrowserUrl(raw));
          field.value = finalUrl;
          lastResolvedUrl = finalUrl;
          if (!result.title) lastResolvedTitle = "";
        } else {
          const norm = normalizedBrowserUrl(raw);
          field.value = norm;
          lastResolvedUrl = norm;
          lastResolvedTitle = "";
        }
      }
      if (!opts?.noHistory) {
        const val = field.value;
        if (!suppressHistory && val) {
          historyStack.splice(historyIndex + 1);
          historyStack.push(val);
          historyIndex = historyStack.length - 1;
        }
      }
    }

    goBtn.addEventListener("click", () => { setUrl(field.value); });
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter"){
        e.preventDefault();
        setUrl(field.value);
      }
    });
    field.addEventListener("focus", () => field.select());
    field.addEventListener("click", () => field.select());

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        if (historyIndex <= 0) return;
        historyIndex -= 1;
        suppressHistory = true;
        setUrl(historyStack[historyIndex], { noHistory: true });
        suppressHistory = false;
      });
    }

    saveBtn.addEventListener("click", () => {
      const current = (lastResolvedUrl || field.value || "").trim();
      const url = normalizedBrowserUrl(current);
      if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) {
        setStatus("Cannot save this page URL.");
        return;
      }

      const guessName = (() => {
        if (lastResolvedTitle) return lastResolvedTitle;
        try{
          const host = new URL(url).hostname.replace(/^www\./i,"");
          return host || "New App";
        } catch {
          return "New App";
        }
      })();

      saveDialog.open(url, guessName, () => {
        appsMenu.renderSavedApps();
      });
    });

    const defaultHome = location.origin + "/apps/browser-home/index.html";
    if (!field.value || field.value === "about:blank") {
      field.value = defaultHome;
      setUrl(defaultHome);
    } else {
      setUrl(field.value);
    }
  }

  function wireNotesUI(win, opts){
    const ta = win.querySelector("[data-notes]");
    const status = win.querySelector("[data-notestatus]");
    const btnNew = win.querySelector("[data-notes-new]");
    const btnOpen = win.querySelector("[data-notes-open]");
    const btnSave = win.querySelector("[data-notes-save]");
    const titleText = win.querySelector("[data-titletext]");
    const openModal = document.getElementById("notesOpenModal");
    const openList = document.getElementById("notesOpenList");
    const openCancel = document.getElementById("notesOpenCancel");
    const openConfirm = document.getElementById("notesOpenConfirm");

    const prefill = (opts && typeof opts.prefill === "string") ? opts.prefill : null;
    const forcePrefill = !!(opts && opts.forcePrefill);
    let fileId = (opts && opts.fileId) ? String(opts.fileId) : "";
    let fileName = "";
    let pendingOpenId = "";

    let t = null;
    function setStatus(txt){
      if (status) status.textContent = txt;
    }

    function setTitle(name){
      if (!titleText) return;
      titleText.textContent = name ? `Notes - ${name}` : "Notes";
    }

    function doSave(){
      localStorage.setItem(NOTES_KEY, ta.value);
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ss = String(now.getSeconds()).padStart(2, "0");
      setStatus("Saved at " + hh + ":" + mm + ":" + ss);
    }

    function scheduleSave(){
      setStatus("Typing...");
      if (t) clearTimeout(t);
      t = setTimeout(doSave, 1000);
    }

    if (fileId) {
      Promise.all([getFileById(fileId), readNoteText(fileId)]).then(([found, text]) => {
        if (found && found.kind === "note" && typeof text === "string") {
          ta.value = text;
          fileName = found.name || "";
          setTitle(fileName);
          setStatus("Opened " + (fileName || "Notes"));
        } else {
          fileId = "";
        }
      });
    }

    if (!fileId) {
      const saved = localStorage.getItem(NOTES_KEY);
      if (typeof saved === "string" && !forcePrefill){
        ta.value = saved;
      } else if (prefill !== null){
        ta.value = prefill;
        localStorage.setItem(NOTES_KEY, ta.value);
      }
      setTitle("");
      setStatus(saved ? "Loaded" : "Not saved yet");
    }

    ta.addEventListener("input", scheduleSave);
    ta.addEventListener("blur", () => {
      if (t) { clearTimeout(t); t = null; }
      doSave();
    });

    setTimeout(() => ta.focus(), 0);

    if (btnNew) {
      btnNew.addEventListener("click", () => {
        fileId = "";
        fileName = "";
        ta.value = "";
        localStorage.setItem(NOTES_KEY, "");
        setTitle("");
        setStatus("New file");
        ta.focus();
      });
    }

    if (btnOpen) {
      btnOpen.addEventListener("click", async () => {
        if (!openModal || !openList || !openCancel || !openConfirm) {
          setStatus("Open dialog not available");
          return;
        }
        const files = await listNotes();
        if (!files.length) {
          setStatus("No saved notes yet");
          return;
        }
        pendingOpenId = "";
        openList.innerHTML = "";
        files.forEach((file, idx) => {
          const row = document.createElement("div");
          row.className = "openitem" + (idx === 0 ? " selected" : "");
          row.textContent = file.name;
          row.dataset.id = file.id;
          openList.appendChild(row);
          if (idx === 0) pendingOpenId = file.id;
        });
        openList.querySelectorAll(".openitem").forEach(row => {
          row.addEventListener("click", () => {
            openList.querySelectorAll(".openitem").forEach(r => r.classList.remove("selected"));
            row.classList.add("selected");
            pendingOpenId = row.dataset.id || "";
          });
          row.addEventListener("dblclick", () => {
            pendingOpenId = row.dataset.id || "";
            openConfirm.click();
          });
        });
        openCancel.onclick = () => {
          openModal.classList.remove("open");
          openModal.setAttribute("aria-hidden", "true");
        };
        openConfirm.onclick = async () => {
          const selected = pendingOpenId ? files.find(f => f.id === pendingOpenId) : null;
          const text = pendingOpenId ? await readNoteText(pendingOpenId) : null;
          if (!selected || typeof text !== "string") {
            setStatus("File not found");
            return;
          }
          fileId = selected.id;
          fileName = selected.name;
          ta.value = text || "";
          setTitle(fileName);
          setStatus("Opened " + fileName);
          openModal.classList.remove("open");
          openModal.setAttribute("aria-hidden", "true");
          ta.focus();
        };
        openModal.classList.add("open");
        openModal.setAttribute("aria-hidden", "false");
      });
    }

    if (btnSave) {
      btnSave.addEventListener("click", async () => {
        let name = fileName;
        if (!name) {
          name = window.prompt("Name this note:", "Untitled");
          if (!name) return;
        }
        const savedFile = await saveNote({ id: fileId || null, name, content: ta.value });
        if (!savedFile) {
          setStatus("Save canceled");
          return;
        }
        fileId = savedFile.id;
        fileName = savedFile.name;
        setTitle(fileName);
        setStatus("Saved " + fileName);
        window.dispatchEvent(new Event("hedgey:docs-changed"));
      });
    }
  }


  function wireThemesUI(win){
    const list = win.querySelector("[data-themes-list]");
    const items = Array.from(list.querySelectorAll("[data-theme]"));
    const title = win.querySelector("[data-theme-title]");
    const desc = win.querySelector("[data-theme-desc]");

    const meta = {
      hedgey: {
        label: "OS 9 Classic",
        desc: "Classic HedgeyOS chrome with Mac OS 9-inspired greys.",
      },
      system7: {
        label: "System Software 7",
        desc: "Early Macintosh look with tighter chrome and lighter greys.",
      },
      greenscreen: {
        label: "Greenscreen",
        desc: "Flat black-and-green CRT terminal vibe with glowing accents.",
      },
      cyberpunk: {
        label: "Cyberpunk Red",
        desc: "BeOS-style tabs with flat black-and-red chrome.",
      },
      beos: {
        label: "BeOS",
        desc: "Warm BeOS yellow title bars and a brighter, punchier contrast.",
      },
      hedgeyOS: {
        label: "HedgeyOS",
        desc: "BeOS-like tabs shifted to the bottom with soft pink and yellow accents.",
      },
    };

    function applySelection(name){
      theme.applyTheme(name);
      items.forEach(item => {
        item.classList.toggle("active", item.dataset.theme === name);
      });
      const info = meta[name] || meta.hedgey;
      if (title) title.textContent = info.label;
      if (desc) desc.textContent = info.desc;
    }

    items.forEach(item => {
      item.addEventListener("click", () => applySelection(item.dataset.theme));
    });

    applySelection(theme.getTheme());
  }

  function spawn(tpl, title, extra){
    const id = "w" + (idSeq++);
    const frag = tpl.content.cloneNode(true);
    const win = frag.querySelector("[data-win]");

    win.dataset.kind = extra?.kind || "window";
    win.dataset.id = id;
    win.style.zIndex = String(++zTop);

    applyDefaultSize(win);

    const { w: dw, h: dh } = deskSize();
    const wNow = parseFloat(win.style.width) || 400;
    const hNow = parseFloat(win.style.height) || 300;

    const baseLeft = 6 + 18 * (idSeq - 2);
    const baseTop  = 6 + 18 * (idSeq - 2);

    win.style.left = clamp(baseLeft, 0, Math.max(0, dw - wNow)) + "px";
    win.style.top  = clamp(baseTop, 0, Math.max(0, dh - hNow)) + "px";

    const titleText = win.querySelector("[data-titletext]");
    if (titleText && title) titleText.textContent = title;

    desktop.appendChild(win);

    const st = {
      win,
      minimized: false,
      maximized: false,
      restoreRect: null,
      title: getTitle(win),
      kind: extra?.kind || "window",
      restoreType: extra?.restoreType || "",
      url: extra?.url || "",
      notesFileId: extra?.notesOpts?.fileId ? String(extra.notesOpts.fileId) : "",
      panelId: extra?.panelId || "",
      createdAt: Date.now() + idSeq
    };
    state.set(id, st);

    win.querySelector("[data-close]").addEventListener("click", () => close(id));
    win.querySelector("[data-minimize]").addEventListener("click", () => minimize(id));
    win.querySelector("[data-zoom]").addEventListener("click", () => toggleZoom(id));

    makeDraggable(id, win);
    makeResizable(id, win);

    if (tpl === finderTpl) wireFinderUI(win);
    if (tpl === appTpl) wireAppUI(win, extra?.url || "about:blank");
    if (tpl === browserTpl) wireBrowserUI(win);
    if (tpl === notesTpl) wireNotesUI(win, extra?.notesOpts || null);
    if (tpl === themesTpl) wireThemesUI(win);

    st.title = getTitle(win);
    if (st.panelId && pendingPanelLayouts.has(st.panelId)) {
      applyLayoutToWindow(id, pendingPanelLayouts.get(st.panelId));
      pendingPanelLayouts.delete(st.panelId);
    }
    focus(id);
    refreshOpenWindowsMenu();
    refreshIcons();
    scheduleLayoutSave();

    if (!extra?.disableOpenFx) {
      const prevVisibility = win.style.visibility;
      win.style.visibility = "hidden";
      Promise.resolve()
        .then(() => animateWindowOpenMatrix(win, {
          color: "#ff4fb8",
          onReveal: () => {
            if (!win.isConnected) return;
            win.style.visibility = prevVisibility;
          },
        }))
        .finally(() => {
          if (!win.isConnected) return;
          win.style.visibility = prevVisibility;
        });
    }

    return id;
  }

  function createFilesWindow(runtimeOpts = {}){
    return spawn(finderTpl, "Files", { kind: "files", restoreType: "files", disableOpenFx: !!runtimeOpts.disableOpenFx });
  }

  function createBrowserWindow(runtimeOpts = {}){
    return spawn(browserTpl, "Browser", { kind: "browser", restoreType: "browser", disableOpenFx: !!runtimeOpts.disableOpenFx });
  }

  function createAppWindow(title, url, runtimeOpts = {}){
    return spawn(appTpl, title, { kind: "app", url, restoreType: "app", disableOpenFx: !!runtimeOpts.disableOpenFx });
  }

  function createNotesWindow(notesOpts, runtimeOpts = {}){
    return spawn(notesTpl, "Notes", {
      kind: "notes",
      notesOpts: notesOpts || null,
      restoreType: "notes",
      disableOpenFx: !!runtimeOpts.disableOpenFx,
    });
  }

  async function openFileById(fileId){
    if (!fileId) return;
    const payload = await readFileBlob(fileId);
    if (!payload || !payload.record) return;
    const { record: file, blob } = payload;
    if (file.kind === "note") {
      createNotesWindow({ fileId: file.id });
      return;
    }
    const name = file.name || "File";
    const ext = (name.split(".").pop() || "").toLowerCase();
    const type = (file.type || "").toLowerCase();
    const isHtml = type.includes("text/html") || ext === "html" || ext === "htm";
    const textExts = new Set([
      "txt","md","markdown","mdx","sh","bash","zsh","log","csv","tsv","json","yaml","yml","ini","conf","env","toml","lock",
      "xml","svg","css","js","ts","tsx","jsx","py","rb","go","rs","php","java","c","cpp","h","hpp","bat","cmd"
    ]);
    const hasExt = name.includes(".");
    const isText = type.startsWith("text/") || textExts.has(ext) || !hasExt;
    const previewExts = new Set([
      "png","jpg","jpeg","gif","webp","bmp","svg","mp4","webm","mov","mp3","wav","ogg","pdf"
    ]);
    const isPreviewable = type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/") || type === "application/pdf" || previewExts.has(ext);
    if (isHtml && blob) {
      const url = URL.createObjectURL(blob);
      createAppWindow(name, url);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return;
    }
    if (isText && blob) {
      try{
        const text = await blob.text();
        createNotesWindow({ prefill: text, forcePrefill: true });
      } catch {
        downloadFile(fileId);
      }
      return;
    }
    if (isPreviewable && blob) {
      const url = URL.createObjectURL(blob);
      createAppWindow(name, url);
      setTimeout(() => URL.revokeObjectURL(url), 20000);
      return;
    }
    promptDownload(file);
  }

  function activateDocuments(filesWinId){
    const st = state.get(filesWinId);
    if (!st || !st.win) return false;
    if (typeof st.win._setFinderSection === "function") {
      st.win._setFinderSection("Encrypted Files");
      focus(filesWinId);
      return true;
    }
    return false;
  }

  function focusDocumentsWindow(){
    const filesWins = Array.from(state.entries())
      .filter(([, st]) => st.kind === "files")
      .map(([id]) => id);
    if (filesWins.length) {
      return activateDocuments(filesWins[0]);
    }
    const newId = createFilesWindow();
    activateDocuments(newId);
    return true;
  }

  function createTerminalWindow(runtimeOpts = {}){
    return spawn(appTpl, "Terminal", {
      kind: "app",
      url: "apps/terminal/index.html",
      restoreType: "terminal",
      disableOpenFx: !!runtimeOpts.disableOpenFx,
    });
  }

  function createThemesWindow(runtimeOpts = {}){
    return spawn(themesTpl, "Themes", {
      kind: "app",
      restoreType: "themes",
      disableOpenFx: !!runtimeOpts.disableOpenFx,
    });
  }

  function listWindows(){
    return Array.from(state.entries())
      .map(([id, st]) => ({
        id,
        title: st.title || getTitle(st.win),
        minimized: !!st.minimized,
        kind: st.kind || "",
        panelId: st.panelId || "",
        zIndex: parseInt(st.win?.style?.zIndex || "0", 10) || 0,
      }))
      .sort((a, b) => b.zIndex - a.zIndex);
  }

  function findWindowByTitle(title){
    const needle = String(title || "").trim().toLowerCase();
    if (!needle) return null;
    const wins = listWindows();
    const exact = wins.find(w => String(w.title || "").trim().toLowerCase() === needle);
    if (exact) return exact;
    return wins.find(w => String(w.title || "").toLowerCase().includes(needle)) || null;
  }

  function openAppById(appId){
    const raw = String(appId || "").trim();
    if (!raw) return null;
    const key = raw.toLowerCase();
    const norm = key.replace(/[^a-z0-9]/g, "");

    // Core system apps aliases.
    if (["localterminal", "terminal", "decenterminal"].includes(norm)) return createTerminalWindow();
    if (["files", "file"].includes(norm)) return createFilesWindow();
    if (["browser", "web", "webbrowser"].includes(norm)) return createBrowserWindow();
    if (["notes", "note"].includes(norm)) return createNotesWindow();

    const entries = Object.entries(appsMap || {});
    const saved = loadSavedApps();
    const byIdExact = entries.find(([id]) => String(id || "").toLowerCase() === key);
    if (byIdExact && byIdExact[1]?.url) {
      const [id, app] = byIdExact;
      return createAppWindow(app.title || id, app.url);
    }
    const byIdNorm = entries.find(([id]) => String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
    if (byIdNorm && byIdNorm[1]?.url) {
      const [id, app] = byIdNorm;
      return createAppWindow(app.title || id, app.url);
    }
    const byTitleExact = entries.find(([, app]) => String(app?.title || "").toLowerCase() === key);
    if (byTitleExact && byTitleExact[1]?.url) {
      const [id, app] = byTitleExact;
      return createAppWindow(app.title || id, app.url);
    }
    const byTitleNorm = entries.find(([, app]) => String(app?.title || "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
    if (byTitleNorm && byTitleNorm[1]?.url) {
      const [id, app] = byTitleNorm;
      return createAppWindow(app.title || id, app.url);
    }
    const byTitleContains = entries.find(([, app]) => {
      const t = String(app?.title || "").toLowerCase();
      return t.includes(key) || key.includes(t);
    });
    if (byTitleContains && byTitleContains[1]?.url) {
      const [id, app] = byTitleContains;
      return createAppWindow(app.title || id, app.url);
    }

    const savedExact = saved.find(app => String(app?.name || "").toLowerCase() === key);
    if (savedExact?.url) return createAppWindow(savedExact.name || "App", savedExact.url);
    const savedNorm = saved.find(app => String(app?.name || "").toLowerCase().replace(/[^a-z0-9]/g, "") === norm);
    if (savedNorm?.url) return createAppWindow(savedNorm.name || "App", savedNorm.url);
    const savedContains = saved.find(app => {
      const t = String(app?.name || "").toLowerCase();
      return t.includes(key) || key.includes(t);
    });
    if (savedContains?.url) return createAppWindow(savedContains.name || "App", savedContains.url);

    return null;
  }

  function listAvailableApps(){
    const base = Object.entries(appsMap || {}).map(([id, app]) => ({
      id: String(id || ""),
      title: String(app?.title || id || ""),
      url: String(app?.url || ""),
      source: "builtin",
    }));
    const saved = loadSavedApps().map((app, i) => ({
      id: `saved:${i + 1}`,
      title: String(app?.name || "Saved App"),
      url: String(app?.url || ""),
      source: "saved",
    }));
    return [...base, ...saved].filter(app => app.title && app.url);
  }

  function openUrlInBrowser(url, opts = {}){
    const target = String(url || "").trim();
    if (!target) return { ok: false, error: "missing url" };
    const existing = findWindowByTitle("Browser");
    let browserId = existing?.id || null;
    if (!browserId || opts.newWindow) browserId = createBrowserWindow();
    if (!browserId) return { ok: false, error: "browser window unavailable" };
    restore(browserId);
    focus(browserId);
    const st = state.get(browserId);
    if (!st?.win) return { ok: false, error: "browser state unavailable" };
    const field = st.win.querySelector("[data-urlfield]");
    const goBtn = st.win.querySelector("[data-go]");
    if (!field || !goBtn) return { ok: false, error: "browser controls unavailable" };
    field.value = target;
    goBtn.click();
    return { ok: true, id: browserId, title: st.title || "Browser", url: target };
  }

  function clearTileSnapshot(){
    tileSnapshot = null;
  }

  function getVisibleWindowStates(){
    return Array.from(state.entries())
      .filter(([, st]) => !st.minimized && st.win && st.win.style.display !== "none")
      .map(([id, st]) => ({ id, st }));
  }

  function untileVisibleWindows(visible){
    if (!tileSnapshot || !visible.length) return false;
    const canUntile = tileSnapshot.size === visible.length
      && visible.every(item => tileSnapshot.has(item.id));
    if (!canUntile) return false;
    visible.forEach(item => {
      const prev = tileSnapshot.get(item.id);
      if (!prev) return;
      item.st.maximized = false;
      item.st.restoreRect = null;
      item.st.win.style.left = `${prev.left}px`;
      item.st.win.style.top = `${prev.top}px`;
      item.st.win.style.width = `${prev.width}px`;
      item.st.win.style.height = `${prev.height}px`;
    });
    clearTileSnapshot();
    return true;
  }

  function tileVisibleWindows(){
    const visible = getVisibleWindowStates();
    if (!visible.length) return;
    if (untileVisibleWindows(visible)) {
      arrangeVisibleWindows();
      return;
    }

    tileSnapshot = new Map();
    visible.forEach(item => {
      tileSnapshot.set(item.id, {
        left: parseFloat(item.st.win.style.left) || item.st.win.offsetLeft || 0,
        top: parseFloat(item.st.win.style.top) || item.st.win.offsetTop || 0,
        width: parseFloat(item.st.win.style.width) || item.st.win.offsetWidth || 360,
        height: parseFloat(item.st.win.style.height) || item.st.win.offsetHeight || 240,
      });
    });

    const { dw, usableH } = getLayoutBounds();
    const gap = 8;
    const count = visible.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt((count * dw) / Math.max(1, usableH))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const maxCellW = Math.max(LAYOUT_MIN_W, dw - gap * 2);
    const maxCellH = Math.max(LAYOUT_MIN_H, usableH - gap * 2);
    const cellW = clamp(Math.floor((dw - gap * (cols + 1)) / cols), LAYOUT_MIN_W, maxCellW);
    const cellH = clamp(Math.floor((usableH - gap * (rows + 1)) / rows), LAYOUT_MIN_H, maxCellH);

    visible.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const left = gap + col * (cellW + gap);
      const top = gap + row * (cellH + gap);
      item.st.maximized = false;
      item.st.restoreRect = null;
      item.st.win.style.left = `${clamp(left, 0, Math.max(0, dw - cellW))}px`;
      item.st.win.style.top = `${clamp(top, 0, Math.max(0, usableH - cellH))}px`;
      item.st.win.style.width = `${cellW}px`;
      item.st.win.style.height = `${cellH}px`;
    });

    refreshIcons();
    refreshOpenWindowsMenu();
  }

  function arrangeVisibleWindows(){
    const visible = getVisibleWindowStates();
    if (!visible.length) return;
    if (!untileVisibleWindows(visible)) clearTileSnapshot();
    const { dw, usableH } = getLayoutBounds();
    const gap = 10;
    const maxW = Math.max(LAYOUT_MIN_W, dw - gap * 2);
    const maxH = Math.max(LAYOUT_MIN_H, usableH - gap * 2);
    const base = visible.map(item => {
      const w = clamp(parseFloat(item.st.win.style.width) || item.st.win.offsetWidth || 360, LAYOUT_MIN_W, maxW);
      const h = clamp(parseFloat(item.st.win.style.height) || item.st.win.offsetHeight || 240, LAYOUT_MIN_H, maxH);
      return { st: item.st, w, h };
    });

    function pack(items){
      let x = gap;
      let y = gap;
      let rowH = 0;
      let maxBottom = 0;
      const placed = [];
      items.forEach(item => {
        let w = item.w;
        let h = item.h;
        if (x + w > dw - gap && x > gap) {
          x = gap;
          y += rowH + gap;
          rowH = 0;
        }
        const left = clamp(x, 0, Math.max(0, dw - w));
        const top = clamp(y, 0, Math.max(0, usableH - h));
        placed.push({ st: item.st, left, top, w, h });
        x += w + gap;
        rowH = Math.max(rowH, h);
        maxBottom = Math.max(maxBottom, top + h);
      });
      return { placed, maxBottom };
    }

    let packed = pack(base);
    if (packed.maxBottom > usableH - gap) {
      const scale = Math.max(0.45, (usableH - gap * 2) / Math.max(1, packed.maxBottom));
      const scaled = base.map(item => ({
        st: item.st,
        w: clamp(Math.floor(item.w * scale), LAYOUT_MIN_W, maxW),
        h: clamp(Math.floor(item.h * scale), LAYOUT_MIN_H, maxH),
      }));
      packed = pack(scaled);
    }

    packed.placed.forEach(item => {
      item.st.maximized = false;
      item.st.restoreRect = null;
      item.st.win.style.left = `${item.left}px`;
      item.st.win.style.top = `${item.top}px`;
      item.st.win.style.width = `${item.w}px`;
      item.st.win.style.height = `${item.h}px`;
    });

    refreshIcons();
    refreshOpenWindowsMenu();
    scheduleLayoutSave();
  }

  function createAgentPanelWindow(title, opts = {}){
    const id = spawn(appTpl, title, { kind: "app", url: "about:blank" });
    const st = state.get(id);
    if (!st) return null;
    if (typeof opts.left === "number") st.win.style.left = `${opts.left}px`;
    if (typeof opts.top === "number") st.win.style.top = `${opts.top}px`;
    if (typeof opts.width === "number") st.win.style.width = `${opts.width}px`;
    if (typeof opts.height === "number") st.win.style.height = `${opts.height}px`;

    // Keep agent panels fully reachable on small screens.
    const { w: dw, h: dh } = deskSize();
    const pad = 6;
    const maxW = Math.max(200, dw - pad * 2);
    const maxH = Math.max(140, dh - pad * 2);
    const curW = parseFloat(st.win.style.width) || st.win.offsetWidth || 420;
    const curH = parseFloat(st.win.style.height) || st.win.offsetHeight || 260;
    const fitW = Math.min(curW, maxW);
    const fitH = Math.min(curH, maxH);
    const curL = parseFloat(st.win.style.left) || 0;
    const curT = parseFloat(st.win.style.top) || 0;
    st.win.style.width = `${fitW}px`;
    st.win.style.height = `${fitH}px`;
    st.win.style.left = `${clamp(curL, 0, Math.max(0, dw - fitW))}px`;
    st.win.style.top = `${clamp(curT, 0, Math.max(0, dh - fitH))}px`;

    const appWrap = st.win.querySelector(".appwrap");
    if (!appWrap) return { id, win: st.win, panelRoot: null };
    if (opts.closeAsMinimize) {
      const closeBtn = st.win.querySelector("[data-close]");
      if (closeBtn) {
        const replacement = closeBtn.cloneNode(true);
        closeBtn.replaceWith(replacement);
        replacement.addEventListener("click", () => minimize(id));
      }
    }
    appWrap.innerHTML = "";
    const host = document.createElement("div");
    host.className = "agent-panel-body";
    host.innerHTML = `<div class="agent-panel" data-agent-panel></div>`;
    appWrap.appendChild(host);

    const panelRoot = st.win.querySelector("[data-agent-panel]");
    if (panelRoot && opts.panelId) panelRoot.dataset.panelId = opts.panelId;
    const stEntry = state.get(id);
    if (stEntry && opts.panelId) {
      stEntry.panelId = opts.panelId;
      stEntry.restoreType = "";
      if (pendingPanelLayouts.has(opts.panelId)) {
        applyLayoutToWindow(id, pendingPanelLayouts.get(opts.panelId));
        pendingPanelLayouts.delete(opts.panelId);
      }
      scheduleLayoutSave();
    }
    focus(id);
    refreshIcons();
    return { id, win: st.win, panelRoot };
  }

  window.addEventListener("resize", () => {
    refreshIcons();
    refreshOpenWindowsMenu();
    scheduleLayoutSave();
  });

  loadPendingPanelLayouts();

  return {
    createFilesWindow,
    createBrowserWindow,
    createNotesWindow,
    createTerminalWindow,
    createAppWindow,
    createThemesWindow,
    createAgentPanelWindow,
    arrangeVisibleWindows,
    tileVisibleWindows,
    focusDocumentsWindow,
    refreshOpenWindowsMenu,
    refreshIcons,
    focus,
    minimize,
    restore,
    listWindows,
    findWindowByTitle,
    openAppById,
    listAvailableApps,
    openUrlInBrowser,
    restoreLayoutSession: restoreNonAgentWindowsFromSnapshot,
  };
}
