import base64
from .utils import _key_manager
from .utils.crypto_utils import decrypt_data_hybrid


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
        """使用私钥解密文本（支持混合加密格式）"""
        try:
            if encrypted_text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(encrypted_text[10:])

                # 使用混合解密
                decrypted_data = decrypt_data_hybrid(encrypted_bytes, _key_manager.server_private_key)
                decrypted_text = decrypted_data.decode("utf-8")
                return (decrypted_text,)
            else:
                return (encrypted_text,)
        except Exception as e:
            print(f"解密错误: {e}")
            return (f"解密错误: {str(e)}",)