import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
      return new NextResponse("Invalid protocol", { status: 400 });
    }
  } catch {
    return new NextResponse("Invalid URL", { status: 400 });
  }

  try {
    const res = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "MADX-Photos-Downloader/1.0",
      },
    });

    if (!res.ok) {
      return new NextResponse(`Failed to fetch image: ${res.statusText}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new NextResponse(
      err instanceof Error ? err.message : "Failed to proxy image",
      { status: 502 }
    );
  }
}

