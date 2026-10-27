#!/usr/bin/env python3
"""THREE O'CLOCK HR — tiny shared-data server (stdlib only)."""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
STORE_PATH = DATA_DIR / "store.json"
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "4173"))
GIST_ID = os.environ.get("GIST_ID", "").strip()
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()

LOCK = threading.Lock()
SESSIONS = {}  # token -> {userId, exp}


def to_int32(n: int) -> int:
    n = n & 0xFFFFFFFF
    if n & 0x80000000:
        n -= 0x100000000
    return n


def js_hash(text: str) -> int:
    h = 2166136261
    for ch in text:
        h = to_int32(h) ^ ord(ch)
        h = to_int32(h * 16777619)
    return h & 0xFFFFFFFF


def hash_password(password: str) -> str:
    return str(js_hash(f"toc-hr:{password}"))


def empty_store() -> dict:
    return {
        "version": 0,
        "state": {
            "version": "bhilai-2",
            "employees": [],
            "attendance": [],
            "users": [
                {
                    "id": "user-owner",
                    "username": "owner",
                    "password": hash_password("3oclock"),
                    "role": "owner",
                    "employeeId": None,
                    "name": "Owner",
                }
            ],
            "leaves": [],
            "advances": [],
            "kajalSeeded": False,
            "octoberStaffSeeded": False,
        },
    }


def gist_load() -> dict | None:
    if not (GIST_ID and GITHUB_TOKEN):
        return None
    req = Request(
        f"https://api.github.com/gists/{GIST_ID}",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "threeoclock-hr",
        },
    )
    with urlopen(req, timeout=20) as res:
        payload = json.loads(res.read().decode("utf-8"))
    content = payload.get("files", {}).get("store.json", {}).get("content")
    if not content:
        return None
    return json.loads(content)


def gist_save(store: dict) -> None:
    if not (GIST_ID and GITHUB_TOKEN):
        return
    body = json.dumps(
        {"files": {"store.json": {"content": json.dumps(store, ensure_ascii=False)}}}
    ).encode("utf-8")
    req = Request(
        f"https://api.github.com/gists/{GIST_ID}",
        data=body,
        method="PATCH",
        headers={
            "Authorization": f"Bearer {GITHUB_TOKEN}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "threeoclock-hr",
        },
    )
    with urlopen(req, timeout=20) as res:
        res.read()


def read_store() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    remote = None
    try:
        remote = gist_load()
    except Exception:
        remote = None
    store = None
    if remote and isinstance(remote, dict) and "state" in remote:
        store = remote
    elif STORE_PATH.exists():
        try:
            store = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        except Exception:
            store = None
    if not store or not isinstance(store, dict) or "state" not in store:
        store = empty_store()
        write_store(store)
        return store
    store.setdefault("state", {})
    ensure_owner(store["state"])
    return store


def write_store(store: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(STORE_PATH)
    try:
        gist_save(store)
    except Exception:
        pass


def public_state(state: dict) -> dict:
    clone = json.loads(json.dumps(state))
    for user in clone.get("users", []):
        user.pop("password", None)
    return clone


def ensure_owner(state: dict) -> dict:
    hashed = hash_password("3oclock")
    owner = None
    for user in state.get("users", []):
        if user.get("role") == "owner" or str(user.get("username") or "").lower() == "owner":
            owner = user
            break
    if owner:
        owner["id"] = owner.get("id") or "user-owner"
        owner["username"] = "owner"
        owner["password"] = hashed
        owner["role"] = "owner"
        owner["name"] = owner.get("name") or "Owner"
        owner["employeeId"] = None
    else:
        state.setdefault("users", []).insert(
            0,
            {
                "id": "user-owner",
                "username": "owner",
                "password": hashed,
                "role": "owner",
                "employeeId": None,
                "name": "Owner",
            },
        )
    return state


def find_user(state: dict, username: str):
    username = username.lower()
    for user in state.get("users", []):
        if user.get("username", "").lower() == username:
            return user
    return None


def session_user(token: str, state: dict):
    sess = SESSIONS.get(token or "")
    if not sess or sess["exp"] < time.time():
        SESSIONS.pop(token or "", None)
        return None
    for user in state.get("users", []):
        if user.get("id") == sess["userId"]:
            return user
    return None


def make_token(user: dict) -> str:
    token = secrets.token_hex(16)
    SESSIONS[token] = {"userId": user["id"], "exp": time.time() + 60 * 60 * 24 * 30}
    return token


def user_view(user: dict) -> dict:
    return {
        "id": user.get("id"),
        "username": user.get("username"),
        "role": user.get("role"),
        "name": user.get("name"),
        "employeeId": user.get("employeeId"),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")

    def _json(self, code: int, payload: dict):
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _token(self) -> str:
        header = self.headers.get("Authorization") or ""
        if header.lower().startswith("bearer "):
            return header.split(" ", 1)[1].strip()
        return ""

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/data") or path.endswith(".py"):
            return self._json(404, {"error": "Not found."})
        if path == "/api/health":
            return self._json(200, {"ok": True})
        if path == "/api/state":
            with LOCK:
                store = read_store()
                user = session_user(self._token(), store["state"])
                if not user:
                    return self._json(401, {"error": "Sign in required."})
                return self._json(
                    200,
                    {"version": store.get("version", 0), "state": public_state(store["state"])},
                )
        if path in ("/", "/index.html"):
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self._body()
        except Exception:
            return self._json(400, {"error": "Invalid JSON."})

        if path == "/api/login":
            username = str(body.get("username") or "").strip().lower()
            password = str(body.get("password") or "")
            with LOCK:
                store = read_store()
                user = find_user(store["state"], username)
                if not user or user.get("password") != hash_password(password):
                    return self._json(401, {"error": "Those credentials are not recognised."})
                token = make_token(user)
                return self._json(200, {"token": token, "user": user_view(user)})

        if path == "/api/register":
            username = str(body.get("username") or "").strip().lower()
            password = str(body.get("password") or "")
            name = str(body.get("name") or "").strip()
            if not username or not password or not name or len(password) < 6:
                return self._json(400, {"error": "Name, username, and a password of 6+ characters are required."})
            with LOCK:
                store = read_store()
                state = store["state"]
                if find_user(state, username):
                    return self._json(409, {"error": "That username is taken. Choose another."})
                email = str(body.get("email") or "").strip()
                employee = None
                if email:
                    for emp in state.get("employees", []):
                        if (emp.get("email") or "").lower() == email.lower():
                            employee = emp
                            break
                if employee and any(u.get("employeeId") == employee["id"] for u in state.get("users", [])):
                    return self._json(409, {"error": "This person already has a login. Sign in instead."})
                if not employee:
                    nums = [int("".join(ch for ch in str(e.get("code") or "") if ch.isdigit()) or 0) for e in state.get("employees", [])]
                    code = "TOC-%03d" % (max(nums or [0]) + 1)
                    employee = {
                        "id": "emp-%s" % secrets.token_hex(8),
                        "code": code,
                        "name": name,
                        "email": email,
                        "phone": str(body.get("phone") or "").strip(),
                        "department": "Kitchen Counter",
                        "position": "Barista",
                        "store": "Bhilai",
                        "status": "pending",
                        "hireDate": time.strftime("%Y-%m-%d"),
                        "defaultShift": "morning",
                        "baseSalary": 0,
                        "mealAllowance": 0,
                        "nightAllowance": 0,
                        "bankName": "",
                        "bankAccount": "",
                        "bankHolder": name,
                    }
                    state.setdefault("employees", []).append(employee)
                user = {
                    "id": "user-%s" % secrets.token_hex(8),
                    "username": username,
                    "password": hash_password(password),
                    "role": "employee",
                    "employeeId": employee["id"],
                    "name": employee.get("name") or name,
                }
                state.setdefault("users", []).append(user)
                store["version"] = int(store.get("version") or 0) + 1
                write_store(store)
                token = make_token(user)
                return self._json(
                    200,
                    {"token": token, "user": user_view(user), "version": store["version"], "state": public_state(state)},
                )

        if path == "/api/logout":
            SESSIONS.pop(self._token(), None)
            return self._json(200, {"ok": True})

        return self._json(404, {"error": "Not found."})

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/state":
            return self._json(404, {"error": "Not found."})
        try:
            body = self._body()
        except Exception:
            return self._json(400, {"error": "Invalid JSON."})
        incoming = body.get("state")
        if not isinstance(incoming, dict):
            return self._json(400, {"error": "Missing state."})
        with LOCK:
            store = read_store()
            user = session_user(self._token(), store["state"])
            if not user:
                return self._json(401, {"error": "Sign in required."})
            current_version = int(store.get("version") or 0)
            try:
                client_version = int(body["version"])
            except (KeyError, TypeError, ValueError):
                client_version = -1
            if client_version != current_version:
                return self._json(
                    409,
                    {
                        "error": "Data was updated elsewhere. Reloaded the latest copy.",
                        "version": current_version,
                        "state": public_state(store["state"]),
                    },
                )
            passwords = {u.get("id"): u.get("password") for u in store["state"].get("users", [])}
            for user_row in incoming.get("users", []):
                if not user_row.get("password"):
                    user_row["password"] = passwords.get(user_row.get("id"), user_row.get("password"))
            incoming.setdefault("leaves", [])
            incoming.setdefault("advances", [])
            store["state"] = incoming
            store["version"] = current_version + 1
            write_store(store)
            return self._json(200, {"version": store["version"], "state": public_state(store["state"])})


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with LOCK:
        read_store()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"THREE O'CLOCK HR running on http://{HOST}:{PORT}")
    if GIST_ID:
        print("Persistent store: GitHub Gist")
    else:
        print(f"Persistent store: {STORE_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
