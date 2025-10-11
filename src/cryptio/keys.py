import os
import json
import base64
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend

# 密钥存储路径（JSON + Base64）
KEY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "keys")
KEY_JSON_PATH = os.path.join(KEY_DIR, "keys.json")

# 兼容旧版 PEM 文件路径（用于迁移）
SERVER_PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "server_public_key.pem")
SERVER_PRIVATE_KEY_PATH = os.path.join(KEY_DIR, "server_private_key.pem")
CLIENT_PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "client_public_key.pem")

os.makedirs(KEY_DIR, exist_ok=True)

# 内存缓存，避免频繁 IO
_KEY_CACHE = None
_KEY_CACHE_MTIME = None


def _read_file_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        return f.read()


def _save_keys_json(server_public_pem: bytes, server_private_pem: bytes, client_public_pem: bytes | None = None):
    data = {
        "server_public_key": base64.b64encode(server_public_pem).decode("ascii"),
        "server_private_key": base64.b64encode(server_private_pem).decode("ascii"),
    }
    if client_public_pem is not None:
        data["client_public_key"] = base64.b64encode(client_public_pem).decode("ascii")
    with open(KEY_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _load_keys_json() -> dict:
    with open(KEY_JSON_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    keys = {
        "server_public_key": base64.b64decode(raw["server_public_key"]),
        "server_private_key": base64.b64decode(raw["server_private_key"]),
    }
    if "client_public_key" in raw:
        keys["client_public_key"] = base64.b64decode(raw["client_public_key"])
    return keys


def _ensure_keys_exist():
    """确保 keys.json 存在；若不存在则生成或从旧文件迁移。"""
    if os.path.exists(KEY_JSON_PATH):
        return

    server_pub = None
    server_pri = None
    client_pub = None

    # 迁移旧 PEM 文件到 JSON
    if os.path.exists(SERVER_PUBLIC_KEY_PATH) and os.path.exists(SERVER_PRIVATE_KEY_PATH):
        try:
            server_pub = _read_file_bytes(SERVER_PUBLIC_KEY_PATH)
            server_pri = _read_file_bytes(SERVER_PRIVATE_KEY_PATH)
            if os.path.exists(CLIENT_PUBLIC_KEY_PATH):
                client_pub = _read_file_bytes(CLIENT_PUBLIC_KEY_PATH)
        except Exception:
            server_pub = None
            server_pri = None

    # 如果没有旧文件，生成新的密钥对
    if server_pub is None or server_pri is None:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
        public_key = private_key.public_key()

        server_pri = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        server_pub = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

    _save_keys_json(server_pub, server_pri, client_pub)


def _get_keys() -> dict:
    """获取密钥（带内存缓存），当文件变化时自动刷新。"""
    global _KEY_CACHE, _KEY_CACHE_MTIME
    try:
        mtime = os.path.getmtime(KEY_JSON_PATH) if os.path.exists(KEY_JSON_PATH) else None
    except Exception:
        mtime = None

    if _KEY_CACHE is not None and _KEY_CACHE_MTIME == mtime:
        return _KEY_CACHE

    # 初次或文件已更新，重新加载
    _ensure_keys_exist()
    if os.path.exists(KEY_JSON_PATH):
        keys = _load_keys_json()
        _KEY_CACHE = keys
        try:
            _KEY_CACHE_MTIME = os.path.getmtime(KEY_JSON_PATH)
        except Exception:
            _KEY_CACHE_MTIME = None
        return keys
    else:
        _KEY_CACHE = {}
        _KEY_CACHE_MTIME = None
        return _KEY_CACHE


def update_client_public_key(client_public_pem: bytes):
    """更新客户端公钥到 keys.json"""
    global _KEY_CACHE, _KEY_CACHE_MTIME

    # 确保服务端密钥存在
    _ensure_keys_exist()
    keys = _load_keys_json()

    # 更新客户端公钥
    _save_keys_json(
        keys["server_public_key"],
        keys["server_private_key"],
        client_public_pem
    )

    # 清空缓存，强制重新加载
    _KEY_CACHE = None
    _KEY_CACHE_MTIME = None