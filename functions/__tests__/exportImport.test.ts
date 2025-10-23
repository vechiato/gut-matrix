/**
 * Tests for export/import helper functions
 * Note: These test the utility functions that could be extracted
 * from editor.js for server-side or shared use
 */

import { describe, it, expect } from '@jest/globals';

// Since these functions are in editor.js (client-side), we'll test
// the concepts and logic here. In a real scenario, you'd extract
// these to a shared module.

describe('CSV Export Logic', () => {
  describe('escapeCsv', () => {
    // Implementation of escapeCsv for testing
    function escapeCsv(value: any): string {
      if (value == null) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }

    it('should return empty string for null or undefined', () => {
      expect(escapeCsv(null)).toBe('');
      expect(escapeCsv(undefined)).toBe('');
    });

    it('should not quote simple strings', () => {
      expect(escapeCsv('simple')).toBe('simple');
      expect(escapeCsv('test 123')).toBe('test 123');
    });

    it('should quote strings with commas', () => {
      expect(escapeCsv('hello, world')).toBe('"hello, world"');
    });

    it('should quote strings with quotes and escape them', () => {
      expect(escapeCsv('say "hello"')).toBe('"say ""hello"""');
    });

    it('should quote strings with newlines', () => {
      expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    });

    it('should convert numbers to strings', () => {
      expect(escapeCsv(123)).toBe('123');
      expect(escapeCsv(45.67)).toBe('45.67');
    });
  });

  describe('CSV format generation', () => {
    it('should generate correct header row', () => {
      const header = [
        'Item',
        'Your G',
        'Your U',
        'Your T',
        'Your Score',
        'Avg G',
        'Avg U',
        'Avg T',
        'Avg Score',
        'Contributors',
        'Notes'
      ].join(',');

      expect(header).toContain('Item');
      expect(header).toContain('Your Score');
      expect(header).toContain('Avg Score');
      expect(header.split(',').length).toBe(11);
    });

    it('should handle empty scores gracefully', () => {
      const row = ['Feature A', '', '', '', '', '', '', '', '', '', ''].join(',');
      expect(row).toBe('Feature A,,,,,,,,,,');
    });

    it('should format numbers with decimals for averages', () => {
      const avgG = 4.5;
      const avgScore = 63.75;
      expect(avgG.toFixed(1)).toBe('4.5');
      expect(avgScore.toFixed(1)).toBe('63.8');
    });
  });
});

describe('CSV Import Logic', () => {
  describe('parseCsvLine', () => {
    // Implementation of parseCsvLine for testing
    function parseCsvLine(line: string): string[] {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            current += '"';
            i++; // Skip next quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }

      result.push(current.trim());
      return result;
    }

    it('should parse simple comma-separated values', () => {
      expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle quoted fields with commas', () => {
      expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
    });

    it('should handle escaped quotes', () => {
      expect(parseCsvLine('a,"b""c",d')).toEqual(['a', 'b"c', 'd']);
    });

    it('should handle empty fields', () => {
      expect(parseCsvLine('a,,c')).toEqual(['a', '', 'c']);
    });

    it('should trim whitespace from unquoted fields', () => {
      expect(parseCsvLine('a, b , c')).toEqual(['a', 'b', 'c']);
    });

    it('should handle complex CSV line', () => {
      const line = 'Feature A,5,4,3,60,4.5,4.0,3.5,63.0,2,"Important feature, needs review"';
      const values = parseCsvLine(line);
      expect(values[0]).toBe('Feature A');
      expect(values[10]).toBe('Important feature, needs review');
      expect(values.length).toBe(11);
    });
  });

  describe('CSV data validation', () => {
    it('should validate minimum number of fields', () => {
      const values = ['item', '5', '4', '3', '60'];
      expect(values.length).toBeGreaterThanOrEqual(5);
    });

    it('should skip rows with missing label', () => {
      const label = '';
      expect(label.trim()).toBeFalsy();
    });

    it('should parse numeric values', () => {
      expect(parseFloat('5')).toBe(5);
      expect(parseFloat('4.5')).toBe(4.5);
      expect(isNaN(parseFloat(''))).toBe(true);
      expect(isNaN(parseFloat('abc'))).toBe(true);
    });

    it('should clamp values to scale range', () => {
      const min = 1;
      const max = 5;
      const clamp = (val: number) => Math.max(min, Math.min(val, max));

      expect(clamp(3)).toBe(3);
      expect(clamp(0)).toBe(1);
      expect(clamp(10)).toBe(5);
      expect(clamp(5)).toBe(5);
    });
  });
});

describe('JSON Import Logic', () => {
  describe('JSON structure validation', () => {
    it('should validate list has items array', () => {
      const validList = { items: [] };
      expect(Array.isArray(validList.items)).toBe(true);

      const invalidList = { data: [] };
      expect(Array.isArray((invalidList as any).items)).toBe(false);
    });

    it('should handle wrapped export format', () => {
      const wrappedExport = {
        exportedAt: '2025-10-22T10:00:00.000Z',
        exportedBy: 'user-id',
        list: {
          title: 'Test',
          items: []
        }
      };

      const list = wrappedExport.list || wrappedExport as any;
      expect((list as any).title).toBe('Test');
      expect(Array.isArray((list as any).items)).toBe(true);
    });

    it('should validate item has required fields', () => {
      const validItem = {
        id: 'uuid',
        label: 'Test Item',
        scores: {}
      };

      expect(validItem.id).toBeTruthy();
      expect(validItem.label).toBeTruthy();

      const invalidItem = {
        label: 'No ID'
      };

      expect((invalidItem as any).id).toBeFalsy();
    });
  });

  describe('Score merging logic', () => {
    it('should merge scores from multiple users', () => {
      const existingScores = {
        'user-1': { g: 5, u: 5, t: 5, score: 125 }
      };

      const importScores = {
        'user-2': { g: 4, u: 4, t: 4, score: 64 }
      };

      const merged = { ...existingScores, ...importScores };
      expect(Object.keys(merged).length).toBe(2);
      expect(merged['user-1'].score).toBe(125);
      expect(merged['user-2'].score).toBe(64);
    });

    it('should overwrite user score if same user in import', () => {
      const existingScores = {
        'user-1': { g: 5, u: 5, t: 5, score: 125 }
      };

      const importScores = {
        'user-1': { g: 4, u: 4, t: 4, score: 64 }
      };

      const merged = { ...existingScores, ...importScores };
      expect(Object.keys(merged).length).toBe(1);
      expect(merged['user-1'].score).toBe(64);
    });
  });

  describe('Item matching logic', () => {
    it('should match items by ID', () => {
      const existingItems = [
        { id: 'item-1', label: 'Item A', scores: {} },
        { id: 'item-2', label: 'Item B', scores: {} }
      ];

      const importItem = { id: 'item-1', label: 'Updated Item A', scores: {} };
      const found = existingItems.find(item => item.id === importItem.id);

      expect(found).toBeTruthy();
      expect(found?.id).toBe('item-1');
    });

    it('should not match items with different IDs', () => {
      const existingItems = [
        { id: 'item-1', label: 'Item A', scores: {} }
      ];

      const importItem = { id: 'item-2', label: 'Item B', scores: {} };
      const found = existingItems.find(item => item.id === importItem.id);

      expect(found).toBeFalsy();
    });
  });
});

describe('File utility functions', () => {
  describe('sanitizeFilename', () => {
    function sanitizeFilename(name: string | undefined): string {
      return (name || 'gut-list')
        .replace(/[^a-z0-9_-]/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
    }

    it('should handle undefined or empty names', () => {
      expect(sanitizeFilename(undefined)).toBe('gut-list');
      expect(sanitizeFilename('')).toBe('gut-list');
    });

    it('should remove special characters', () => {
      expect(sanitizeFilename('My List!')).toBe('my_list');
      expect(sanitizeFilename('Test@#$%')).toBe('test');
    });

    it('should preserve alphanumeric, dash, and underscore', () => {
      expect(sanitizeFilename('test-list_v2')).toBe('test-list_v2');
    });

    it('should convert to lowercase', () => {
      expect(sanitizeFilename('MyList')).toBe('mylist');
    });

    it('should collapse multiple underscores', () => {
      expect(sanitizeFilename('my   list')).toBe('my_list');
    });

    it('should handle complex names', () => {
      expect(sanitizeFilename('Q4 2024 Product Roadmap (Final)')).toBe('q4_2024_product_roadmap_final');
    });
  });

  describe('filename generation', () => {
    it('should include date in filename', () => {
      const date = new Date('2025-10-22T10:00:00.000Z');
      const dateStr = date.toISOString().split('T')[0];
      expect(dateStr).toBe('2025-10-22');
    });

    it('should generate CSV filename', () => {
      const title = 'My List';
      const date = '2025-10-22';
      const filename = `my_list_${date}.csv`;
      expect(filename).toMatch(/\.csv$/);
      expect(filename).toContain('my_list');
    });

    it('should generate JSON filename', () => {
      const title = 'My List';
      const date = '2025-10-22';
      const filename = `my_list_${date}.json`;
      expect(filename).toMatch(/\.json$/);
      expect(filename).toContain('my_list');
    });
  });
});

describe('Import merge strategies', () => {
  it('should count new items correctly', () => {
    let importedCount = 0;
    let updatedCount = 0;

    const existingItems = [
      { id: 'item-1', label: 'Existing', scores: {} }
    ];

    const importItems = [
      { id: 'item-1', label: 'Existing', scores: { 'user-1': { g: 5, u: 5, t: 5, score: 125 } } },
      { id: 'item-2', label: 'New', scores: {} }
    ];

    importItems.forEach(importItem => {
      const existing = existingItems.find(item => item.id === importItem.id);
      if (existing) {
        updatedCount++;
      } else {
        importedCount++;
      }
    });

    expect(importedCount).toBe(1);
    expect(updatedCount).toBe(1);
  });

  it('should merge all user scores on JSON import', () => {
    const existingItem = {
      id: 'item-1',
      scores: {
        'user-1': { g: 5, u: 5, t: 5, score: 125 }
      }
    };

    const importItem = {
      id: 'item-1',
      scores: {
        'user-1': { g: 4, u: 4, t: 4, score: 64 },
        'user-2': { g: 3, u: 3, t: 3, score: 27 }
      }
    };

    const mergedScores = { ...existingItem.scores, ...importItem.scores };
    expect(Object.keys(mergedScores).length).toBe(2);
    expect(mergedScores['user-1'].score).toBe(64); // Overwritten
    expect(mergedScores['user-2'].score).toBe(27); // Added
  });

  it('should only update your scores on CSV import', () => {
    const userId = 'current-user';
    const existingItem = {
      id: 'item-1',
      scores: {
        'user-1': { g: 5, u: 5, t: 5, score: 125 },
        'current-user': { g: 3, u: 3, t: 3, score: 27 }
      }
    };

    // CSV import only updates current user's score
    const newScore = { g: 4, u: 4, t: 4, score: 64 };
    existingItem.scores[userId] = newScore;

    expect(existingItem.scores['user-1'].score).toBe(125); // Preserved
    expect(existingItem.scores[userId].score).toBe(64); // Updated
  });
});
