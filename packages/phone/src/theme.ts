import type { HostAppearance } from '@enso/pair';
import { applyTerminalThemeToApp, clearTerminalThemeFromApp } from './stubs/ghostty-theme';
import { setAppearanceTheme } from './stubs/settings-store';
import { cssColorToHex, stampThemeColorMetas } from './themeColor';
import { settingsThemeFromPhone, type ThemePreference } from './themePreference';

/**
 * 主题优先级：本地覆盖 > 桌面下发 > 跟随系统。
 * 一旦用户在手机上显式选过，就不再被桌面的主题变更打断。
 * sync-terminal 与桌面同语义：整套 UI 配色由终端调色板推导。
 */

export type { ThemePreference } from './themePreference';

const OVERRIDE_KEY = 'enso-phone-theme';

let hostTheme: HostAppearance = 'system';
let override: ThemePreference = readOverride();
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function readOverride(): ThemePreference {
  const raw = localStorage.getItem(OVERRIDE_KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}

/**
 * 让 Safari 的状态栏/工具栏底色跟随页面。写死的 theme-color 在主题切换后
 * 会与页面对不上，表现为上下两条系统灰边。
 *
 * iOS 独立 PWA 只在启动时认新插入的 meta，运行中必须改已有节点的 content。
 * 颜色用 #rrggbb：rgb()/oklch() 它不刷新额头。
 */
function syncThemeColorMeta(): void {
  requestAnimationFrame(() => {
    const computed =
      getComputedStyle(document.documentElement).backgroundColor ||
      getComputedStyle(document.body).backgroundColor;
    const hex = cssColorToHex(computed);
    if (!hex) return;
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.prepend(meta);
      metas.push(meta);
    }
    stampThemeColorMetas(metas, hex);
  });
}

function apply(): void {
  // 本地覆盖优先，且覆盖时不套终端配色（用户要的是明确的浅/深）
  if (override !== 'auto') {
    clearTerminalThemeFromApp();
    document.documentElement.classList.toggle('dark', override === 'dark');
  } else if (hostTheme === 'sync-terminal') {
    applyTerminalThemeToApp(undefined, true);
  } else {
    clearTerminalThemeFromApp();
    const dark = hostTheme === 'system' ? media.matches : hostTheme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
  }
  for (const listener of listeners) listener();
  syncThemeColorMeta();
  const appearance = settingsThemeFromPhone(override, hostTheme);
  setAppearanceTheme(appearance.theme, appearance.syncTerminalTheme);
}

/** 桌面下发的偏好（仅在未本地覆盖时生效） */
export function setHostTheme(theme: HostAppearance): void {
  hostTheme = theme;
  apply();
}

/** 终端调色板更新后需重算（sync-terminal 依赖它） */
export function refreshTheme(): void {
  apply();
}

export function getThemePreference(): ThemePreference {
  return override;
}

export function setThemePreference(next: ThemePreference): void {
  override = next;
  if (next === 'auto') localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, next);
  apply();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initTheme(): void {
  apply();
  media.addEventListener('change', apply);
}
