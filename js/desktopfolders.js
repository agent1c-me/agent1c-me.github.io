export function createDesktopFolders({ desktop } = {}){
  const folderDefs = new Map()
  let overlayEl = null
  let activeFolderId = ""
  let activeAnchor = null

  registerFolder({
    id: "persona",
    title: "Persona",
    glyph: "🗂️",
    memberPanelIds: ["soul", "tools", "heartbeat"],
  })

  function registerFolder(def){
    if (!def || !def.id) return false
    const id = String(def.id).trim()
    if (!id) return false
    const members = Array.isArray(def.memberPanelIds) ? def.memberPanelIds.map(x => String(x || "").trim()).filter(Boolean) : []
    folderDefs.set(id, {
      id,
      title: String(def.title || id),
      glyph: String(def.glyph || "🗂️"),
      memberPanelIds: members,
    })
    return true
  }

  function setFolders(defs){
    folderDefs.clear()
    for (const def of Array.isArray(defs) ? defs : []) registerFolder(def)
  }

  function ensureOverlay(){
    if (overlayEl && overlayEl.isConnected) return overlayEl
    overlayEl = document.createElement("section")
    overlayEl.className = "desktop-folder-overlay"
    overlayEl.style.display = "none"
    document.body.appendChild(overlayEl)
    return overlayEl
  }

  function hideOverlay(){
    if (!overlayEl) return
    overlayEl.style.display = "none"
    overlayEl.innerHTML = ""
    activeFolderId = ""
    activeAnchor = null
  }

  function positionOverlay(anchorEl){
    if (!overlayEl || !anchorEl) return
    const iconRect = anchorEl.getBoundingClientRect()
    const deskRect = desktop?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
      width: window.innerWidth,
      height: window.innerHeight,
    }

    overlayEl.style.display = "block"
    const ownRect = overlayEl.getBoundingClientRect()
    const gap = 8
    let left = iconRect.left + iconRect.width + gap
    if (left + ownRect.width > deskRect.right - 6) left = iconRect.left - ownRect.width - gap
    left = Math.max(deskRect.left + 6, left)
    let top = iconRect.top - 6
    if (top + ownRect.height > deskRect.bottom - 6) top = deskRect.bottom - ownRect.height - 6
    top = Math.max(deskRect.top + 6, top)
    overlayEl.style.left = `${Math.round(left)}px`
    overlayEl.style.top = `${Math.round(top)}px`
  }

  function splitLabel(title){
    const t = String(title || "").trim()
    if (!t) return ["", ""]
    if (t.length <= 12) return [t, ""]
    let cut = t.lastIndexOf(" ", 12)
    if (cut < 5) cut = 12
    const a = t.slice(0, cut).trim()
    const b0 = t.slice(cut).trim()
    const b = b0.length > 12 ? `${b0.slice(0, 11)}…` : b0
    return [a, b]
  }

  function glyphForMember(meta){
    const panelId = String(meta?.panelId || "")
    if (panelId === "soul") return "👻"
    if (panelId === "tools") return "🧰"
    if (panelId === "heartbeat") return "❤️"
    return "📄"
  }

  function showFolder(folderMeta, anchorEl, onOpen){
    const root = ensureOverlay()
    const items = Array.isArray(folderMeta?.items) ? folderMeta.items : []
    if (!items.length) {
      hideOverlay()
      return
    }
    root.innerHTML = `
      <div class="desktop-folder-title">${escapeHtml(folderMeta.title || "Folder")}</div>
      <div class="desktop-folder-grid">
        ${items.map(item => {
          const [line1, line2] = splitLabel(item.title)
          return `
            <button class="desktop-folder-icon" type="button" data-folder-item-id="${escapeHtml(item.id)}">
              <span class="desktop-folder-icon-glyph">${escapeHtml(item.glyph || "📄")}</span>
              <span class="desktop-folder-icon-label">
                <span class="desktop-folder-icon-line">${escapeHtml(line1)}</span>
                <span class="desktop-folder-icon-line">${escapeHtml(line2)}</span>
              </span>
            </button>
          `
        }).join("")}
      </div>
    `
    positionOverlay(anchorEl)
    activeFolderId = String(folderMeta.folderId || "")
    activeAnchor = anchorEl
    root.querySelectorAll("[data-folder-item-id]").forEach(node => {
      node.addEventListener("click", (e) => {
        e.preventDefault()
        const id = node.getAttribute("data-folder-item-id") || ""
        hideOverlay()
        onOpen?.(id)
      })
    })
  }

  function toggle(folderMeta, anchorEl, onOpen){
    const folderId = String(folderMeta?.folderId || "")
    if (!folderId) return
    if (activeFolderId === folderId && overlayEl?.style.display !== "none") {
      hideOverlay()
      return
    }
    showFolder(folderMeta, anchorEl, onOpen)
  }

  function transform(order, metaById){
    const nextOrder = Array.isArray(order) ? order.slice() : []
    const nextMeta = new Map(metaById || [])

    for (const def of folderDefs.values()) {
      const memberSet = new Set(def.memberPanelIds || [])
      if (!memberSet.size) continue
      const memberIds = nextOrder.filter(id => {
        const meta = nextMeta.get(id)
        return meta && memberSet.has(String(meta.panelId || ""))
      })
      if (!memberIds.length) continue
      const firstIdx = nextOrder.findIndex(id => memberIds.includes(id))
      const folderId = `folder:${def.id}`
      const items = memberIds.map(id => {
        const meta = nextMeta.get(id) || {}
        return { id, title: String(meta.title || id), glyph: glyphForMember(meta) }
      })
      for (const id of memberIds) {
        const idx = nextOrder.indexOf(id)
        if (idx >= 0) nextOrder.splice(idx, 1)
        nextMeta.delete(id)
      }
      const insertAt = Math.max(0, Math.min(firstIdx, nextOrder.length))
      nextOrder.splice(insertAt, 0, folderId)
      nextMeta.set(folderId, {
        kind: "folder",
        title: def.title,
        glyph: def.glyph,
        folderId,
        items,
      })
    }

    return { order: nextOrder, metaById: nextMeta }
  }

  document.addEventListener("pointerdown", (e) => {
    if (!overlayEl || overlayEl.style.display === "none") return
    const target = e.target
    if (overlayEl.contains(target)) return
    if (activeAnchor && activeAnchor.contains(target)) return
    hideOverlay()
  }, true)
  window.addEventListener("resize", () => {
    if (!overlayEl || overlayEl.style.display === "none" || !activeAnchor) return
    positionOverlay(activeAnchor)
  })

  return {
    transform,
    toggle,
    hideOverlay,
    registerFolder,
    setFolders,
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
