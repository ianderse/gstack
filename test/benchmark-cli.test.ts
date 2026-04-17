/**
 * gstack-model-benchmark CLI tests (offline).
 *
 * Covers CLI wiring that unit tests against benchmark-runner.ts can't see:
 *   - --dry-run auth/provider-list resolution
 *   - unknown provider WARN path
 *   - provider default (claude) when --models omitted
 *   - prompt resolution (inline --prompt vs positional file path)
 *   - output format flag wiring via --dry-run (avoids real CLI invocation)
 *
 * All tests use --dry-run so no API calls happen.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');
const BIN = path.join(ROOT, 'bin', 'gstack-model-benchmark');

function run(args: string[], opts: { env?: Record<string, string> } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bun', ['run', BIN, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...opts.env },
    encoding: 'utf-8',
    timeout: 15000,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}

describe('gstack-model-benchmark --dry-run', () => {
  test('prints provider availability report and exits 0', () => {
    const r = run(['--prompt', 'hi', '--models', 'claude,gpt,gemini', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gstack-model-benchmark --dry-run');
    expect(r.stdout).toContain('claude');
    expect(r.stdout).toContain('gpt');
    expect(r.stdout).toContain('gemini');
    expect(r.stdout).toContain('no prompts sent');
  });

  test('reports default provider when --models omitted', () => {
    const r = run(['--prompt', 'hi', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('providers:  claude');
  });

  test('unknown provider in --models emits WARN and is dropped', () => {
    const r = run(['--prompt', 'hi', '--models', 'claude,gpt-42-fake', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('unknown provider');
    expect(r.stderr).toContain('gpt-42-fake');
    expect(r.stdout).toContain('providers:  claude');
    expect(r.stdout).not.toContain('gpt-42-fake');
  });

  test('empty --models list falls back to claude default', () => {
    const r = run(['--prompt', 'hi', '--models', '', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('providers:  claude');
  });

  test('--timeout-ms and --workdir flags flow through to dry-run report', () => {
    const r = run(['--prompt', 'hi', '--timeout-ms', '9999', '--workdir', '/tmp', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('timeout_ms: 9999');
    expect(r.stdout).toContain('workdir:    /tmp');
  });

  test('--judge flag reported in dry-run output', () => {
    const r = run(['--prompt', 'hi', '--judge', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('judge:      on');
  });

  test('--output flag reported in dry-run', () => {
    const r = run(['--prompt', 'hi', '--output', 'json', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('output:     json');
  });

  test('each adapter reports either OK or NOT READY, never crashes', () => {
    const r = run(['--prompt', 'hi', '--models', 'claude,gpt,gemini', '--dry-run']);
    expect(r.status).toBe(0);
    // Each provider line must end in OK or NOT READY
    const lines = r.stdout.split('\n');
    const adapterLines = lines.filter(l => /^\s+(claude|gpt|gemini):/.test(l));
    expect(adapterLines.length).toBe(3);
    for (const line of adapterLines) {
      expect(line).toMatch(/(OK|NOT READY)/);
    }
  });

  test('long prompt is truncated in dry-run display', () => {
    const longPrompt = 'x'.repeat(200);
    const r = run(['--prompt', longPrompt, '--dry-run']);
    expect(r.status).toBe(0);
    // Summary truncates to 80 chars + ellipsis
    expect(r.stdout).toMatch(/prompt:\s+x{80}…/);
  });
});

describe('gstack-model-benchmark prompt resolution', () => {
  test('positional file path is read and passed as prompt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prompt-'));
    const promptFile = path.join(tmp, 'prompt.txt');
    fs.writeFileSync(promptFile, 'hello from file');
    try {
      const r = run([promptFile, '--dry-run']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('hello from file');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('positional non-file arg is treated as inline prompt', () => {
    const r = run(['treat-me-as-inline', '--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('treat-me-as-inline');
  });

  test('missing prompt exits non-zero', () => {
    const r = run(['--dry-run']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('specify a prompt');
  });
});
