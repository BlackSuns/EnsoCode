import { bindingToAccelerator, resolveTrayToggleBinding } from '@shared/keybindingAccelerator';
import { globalShortcut } from 'electron';

let registered: string | null = null;
let toggle: () => void = () => {};

export function setTrayToggleHandler(handler: () => void): void {
  toggle = handler;
}

export function syncTrayToggleShortcut(keybindings: unknown): void {
  if (!globalShortcut || typeof globalShortcut.register !== 'function') return;
  const accelerator = bindingToAccelerator(resolveTrayToggleBinding(keybindings));
  if (registered === accelerator) return;
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {
      // 热键可能已经被系统丢掉
    }
    registered = null;
  }
  if (!accelerator) return;
  try {
    if (globalShortcut.register(accelerator, () => toggle())) registered = accelerator;
    else console.warn('[tray] failed to register toggle shortcut', accelerator);
  } catch (error) {
    registered = null;
    console.warn('[tray] failed to register toggle shortcut', { accelerator, error });
  }
}

export function stopTrayToggleShortcut(): void {
  if (!registered || !globalShortcut || typeof globalShortcut.unregister !== 'function') {
    registered = null;
    return;
  }
  globalShortcut.unregister(registered);
  registered = null;
}
