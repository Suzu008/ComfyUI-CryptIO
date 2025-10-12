"""
密钥工具模块
提供密钥导入、导出、加载、存储管理等功能
"""

import os
import json
import base64
from typing import Optional, cast
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey, RSAPrivateKey
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend


class KeyManager:
    """
    密钥管理器单例类
    负责密钥的加载、缓存、更新和持久化
    """

    _instance: Optional["KeyManager"] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        """初始化密钥管理器（仅首次调用时执行）"""
        if self._initialized:
            return

        # 密钥存储路径
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        self._key_dir = os.path.join(base_dir, "keys")
        self._key_file = os.path.join(self._key_dir, "keys.json")
        os.makedirs(self._key_dir, exist_ok=True)

        # 缓存状态
        self._cache_mtime: Optional[float] = None
        self._server_public_key: Optional[RSAPublicKey] = None
        self._server_private_key: Optional[RSAPrivateKey] = None
        self._client_public_key: Optional[RSAPublicKey] = None
        self._server_public_key_pem: Optional[bytes] = None
        self._server_private_key_pem: Optional[bytes] = None
        self._client_public_key_pem: Optional[bytes] = None

        # 初始化加载
        self._load()
        self._initialized = True

    def _load(self):
        """加载密钥到缓存"""
        # 检查文件修改时间
        try:
            current_mtime = os.path.getmtime(self._key_file) if os.path.exists(self._key_file) else None
        except Exception:
            current_mtime = None

        # 缓存命中
        if self._cache_mtime == current_mtime and self._server_private_key is not None:
            return

        # 确保密钥文件存在
        if not os.path.exists(self._key_file):
            self._generate_server_keys()

        # 从文件加载
        with open(self._key_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        # 解码 PEM 数据
        self._server_public_key_pem = base64.b64decode(data["server_public_key"])
        self._server_private_key_pem = base64.b64decode(data["server_private_key"])

        if "client_public_key" in data:
            self._client_public_key_pem = base64.b64decode(data["client_public_key"])

        # 加载密钥对象
        self._server_public_key = cast(
            RSAPublicKey, serialization.load_pem_public_key(self._server_public_key_pem, backend=default_backend())
        )
        self._server_private_key = cast(
            RSAPrivateKey, serialization.load_pem_private_key(self._server_private_key_pem, password=None, backend=default_backend())
        )

        if self._client_public_key_pem:
            self._client_public_key = cast(
                RSAPublicKey, serialization.load_pem_public_key(self._client_public_key_pem, backend=default_backend())
            )

        # 更新缓存时间
        self._cache_mtime = current_mtime

    def _generate_server_keys(self):
        """生成服务端密钥对"""
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
        public_key = private_key.public_key()

        self._server_private_key_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        self._server_public_key_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )

        self._save()

    def _save(self):
        """保存密钥到文件"""
        data: dict[str, str] = {}
        if self._server_public_key_pem and self._server_private_key_pem:
            data["server_public_key"] = base64.b64encode(self._server_public_key_pem).decode("ascii")
            data["server_private_key"] = base64.b64encode(self._server_private_key_pem).decode("ascii")

        if self._client_public_key_pem:
            data["client_public_key"] = base64.b64encode(self._client_public_key_pem).decode("ascii")

        with open(self._key_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def reload(self):
        """重新加载密钥（当外部修改文件时调用）"""
        self._cache_mtime = None
        self._load()

    def update_client_key(self, client_public_pem: bytes):
        """
        更新客户端公钥

        Args:
            client_public_pem: 客户端公钥（PEM格式）
        """
        self._client_public_key_pem = client_public_pem
        self._save()
        self.reload()

    # ===== 属性访问器 =====

    @property
    def server_public_key(self) -> Optional[RSAPublicKey]:
        """服务端公钥对象"""
        self._load()
        return self._server_public_key

    @property
    def server_private_key(self) -> Optional[RSAPrivateKey]:
        """服务端私钥对象"""
        self._load()
        return self._server_private_key

    @property
    def client_public_key(self) -> Optional[RSAPublicKey]:
        """客户端公钥对象"""
        self._load()
        return self._client_public_key

    @property
    def server_public_key_pem(self) -> Optional[bytes]:
        """服务端公钥（PEM格式）"""
        self._load()
        return self._server_public_key_pem

    @property
    def server_private_key_pem(self) -> Optional[bytes]:
        """服务端私钥（PEM格式）"""
        self._load()
        return self._server_private_key_pem

    @property
    def client_public_key_pem(self) -> Optional[bytes]:
        """客户端公钥（PEM格式）"""
        self._load()
        return self._client_public_key_pem


# ===== 全局单例实例 =====
_key_manager = KeyManager()
