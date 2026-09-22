import fs from 'node:fs';
import { type DiscoveredMcpServer, parseServerMap } from '@shared/mcpConfig';
import { parse as parseToml } from 'smol-toml';

export type { DiscoveredMcpServer };
export { parseServerMap };

/** Claude Code (~/.claude.json)：合并全局与各项目下的 mcpServers */
export function readClaudeMcp(file: string): DiscoveredMcpServer[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    mcpServers?: unknown;
    projects?: Record<string, { mcpServers?: unknown }>;
  };

  const servers = parseServerMap(raw.mcpServers);
  const seen = new Set(servers.map((server) => server.name));

  for (const project of Object.values(raw.projects ?? {})) {
    for (const server of parseServerMap(project?.mcpServers)) {
      if (seen.has(server.name)) continue;
      seen.add(server.name);
      servers.push(server);
    }
  }

  return servers;
}

/** Claude Desktop / Cursor：{ mcpServers: {...} } */
export function readJsonMcp(file: string): DiscoveredMcpServer[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { mcpServers?: unknown };
  return parseServerMap(raw.mcpServers);
}

/** Codex (~/.codex/config.toml)：[mcp_servers.<name>] */
export function readCodexMcp(file: string): DiscoveredMcpServer[] {
  const raw = parseToml(fs.readFileSync(file, 'utf8')) as { mcp_servers?: unknown };
  return parseServerMap(raw.mcp_servers);
}
