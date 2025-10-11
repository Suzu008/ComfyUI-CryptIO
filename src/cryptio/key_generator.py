from .keys import _ensure_keys_exist, _get_keys


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