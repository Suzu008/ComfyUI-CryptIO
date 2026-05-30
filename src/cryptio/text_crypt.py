import base64
from comfy_api.latest import io

from .utils import _key_manager
from .utils.crypto_utils import decrypt_data_hybrid


class TextEncrypt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TextEncrypt",
            display_name="Text Encrypt 🔒",
            category="CryptIO🔒",
            description="Encrypt text with server public key (encryption performed in frontend JavaScript)",
            inputs=[
                io.String.Input("text", multiline=True, default="Text to encrypt", tooltip="Text to encrypt"),
                io.Boolean.Input("encrypted", default=False, tooltip="Whether the text has been encrypted by the frontend"),
            ],
            outputs=[
                io.String.Output(display_name="text"),
                io.String.Output(display_name="encrypted_text"),
            ],
        )

    @classmethod
    def execute(cls, text, encrypted):
        try:
            if text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(text[10:])
                decrypted_data = decrypt_data_hybrid(encrypted_bytes, _key_manager.server_private_key)
                decrypted_text = decrypted_data.decode("utf-8")
                return io.NodeOutput(decrypted_text, text)
            else:
                raise ValueError("Text is not in encrypted format")
        except Exception as e:
            print(f"Decryption error: {e}")
            return io.NodeOutput(f"Decryption error: {str(e)}", text)


class TextDecrypt(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TextDecrypt",
            display_name="Text Decrypt 🔒",
            category="CryptIO🔒",
            description="Decrypt text encrypted with client public key using server private key",
            inputs=[
                io.String.Input("encrypted_text", multiline=True, default="ENCRYPTED:...", tooltip="Encrypted text to decrypt"),
            ],
            outputs=[
                io.String.Output(display_name="decrypted_text"),
            ],
        )

    @classmethod
    def execute(cls, encrypted_text):
        try:
            if encrypted_text.startswith("ENCRYPTED:"):
                encrypted_bytes = base64.b64decode(encrypted_text[10:])
                decrypted_data = decrypt_data_hybrid(encrypted_bytes, _key_manager.server_private_key)
                decrypted_text = decrypted_data.decode("utf-8")
                return io.NodeOutput(decrypted_text)
            else:
                return io.NodeOutput(encrypted_text)
        except Exception as e:
            print(f"Decryption error: {e}")
            return io.NodeOutput(f"Decryption error: {str(e)}")
