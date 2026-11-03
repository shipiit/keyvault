// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

describe('README', () => {
  it('has a "Running the tests" section naming the real test command', () => {
    const match = readme.match(/^#{2,3} Running the tests\n([\s\S]*?)(?=^#{1,3} |^---$)/m);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('npm test');
    expect(pkg.scripts.test).toBe('vitest run');
    expect(match[1]).toContain(pkg.scripts.test);
  });
});
