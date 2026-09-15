import { useEffect, useMemo, useState } from 'react';
import { resolveColorScheme } from '@/lib/colorScheme';
import { isTerminalThemeDark } from '@/lib/ghosttyTheme';
import { useSettingsStore } from '@/stores/settings';

function prefersDarkScheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 跟 html.dark 同一套判定，给 pierre diffs 的 themeType（它默认只跟 OS） */
export function useColorScheme() {
  const theme = useSettingsStore((s) => s.theme);
  const terminalTheme = useSettingsStore((s) => s.terminalTheme);
  const [prefersDark, setPrefersDark] = useState(prefersDarkScheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return resolveColorScheme(theme, {
    prefersDark,
    terminalIsDark: isTerminalThemeDark(terminalTheme),
  });
}

export function useCodeHighlightOptions<T extends object>(
  base: T
): T & { themeType: 'dark' | 'light' } {
  const themeType = useColorScheme();
  return useMemo(() => ({ ...base, themeType }), [base, themeType]);
}
