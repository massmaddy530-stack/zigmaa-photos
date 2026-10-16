# Guest access: QR code, selfie matching and downloads

How customers find their photos, what protects them, and what is needed before guests' phones can use it.

## Photographer: create an event and its QR code

1. Dashboard (`/dashboard/events/new`): create the event.
2. Start uploading: the ingestion agent (`ingestion-agent/README.md`, folder mode for DSLR/mirrorless cameras) or the
   event's **Upload** tab.
3. Event's **Share** tab: guest link, QR code, **SVG** download (scales to any print size) and **Print** (a printable page
   with the event name, QR and link).
4. If the yellow box "Guests' phones can't open this link yet" appears, the link points to `localhost`, a LAN
   address or plain HTTP. Deploy first (below), then print.
5. QR shared somewhere it shouldn't be? **Replace link** (Share tab). The old link and every printed copy of the
   old QR stop working immediately; photos are unaffected. Print the new QR.

The QR encodes only `https://<frontend>/e/<guest code>`. The guest code is a random 12-character value (about 59
bits), not the database id. The QR never contains the admin key, ingest key, database credentials or internal ids.
Archived events and unknown or replaced codes show "This event isn't available".

## Customer: scan, selfie, download

1. Scan the QR with the phone camera (or open the link on a laptop). No app install; any mobile data or Wi-Fi works.
   The customer does not need the photographer's network.
2. Read the explanation and tick the consent box. Nothing is uploaded before that.
3. **Take a selfie** (front camera in the browser) or **Upload a photo**. The image is resized on the device
   (max 1280 px, EXIF/GPS stripped) before upload; the page shows upload progress, then "Searching".
4. Results show **thumbnails only**. Tap one for a larger preview (loaded on demand). **Download** fetches the
   **original, full-quality file**.
5. If there are no matches, or the matches are wrong, use **New search / Try another selfie**. Connection problems
   offer **Try again with the same selfie**; an offline banner appears while the phone has no connection;
   interrupted or expired downloads say so and can be retried.

Face matching is automated. It can miss photos and can occasionally show a look-alike, and the page says so.
Customers should check each photo. Accuracy depends on lighting, angle, image quality and the configured
`MATCH_SIMILARITY_THRESHOLD`, which is a starting point, not a calibrated value.

## Privacy and retention

| data | handling |
|---|---|
| Selfie | Processed in memory for one search, never written to disk or storage, never logged. Discarded when the request ends. The browser drops its copy on "New search" or when the page closes. |
| Selfie face template | Computed in memory, used for one event-scoped search, discarded. Never stored. |
| Search results | Only (photo id, similarity) pairs, behind a random token, deleted after `MATCH_SESSION_TTL_S` (15 min). |
| Photo links | HMAC-signed (local storage) or presigned (R2) URLs that expire after `SIGNED_URL_TTL_S` (15 min). No guessable public URLs. |
| Event photo face data | Kept for the event. Delete with the event's Settings > purge face data action or `backend/scripts/retention.py`; deleting the event removes photos and faces. |

Isolation: a search only compares against face data with that event's id; result tokens are bound to their event;
guests can never list the gallery. Searches are rate-limited per IP (`MATCH_RATE_LIMIT` per `MATCH_RATE_WINDOW_S`);
selfies must be JPEG/PNG/WebP under `SELFIE_MAX_BYTES` (8 MB).

## Deploying for public HTTPS (required before real guests)

`localhost` and private addresses (`192.168.x.x`, `10.x.x.x`) are not reachable from guests' phones on mobile data,
and phone browsers allow the in-page camera only on HTTPS. Until the app is deployed on public HTTPS, only you can
use the guest page.

Minimum setup (any host that runs Python + Node, or containers):

1. **Backend** on a public HTTPS domain, e.g. `https://api.example.com`:
   * PostgreSQL with pgvector, run `alembic upgrade head`; Redis for `TASK_MODE=celery` + a Celery worker, and
     `RATE_LIMIT_BACKEND=redis` with more than one API process.
   * `ENVIRONMENT=production`, strong random `ADMIN_API_KEY`, `INGEST_API_KEY`, `SIGNING_SECRET` (the app refuses to
     start with a short `ADMIN_API_KEY` or `SIGNING_SECRET`).
   * `PUBLIC_BASE_URL=https://api.example.com`, `FRONTEND_BASE_URL=https://photos.example.com`,
     `CORS_ORIGINS=https://photos.example.com`.
   * Behind a reverse proxy / load balancer: `TRUST_PROXY_HEADERS=true` (so rate limits see the real client IP).
   * `STORAGE_BACKEND=r2` (Cloudflare R2) is recommended. Add a CORS rule on the bucket for the frontend origin so
     downloads save directly; without it, they open in a new tab instead.
   * Face model files in `backend/models/buffalo_l` (`python scripts/download_models.py`). Check their licence.
2. **Frontend** on `https://photos.example.com` (e.g. Vercel, or `npm run build; npm start` behind a proxy):
   `NEXT_PUBLIC_API_BASE_URL=https://api.example.com`, `API_BASE_URL=https://api.example.com`.
3. **Ingestion agent** on the photographer's laptop: `API_BASE_URL=https://api.example.com`. It only makes outgoing
   HTTPS requests, so no port forwarding is needed and the camera stays on the local network.
4. Open the Share tab: the warning disappears once both URLs are public HTTPS. Test with a phone **on mobile data**
   (Wi-Fi off) before printing.

Speed depends on photo size, the guest's signal, server capacity and how many people search at once. Measure on
your own deployment; there is no guaranteed download time. Thumbnails (≈400 px) and previews (≤1920 px) keep
browsing light on mobile data. Originals download only when requested.
