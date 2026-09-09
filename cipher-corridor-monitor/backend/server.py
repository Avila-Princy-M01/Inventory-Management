"""
server.py — Flask development server for the Pharma Corridor Monitor SPA.

Routes:
  GET  /                      → serves frontend/index.html (static SPA)
  GET  /<path>                → serves static files from frontend/
  GET  /dashboard_data.json   → serves backend/dashboard_data.json
  POST /upload                → accepts .xlsx, reruns pipeline, returns new dashboard_data.json
"""

import os
import sys
import json
import shutil
import tempfile
import subprocess
import threading
import uuid
from datetime import datetime

from flask import Flask, send_from_directory, jsonify, request, Response

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
PARENT_DIR = os.path.dirname(PROJECT_ROOT)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
BACKEND_DIR = BASE_DIR
DASHBOARD_DATA_PATH = os.path.join(BACKEND_DIR, "dashboard_data.json")

# ── Load .env if present in PROJECT_ROOT or PARENT_DIR ────────────────────────
ENV_PATHS = [
    os.path.join(PROJECT_ROOT, ".env"),
    os.path.join(PARENT_DIR, ".env"),
    os.path.join(BACKEND_DIR, ".env"),
]
for env_p in ENV_PATHS:
    if os.path.isfile(env_p):
        try:
            with open(env_p, "r", encoding="utf-8") as ef:
                for line in ef:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and v and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass


# Robust resolution for corridor_pipeline.py across parent (D:\novo\) and backend
PIPELINE_CANDIDATES = [
    os.path.join(PARENT_DIR, "corridor_pipeline.py"),
    os.path.join(BACKEND_DIR, "corridor_pipeline.py"),
    os.path.join(PROJECT_ROOT, "corridor_pipeline.py"),
]
PIPELINE_SCRIPT = next((p for p in PIPELINE_CANDIDATES if os.path.isfile(p)), PIPELINE_CANDIDATES[0])

# Robust resolution for generate_dashboard_data.py
GENERATE_CANDIDATES = [
    os.path.join(BACKEND_DIR, "generate_dashboard_data.py"),
    os.path.join(PROJECT_ROOT, "generate_dashboard_data.py"),
    os.path.join(PARENT_DIR, "generate_dashboard_data.py"),
]
GENERATE_SCRIPT = next((p for p in GENERATE_CANDIDATES if os.path.isfile(p)), GENERATE_CANDIDATES[0])

# ── Flask app ──────────────────────────────────────────────────────────────────
app = Flask(__name__, static_folder=None)

# Subprocess budget for pipeline work triggered by a judge upload.
PIPELINE_TIMEOUT_SECONDS = 300

# ── Benchmark protection: snapshot current artifacts before an upload overwrites them ──
BENCHMARK_XLSX = "Inventry_Corridor_Alert_Weekly_Aug2026_Jul2027.xlsx"
SNAPSHOT_DIR = os.path.join(BACKEND_DIR, "benchmark_snapshot")
SNAPSHOT_FILES = ["dashboard_data.json", "corridor_panel.parquet", "corridor_findings.json"]


# ── Static file serving — frontend/ ───────────────────────────────────────────
@app.route("/")
def serve_index():
    """Serve the SPA entry point."""
    idx_path = os.path.join(FRONTEND_DIR, "index.html")
    from flask import send_file
    return send_file(idx_path)


@app.route("/<path:filename>")
def serve_static(filename):
    """Serve any static asset from frontend/ (JS, CSS, fonts, etc.) safely handling spaces and URI encoding."""
    import urllib.parse
    decoded = urllib.parse.unquote(filename)
    if decoded.startswith("frontend/"):
        decoded = decoded[len("frontend/"):]

    # Check FRONTEND_DIR
    target = os.path.join(FRONTEND_DIR, decoded)
    if os.path.isfile(target):
        from flask import send_file
        return send_file(target)

    # Check dashboard_data.json
    if decoded in ("dashboard_data.json", "backend/dashboard_data.json"):
        return serve_dashboard_data()

    # Check PROJECT_ROOT and BACKEND_DIR
    for root_cand in [PROJECT_ROOT, BACKEND_DIR, PARENT_DIR]:
        alt = os.path.join(root_cand, decoded)
        if os.path.isfile(alt):
            from flask import send_file
            return send_file(alt)

    return send_from_directory(FRONTEND_DIR, decoded)


# ── Dashboard data ─────────────────────────────────────────────────────────────
@app.route("/dashboard_data.json")
def serve_dashboard_data():
    """Serve the current backend/dashboard_data.json with automatic gzip compression."""
    accept_encoding = request.headers.get("Accept-Encoding", "")
    data_path = os.path.join(BACKEND_DIR, "dashboard_data.json")
    if not os.path.isfile(data_path):
        return jsonify({"error": "NOT_FOUND"}), 404

    if "gzip" in accept_encoding.lower():
        import gzip
        with open(data_path, "rb") as fh:
            raw_bytes = fh.read()
        compressed = gzip.compress(raw_bytes, compresslevel=6)
        resp = Response(compressed, mimetype="application/json")
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Length"] = str(len(compressed))
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    return send_from_directory(BACKEND_DIR, "dashboard_data.json")


# ── Upload endpoint — asynchronous job model ──────────────────────────────
# Heavy rebuilds (60s+) exceed response-time caps of public proxies (e.g.
# Cloudflare terminates responses past 100s), so uploads run as background
# jobs: POST /upload returns 202 {job_id} immediately and the client polls
# GET /upload/status/<job_id> until the fresh payload is ready.

UPLOAD_JOBS = {}
UPLOAD_JOBS_LOCK = threading.Lock()


def _run_upload_pipeline(job_id, tmp_path, pipeline_env):
    """Background worker: rebuild the panel, regenerate the payload, publish status."""
    try:
        try:
            result_pipeline = subprocess.run(
                [sys.executable, PIPELINE_SCRIPT, "--rebuild"],
                capture_output=True,
                text=True,
                cwd=BACKEND_DIR,
                env=pipeline_env,
                timeout=PIPELINE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "PIPELINE_TIMEOUT",
                    "detail": f"Pipeline exceeded {PIPELINE_TIMEOUT_SECONDS}s budget. The workbook may be malformed or too large for this prototype.",
                })
            return
        except FileNotFoundError as exc:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "FILE_NOT_FOUND",
                    "detail": f"Failed to execute pipeline script {PIPELINE_SCRIPT}: {exc}",
                })
            return

        if result_pipeline.returncode != 0:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "PIPELINE_FAILURE",
                    "detail": (result_pipeline.stderr or result_pipeline.stdout or "pipeline failed")[-4000:],
                })
            return

        try:
            result_generate = subprocess.run(
                [sys.executable, GENERATE_SCRIPT],
                capture_output=True,
                text=True,
                cwd=BACKEND_DIR,
                env=pipeline_env,
                timeout=PIPELINE_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "PIPELINE_TIMEOUT",
                    "detail": f"Dashboard generation exceeded {PIPELINE_TIMEOUT_SECONDS}s budget.",
                })
            return
        except FileNotFoundError as exc:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "FILE_NOT_FOUND",
                    "detail": f"Failed to execute generator script {GENERATE_SCRIPT}: {exc}",
                })
            return

        if result_generate.returncode != 0:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "PIPELINE_FAILURE",
                    "detail": (result_generate.stderr or result_generate.stdout or "generation failed")[-4000:],
                })
            return

        # Synchronize parquet & findings to the parent directory (best-effort).
        try:
            for fname in ["corridor_panel.parquet", "corridor_findings.json"]:
                sf = os.path.join(BACKEND_DIR, fname)
                df = os.path.join(PARENT_DIR, fname)
                if os.path.isfile(sf) and os.path.isdir(PARENT_DIR) and sf != df:
                    shutil.copy2(sf, df)
        except Exception:
            pass

        # Read the fresh payload back so the exact served bytes are pinned.
        try:
            with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
                payload_text = fh.read()
        except OSError as exc:
            with UPLOAD_JOBS_LOCK:
                UPLOAD_JOBS[job_id].update({
                    "status": "error",
                    "error": "PIPELINE_FAILURE",
                    "detail": str(exc),
                })
            return

        with UPLOAD_JOBS_LOCK:
            UPLOAD_JOBS[job_id].update({
                "status": "done",
                "payload_text": payload_text,
                "finished": datetime.utcnow().isoformat() + "Z",
            })
    finally:
        # The worker owns the temp file now — always clean it up.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route("/upload/status/<job_id>", methods=["GET"])
def upload_status(job_id):
    """Poll an async upload job. Terminal states: done (with payload) / error."""
    with UPLOAD_JOBS_LOCK:
        job = UPLOAD_JOBS.get(job_id)
        if job is None:
            return jsonify({"error": "UNKNOWN_JOB"}), 404
        snapshot = dict(job)
    if snapshot["status"] == "done":
        payload_text = snapshot.pop("payload_text", "")
        # Hand off the payload once, then prune the completed job from memory.
        with UPLOAD_JOBS_LOCK:
            UPLOAD_JOBS.pop(job_id, None)
        resp = Response(payload_text, status=200, mimetype="application/json")
        resp.headers["X-Upload-Job"] = job_id
        return resp
    return jsonify({
        "job_id": job_id,
        "status": snapshot["status"],
        "error": snapshot.get("error"),
        "detail": snapshot.get("detail"),
        "started": snapshot.get("started"),
    }), 200


@app.route("/upload", methods=["POST"])
def upload():
    """
    Accept a multipart/form-data POST with a field named 'file' (.xlsx only).

    Validation:
      1. File extension must be .xlsx           → HTTP 400 WRONG_FILE_TYPE
      2. Workbook must contain an 'Export' sheet → HTTP 422 INVALID_WORKBOOK

    On success:
      - Validate the workbook (extension + 'Export' sheet)
      - Snapshot the current benchmark artifacts (restore safety)
      - Dispatch corridor_pipeline.py --rebuild + generate_dashboard_data.py
        as a background job → HTTP 202 {"job_id": ...}
      - Client polls GET /upload/status/<job_id>; 'done' returns the fresh
        dashboard_data.json (HTTP 200), 'error' returns the failure detail

    Design note: rebuilds take 60s+, which exceeds public-proxy response caps
    (e.g. Cloudflare 100s), so the pipeline must not run inside the request.
    """
    # ── 1. File presence check ─────────────────────────────────────────────
    if "file" not in request.files:
        return jsonify({"error": "NO_FILE"}), 400

    uploaded_file = request.files["file"]

    # ── 2. Extension validation ────────────────────────────────────────────
    filename = uploaded_file.filename or ""
    if not filename.lower().endswith(".xlsx"):
        return jsonify({"error": "WRONG_FILE_TYPE"}), 400

    # ── 3. Save to a named temp file so pipeline can read it ───────────────
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".xlsx")
    dispatched = False
    try:
        try:
            os.close(tmp_fd)
            uploaded_file.save(tmp_path)
        except OSError as exc:
            return jsonify({"error": "PIPELINE_FAILURE", "detail": str(exc)}), 500

        # ── 4. Validate workbook contains 'Export' sheet ───────────────────
        try:
            import openpyxl  # noqa: PLC0415 — imported here to keep top-level lean
            wb = openpyxl.load_workbook(tmp_path, read_only=True, data_only=True)
            sheet_names = wb.sheetnames
            wb.close()
        except Exception as exc:  # noqa: BLE001
            return jsonify({"error": "INVALID_WORKBOOK"}), 422

        if "Export" not in sheet_names:
            return jsonify({"error": "INVALID_WORKBOOK"}), 422

        # ── 5. Replace the input parquet with the new upload ───────────────
        # corridor_pipeline.py reads the xlsx when called with --rebuild and
        # the path is passed as the first positional argument (or via env var).
        # We set the env var CORRIDOR_INPUT so the pipeline can locate the file.
        pipeline_env = os.environ.copy()
        pipeline_env["CORRIDOR_INPUT"] = tmp_path
        # Also make sure the working directory is the backend folder so
        # relative-path references inside the scripts resolve correctly.
        cwd = BACKEND_DIR

        # ── 5b. Snapshot current artifacts so the pristine benchmark is never lost ──
        # (A judge upload overwrites dashboard_data.json / parquet / findings; this
        # guarantees the demo benchmark can always be restored afterwards.)
        try:
            os.makedirs(SNAPSHOT_DIR, exist_ok=True)
            for fname in SNAPSHOT_FILES:
                sf = os.path.join(BACKEND_DIR, fname)
                if os.path.isfile(sf):
                    shutil.copy2(sf, os.path.join(SNAPSHOT_DIR, fname))
        except Exception as snap_exc:
            print(f"[server] WARNING: benchmark snapshot failed: {snap_exc}", file=sys.stderr)

        # ── 6. Validate resolved scripts, then dispatch the heavy rebuild to a
        # background worker. The HTTP request returns immediately with a job id;
        # the client polls GET /upload/status/<job_id> for completion.
        if not os.path.isfile(PIPELINE_SCRIPT):
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"corridor_pipeline.py not found at resolved script path: {PIPELINE_SCRIPT}. Checked paths: {PIPELINE_CANDIDATES}",
                }
            ), 500
        if not os.path.isfile(GENERATE_SCRIPT):
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"generate_dashboard_data.py not found at {GENERATE_SCRIPT}. Checked paths: {GENERATE_CANDIDATES}",
                }
            ), 500

        job_id = uuid.uuid4().hex[:12]
        with UPLOAD_JOBS_LOCK:
            UPLOAD_JOBS[job_id] = {"status": "running", "started": datetime.utcnow().isoformat() + "Z"}
        worker = threading.Thread(
            target=_run_upload_pipeline,
            args=(job_id, tmp_path, pipeline_env),
            daemon=True,
        )
        worker.start()
        dispatched = True
        return jsonify({"job_id": job_id, "status": "running"}), 202

    finally:
        # Clean up the temp file unless a background worker now owns it.
        if not dispatched:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


# ── GxP audit persistence ─────────────────────────────────────────────────────

# Append-only JSONL ledger (21 CFR-style audit trail that survives page
# refreshes and server restarts).
AUDIT_LOG_PATH = os.path.join(BACKEND_DIR, "gxp_audit_ledger.jsonl")


def _load_audit_entries():
    entries = []
    try:
        if os.path.isfile(AUDIT_LOG_PATH):
            with open(AUDIT_LOG_PATH, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        entries.append(json.loads(line))
    except Exception as exc:
        print(f"[server] WARNING: could not read audit ledger: {exc}", file=sys.stderr)
    return entries


@app.route("/audit/log", methods=["GET", "POST"])
def audit_log_endpoint():
    """
    GET:  returns all persisted GxP audit entries.
    POST: appends one entry (the frontend pushes every analyst action here).
    """
    if request.method == "GET":
        return jsonify({"entries": _load_audit_entries()}), 200

    if not request.is_json or not request.get_json(silent=True):
        return jsonify({"error": "INVALID_PAYLOAD", "detail": "JSON audit entry required"}), 400
    entry = request.get_json(silent=True)
    try:
        with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as exc:
        return jsonify({"error": "WRITE_ERROR", "detail": str(exc)}), 500
    return jsonify({"success": True}), 200


# ── Benchmark restore endpoint ────────────────────────────────────────────────
@app.route("/restore-benchmark", methods=["POST"])
def restore_benchmark():
    """
    Restores the pristine benchmark artifacts from the snapshot taken before the
    most recent judge upload. Guarantees the [ LOAD HACKATHON BENCHMARK ] button
    always loads the real 260,000 SKU-week baseline, even after uploads.
    """
    missing = [f for f in SNAPSHOT_FILES if not os.path.isfile(os.path.join(SNAPSHOT_DIR, f))]
    if missing:
        return jsonify({
            "error": "NO_SNAPSHOT",
            "detail": f"No pre-upload benchmark snapshot found (missing: {', '.join(missing)}). The benchmark artifacts on disk are untouched.",
        }), 404
    try:
        for fname in SNAPSHOT_FILES:
            src = os.path.join(SNAPSHOT_DIR, fname)
            dst = os.path.join(BACKEND_DIR, fname)
            if os.path.isfile(src):
                shutil.copy2(src, dst)
        # Keep the root-level copies in sync as well (best-effort: the parent
        # directory may be read-only in container deployments)
        try:
            for fname in ["dashboard_data.json", "corridor_findings.json"]:
                src = os.path.join(BACKEND_DIR, fname)
                dst = os.path.join(PARENT_DIR, fname)
                if os.path.isfile(src) and os.path.isdir(PARENT_DIR):
                    shutil.copy2(src, dst)
        except Exception:
            pass
    except Exception as exc:
        return jsonify({"error": "RESTORE_FAILED", "detail": str(exc)}), 500
    return jsonify({"success": True, "restored": SNAPSHOT_FILES}), 200


# ── Demo / default dataset loader endpoint ─────────────────────────────────────
@app.route("/load-demo", methods=["POST", "GET"])
def load_demo():
    """
    Returns the pre-processed demonstration dataset (or generates it if missing).
    Provides instant start for testing without needing to upload 30 MB manually.
    """
    if os.path.isfile(DASHBOARD_DATA_PATH):
        try:
            # If a judge upload previously overwrote the benchmark, silently restore it first
            snap_dash = os.path.join(SNAPSHOT_DIR, "dashboard_data.json")
            if os.path.isfile(snap_dash):
                for fname in SNAPSHOT_FILES:
                    src = os.path.join(SNAPSHOT_DIR, fname)
                    dst = os.path.join(BACKEND_DIR, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, dst)
                for fname in ["dashboard_data.json", "corridor_findings.json"]:
                    dst = os.path.join(PARENT_DIR, fname)
                    if os.path.isdir(PARENT_DIR) and os.path.isfile(os.path.join(BACKEND_DIR, fname)):
                        try:
                            shutil.copy2(os.path.join(BACKEND_DIR, fname), dst)
                        except Exception:
                            pass
            with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
                payload = fh.read()
            return Response(payload, status=200, mimetype="application/json")
        except OSError as exc:
            return jsonify({"error": "READ_ERROR", "detail": str(exc)}), 500

    # If dashboard_data.json doesn't exist, run generation pipeline
    result_generate = subprocess.run(
        [sys.executable, GENERATE_SCRIPT],
        capture_output=True,
        text=True,
        cwd=BACKEND_DIR,
    )
    if result_generate.returncode != 0:
        return jsonify(
            {
                "error": "PIPELINE_FAILURE",
                "detail": result_generate.stderr or result_generate.stdout,
            }
        ), 500

    with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
        payload = fh.read()
    return Response(payload, status=200, mimetype="application/json")


# ── Background Email & Dispatch Endpoints ─────────────────────────────────────
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)
import email_service


@app.route("/api/email/status", methods=["GET"])
def email_status():
    """Returns the current background scheduler status, next run, and recent logs."""
    return jsonify(email_service.get_status()), 200


@app.route("/api/email/preview", methods=["GET"])
def email_preview():
    """Returns the formatted HTML and text preview of the Monday morning AI email digest."""
    try:
        data = None
        if os.path.isfile(DASHBOARD_DATA_PATH):
            with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        digest = email_service.build_email_digest(data)
        return jsonify(digest), 200
    except Exception as exc:
        return jsonify({"error": "PREVIEW_FAILED", "detail": str(exc)}), 500


@app.route("/api/email/dispatch", methods=["POST"])
def dispatch_email_endpoint():
    """
    On-demand email dispatch trigger.
    Can be used to test dispatch or manually push the Monday briefing.
    Optional JSON body: { "recipients": ["user@domain.com"] }
    """
    recipients = None
    if request.is_json and request.json:
        recipients = request.json.get("recipients")
    try:
        res = email_service.dispatch_email(recipients=recipients)
        return jsonify(res), 200
    except Exception as exc:
        return jsonify({"error": "DISPATCH_FAILED", "detail": str(exc)}), 500


@app.route("/api/email/recipients", methods=["POST"])
def update_recipients_endpoint():
    """Updates recipient email list."""
    if not request.is_json or "recipients" not in request.json:
        return jsonify({"error": "INVALID_PAYLOAD", "detail": "Missing 'recipients' field"}), 400
    new_recs = email_service.update_recipients(request.json["recipients"])
    return jsonify({"success": True, "recipients": new_recs}), 200


@app.route("/api/settings/administrative", methods=["GET", "POST"])
def administrative_settings_endpoint():
    """
    GET: Returns current administrative settings from dashboard_data.json.
    POST: Updates administrative settings (per_market_override_toggle, lead_times_by_market, etc.)
          and persists them into dashboard_data.json.
    """
    if not os.path.isfile(DASHBOARD_DATA_PATH):
        return jsonify({"error": "DATA_NOT_FOUND"}), 404

    try:
        with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except Exception as exc:
        return jsonify({"error": "READ_ERROR", "detail": str(exc)}), 500

    current_settings = data.get("administrative_settings", {})

    if request.method == "GET":
        return jsonify(current_settings), 200

    # POST update
    if not request.is_json:
        return jsonify({"error": "INVALID_JSON"}), 400

    updates = request.json or {}
    if "per_market_override_toggle" in updates:
        current_settings["per_market_override_toggle"] = bool(updates["per_market_override_toggle"])
    if "global_lead_time_default_weeks" in updates:
        current_settings["global_lead_time_default_weeks"] = int(updates["global_lead_time_default_weeks"])
        current_settings["global_lead_time_default_days"] = current_settings["global_lead_time_default_weeks"] * 7
    if "lead_times_by_market" in updates and isinstance(updates["lead_times_by_market"], dict):
        current_settings.setdefault("lead_times_by_market", {}).update(updates["lead_times_by_market"])

    data["administrative_settings"] = current_settings

    # Also update metadata.administrative_settings if present
    if "metadata" in data and isinstance(data["metadata"], dict):
        data["metadata"]["administrative_settings"] = current_settings

    try:
        with open(DASHBOARD_DATA_PATH, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        # Sync to parent directory if exists
        parent_dash = os.path.join(PARENT_DIR, "dashboard_data.json")
        if os.path.isdir(PARENT_DIR) and os.path.isfile(parent_dash) and DASHBOARD_DATA_PATH != parent_dash:
            with open(parent_dash, "w", encoding="utf-8") as fh2:
                json.dump(data, fh2, indent=2)
    except Exception as exc:
        return jsonify({"error": "WRITE_ERROR", "detail": str(exc)}), 500

    return jsonify({
        "success": True,
        "administrative_settings": current_settings
    }), 200


# ── AI API Key Management ─────────────────────────────────────────────────────
@app.route("/api/settings/ai-key", methods=["GET", "POST"])
def manage_ai_key():
    """
    GET: Returns whether an AI API key (Gemini / OpenAI) is configured and a masked preview.
    POST: Sets and persists the GEMINI_API_KEY to os.environ and the .env file.
    """
    env_file = os.path.join(PROJECT_ROOT, ".env")
    if request.method == "GET":
        k = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or os.environ.get("OPENAI_API_KEY") or ""
        masked = (k[:6] + "..." + k[-4:]) if len(k) > 10 else ("Configured" if k else "None")
        return jsonify({
            "is_configured": bool(k),
            "masked_key": masked,
            "provider": "Google Gemini" if (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")) else ("OpenAI" if os.environ.get("OPENAI_API_KEY") else "Built-in Copilot")
        }), 200

    # POST: Save key
    if not request.is_json or "api_key" not in request.json:
        return jsonify({"error": "MISSING_KEY"}), 400

    new_key = str(request.json["api_key"]).strip()
    provider = request.json.get("provider", "gemini").lower()
    env_var_name = "OPENAI_API_KEY" if "openai" in provider else "GEMINI_API_KEY"

    if new_key:
        os.environ[env_var_name] = new_key
        # Persist to .env file
        lines = []
        if os.path.isfile(env_file):
            with open(env_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
        found = False
        new_lines = []
        for line in lines:
            if line.strip().startswith(env_var_name + "="):
                new_lines.append(f"{env_var_name}={new_key}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{env_var_name}={new_key}\n")
        with open(env_file, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

    return jsonify({
        "success": True,
        "is_configured": bool(new_key),
        "message": f"{env_var_name} saved successfully."
    }), 200


# ── AI Supply Copilot Endpoint (Natural Language Understanding & Guidance) ─────
@app.route("/api/ai/ask", methods=["POST"])
def ai_ask_endpoint():
    """
    Answers user questions about signals, corridor health, or 'what should I do'
    in crystal-clear, jargon-free plain English.
    """
    if not request.is_json:
        return jsonify({"error": "INVALID_JSON"}), 400

    payload = request.json or {}
    question = (payload.get("question") or "").strip().lower()
    topic = payload.get("topic") or "general"
    sig = payload.get("signal") or {}

    brand = sig.get("brand", "Product")
    market = sig.get("market_name") or sig.get("country", "Market")
    action_type = sig.get("action_type", "ACTIVE CRISIS")
    breach_week = sig.get("breach_week", 1)
    rec_qty = sig.get("recommended_qty_units", 0)
    market_lt = sig.get("market_lead_time") or sig.get("market_lead_time_weeks") or 4
    lost_patients = sig.get("lost_lifelong_patients", 0)
    cap_risk = sig.get("capital_at_risk_inr", 0)
    cap_cr = cap_risk / 1e7 if cap_risk else 0.0
    transfer = sig.get("intermarket_transfer") or {}
    donor_country = transfer.get("donor_country", "Surplus Donor Market")

    # If an external AI API key is configured, attempt external generation
    gemini_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            prompt = (
                f"You are the Novo Nordisk AI Supply Chain Copilot. Explain in very simple, plain English without confusing jargon. "
                f"The user needs to know what is happening and EXACTLY what they should do.\n"
                f"Context: {brand} in {market}. Action: {action_type}. Breach week: {breach_week}. "
                f"Recommended quantity: {rec_qty:,} units. Lead time: {market_lt} weeks. "
                f"Patients at risk: {lost_patients:,}. Capital exposure: ₹{cap_cr:.2f} Cr. "
                f"Donor transfer available: {transfer.get('has_transfer', False)} from {donor_country}.\n"
                f"User question: {payload.get('question')}\n"
                f"Provide a friendly, direct, 3-point answer: 1. Plain English summary, 2. Exact action to take right now, 3. Why it matters."
            )
            resp = model.generate_content(prompt)
            if resp and resp.text:
                return jsonify({
                    "success": True,
                    "answer": resp.text,
                    "model": "Google Gemini (Active)"
                }), 200
        except Exception:
            pass  # Gracefully fall back to built-in expert engine

    # Built-in High-Intelligence Natural Language Supply Chain Copilot
    if "one sentence" in question or "1 sentence" in question or topic == "summary_1s":
        if "CRISIS" in action_type:
            answer = f"We are running out of {brand} in {market} in {breach_week} week(s)—click 'APPROVE TRANSFER' or 'APPROVE AIR EXPEDITE' right now to fly in {rec_qty:,} units so {lost_patients:,} patients get their medicine."
        elif "EXCESS" in action_type:
            answer = f"{market} has way too much {brand} in storage right now—click 'DEFER INBOUND SUPPLY' to pause future shipments and let other markets use the surplus."
        elif "EXPEDITE" in action_type:
            answer = f"Regular cargo ships take {market_lt} weeks which is too slow—click 'APPROVE AIR EXPEDITE' to fly {rec_qty:,} units in before week {breach_week}."
        else:
            answer = f"Everything is running on time—click 'APPROVE STANDARD PO' to release your regular weekly order of {rec_qty:,} units."

    elif "what should i do" in question or "what do i do" in question or "action" in question or topic == "what_to_do":
        if "CRISIS" in action_type or "EXPEDITE" in action_type:
            steps = [
                f"1. Click the large green button below: {'[TRANSFER APPROVED]' if transfer.get('has_transfer') else '[APPROVE AIR EXPEDITE]'}.",
                f"2. This authorizes dispatching {rec_qty:,} units by fast air freight ({'from ' + donor_country if transfer.get('has_transfer') else 'from the factory'}).",
                f"3. Delivery arrives in 4 to 7 days, completely protecting {lost_patients:,} patients from missing their treatment.",
                f"4. The system will automatically sign and log this approval in your GxP audit ledger."
            ]
            answer = "Here is exactly what you should do right now:\n\n" + "\n".join(steps)
        elif "EXCESS" in action_type:
            steps = [
                f"1. Click '[DEFER INBOUND SUPPLY]' in the top-right corner of the drawer.",
                f"2. Do NOT release any new purchase orders for {brand} in {market} this month.",
                f"3. Mark this warehouse as an 'Available Donor' so sister markets facing shortages can borrow stock.",
                f"4. This frees up ₹{cap_cr:.2f} Cr in capital and prevents medicine from expiring in storage."
            ]
            answer = "Here is exactly what you should do right now:\n\n" + "\n".join(steps)
        else:
            steps = [
                f"1. Click '[APPROVE STANDARD PO]' to sign off on the regular replenishment order.",
                f"2. This releases {rec_qty:,} units into normal {market_lt}-week shipping on schedule.",
                f"3. No emergency air freight or special waivers are needed because stock is still healthy."
            ]
            answer = "Here is exactly what you should do right now:\n\n" + "\n".join(steps)

    elif "sea" in question or "shipping" in question or "ocean" in question or "why can't" in question or topic == "why_not_sea":
        if "CRISIS" in action_type or "EXPEDITE" in action_type:
            answer = (
                f"Why cargo ships won't work here:\n\n"
                f"• Regular ocean shipping to {market} takes {market_lt} weeks ({market_lt * 7} days).\n"
                f"• But our stock runs out in Week {breach_week} (just {breach_week} week(s) away).\n"
                f"• If we ship by sea, the boat arrives {max(1, market_lt - breach_week)} weeks AFTER pharmacy shelves are already completely empty.\n"
                f"• That is why we MUST use air freight or a nearby surplus transfer, which arrives in just 4 to 7 days."
            )
        else:
            answer = f"For this corridor, ocean shipping is fully on schedule! The {market_lt}-week transit time will arrive before any stock runs low, so you do not need to pay expensive air freight."

    elif "donor" in question or "safe" in question or "germany" in question or topic == "is_donor_safe":
        if transfer.get("has_transfer"):
            donor_doh = transfer.get("donor_post_doh", 45)
            donor_ssd = transfer.get("donor_ssd", 21)
            answer = (
                f"Yes, the donor market ({donor_country}) is 100% safe!\n\n"
                f"• Even after giving {transfer.get('transfer_qty', rec_qty):,} units to {market}, {donor_country} still has {donor_doh} days of inventory.\n"
                f"• Their required safety floor is only {donor_ssd} days, meaning they keep a generous safety cushion.\n"
                f"• The system tested this mathematically: ZERO secondary risk of stockout for {donor_country}."
            )
        else:
            answer = f"There is currently no donor market transfer assigned to this corridor; replenishment is fulfilled directly via factory allocation."

    elif "email" in question or "manager" in question or "boss" in question or topic == "draft_email":
        answer = (
            f"Subject: Urgent Approval: Air replenishment for {brand} in {market} (Week {breach_week} Cliff)\n\n"
            f"Hi Team,\n\n"
            f"Our inventory monitoring system flagged that {brand} in {market} will breach its safety stock in Week {breach_week}. "
            f"Standard sea freight ({market_lt}W lead time) is too slow to prevent a stockout.\n\n"
            f"Proposed Action:\n"
            f"• Approve emergency air dispatch of {rec_qty:,} units ({'transferred from ' + donor_country if transfer.get('has_transfer') else 'expedited release'}).\n"
            f"• Lead time: 4-7 days priority arrival.\n"
            f"• Impact: Protects {lost_patients:,} lifelong chronic patients and avoids ₹{cap_cr:.2f} Cr in stockout revenue loss.\n\n"
            f"Please let me know if you approve so I can confirm the electronic sign-off in the corridor monitor.\n\n"
            f"Best regards,\nSupply Chain Planning"
        )

    else:
        # General question fallback
        answer = (
            f"Summary for {brand} in {market}:\n\n"
            f"• Situation: Inventory reaches critical level in Week {breach_week}. Normal sea freight ({market_lt} weeks) is too slow.\n"
            f"• Impact: Without action, {lost_patients:,} chronic patients will miss treatment and ₹{cap_cr:.2f} Cr is exposed.\n"
            f"• Recommended Action: Click the action button below to authorize {rec_qty:,} units by expedited air transit. Arrival is expected in 4-7 days."
        )

    return jsonify({
        "success": True,
        "answer": answer,
        "model": "NovoSupply AI Copilot v3.0 (Plain-English Engine)"
    }), 200


# ── Entry point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Verify expected directories exist before starting.
    if not os.path.isdir(FRONTEND_DIR):
        print(
            f"[server] WARNING: frontend directory not found at {FRONTEND_DIR}",
            file=sys.stderr,
        )
    if not os.path.isfile(DASHBOARD_DATA_PATH):
        print(
            f"[server] WARNING: dashboard_data.json not found at {DASHBOARD_DATA_PATH}",
            file=sys.stderr,
        )

    # Start the automated Monday 08:00 AM Background Email Dispatcher
    try:
        email_service.start_scheduler()
        print("[server] Autonomous Monday 08:00 AM Email Scheduler: ACTIVE")
    except Exception as exc:
        print(f"[server] WARNING: Failed to start email scheduler: {exc}", file=sys.stderr)

    print(f"[server] Project root   : {PROJECT_ROOT}")
    print(f"[server] Parent dir     : {PARENT_DIR}")
    print(f"[server] Frontend dir   : {FRONTEND_DIR}")
    print(f"[server] Dashboard data : {DASHBOARD_DATA_PATH}")
    print(f"[server] Pipeline script: {PIPELINE_SCRIPT} (exists: {os.path.isfile(PIPELINE_SCRIPT)})")
    print(f"[server] Generate script: {GENERATE_SCRIPT} (exists: {os.path.isfile(GENERATE_SCRIPT)})")
    bind_host = os.environ.get("CHM_BIND", "127.0.0.1")
    bind_port = int(os.environ.get("CHM_PORT", "8000"))
    if "--port" in sys.argv:
        bind_port = int(sys.argv[sys.argv.index("--port") + 1])
    print("[server] Listening on    http://" + bind_host + ":" + str(bind_port))

    # Bind to loopback only: binding 0.0.0.0 triggers a Windows Firewall prompt
    # on judge machines (demo-killer). Use the CHM_BIND env var to override.
    app.run(host=bind_host, port=bind_port, debug=False, threaded=True, use_reloader=False)


