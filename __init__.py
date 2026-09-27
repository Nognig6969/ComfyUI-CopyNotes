import json
import os
import shutil
from datetime import datetime

from aiohttp import web
from server import PromptServer

# All snippet data lives in this JSON file, inside the custom node's own folder.
# This is what makes it survive page refreshes and full ComfyUI restarts —
# it has nothing to do with any workflow or graph, so it's always there.
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DATA_FILE = os.path.join(DATA_DIR, "copynotes.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

DEFAULT_DATA = {"groups": []}


def _backup_current_data():
    """Copy the current data file into data/backups/ before it gets replaced
    by an import. Returns the backup filename, or None if there was nothing
    to back up yet."""
    if not os.path.exists(DATA_FILE):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_name = f"copynotes-{timestamp}.json"
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    counter = 1
    while os.path.exists(backup_path):
        backup_name = f"copynotes-{timestamp}-{counter}.json"
        backup_path = os.path.join(BACKUP_DIR, backup_name)
        counter += 1
    shutil.copy2(DATA_FILE, backup_path)
    return backup_name


def _ensure_data_file():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(DATA_FILE):
        with open(DATA_FILE, "w", encoding="utf-8") as f:
            json.dump(DEFAULT_DATA, f, indent=2)


def _load_data():
    _ensure_data_file()
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, dict) or "groups" not in data:
                return dict(DEFAULT_DATA)
            return data
    except (json.JSONDecodeError, OSError):
        return dict(DEFAULT_DATA)


def _save_data(data):
    _ensure_data_file()
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


@PromptServer.instance.routes.get("/copynotes/data")
async def copynotes_get(request):
    return web.json_response(_load_data())


@PromptServer.instance.routes.post("/copynotes/data")
async def copynotes_post(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(payload, dict) or "groups" not in payload:
        return web.json_response({"error": "expected an object with a 'groups' array"}, status=400)
    _save_data(payload)
    return web.json_response({"status": "ok"})


@PromptServer.instance.routes.post("/copynotes/import")
async def copynotes_import(request):
    try:
        payload = await request.json()
    except Exception:
        return web.json_response({"error": "invalid json"}, status=400)
    if not isinstance(payload, dict) or not isinstance(payload.get("groups"), list):
        return web.json_response({"error": "expected an object with a 'groups' array"}, status=400)
    backup_name = _backup_current_data()
    _save_data(payload)
    return web.json_response({"status": "ok", "backup": backup_name})


# No graph nodes anymore — this now lives entirely in the sidebar (see web/sidebar.js).
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
