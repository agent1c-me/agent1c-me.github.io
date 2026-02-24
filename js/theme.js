import { DARK_MODE_KEY, THEME_KEY, WALLPAPER_KEY } from "./constants.js";

export function initThemeToggle({ button }){
  function apply(on){
    document.body.classList.toggle("dark", !!on);
    button.textContent = on ? "☀" : "☾";
  }

  const saved = localStorage.getItem(DARK_MODE_KEY);
  apply(saved === "1");

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = !document.body.classList.contains("dark");
    apply(on);
    localStorage.setItem(DARK_MODE_KEY, on ? "1" : "0");
  });
}

export function getTheme(){
  const raw = localStorage.getItem(THEME_KEY) || "hedgeyOS";
  return raw === "hedgey" ? "hedgeyOS" : raw;
}

function getDesktopEl(){
  return document.getElementById("desktop") || document.querySelector(".desktop");
}

function applyWallpaperToDesktop(dataUrl){
  const desktop = getDesktopEl();
  if (!desktop) return;
  if (dataUrl) {
    desktop.style.backgroundImage = `url("${String(dataUrl).replaceAll('"', '\\"')}")`;
    desktop.style.backgroundPosition = "center center";
    desktop.style.backgroundRepeat = "no-repeat";
    desktop.style.backgroundSize = "cover";
  } else {
    desktop.style.backgroundImage = "";
    desktop.style.backgroundPosition = "";
    desktop.style.backgroundRepeat = "";
    desktop.style.backgroundSize = "";
  }
}

export function getWallpaper(){
  const raw = localStorage.getItem(WALLPAPER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.dataUrl === "string") {
      return {
        name: typeof parsed.name === "string" ? parsed.name : "Wallpaper",
        dataUrl: parsed.dataUrl,
      };
    }
  } catch {}
  if (typeof raw === "string" && raw.startsWith("data:image/")) {
    return { name: "Wallpaper", dataUrl: raw };
  }
  return null;
}

export function getWallpaperName(){
  return getWallpaper()?.name || "";
}

export function applyWallpaper(wallpaper, { persist = true } = {}){
  let record = null;
  if (wallpaper && typeof wallpaper === "object") {
    const dataUrl = String(wallpaper.dataUrl || "").trim();
    if (dataUrl.startsWith("data:image/")) {
      record = {
        name: String(wallpaper.name || "Wallpaper").trim() || "Wallpaper",
        dataUrl,
      };
    }
  }
  applyWallpaperToDesktop(record?.dataUrl || "");
  if (persist) {
    if (record) localStorage.setItem(WALLPAPER_KEY, JSON.stringify(record));
    else localStorage.removeItem(WALLPAPER_KEY);
  }
  window.dispatchEvent(new CustomEvent("hedgey:wallpaper-changed", {
    detail: {
      name: record?.name || "",
      hasWallpaper: !!record,
    },
  }));
}

export function clearWallpaper(opts = {}){
  applyWallpaper(null, opts);
}

export function applyTheme(name, { persist = true } = {}){
  const allowed = ["beos", "system7", "greenscreen", "cyberpunk", "hedgeyOS"];
  const normalized = name === "hedgey" ? "hedgeyOS" : name;
  const theme = allowed.includes(normalized) ? normalized : "hedgeyOS";
  document.body.classList.toggle("beos", theme === "beos");
  document.body.classList.toggle("system7", theme === "system7");
  document.body.classList.toggle("greenscreen", theme === "greenscreen");
  document.body.classList.toggle("cyberpunk", theme === "cyberpunk");
  document.body.classList.toggle("hedgeyOS", theme === "hedgeyOS");
  if (persist) localStorage.setItem(THEME_KEY, theme);
}

export function initThemeState(){
  const saved = localStorage.getItem(THEME_KEY);
  if (!saved) {
    localStorage.setItem(THEME_KEY, "hedgeyOS");
    applyTheme("hedgeyOS", { persist: false });
  } else {
    applyTheme(getTheme(), { persist: false });
  }
  applyWallpaper(getWallpaper(), { persist: false });
}
