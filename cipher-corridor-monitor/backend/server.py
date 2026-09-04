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
import tempfile
import subprocess

from flask import Flask, send_from_directory, jsonify, request, Response

# ── Path resolution ────────────────────────────────────────────────────────────
# ── Path resolution ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
PARENT_DIR = os.path.dirname(PROJECT_ROOT)
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
BACKEND_DIR = BASE_DIR
DASHBOARD_DATA_PATH = os.path.join(BACKEND_DIR, "dashboard_data.json")

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


# ── Static file serving — frontend/ ───────────────────────────────────────────
@app.route("/")
def serve_index():
    """Serve the SPA entry point."""
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    """Serve any static asset from frontend/ (JS, CSS, fonts, etc.)."""
    return send_from_directory(FRONTEND_DIR, filename)


# ── Dashboard data ─────────────────────────────────────────────────────────────
@app.route("/dashboard_data.json")
def serve_dashboard_data():
    """Serve the current backend/dashboard_data.json as application/json."""
    return send_from_directory(BACKEND_DIR, "dashboard_data.json")


# ── Upload endpoint ────────────────────────────────────────────────────────────
@app.route("/upload", methods=["POST"])
def upload():
    """
    Accept a multipart/form-data POST with a field named 'file' (.xlsx only).

    Validation:
      1. File extension must be .xlsx           → HTTP 400 WRONG_FILE_TYPE
      2. Workbook must contain an 'Export' sheet → HTTP 422 INVALID_WORKBOOK

    On success:
      - Save to a temp file
      - Run corridor_pipeline.py --rebuild (subprocess)
      - Run generate_dashboard_data.py (subprocess)
      - Stream back the updated dashboard_data.json → HTTP 200

    On subprocess failure:
      - Return HTTP 500 PIPELINE_FAILURE with stderr detail
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

        # ── 6. Run corridor_pipeline.py --rebuild ──────────────────────────
        if not os.path.isfile(PIPELINE_SCRIPT):
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"corridor_pipeline.py not found at resolved script path: {PIPELINE_SCRIPT}. Checked paths: {PIPELINE_CANDIDATES}",
                }
            ), 500

        try:
            result_pipeline = subprocess.run(
                [sys.executable, PIPELINE_SCRIPT, "--rebuild"],
                capture_output=True,
                text=True,
                cwd=cwd,
                env=pipeline_env,
            )
        except FileNotFoundError as exc:
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"Failed to execute pipeline script {PIPELINE_SCRIPT}: {exc}",
                }
            ), 500

        if result_pipeline.returncode != 0:
            return jsonify(
                {
                    "error": "PIPELINE_FAILURE",
                    "detail": result_pipeline.stderr or result_pipeline.stdout,
                }
            ), 500

        # ── 7. Run generate_dashboard_data.py ─────────────────────────────
        if not os.path.isfile(GENERATE_SCRIPT):
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"generate_dashboard_data.py not found at {GENERATE_SCRIPT}. Checked paths: {GENERATE_CANDIDATES}",
                }
            ), 500

        try:
            result_generate = subprocess.run(
                [sys.executable, GENERATE_SCRIPT],
                capture_output=True,
                text=True,
                cwd=cwd,
                env=pipeline_env,
            )
        except FileNotFoundError as exc:
            return jsonify(
                {
                    "error": "FILE_NOT_FOUND",
                    "detail": f"Failed to execute generator script {GENERATE_SCRIPT}: {exc}",
                }
            ), 500

        if result_generate.returncode != 0:
            return jsonify(
                {
                    "error": "PIPELINE_FAILURE",
                    "detail": result_generate.stderr or result_generate.stdout,
                }
            ), 500

        # ── 8. Synchronize parquet & findings to parent directory if applicable ──
        try:
            import shutil
            for fname in ["corridor_panel.parquet", "corridor_findings.json"]:
                sf = os.path.join(BACKEND_DIR, fname)
                df = os.path.join(PARENT_DIR, fname)
                if os.path.isfile(sf) and os.path.isdir(PARENT_DIR) and sf != df:
                    shutil.copy2(sf, df)
        except Exception:
            pass

        # ── 9. Stream back the freshly generated dashboard_data.json ──────
        try:
            with open(DASHBOARD_DATA_PATH, "r", encoding="utf-8") as fh:
                payload = fh.read()
        except OSError as exc:
            return jsonify({"error": "PIPELINE_FAILURE", "detail": str(exc)}), 500

        return Response(payload, status=200, mimetype="application/json")

    finally:
        # Always clean up the temp file regardless of outcome.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


# ── Demo / default dataset loader endpoint ─────────────────────────────────────
@app.route("/load-demo", methods=["POST", "GET"])
def load_demo():
    """
    Returns the pre-processed demonstration dataset (or generates it if missing).
    Provides instant start for testing without needing to upload 30 MB manually.
    """
    if os.path.isfile(DASHBOARD_DATA_PATH):
        try:
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
    print("[server] Listening on    http://0.0.0.0:8000")

    app.run(host="0.0.0.0", port=8000, debug=False, threaded=True, use_reloader=False)
