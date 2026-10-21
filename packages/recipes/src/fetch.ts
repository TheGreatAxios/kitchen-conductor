import { lookup } from "node:dns/promises";

export function isBlockedIp(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^::ffff:/, "");
  if (s === "::1" || s === "0.0.0.0" || s === "::") return true;
  if (s.startsWith("fe80:") || s.startsWith("fc") || s.startsWith("fd")) return true;
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return s.includes(":") ? false : true;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export interface FetchDeps {
  lookup?: (host: string) => Promise<string[]>;
  fetch?: typeof fetch;
}

async function defaultLookup(host: string): Promise<string[]> {
  if (host === "localhost") return ["127.0.0.1"];
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

/** http(s) only, private and link-local addresses refused, including after a redirect. */
export async function fetchPublicText(raw: string, deps: FetchDeps = {}): Promise<string> {
  const look = deps.lookup ?? defaultLookup;
  const doFetch = deps.fetch ?? fetch;
  let current = raw;
  for (let hop = 0; hop < 3; hop++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      throw new Error("bad url");
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error("bad url");
    const ips = await look(url.hostname);
    if (ips.length === 0 || ips.some(isBlockedIp)) throw new Error("blocked address");
    const res = await doFetch(url, { redirect: "manual", signal: AbortSignal.timeout(4000) });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("bad redirect");
      current = new URL(loc, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 1_000_000) throw new Error("too large");
    return new TextDecoder().decode(buf).slice(0, 12_000);
  }
  throw new Error("too many redirects");
}
