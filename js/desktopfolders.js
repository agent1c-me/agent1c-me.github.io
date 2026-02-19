function normalizeTitle(value){
  return String(value || "").trim().toLowerCase()
}

export function createDesktopFolders({ desktop } = {}){
  let overlayEl = null
  let openFolderId = ""
  let openAnchorEl = null

  const definitions = [
    {
      id: "persona",
      title: "Persona",
      glyph: "🗂️",
      match: (meta) => {
        const title = normalizeTitle(meta?.title)
        return title === "soul.md" || title === "tools.md" || title === "heartbeat.md"
      },
    },
  ]

  function setDefinitions(nextDefs){
    definitions.length = 0
    for (const def of Array.isArray(nextDefs) ? nextDefs : []) {
      if (!def || !def.id || typeof def.match !== "function") continue
      definitions.push({
        id: String(def.id),
        title: String(def.title || "Folder"),
        glyph: String(def.glyph || "🗂️"),
        match: def.match,
      })
    }
  }

  function registerDefinition(def){
    if (!def || !def.id || typeof def.match !== "function") return false
    const id = String(def.id)
    const idx = definitions.findIndex(entry => entry.id === id)
    const normalized = {
      id,
      title: String(def.title || "Folder"),
      glyph: String(def.glyph || "🗂️"),
      match: def.match,
    }
    if (idx >= 0) definitions[idx] = normalized
    else definitions.push(normalized)
    return true
  }

  function ensureOverlay(){
    if (overlayEl && overlayEl.isConnected) return overlayEl
    overlayEl = document.createElement("section")
    overlayEl.className = "desktop-folder-overlay"
    overlayEl.setAttribute("aria-live", "polite")
    overlayEl.style.display = "none"
    document.body.appendChild(overlayEl)
    return overlayEl
  }

  function hideOverlay(){
    if (!overlayEl) return
    overlayEl.style.display = "none"
    overlayEl.innerHTML = ""
    openFolderId = ""
    openAnchorEl = null
  }

  function positionOverlay(anchorEl){
    if (!overlayEl || !anchorEl) return
    const iconRect = anchorEl.getBoundingClientRect()
    const desktopRect = desktop?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    const gap = 8
    const width = Math.max(200, Math.min(300, Math.round(desktopRect.width * 0.44)))
    overlayEl.style.width = `${width}px`
    overlayEl.style.display = "block"
    const ownRect = overlayEl.getBoundingClientRect()
    let left = iconRect.left + iconRect.width + gap
    if (left + ownRect.width > desktopRect.right - 6) {
      left = iconRect.left - ownRect.width - gap
    }
    if (left < desktopRect.left + 6) left = desktopRect.left + 6

    let top = iconRect.top - 4
    if (top + ownRect.height > desktopRect.bottom - 6) {
      top = desktopRect.bottom - ownRect.height - 6
    }
    if (top < desktopRect.top + 6) top = desktopRect.top + 6

    overlayEl.style.left = `${Math.round(left)}px`
    overlayEl.style.top = `${Math.round(top)}px`
  }

  function renderOverlay(folderMeta, anchorEl, onOpenId){
    const root = ensureOverlay()
    const items = Array.isArray(folderMeta?.items) ? folderMeta.items : []
    if (!items.length) {
      hideOverlay()
      return
    }
    root.innerHTML = `
      <div class="desktop-folder-title">${escapeHtml(folderMeta?.title || "Folder")}</div>
      <div class="desktop-folder-items">
        ${items.map(item => `
          <button class="desktop-folder-item" type="button" data-folder-item-id="${escapeHtml(item.id)}">
            <span class="desktop-folder-item-glyph">${escapeHtml(item.glyph || "📄")}</span>
            <span class="desktop-folder-item-label">${escapeHtml(item.title || "Item")}</span>
          </button>
        `).join("")}
      </div>
    `
    positionOverlay(anchorEl)
    openFolderId = String(folderMeta?.folderId || "")
    openAnchorEl = anchorEl
    root.querySelectorAll("[data-folder-item-id]").forEach(node => {
      node.addEventListener("click", (e) => {
        e.preventDefault()
        const id = node.getAttribute("data-folder-item-id") || ""
        hideOverlay()
        onOpenId?.(id)
      })
    })
  }

  function toggle(folderMeta, anchorEl, onOpenId){
    const folderId = String(folderMeta?.folderId || "")
    if (!folderId) return
    if (openFolderId === folderId && overlayEl?.style.display !== "none") {
      hideOverlay()
      return
    }
    renderOverlay(folderMeta, anchorEl, onOpenId)
  }

  function transform(order, metaById){
    const nextOrder = Array.isArray(order) ? order.slice() : []
    const nextMeta = new Map(metaById || [])

    for (const def of definitions) {
      const members = nextOrder.filter(id => {
        const meta = nextMeta.get(id)
        if (!meta) return false
        try {
          return Boolean(def.match?.(meta, id))
        } catch {
          return false
        }
      })
      if (!members.length) continue

      const firstIdx = nextOrder.findIndex(id => members.includes(id))
      const folderId = `folder:${def.id}`
      const folderItems = members.map(id => {
        const meta = nextMeta.get(id) || {}
        return {
          id,
          title: String(meta.title || id),
          glyph: glyphForMeta(meta),
        }
      })

      members.forEach(id => {
        const idx = nextOrder.indexOf(id)
        if (idx >= 0) nextOrder.splice(idx, 1)
        nextMeta.delete(id)
      })

      const insertAt = Math.max(0, Math.min(firstIdx, nextOrder.length))
      nextOrder.splice(insertAt, 0, folderId)
      nextMeta.set(folderId, {
        title: def.title || "Folder",
        kind: "folder",
        folderId,
        glyph: def.glyph || "🗂️",
        items: folderItems,
      })
    }

    return { order: nextOrder, metaById: nextMeta }
  }

  function glyphForMeta(meta){
    const kind = String(meta?.kind || "")
    if (kind === "note") return "📝"
    if (kind === "file") return "📦"
    if (kind === "app") {
      const title = normalizeTitle(meta?.title)
      if (title.includes("heartbeat")) return "❤️"
      if (title.includes("soul")) return "👻"
      if (title.includes("tools")) return "🧰"
    }
    return "📄"
  }

  function bindGlobalClose(){
    document.addEventListener("pointerdown", (e) => {
      if (!overlayEl || overlayEl.style.display === "none") return
      const target = e.target
      if (overlayEl.contains(target)) return
      if (openAnchorEl && openAnchorEl.contains(target)) return
      hideOverlay()
    }, true)
    window.addEventListener("resize", () => {
      if (!overlayEl || overlayEl.style.display === "none" || !openAnchorEl) return
      positionOverlay(openAnchorEl)
    })
  }

  bindGlobalClose()
  return {
    transform,
    toggle,
    hideOverlay,
    setDefinitions,
    registerDefinition,
  }
}

function escapeHtml(value){
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;")
}
