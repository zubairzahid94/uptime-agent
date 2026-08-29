import { describe, it, expect, vi } from "vitest";
import dns from "node:dns/promises";
import { assertUrlIsSafe, safeFetch, SsrfBlockedError } from "./ssrf.js";

describe("assertUrlIsSafe", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertUrlIsSafe("ftp://example.com")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects loopback IPs", async () => {
    await expect(assertUrlIsSafe("http://127.0.0.1/health")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects link-local / cloud metadata IP", async () => {
    await expect(assertUrlIsSafe("http://169.254.169.254/latest/meta-data")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects private-range IPs", async () => {
    await expect(assertUrlIsSafe("http://10.0.0.5")).rejects.toThrow(SsrfBlockedError);
    await expect(assertUrlIsSafe("http://192.168.1.1")).rejects.toThrow(SsrfBlockedError);
  });

  it("rejects a hostname that resolves to a private IP (DNS-rebinding case)", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce([{ address: "10.1.2.3", family: 4 }] as any);
    await expect(assertUrlIsSafe("http://sneaky.example.com")).rejects.toThrow(SsrfBlockedError);
    vi.restoreAllMocks();
  });

  it("allows a public https URL", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any);
    await expect(assertUrlIsSafe("https://example.com/health")).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});

describe("safeFetch", () => {
  it("validates the initial URL, then follows a redirect only after validating its target too", async () => {
    vi.spyOn(dns, "lookup")
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any)
      .mockResolvedValueOnce([{ address: "93.184.216.35", family: 4 }] as any);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: "https://redirected.example.com/health" }) })
      .mockResolvedValueOnce({ status: 200, headers: new Headers() });
    const res = await safeFetch("https://example.com/start", fetchImpl as any);
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it("blocks a redirect that points at a private IP even though the initial URL was safe", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as any);
    const fetchImpl = vi.fn().mockResolvedValueOnce({
      status: 302, headers: new Headers({ location: "http://169.254.169.254/latest/meta-data" }),
    });
    await expect(safeFetch("https://example.com/start", fetchImpl as any)).rejects.toThrow(SsrfBlockedError);
    vi.restoreAllMocks();
  });

  it("gives up after too many redirects rather than looping forever", async () => {
    vi.spyOn(dns, "lookup").mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as any);
    const fetchImpl = vi.fn().mockResolvedValue({ status: 302, headers: new Headers({ location: "https://example.com/next" }) });
    await expect(safeFetch("https://example.com/start", fetchImpl as any)).rejects.toThrow(SsrfBlockedError);
    vi.restoreAllMocks();
  });
});
