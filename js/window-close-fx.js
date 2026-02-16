export function animateWindowCloseMatrix(win, opts = {}){
  if (!win || !(win instanceof HTMLElement)) return Promise.resolve();
  if (!document.body.contains(win)) return Promise.resolve();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return Promise.resolve();

  const rect = win.getBoundingClientRect();
  if (!rect.width || !rect.height) return Promise.resolve();

  const color = String(opts.color || "#ff4fb8");
  const glow = String(opts.glow || "rgba(255, 79, 184, 0.65)");
  const duration = Math.max(420, Math.min(1200, Number(opts.durationMs) || 760));

  const layer = document.createElement("div");
  layer.style.position = "fixed";
  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  layer.style.zIndex = "10000";
  layer.style.pointerEvents = "none";
  layer.style.overflow = "hidden";
  layer.style.background = "transparent";
  layer.style.transformOrigin = "top center";

  const windowGhost = win.cloneNode(true);
  windowGhost.style.position = "absolute";
  windowGhost.style.left = "0";
  windowGhost.style.top = "0";
  windowGhost.style.width = "100%";
  windowGhost.style.height = "100%";
  windowGhost.style.margin = "0";
  windowGhost.style.minWidth = "0";
  windowGhost.style.minHeight = "0";
  windowGhost.style.maxWidth = "none";
  windowGhost.style.maxHeight = "none";
  windowGhost.style.pointerEvents = "none";
  windowGhost.style.transform = "none";
  windowGhost.style.opacity = "0.95";
  windowGhost.style.overflow = "hidden";
  layer.appendChild(windowGhost);
  const prevVisibility = win.style.visibility;
  win.style.visibility = "hidden";

  const chars = "01アイウエオカキクケコサシスセソナニヌネノマミムメモラリルレロ";
  const colWidth = 12;
  const cols = Math.max(8, Math.min(96, Math.floor(rect.width / colWidth)));
  const rain = document.createElement("div");
  rain.style.position = "absolute";
  rain.style.inset = "0";
  rain.style.fontFamily = "monospace";
  rain.style.fontSize = "13px";
  rain.style.fontWeight = "700";
  rain.style.lineHeight = "13px";
  rain.style.color = color;
  rain.style.textShadow = `0 0 2px ${glow}, 0 0 8px ${glow}`;
  rain.style.mixBlendMode = "screen";
  rain.style.opacity = "0.98";

  for (let i = 0; i < cols; i += 1) {
    const stream = document.createElement("div");
    const len = 14 + Math.floor(Math.random() * 26);
    let text = "";
    for (let j = 0; j < len; j += 1) {
      text += chars[Math.floor(Math.random() * chars.length)];
      if (j < len - 1) text += "\n";
    }
    stream.textContent = text;
    stream.style.position = "absolute";
    stream.style.left = `${Math.floor(i * (rect.width / cols))}px`;
    stream.style.top = `${-Math.random() * (rect.height * 1.2)}px`;
    stream.style.whiteSpace = "pre";
    stream.style.width = `${colWidth}px`;
    stream.style.textAlign = "center";
    stream.style.opacity = `${0.82 + Math.random() * 0.18}`;
    rain.appendChild(stream);

    stream.animate(
      [
        { transform: "translateY(0px)", opacity: stream.style.opacity },
        { transform: `translateY(${rect.height + 80}px)`, opacity: "0.05" },
      ],
      {
        duration: duration * (0.95 + Math.random() * 0.55),
        easing: "linear",
        fill: "forwards",
      },
    );
  }

  const sweep = document.createElement("div");
  sweep.style.position = "absolute";
  sweep.style.left = "0";
  sweep.style.right = "0";
  sweep.style.top = "0";
  sweep.style.height = "100%";
  sweep.style.background = `linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${glow} 55%, rgba(255,255,255,0) 100%)`;
  sweep.style.mixBlendMode = "screen";
  sweep.style.opacity = "0.0";

  layer.appendChild(rain);
  layer.appendChild(sweep);
  document.body.appendChild(layer);

  windowGhost.animate(
    [
      { opacity: 0.95, filter: "brightness(1) blur(0px)" },
      { opacity: 0.45, filter: "brightness(0.7) blur(0.4px)" },
      { opacity: 0.0, filter: "brightness(0.45) blur(1.2px)" },
    ],
    { duration: duration * 0.72, easing: "ease-out", fill: "forwards" },
  );

  const layerAnim = layer.animate(
    [
      { opacity: 1, filter: "brightness(1) blur(0px)", clipPath: "inset(0 0 0 0)" },
      { opacity: 1, filter: "brightness(1.15) blur(0px)", clipPath: "inset(0 0 0 0)" },
      { opacity: 0.88, filter: "brightness(1.05) blur(0.2px)", clipPath: "inset(0 0 0 0)" },
      { opacity: 0.0, filter: "brightness(0.65) blur(1.2px)", clipPath: "inset(0 0 88% 0)" },
    ],
    { duration, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" },
  );

  sweep.animate(
    [
      { transform: "translateY(-100%)", opacity: 0.0 },
      { transform: "translateY(25%)", opacity: 0.72 },
      { transform: "translateY(115%)", opacity: 0.0 },
    ],
    { duration: duration * 0.92, delay: duration * 0.12, easing: "ease-out", fill: "forwards" },
  );

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      layer.remove();
      if (opts?.restoreTargetVisibility) {
        win.style.visibility = prevVisibility;
      }
      resolve();
    };
    const t = setTimeout(finish, duration + 240);
    layerAnim.addEventListener("finish", () => {
      clearTimeout(t);
      finish();
    }, { once: true });
  });
}
