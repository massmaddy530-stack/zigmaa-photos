# Zigmaa Photos camera ingestion agent

Gets event photos from a camera onto the server automatically. It uploads them to one explicitly selected event
through the backend's existing agent API. The backend does all validation, size limits, storage, de-duplication,
face detection and indexing, exactly as for dashboard uploads.

Three camera sources (`CAMERA_SOURCE`):

| source   | use it when                                                                                     |
|----------|--------------------------------------------------------------------------------------------------|
| `folder` | **Recommended for DSLR/mirrorless cameras (Sony, Canon, Nikon, ...).** The camera's own transfer software, Wi-Fi transfer or a card import saves JPEGs into a folder on this PC; the agent uploads each new, complete file. |
| `rtsp`   | An IP/security camera that really provides an RTSP video stream. The agent saves a still every N seconds or on motion. |
| `mock`   | Testing without hardware. Synthetic images labelled `MOCK CAPTURE - NOT A REAL CAMERA`, files named `MOCK_*.jpg`. |

```
camera software / card import ──► WATCH_FOLDER\*.jpg ─┐
IP camera (RTSP on your LAN) ──► still (interval/motion) ─┼─► spool\<event>\pending\  (survives restarts)
MOCK ──► labelled test image ───────────────────────────┘          │
backend  POST /api/v1/events/{id}/photos/check-hashes   ◄── skip photos already on the server (SHA-256)
         POST /api/v1/events/{id}/photos  (X-API-Key = INGEST_API_KEY, source=agent) ◄── upload, retry w/ backoff
```

* **No lost or doubled photos**: a photo stays in `pending\` until the server confirms it. Retries after a timeout,
  crash or restart are caught by `check-hashes` and by the server's per-event SHA-256 de-duplication.
* **One agent per event**: `spool\<event>\agent.lock` stops a second agent for the same event from uploading the
  same files in parallel.
* **Errors**: camera/folder unavailable -> retry with exponential backoff (`RECONNECT_MIN_S`..`RECONNECT_MAX_S`).
  Backend down / 5xx / 429 -> retry with backoff while photos keep queueing. Wrong key (401/403), unknown event (404)
  or archived event (409) -> the agent stops with a clear message and keeps the files. Files the server rejects go
  to `rejected\` with a `.json` reason. Nothing pending is ever deleted silently.
* **Status**: console log plus `spool\<event_id>\status.json` (connection state, last errors, pending / uploaded /
  failed counts, and in folder mode what was skipped and why).
* **Security**: uses the upload-only ingest key (it cannot read or manage events). Camera URLs must be private LAN
  addresses; keys and camera credentials are masked in every log line and in `status.json`.

## Folder mode in detail

* **Originals are read-only.** Nothing in `WATCH_FOLDER` is moved, renamed, modified or deleted. The agent copies the
  original bytes into the spool, so uploads keep full camera quality (no re-encoding) and the server records the
  camera's file name (e.g. `DSC01234.jpg`).
* **Only finished files.** A file is taken once its size and timestamp have been unchanged for
  `FILE_STABLE_SECONDS` over at least two scans, it can be opened (not locked by the transfer software), and it
  ends with the JPEG/PNG end marker. Half-copied files are never uploaded. A file that stays incomplete is skipped
  and logged after three checks, and taken later if it changes.
* **What is picked up**: `.jpg` / `.jpeg` (any case) and, unless `FOLDER_INCLUDE_PNG=false`, `.png`. Ignored: RAW
  (`.ARW`, `.CR2/.CR3`, `.NEF`, ...), video, temporary/partial files (`.tmp`, `.part`, `.crdownload`, ...), hidden
  files and files starting with `~` or `$`. Unicode names and spaces are fine. Files over `MAX_UPLOAD_BYTES` are
  skipped with a warning.
* **Each photo once.** `spool\<event>\folder_ledger.jsonl` records every file handled (path, size, timestamp,
  SHA-256), so restarts don't re-upload. Identical bytes under another name or in another subfolder are skipped. A
  re-exported or edited file (new content) counts as a new photo.
* **Old photos stay out of new events.** The first time the agent runs for an `EVENT_ID`, photos already in the
  folder are recorded as "existing" and **not** uploaded (set `FOLDER_INCLUDE_EXISTING=true` to upload them).
  Photos added while the agent was stopped are uploaded at the next start.
* **Folder missing** (card not inserted, share offline, typo): the agent reports it and keeps retrying. It
  continues as soon as the folder appears.

## Camera compatibility

The agent never controls the camera. Any camera works as long as **something** puts JPEG files into a folder on this
Windows PC:

* **Sony Alpha (e.g. a6400)**: Sony's PC software, or the camera's built-in "send to computer" Wi-Fi feature, where
  your model and firmware offer it; or memory-card import. Check Sony's support pages for your exact model, and test
  at home before the event. Sony does not document an RTSP stream for the a6400, so treat RTSP as unsupported on it.
  Some Sony tools save into dated subfolders, in which case set `FOLDER_RECURSIVE=true`.
* **Canon**: EOS Utility (Wi-Fi or USB) or Image Transfer Utility, or card import.
* **Nikon**: NX Tether, Wireless Transmitter Utility (on supported models), or card import.
* **Other cameras / phones**: any vendor app, FTP server, sync tool or manual copy that writes into the folder.
* **IP cameras**: `rtsp` mode, only if the camera documents an RTSP URL and it plays in VLC.

Wireless transfer support differs by model, firmware and region. Not every camera can send to a PC over Wi-Fi, so
verify the exact model before relying on it. USB tethering is optional: if Wi-Fi transfer or card import works for
you, folder mode needs nothing else. Switch the camera to JPEG (or RAW+JPEG). The agent uploads the JPEGs only.

## Setup (Windows 11, PowerShell)

The virtual environment already exists in `ingestion-agent\.venv`. No new packages are needed for folder mode.

```powershell
cd "C:\Users\madha\Desktop\zigmaa photos\ingestion-agent"
.\.venv\Scripts\Activate.ps1                      # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install -r requirements.txt         # only if packages are missing (requirements-dev.txt adds pytest)
if (-not (Test-Path .env)) { Copy-Item .env.example .env }   # never overwrites an existing .env
notepad .env
```

In `.env` set:

* `INGEST_API_KEY`: the value of `INGEST_API_KEY` in `backend\.env` (the upload-only key, not the admin key)
* `EVENT_ID`: the event's id, the last part of `http://localhost:3000/dashboard/events/<EVENT_ID>`
* `API_BASE_URL`: `http://localhost:8000` locally, or your deployed backend URL, e.g. `https://api.example.com`

## Folder mode (Sony / Canon / Nikon / any camera)

1. Create the folder and point your camera software at it (e.g. Sony/Canon/Nikon transfer software's "save to"
   folder):

   ```powershell
   New-Item -ItemType Directory -Force C:\EventPhotos
   ```

2. In `.env`:

   ```
   CAMERA_SOURCE=folder
   WATCH_FOLDER=C:\EventPhotos
   FOLDER_RECURSIVE=false          # true if the software creates subfolders
   FILE_STABLE_SECONDS=3           # 5-10 for slow Wi-Fi transfers or network shares
   ```

3. Check, then run (with the backend running):

   ```powershell
   python -m zigmaa_agent check     # config + backend + folder; uploads nothing; says what happens to existing files
   python -m zigmaa_agent run       # until Ctrl+C (Ctrl+C finishes the current upload, keeps the rest pending)
   ```

4. Test without a camera by copying a photo in, the way transfer software would:

   ```powershell
   Copy-Item "$env:USERPROFILE\Pictures\some-photo.jpg" C:\EventPhotos\TEST_0001.jpg
   ```

   Within a few seconds the log shows `new photo ...__TEST_0001.jpg` followed by `created (photo ...)`. Delete the
   test photo from the event in the dashboard afterwards if you used a real event. A disposable test event is
   better.

## Mock mode (no camera)

1. Start the backend (terminal 1):

   ```powershell
   cd "C:\Users\madha\Desktop\zigmaa photos\backend"
   .\.venv\Scripts\Activate.ps1
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```

2. Create a **test** event in the dashboard (`http://localhost:3000`, `npm run dev` in `frontend`), copy its id into
   `EVENT_ID`, set `CAMERA_SOURCE=mock`.

3. Run the agent (terminal 2):

   ```powershell
   cd "C:\Users\madha\Desktop\zigmaa photos\ingestion-agent"
   .\.venv\Scripts\Activate.ps1
   python -m zigmaa_agent check                  # config + backend + camera; uploads nothing
   python -m zigmaa_agent run --max-captures 3   # 3 stills, then stop
   ```

   Optional: `MOCK_IMAGE_DIR` (cycle through your own photos to test face matching end to end),
   `MOCK_DROP_EVERY_N_READS=7` (simulate camera dropouts), `CAPTURE_MODE=motion`.

4. Test retry: stop the backend, run the agent for a few captures (uploads fail, stills stay in `pending`), start
   the backend again and run `python -m zigmaa_agent run --max-captures 0`. The pending stills upload once.

## RTSP mode (IP cameras only)

1. Put the camera and this PC on the same LAN; give the camera a fixed (DHCP-reserved) IP.
2. Find its RTSP URL in the camera's manual or app (the path differs per model) and **test it in VLC first**
   (Media > Open Network Stream). If VLC can't play it, the agent can't either.
3. In `.env`:

   ```
   CAMERA_SOURCE=rtsp
   CAMERA_RTSP_URL=rtsp://192.168.1.50:554/<stream path from the manual>
   CAMERA_USERNAME=<camera user>
   CAMERA_PASSWORD=<camera password>
   CAMERA_RTSP_TRANSPORT=tcp
   ```

4. `python -m zigmaa_agent check`, then `python -m zigmaa_agent run --max-captures 3`.

The RTSP connector is tested against simulated capture devices only. It has **not** been verified with a physical
camera.

## Checking upload status

```powershell
$ev = (Select-String -Path .env -Pattern '^EVENT_ID=(.+)$').Matches[0].Groups[1].Value
Get-Content "spool\$ev\status.json"                               # agent view: state, counts, last errors
(Get-ChildItem "spool\$ev\pending").Count                         # waiting for upload
Get-ChildItem "spool\$ev\rejected" -Filter *.json | Get-Content   # why the server rejected files
# Server view (admin key from backend\.env):
$admin = (Select-String -Path ..\backend\.env -Pattern '^ADMIN_API_KEY=(.+)$').Matches[0].Groups[1].Value
(Invoke-RestMethod "http://localhost:8000/api/v1/events/$ev/status" -Headers @{Authorization="Bearer $admin"}).counts
```

## Troubleshooting

| message / symptom | cause and fix |
|---|---|
| `backend unreachable at ...` | Backend not running or wrong `API_BASE_URL`. Open `<API_BASE_URL>/health` in a browser. The agent keeps the photos and retries. |
| `backend refused the ingest key (HTTP 401/403)` | `INGEST_API_KEY` doesn't match `backend\.env`. Copy it again (no quotes or spaces) and restart the backend if you changed it there. |
| `event ... was not found; check EVENT_ID` | Wrong or deleted event. Copy the id from the dashboard URL. |
| `event ... is archived` | Make the event live again in the dashboard (Settings) or choose another event. |
| `EVENT_ID is required and must be the event's UUID` | The value must look like `1a2b3c4d-....`, not the event name or guest code. |
| `watch folder ... does not exist` | Create it (`New-Item -ItemType Directory -Force C:\EventPhotos`), check the spelling, or connect the card/share. The agent retries by itself. |
| `no permission to read watch folder` | Run the agent as the same Windows user that owns the folder, or grant read access: `icacls C:\EventPhotos /grant "${env:USERNAME}:(OI)(CI)R"`. |
| `waiting for X.jpg (Permission denied)` | The transfer software still has the file open; it's retried automatically. |
| `photo(s) already in ... were skipped` | First run for this event: earlier photos aren't uploaded. Set `FOLDER_INCLUDE_EXISTING=true` if you want them. |
| `another agent is already running for this event` | Close the other agent window (only one agent per event). |
| Photos never appear | Is the camera saving JPEG (not RAW only)? Are they in a subfolder (`FOLDER_RECURSIVE=true`)? Check `status.json` (`skipped_*` counts). |
| `could not connect to rtsp://...` | Wrong IP/port/path/credentials, or the camera has no RTSP. Test in VLC first. |

## Tests

```powershell
python -m pytest -v
```

They use a fake backend, a fake capture device and temporary folders. No server, database or camera is needed.
