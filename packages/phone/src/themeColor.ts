/** iOS 状态栏只认 #rrggbb；rgb()/oklch() 换了也不刷新额头。 */

const HEX_RE = /^#([\da-f]{3}|[\da-f]{6})$/i;
const RGB_COMMA_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)$/i;
const RGB_SPACE_RE = /^rgba?\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i;

function nibble(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex(r: number, g: number, b: number, alpha?: string): string | null {
  if (alpha !== undefined) {
    const raw = alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
    if (!(raw > 0)) return null;
  }
  return `#${nibble(r)}${nibble(g)}${nibble(b)}`;
}

function canvasToHex(color: string): string | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return null;
    return rgbToHex(r, g, b);
  } catch {
    return null;
  }
}

export function cssColorToHex(color: string): string | null {
  const value = color.trim();
  const hex = HEX_RE.exec(value);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
    }
    return `#${h.toLowerCase()}`;
  }
  const rgb = RGB_COMMA_RE.exec(value) ?? RGB_SPACE_RE.exec(value);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4]);
  return canvasToHex(value);
}

/** 改已有节点的 content，iOS 对删了重插的 meta 在运行中不再采样。 */
export function stampThemeColorMetas(
  metas: Array<{
    removeAttribute(name: string): void;
    setAttribute(name: string, value: string): void;
  }>,
  hex: string
): void {
  for (const meta of metas) {
    meta.removeAttribute('media');
    meta.setAttribute('content', hex);
  }
}
