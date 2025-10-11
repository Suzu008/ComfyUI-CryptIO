from numbers import Number
import os
import json
import base64
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from server import PromptServer
from aiohttp import web

# 密钥存储路径（整合为单一 JSON 文件，使用 Base64 编码）
KEY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "keys")
SERVER_PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "server_public_key.pem")  # 兼容旧存储（迁移用）
SERVER_PRIVATE_KEY_PATH = os.path.join(KEY_DIR, "server_private_key.pem")  # 兼容旧存储（迁移用）
CLIENT_PUBLIC_KEY_PATH = os.path.join(KEY_DIR, "client_public_key.pem")  # 兼容旧存储（迁移用）
KEY_JSON_PATH = os.path.join(KEY_DIR, "keys.json")
os.makedirs(KEY_DIR, exist_ok=True)

# 读取密钥缓存，避免频繁读取文件
_KEY_CACHE = None
_KEY_CACHE_MTIME = None

def _read_file_bytes(path: str):
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

def _load_keys_json():
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

def _get_keys():
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
        # 理论上不会到这里，但为安全起见返回空结构
        _KEY_CACHE = {}
        _KEY_CACHE_MTIME = None
        return _KEY_CACHE


@PromptServer.instance.routes.get("/cryptio/public_key")
async def get_public_key(request):
    keys = _get_keys()
    pub = keys.get("server_public_key")
    if pub:
        return web.json_response({"public_key": pub.decode("utf-8")})
    else:
        return web.json_response({"error": "Public key not found"}, status=404)


class KeyGenerator:
    """
    生成RSA密钥对并提供API接口供客户端获取公钥
    """

    def __init__(self):
        _ensure_keys_exist()

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("public_key",)
    FUNCTION = "generate"
    CATEGORY = "CryptIO"

    def generate_keys_if_not_exist(self):
        """兼容旧接口：确保密钥存在（现使用 JSON 存储）。"""
        _ensure_keys_exist()

    def generate(self):
        """返回公钥（使用缓存避免频繁 IO）"""
        public_key = _get_keys()["server_public_key"].decode("utf-8")
        return (public_key,)


class ClientEncrypt:
    """
    客户端加密节点，使用公钥加密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": "要加密的文本"}),
                "encrypted": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("encrypted_text",)
    FUNCTION = "encrypt"
    CATEGORY = "CryptIO"

    def encrypt(self, text: int, encrypted):
        """使用公钥加密文本"""
        # 在客户端JavaScript中实现，这里只是占位符
        # 实际加密在前端JavaScript中完成
        return (text,)


class ServerDecrypt:
    """
    服务端解密节点，使用私钥解密文本
    """

    def __init__(self):
        pass

    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "encrypted_text": ("STRING", {"multiline": True, "default": "ENCRYPTED:加密的文本"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("decrypted_text",)
    FUNCTION = "decrypt"
    CATEGORY = "CryptIO"

    def decrypt(self, encrypted_text):
        """使用私钥解密文本（私钥从缓存加载）"""
        try:
            if encrypted_text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(encrypted_text[10:])

                private_pem = _get_keys().get("server_private_key")
                private_key = serialization.load_pem_private_key(private_pem, password=None, backend=default_backend())

                decrypted_bytes = private_key.decrypt(
                    encrypted_bytes,
                    padding.OAEP(
                        mgf=padding.MGF1(algorithm=hashes.SHA256()),
                        algorithm=hashes.SHA256(),
                        label=None,
                    ),
                )

                decrypted_text = decrypted_bytes.decode("utf-8")
                return (decrypted_text,)
            else:
                return (encrypted_text,)
        except Exception as e:
            print(f"解密错误: {e}")
            return (f"解密错误: {str(e)}",)


# 节点映射
NODE_CLASS_MAPPINGS = {
    "KeyGenerator": KeyGenerator,
    "ClientEncrypt": ClientEncrypt,
    "ServerDecrypt": ServerDecrypt,
}

# 节点显示名称映射
NODE_DISPLAY_NAME_MAPPINGS = {
    "KeyGenerator": "密钥生成器",
    "ClientEncrypt": "客户端加密",
    "ServerDecrypt": "服务端解密",
}
