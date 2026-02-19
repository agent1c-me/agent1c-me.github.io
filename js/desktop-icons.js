export function createDesktopIcons({ iconLayer, desktop }){
  const icons = new Map();

  function splitTitleTwoLines(title){
    const t = (title || "").trim();
    if (!t) return ["", ""];
    const max1 = 14;
    const max2 = 14;
    if (t.length <= max1) return [t, ""];
    let cut = t.lastIndexOf(" ", max1);
    if (cut < 6) cut = max1;
    let line1 = t.slice(0, cut).trim();
    let rest = t.slice(cut).trim();
    if (rest.length <= max2) return [line1, rest];
    let line2 = rest.slice(0, Math.max(0, max2 - 1)).trimEnd() + "…";
    return [line1, line2];
  }

  function computePositions(count){
    const cs = getComputedStyle(document.documentElement);
    const cellW = parseInt(cs.getPropertyValue("--icon-cell-w"), 10) || 92;
    const cellH = parseInt(cs.getPropertyValue("--icon-cell-h"), 10) || 86;
    const pad = parseInt(cs.getPropertyValue("--icon-pad"), 10) || 10;

    const dw = desktop.clientWidth;
    const dh = desktop.clientHeight;

    const cols = Math.max(1, Math.floor((dw - pad) / cellW));
    const positions = [];

    for (let i = 0; i < count; i++){
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * cellW;
      const y = dh - pad - cellH - row * cellH;
      positions.push({ x, y });
    }
    return positions;
  }

  function glyphForKind(kind, meta){
    if (kind === "folder") return String(meta?.glyph || "🗂️");
    if (kind === "files") return "📂";
    if (kind === "notes") return "📑";
    if (kind === "note") return "📝";
    if (kind === "browser") return "🌐";
    if (kind === "app" && /(agent1c:|chat|ai apis|openai api|telegram api|loop|config|shell relay|soul\.md|tools\.md|heartbeat\.md|events|create vault|unlock vault)/i.test(meta?.title || "")) {
      const title = (meta?.title || "").toLowerCase();
      if (title.includes("shell relay")) return "🖥️";
      if (title.includes("heartbeat")) return "❤️";
      if (title.includes("soul")) return "👻";
      if (title.includes("tools")) return "🧰";
      if (title.includes("events")) return "📓";
      if (title.includes("chat")) return "💬";
      if (title.includes("ai apis") || title.includes("openai")) return "🧠";
      if (title.includes("telegram")) return "✈️";
      if (title.includes("config") || title.includes("loop")) return "🛠️";
      if (title.includes("create vault")) return "🗝️";
      if (title.includes("unlock")) return "🔓";
      return "👁️";
    }
    if (kind === "app" && /terminal/i.test(meta?.title || "")) return "⌨️";
    if (kind === "file") {
      const type = (meta?.type || "").toLowerCase();
      const ext = (meta?.ext || "").toLowerCase();
      if (type.startsWith("image/") || ["png","jpg","jpeg","gif","webp","bmp","svg"].includes(ext)) return "🖼️";
      if (type.startsWith("video/") || ["mp4","webm","mov"].includes(ext)) return "🎞️";
      if (type.startsWith("audio/") || ["mp3","wav","ogg"].includes(ext)) return "🎵";
      if (type === "application/pdf" || ext === "pdf") return "📄";
      if (["zip","rar","7z","tar","gz"].includes(ext)) return "🗜️";
      return "📦";
    }
    return "📔";
  }

  function ensureIcon(id, title, kind, meta, onClick){
    let el = icons.get(id);
    if (!el){
      el = document.createElement("div");
      el.className = "desk-icon";
      el.dataset.winId = id;

      const glyph = document.createElement("div");
      glyph.className = "glyph";
      el.appendChild(glyph);

      const label = document.createElement("div");
      label.className = "label";
      const l1 = document.createElement("div");
      l1.className = "line";
      const l2 = document.createElement("div");
      l2.className = "line";
      label.appendChild(l1);
      label.appendChild(l2);
      el.appendChild(label);

      el.addEventListener("click", (e) => { e.stopPropagation(); onClick?.(id, el); });

      iconLayer.appendChild(el);
      icons.set(id, el);
    }

    el.querySelector(".glyph").textContent = glyphForKind(kind, meta);
    const [a, b] = splitTitleTwoLines(title);
    const lines = el.querySelectorAll(".line");
    lines[0].textContent = a;
    lines[1].textContent = b;

    return el;
  }

  function removeIcon(id){
    const el = icons.get(id);
    if (el) el.remove();
    icons.delete(id);
  }

  function render(order, metaById, onClick){
    const positions = computePositions(order.length);

    for (let i = 0; i < order.length; i++){
      const id = order[i];
      const meta = metaById.get(id);
      if (!meta) continue;
      const el = ensureIcon(id, meta.title, meta.kind, meta, onClick);
      el.style.left = positions[i].x + "px";
      el.style.top = positions[i].y + "px";
    }

    for (const existingId of Array.from(icons.keys())){
      if (!metaById.has(existingId)) removeIcon(existingId);
    }
  }

  return { render, removeIcon };
}
