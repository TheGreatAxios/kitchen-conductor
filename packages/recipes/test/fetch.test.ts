import { describe, expect, it } from "vitest";
import { fetchPublicText, isBlockedIp } from "../src/fetch.js";

describe("fetchPublicText", () => {
  it("blocks private, link-local, and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.9", "172.16.0.4", "169.254.169.254", "100.64.0.1", "::1", "0.0.0.0"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });

  it("refuses a private lookup and a redirect onto one", async () => {
    await expect(fetchPublicText("https://example.test/recipe", {
      lookup: async () => ["127.0.0.1"],
      fetch: async () => { throw new Error("should not fetch"); },
    })).rejects.toThrow(/blocked/);

    await expect(fetchPublicText("https://example.test/recipe", {
      lookup: async (host) => host === "evil.test" ? ["169.254.169.254"] : ["8.8.8.8"],
      fetch: async () => new Response(null, { status: 302, headers: { location: "https://evil.test/latest" } }),
    })).rejects.toThrow(/blocked/);
  });

  it("refuses userinfo and non-http URLs", async () => {
    await expect(fetchPublicText("https://user:pass@example.test/")).rejects.toThrow(/bad url/);
    await expect(fetchPublicText("file:///etc/passwd")).rejects.toThrow(/bad url/);
  });

  it("returns text from an injected public response", async () => {
    const text = await fetchPublicText("https://recipes.example/one", {
      lookup: async () => ["8.8.8.8"],
      fetch: async () => new Response("<html>hello recipe</html>"),
    });
    expect(text).toContain("hello recipe");
  });
});
