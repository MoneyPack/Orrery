import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production content security policy", () => {
  it("allows connections only to the same origin", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const policy = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1];

    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toMatch(/connect-src[^;]*\b(?:ws|wss):/);
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("frame-ancestors");
  });

  it("ships a hosting headers config sending frame-ancestors 'none'", () => {
    const headers = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");

    expect(headers).toMatch(/Content-Security-Policy:[^\n]*frame-ancestors 'none'/);
  });
});
