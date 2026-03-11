/**
 * Obsidian vault writer — creates Markdown notes with YAML frontmatter.
 *
 * Used by consolidation.ts to write digest, synthesis, and entity notes
 * to the configured Obsidian vault.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { logger } from '../logger.js';

// -- Helpers ----------------------------------------------------------------

function safe(value: string): string {
  return value.replace(/"/g, "'");
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// -- Public API -------------------------------------------------------------

/** Create the standard vault directory structure. */
export function ensureVaultDirs(vaultPath: string): void {
  ensureDir(join(vaultPath, 'Galileo', 'Digest'));
  ensureDir(join(vaultPath, 'Galileo', 'Entities'));
  ensureDir(join(vaultPath, 'Galileo', 'Insights'));
}

/** Write a daily digest note to <vault>/Galileo/Digest/<date>.md */
export function writeDigestNote(
  vaultPath: string,
  date: string,
  summary: string,
  episodeCount: number,
): void {
  const dir = join(vaultPath, 'Galileo', 'Digest');
  ensureDir(dir);

  const content =
    `---\ndate: "${safe(date)}"\nsource: galileo-consolidation\nepisode_count: ${episodeCount}\n---\n\n` +
    `# Galileo Daily Digest — ${date}\n\n${summary}\n`;

  const notePath = join(dir, `${date}.md`);
  writeFileSync(notePath, content, 'utf-8');
  logger.info({ path: notePath }, 'Digest note written');
}

/** Write a weekly synthesis note to <vault>/Galileo/Insights/<weekStr>.md */
export function writeSynthesisNote(
  vaultPath: string,
  weekStr: string,
  dateRange: string,
  synthesis: string,
  episodeCount: number,
): void {
  const dir = join(vaultPath, 'Galileo', 'Insights');
  ensureDir(dir);

  const content =
    `---\nweek: "${safe(weekStr)}"\ndate_range: "${safe(dateRange)}"\nsource: galileo-synthesis\nepisode_count: ${episodeCount}\n---\n\n` +
    `# Weekly Insight Synthesis — ${weekStr}\n\n${synthesis}\n`;

  const notePath = join(dir, `${weekStr}.md`);
  writeFileSync(notePath, content, 'utf-8');
  logger.info({ path: notePath }, 'Synthesis note written');
}

/** Write an entity note to <vault>/Galileo/Entities/<name>.md */
export function writeEntityNote(
  vaultPath: string,
  entity: { name: string; type: string; summary: string; createdAt: string },
  relations: Array<{ relatedName: string; fact: string }>,
): void {
  const dir = join(vaultPath, 'Galileo', 'Entities');
  ensureDir(dir);

  const frontmatter =
    `---\nname: "${safe(entity.name)}"\ntype: "${safe(entity.type)}"\n` +
    `created_at: "${safe(entity.createdAt)}"\nsource: galileo\n---\n`;

  const lines: string[] = [`# ${entity.name}\n`];
  if (entity.summary) {
    lines.push(`${entity.summary}\n`);
  }

  if (relations.length > 0) {
    lines.push('\n## Relationships\n');
    for (const rel of relations) {
      lines.push(`- ${rel.fact} → [[${rel.relatedName}]]`);
    }
  }

  const content = frontmatter + '\n' + lines.join('\n') + '\n';
  const filename = sanitizeFilename(entity.name);
  const notePath = join(dir, `${filename}.md`);
  writeFileSync(notePath, content, 'utf-8');
}
