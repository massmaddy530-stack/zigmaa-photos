import { NextRequest, NextResponse } from "next/server";
import { API_BASE_URL } from "@/lib/server-config";

export const dynamic = "force-dynamic";

const ALLOWED_HOST_SUFFIXES = [
  ".r2.dev",
  ".r2.cloudflarestorage.com",
  ".storage.supabase.co",
  ".supabase.co",
  ".amazonaws.com",
];

function isPrivateOrLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc00:") || h.startsWith("fd")) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // Cloud metadata IP
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function isAllowedTargetUrl(url: URL): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();

  try {
    const apiHost = new URL(API_BASE_URL).hostname.toLowerCase();
    if (host === apiHost) return true;
  } catch {
    /* ignore */
  }

  const r2Public = process.env.R2_PUBLIC_URL?.trim();
  if (r2Public) {
    try {
      const r2Host = new URL(r2Public.startsWith("http") ? r2Public : `https://${r2Public}`).hostname.toLowerCase();
      if (host === r2Host) return true;
    } catch {
      /* ignore */
    }
  }

  if (isPrivateOrLocalHost(host)) return false;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * Proxies cross-origin image downloads (such as Cloudflare R2 / S3 storage URLs)
 * so the client browser can fetch the blob with same-origin headers and apply
 * watermarks before saving directly to local storage.
 */
export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(urlParam);
    if (!isAllowedTargetUrl(targetUrl)) {
      return new NextResponse("Forbidden download host", { status: 403 });
    }
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  try {
    let res: Response;
    let hops = 0;
    for (;;) {
      res = await fetch(targetUrl.toString(), {
        headers: {
          "User-Agent": "Zigmaa-Moments-Downloader/1.0",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });

      if (res.status < 300 || res.status >= 400 || !res.headers.get("location")) break;
      if (++hops > 5) {
        return new NextResponse("Too many redirects", { status: 502 });
      }
      let nextUrl: URL;
      try {
        nextUrl = new URL(res.headers.get("location")!, targetUrl);
      } catch {
        return new NextResponse("Invalid redirect target", { status: 502 });
      }
      if (!isAllowedTargetUrl(nextUrl)) {
        return new NextResponse("Forbidden redirect host", { status: 403 });
      }
      targetUrl = nextUrl;
    }

    if (!res.ok) {
      return new NextResponse(`Failed to fetch image: ${res.statusText}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      return new NextResponse("Unsupported content type", { status: 415 });
    }
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Failed to proxy image",
      { status: 502 }
    );
  }
}

