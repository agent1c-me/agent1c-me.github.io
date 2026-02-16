export function animateWindowCloseMatrix(win, opts = {}){
  if (!win || !(win instanceof HTMLElement)) return Promise.resolve();
  if (!document.body.contains(win)) return Promise.resolve();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return Promise.resolve();

  const rect = win.getBoundingClientRect();
  if (!rect.width || !rect.height) return Promise.resolve();

  const color = String(opts.color || "#ff4fb8");
  const glow = String(opts.glow || "rgba(255, 79, 184, 0.65)");
  const duration = Math.max(220, Math.min(700, Number(opts.durationMs) || 360));

  const layer = document.createElement("div");
  layer.style.position = "fixed";
  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  layer.style.zIndex = "10000";
  layer.style.pointerEvents = "none";
  layer.style.overflow = "hidden";
  layer.style.border = getComputedStyle(win).border || "1px solid rgba(0,0,0,0.35)";
  layer.style.boxShadow = getComputedStyle(win).boxShadow || "0 2px 8px rgba(0,0,0,0.25)";
  layer.style.background = "rgba(6, 0, 10, 0.94)";
  layer.style.transformOrigin = "top center";
  layer.style.backdropFilter = "blur(0.5px)";

  const chars = "01アイウエオカキクケコサシスセソナニヌネノマミムメモラリルレロ";
  const colWidth = 12;
  const cols = Math.max(8, Math.min(96, Math.floor(rect.width / colWidth)));
  const rain = document.createElement("div");
  rain.style.position = "absolute";
  rain.style.inset = "0";
  rain.style.fontFamily = "monospace";
  rain.style.fontSize = "11px";
  rain.style.fontWeight = "700";
  rain.style.lineHeight = "12px";
  rain.style.color = color;
  rain.style.textShadow = `0 0 6px ${glow}, 0 0 12px ${glow}`;

  for (let i = 0; i < cols; i += 1) {
    const stream = document.createElement("div");
    const len = 8 + Math.floor(Math.random() * 12);
    let text = "";
    for (let j = 0; j < len; j += 1) text += chars[Math.floor(Math.random() * chars.length)];
    stream.textContent = text;
    stream.style.position = "absolute";
    stream.style.left = `${i * colWidth}px`;
    stream.style.top = `${-Math.random() * rect.height}px`;
    stream.style.opacity = `${0.72 + Math.random() * 0.28}`;
    rain.appendChild(stream);

    stream.animate(
      [
        { transform: "translateY(0px)", opacity: stream.style.opacity },
        { transform: `translateY(${rect.height + 48}px)`, opacity: "0.05" },
      ],
      {
        duration: duration * (0.72 + Math.random() * 0.75),
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
  sweep.style.background = `linear-gradient(to bottom, rgba(255,255,255,0) 0%, ${glow} 55%, rgba(0,0,0,0) 100%)`;
  sweep.style.mixBlendMode = "screen";
  sweep.style.opacity = "0.0";

  layer.appendChild(rain);
  layer.appendChild(sweep);
  document.body.appendChild(layer);

  const layerAnim = layer.animate(
    [
      { opacity: 1, filter: "brightness(1) blur(0px)", clipPath: "inset(0 0 0 0)" },
      { opacity: 0.92, filter: "brightness(1.2) blur(0.4px)", clipPath: "inset(0 0 0 0)" },
      { opacity: 0.0, filter: "brightness(0.6) blur(1.4px)", clipPath: "inset(88% 0 0 0)" },
    ],
    { duration, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" },
  );

  sweep.animate(
    [
      { transform: "translateY(-100%)", opacity: 0.0 },
      { transform: "translateY(15%)", opacity: 0.62 },
      { transform: "translateY(105%)", opacity: 0.0 },
    ],
    { duration: duration * 0.86, easing: "ease-out", fill: "forwards" },
  );

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      layer.remove();
      resolve();
    };
    const t = setTimeout(finish, duration + 120);
    layerAnim.addEventListener("finish", () => {
      clearTimeout(t);
      finish();
    }, { once: true });
  });
}
