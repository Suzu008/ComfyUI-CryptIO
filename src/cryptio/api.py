import os
import string
import secrets
import json
import base64
from aiohttp import web
from server import PromptServer  # pyright: ignore[reportMissingImports]
import folder_paths  # pyright: ignore[reportMissingImports]
from .utils import _key_manager
from .utils.crypto_utils import (
    encrypt_data_with_public_key,
    generate_aes_key_and_iv,
    encrypt_with_aes_cbc,
)
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend


@PromptServer.instance.routes.post("/cryptio/exchange_keys")
async def exchange_keys(request):
    """
    密钥交换端点：
    1. 接收客户端公钥
    2. 保存客户端公钥到服务器
    3. 使用客户端公钥加密服务端密钥对
    4. 返回加密后的服务端密钥
    """
    try:
        data = await request.json()
        client_public_key_pem = data.get("client_public_key")

        if not client_public_key_pem:
            return web.json_response({"error": "client_public_key is required"}, status=400)

        # 保存客户端公钥
        client_public_key_bytes = client_public_key_pem.encode("utf-8")
        _key_manager.update_client_key(client_public_key_bytes)

        # 获取服务端密钥 PEM 格式
        server_public_key_pem = _key_manager.server_public_key_pem
        server_private_key_pem = _key_manager.server_private_key_pem

        if not server_public_key_pem or not server_private_key_pem:
            return web.json_response({"error": "Server keys not found"}, status=500)

        # 使用客户端公钥加密服务端密钥
        client_public_key = serialization.load_pem_public_key(
            client_public_key_bytes, backend=default_backend()
        )

        # 准备要加密的数据（服务端公钥和私钥）
        keys_data = json.dumps(
            {
                "server_public_key": server_public_key_pem.decode("utf-8"),
                "server_private_key": server_private_key_pem.decode("utf-8"),
            }
        )

        # 由于RSA加密有大小限制，使用混合加密方案（AES-CBC + RSA-OAEP）
        # 1. 生成随机AES密钥和IV
        aes_key, iv = generate_aes_key_and_iv()

        # 2. 使用AES加密数据
        encrypted_data = encrypt_with_aes_cbc(keys_data.encode("utf-8"), aes_key, iv)

        # 3. 使用RSA加密AES密钥
        encrypted_aes_key = encrypt_data_with_public_key(aes_key, client_public_key)

        # 4. 返回加密后的数据
        return web.json_response(
            {
                "encrypted_aes_key": base64.b64encode(encrypted_aes_key).decode("ascii"),
                "iv": base64.b64encode(iv).decode("ascii"),
                "encrypted_data": base64.b64encode(encrypted_data).decode("ascii"),
            }
        )

    except Exception as e:
        print(f"Error in key exchange: {e}")
        import traceback

        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/cryptio/public_key")
async def get_public_key(request):
    """兼容旧的公钥获取接口（不加密传输）"""
    pub_pem = _key_manager.server_public_key_pem
    if pub_pem:
        return web.json_response({"public_key": pub_pem.decode("utf-8")})
    else:
        return web.json_response({"error": "Public key not found"}, status=404)


@PromptServer.instance.routes.post("/cryptio/upload_encrypted")
async def upload_encrypted_image(request):
    """接收加密的图片数据并保存到文件"""
    try:
        # 读取 multipart 表单数据
        reader = await request.multipart()

        encrypted_data = None
        original_filename = None

        async for field in reader:
            if field.name == "image":
                # 读取加密的文件数据
                encrypted_data = await field.read()
                original_filename = field.filename

        if not encrypted_data:
            return web.json_response({"error": "No image data received"}, status=400)

        # 生成唯一的加密文件名，保留原始文件名并追加随机字符串
        input_dir = folder_paths.get_input_directory()

        safe_original = os.path.basename(original_filename) if original_filename else "cryptio"
        if safe_original.lower().endswith(".encrypted"):
            safe_original = safe_original[:-len(".encrypted")]

        base_name, file_ext = os.path.splitext(safe_original)

        base_name = base_name.strip().replace(" ", "_") or "cryptio"
        file_ext = file_ext or ".enc"

        charset = string.ascii_lowercase + string.digits

        def build_filename() -> str:
            random_suffix = ''.join(secrets.choice(charset) for _ in range(6))
            return f"{base_name}_{random_suffix}{file_ext}.encrypted"

        unique_filename = build_filename()
        while os.path.exists(os.path.join(input_dir, unique_filename)):
            unique_filename = build_filename()

        # 保存到 input 目录
        file_path = os.path.join(input_dir, unique_filename)

        # 写入加密数据
        with open(file_path, "wb") as f:
            f.write(encrypted_data)

        return web.json_response({"name": unique_filename, "subfolder": "", "type": "input"})

    except Exception as e:
        print(f"Error uploading encrypted image: {e}")
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/cryptio/view_encrypted")
async def view_encrypted_image(request):
    """获取加密图片用于前端预览（返回二进制加密数据，由前端解密）"""
    try:
        filename = request.query.get("filename")
        if not filename:
            return web.json_response({"error": "filename parameter is required"}, status=400)

        # 获取文件路径
        image_path = folder_paths.get_annotated_filepath(filename)

        if not os.path.exists(image_path):
            return web.json_response({"error": "File not found"}, status=404)

        # 读取加密文件
        with open(image_path, "rb") as f:
            encrypted_data = f.read()

        # 返回二进制数据，使用 Content-Disposition header 传递文件名
        return web.Response(
            body=encrypted_data, content_type="application/octet-stream", headers={"Content-Disposition": f'filename="{filename}"'}
        )

    except Exception as e:
        print(f"Error viewing encrypted image: {e}")
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/cryptio-sw.js")
async def serve_service_worker(request):
    """Serve the Service Worker script from root so its natural scope is '/'.

    Served from /cryptio-sw.js (no subdirectory) → natural scope is /.
    No Service-Worker-Allowed header needed.
    """
    sw_path = os.path.join(os.path.dirname(__file__), "..", "..", "js", "sw.js")
    if not os.path.exists(sw_path):
        return web.json_response({"error": "Service Worker script not found"}, status=404)

    with open(sw_path, "r", encoding="utf-8") as f:
        content = f.read()

    return web.Response(
        text=content,
        content_type="application/javascript",
    )
