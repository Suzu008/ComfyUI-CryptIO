import base64
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
from .keys import _get_keys


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