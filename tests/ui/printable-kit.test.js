/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { printableRecoveryHtml, openPrintableKit } from '../../src/ui/lib/printable-kit.js';

const KIT = {
  fingerprint: '27FC-924C',
  entryCount: 8,
  version: '0.1.0',
  generatedAt: 1_700_000_000_000,
};

describe('printableRecoveryHtml', () => {
  it('identifies the vault', () => {
    const html = printableRecoveryHtml(KIT);
    expect(html).toContain('27FC-924C');
    expect(html).toContain('0.1.0');
  });

  it('carries its own black-on-white styling, owing nothing to the theme', () => {
    // The bug this replaced: a print stylesheet over a dark-themed page forced
    // the paper white and left every colour a light grey chosen for a dark
    // background. It printed white on white.
    const html = printableRecoveryHtml(KIT);
    expect(html).toContain('color: #000');
    expect(html).toContain('background: #fff');
    expect(html).toContain('color-scheme: light');
    expect(html).not.toContain('var(--color-');
  });

  it('contains no script, so it needs no exception to the extension CSP', () => {
    expect(printableRecoveryHtml(KIT)).not.toMatch(/<script/i);
  });

  it('carries a footer identifying the vault and the build that made it', () => {
    const html = printableRecoveryHtml(KIT);
    expect(html).toContain('github.com/shipiit/keyvault');
    expect(html).toContain('Vault 27FC-924C');
    expect(html).toContain('v0.1.0');
  });

  it('watermarks the sheet, and says CONFIDENTIAL only when it is', () => {
    // The watermark is text rather than a background image on purpose: many
    // printers drop background graphics by default and would silently omit it.
    expect(printableRecoveryHtml(KIT)).toContain('RECOVERY KIT</span>');
    expect(printableRecoveryHtml(KIT, { masterPassword: 'x' })).toContain('CONFIDENTIAL</span>');
  });

  it('keeps the watermark faint enough not to fight the content', () => {
    expect(printableRecoveryHtml(KIT)).toMatch(/opacity: 0\.0[0-9]/);
  });

  describe('when nothing is typed', () => {
    it('leaves ruled lines to write on', () => {
      const html = printableRecoveryHtml(KIT);
      expect(html).toContain('class="rule"');
    });

    it('says the password is not stored and cannot be printed', () => {
      expect(printableRecoveryHtml(KIT)).toMatch(/never stored anywhere/i);
    });

    it('carries no warning about holding a password, because it holds none', () => {
      expect(printableRecoveryHtml(KIT)).not.toMatch(/contains your master password/i);
    });

    it('prints nothing for an empty or whitespace-only value', () => {
      // A blank field must not produce an empty box that looks filled in.
      for (const value of ['', '   ', undefined, null]) {
        const html = printableRecoveryHtml(KIT, { masterPassword: value });
        expect(html, String(value)).toContain('class="rule"');
        expect(html).not.toMatch(/contains your master password/i);
      }
    });
  });

  describe('when the user chooses to print them', () => {
    const FILLED = { masterPassword: 'correct-horse', backupLocation: 'Documents/backup.json' };

    it('prints both values', () => {
      const html = printableRecoveryHtml(KIT, FILLED);
      expect(html).toContain('correct-horse');
      expect(html).toContain('Documents/backup.json');
    });

    it('says on the sheet itself that it opens the vault', () => {
      // The sheet outlives the moment of deciding to print it. Whoever finds
      // it later needs to know what they are holding.
      expect(printableRecoveryHtml(KIT, FILLED)).toMatch(/contains your master password/i);
    });

    it('stops claiming the password cannot be printed', () => {
      const html = printableRecoveryHtml(KIT, FILLED);
      expect(html).not.toMatch(/cannot print it/i);
      expect(html).toMatch(/at your request/i);
    });

    it('escapes a password containing HTML, rather than rendering it', () => {
      // Passwords legitimately contain < > & " '. Unescaped, a password could
      // silently break the document — or worse, be partly swallowed by it, so
      // the printed sheet no longer matches the real password.
      const html = printableRecoveryHtml(KIT, { masterPassword: `<b>&"'x</b>` });
      expect(html).toContain('&lt;b&gt;&amp;&quot;&#39;x&lt;/b&gt;');
      expect(html).not.toContain('<b>&"');
    });
  });
});

describe('openPrintableKit', () => {
  function fakeWindow() {
    const tab = {
      document: { write: vi.fn(), close: vi.fn() },
      setTimeout: vi.fn((fn) => fn()),
      print: vi.fn(),
    };
    return { tab, opener: { open: vi.fn(() => tab) } };
  }

  it('opens a real tab, because a popup cannot print', () => {
    const { tab, opener } = fakeWindow();
    expect(openPrintableKit(KIT, {}, opener)).toBe(true);
    expect(opener.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.print).toHaveBeenCalled();
  });

  it('writes the document before printing it', () => {
    const { tab, opener } = fakeWindow();
    openPrintableKit(KIT, {}, opener);
    expect(tab.document.write.mock.calls[0][0]).toContain('27FC-924C');
    expect(tab.document.close).toHaveBeenCalled();
  });

  it('reports a blocked pop-up instead of failing silently', () => {
    // Otherwise the button looks broken, which is exactly the complaint this
    // whole change came from.
    const opener = { open: vi.fn(() => null) };
    expect(openPrintableKit(KIT, {}, opener)).toBe(false);
  });
});
