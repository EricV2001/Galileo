import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

import {
  ensureVaultDirs,
  writeDigestNote,
  writeSynthesisNote,
  writeEntityNote,
} from './obsidian-writer.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('obsidian-writer', () => {
  const vault = '/tmp/test-vault';

  describe('writeDigestNote', () => {
    it('creates the Digest directory and writes frontmatter with correct date', () => {
      writeDigestNote(vault, '2026-03-11', 'A summary.', 5);

      expect(mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('Galileo/Digest'),
        { recursive: true },
      );

      const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = written[1] as string;
      expect(written[0]).toContain('2026-03-11.md');
      expect(content).toContain('---');
      expect(content).toContain('date: "2026-03-11"');
      expect(content).toContain('source: galileo-consolidation');
      expect(content).toContain('episode_count: 5');
      expect(content).toContain('# Galileo Daily Digest — 2026-03-11');
      expect(content).toContain('A summary.');
    });
  });

  describe('writeSynthesisNote', () => {
    it('writes YAML frontmatter with week, date_range, and source', () => {
      writeSynthesisNote(vault, 'W11-2026', 'Mar 9–Mar 15', 'Insights here.', 12);

      const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = written[1] as string;
      expect(written[0]).toContain('W11-2026.md');
      expect(content).toContain('week: "W11-2026"');
      expect(content).toContain('date_range: "Mar 9–Mar 15"');
      expect(content).toContain('source: galileo-synthesis');
      expect(content).toContain('episode_count: 12');
    });
  });

  describe('writeEntityNote', () => {
    const entity = {
      name: 'Neo4j',
      type: 'technology',
      summary: 'A graph database.',
      createdAt: '2026-03-10',
    };

    it('writes frontmatter with name, type, created_at, and source', () => {
      writeEntityNote(vault, entity, []);

      const written = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const content = written[1] as string;
      expect(content).toContain('name: "Neo4j"');
      expect(content).toContain('type: "technology"');
      expect(content).toContain('created_at: "2026-03-10"');
      expect(content).toContain('source: galileo');
    });

    it('includes wikilinks when relations are provided', () => {
      const relations = [
        { relatedName: 'Graphiti', fact: 'uses' },
        { relatedName: 'Cypher', fact: 'query language' },
      ];
      writeEntityNote(vault, entity, relations);

      const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(content).toContain('## Relationships');
      expect(content).toContain('[[Graphiti]]');
      expect(content).toContain('[[Cypher]]');
    });

    it('omits Relationships section when no relations', () => {
      writeEntityNote(vault, entity, []);

      const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(content).not.toContain('## Relationships');
    });
  });

  describe('ensureVaultDirs', () => {
    it('creates Digest, Entities, and Insights subdirectories', () => {
      ensureVaultDirs(vault);

      const calls = (mkdirSync as ReturnType<typeof vi.fn>).mock.calls.map(
        (c) => c[0] as string,
      );
      expect(calls).toHaveLength(3);
      expect(calls.some((p) => p.endsWith('Galileo/Digest'))).toBe(true);
      expect(calls.some((p) => p.endsWith('Galileo/Entities'))).toBe(true);
      expect(calls.some((p) => p.endsWith('Galileo/Insights'))).toBe(true);
    });
  });

  describe('filename sanitization', () => {
    it('replaces special characters with underscores', () => {
      const entity = {
        name: 'foo/bar:baz',
        type: 'test',
        summary: '',
        createdAt: '2026-01-01',
      };
      writeEntityNote(vault, entity, []);

      const writtenPath = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(writtenPath).toContain('foo_bar_baz.md');
      expect(writtenPath).not.toContain('/bar:');
    });
  });

  describe('YAML escaping', () => {
    it('replaces double quotes with single quotes in frontmatter values', () => {
      const entity = {
        name: 'He said "hello"',
        type: 'quote',
        summary: '',
        createdAt: '2026-01-01',
      };
      writeEntityNote(vault, entity, []);

      const content = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      expect(content).toContain("name: \"He said 'hello'\"");
      expect(content).not.toContain('""');
    });
  });
});
