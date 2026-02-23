/**
 * Unit tests for chatContentParser utilities.
 */
import { describe, it, expect } from 'vitest';
import {
  stripToolArtifacts,
  splitInlineToolCalls,
  parseToolCall,
  extractToolResults,
} from '../../src/utils/chatContentParser';

describe('stripToolArtifacts', () => {
  it('removes ## Tool Execution Results sections', () => {
    const text = 'Hello world\n\n## Tool Execution Results\n### readFile [OK]\ncontents here\n\nMore text';
    const result = stripToolArtifacts(text);
    expect(result).not.toContain('Tool Execution Results');
    expect(result).toContain('Hello world');
  });

  it('removes standalone ### toolname [OK] headers', () => {
    const text = 'Before\n\n### readFile [OK]\nresult content\n\nAfter paragraph';
    const result = stripToolArtifacts(text);
    expect(result).not.toContain('### readFile');
  });

  it('collapses excessive newlines', () => {
    const text = 'Line 1\n\n\n\n\nLine 2';
    const result = stripToolArtifacts(text);
    expect(result).toBe('Line 1\n\nLine 2');
  });

  it('returns text unchanged when no artifacts present', () => {
    const text = 'Just regular text\nwith newlines';
    expect(stripToolArtifacts(text)).toBe(text);
  });
});

describe('parseToolCall', () => {
  it('parses valid tool JSON with "tool" key', () => {
    const json = '{ "tool": "readFile", "params": { "path": "/test.txt" } }';
    const result = parseToolCall(json);
    expect(result).toEqual({ tool: 'readFile', params: { path: '/test.txt' } });
  });

  it('parses valid tool JSON with "name" key', () => {
    const json = '{ "name": "writeFile", "arguments": { "path": "/test.txt" } }';
    const result = parseToolCall(json);
    expect(result).toEqual({ tool: 'writeFile', params: { path: '/test.txt' } });
  });

  it('returns null for invalid JSON', () => {
    expect(parseToolCall('not json at all')).toBeNull();
  });

  it('returns null for JSON without tool/name', () => {
    expect(parseToolCall('{ "foo": "bar" }')).toBeNull();
  });

  it('handles whitespace around JSON', () => {
    const result = parseToolCall('  { "tool": "test", "params": {} }  ');
    expect(result?.tool).toBe('test');
  });
});

describe('splitInlineToolCalls', () => {
  it('returns text segment for plain text', () => {
    const result = splitInlineToolCalls('Just regular text');
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('text');
    expect(result[0].content).toBe('Just regular text');
  });

  it('detects inline tool call JSON', () => {
    const text = 'Before {"tool":"readFile","params":{"path":"/a.txt"}} After';
    const result = splitInlineToolCalls(text);
    const toolSeg = result.find(s => s.type === 'tool');
    expect(toolSeg).toBeDefined();
    expect(toolSeg!.toolCall?.tool).toBe('readFile');
  });

  it('preserves text before and after tool call', () => {
    const text = 'Hello {"tool":"test","params":{}} World';
    const result = splitInlineToolCalls(text);
    const textSegs = result.filter(s => s.type === 'text');
    expect(textSegs.some(s => s.content.includes('Hello'))).toBe(true);
    expect(textSegs.some(s => s.content.includes('World'))).toBe(true);
  });
});

describe('extractToolResults', () => {
  it('returns empty map for content without results', () => {
    const result = extractToolResults('No tool results here');
    expect(result.size).toBe(0);
  });

  it('extracts results from ## Tool Execution Results section', () => {
    const content = 'Some text\n\n## Tool Execution Results\n### readFile [OK]\nFile contents here\n### writeFile [FAIL]\nPermission denied';
    const result = extractToolResults(content);
    expect(result.has('readFile')).toBe(true);
    expect(result.get('readFile')![0].isOk).toBe(true);
    expect(result.has('writeFile')).toBe(true);
    expect(result.get('writeFile')![0].isOk).toBe(false);
  });

  it('extracts from standalone headers when no ## section', () => {
    const content = '### listFiles [OK]\nfile1.txt\nfile2.txt';
    const result = extractToolResults(content);
    expect(result.has('listFiles')).toBe(true);
    expect(result.get('listFiles')![0].isOk).toBe(true);
    expect(result.get('listFiles')![0].text).toContain('file1.txt');
  });
});
