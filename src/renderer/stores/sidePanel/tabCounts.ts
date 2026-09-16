export type SidePanelTabCounts = { browsers: number; terminals: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBrowserId(id: unknown): boolean {
  return id === 'browser' || (typeof id === 'string' && id.startsWith('browser:'));
}

function panelKind(panel: Record<string, unknown>): string | undefined {
  if (typeof panel.contentComponent === 'string') return panel.contentComponent;
  if (typeof panel.component === 'string') return panel.component;
  return undefined;
}

export function countSidePanelTabs(layout: unknown): SidePanelTabCounts {
  if (!isRecord(layout) || !isRecord(layout.panels)) return { browsers: 0, terminals: 0 };
  let browsers = 0;
  let terminals = 0;
  for (const [key, panel] of Object.entries(layout.panels)) {
    if (!isRecord(panel)) continue;
    const kind = panelKind(panel);
    if (kind === 'browser' || isBrowserId(panel.id) || isBrowserId(key)) browsers += 1;
    else if (kind === 'terminal') terminals += 1;
  }
  return { browsers, terminals };
}
