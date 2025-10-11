import os
import uuid
from aiohttp import web
from server import PromptServer
from .keys import _get_keys
import folder_paths


@PromptServer.instance.routes.get("/cryptio/public_key")
async def get_public_key(request):
    keys = _get_keys()
    pub = keys.get("server_public_key")
    if pub:
        return web.json_response({"public_key": pub.decode("utf-8")})
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
            if field.name == 'image':
                # 读取加密的文件数据
                encrypted_data = await field.read()
                original_filename = field.filename

        if not encrypted_data:
            return web.json_response({"error": "No image data received"}, status=400)

        # 生成唯一的加密文件名
        file_ext = os.path.splitext(original_filename)[1] if original_filename else ".enc"
        unique_filename = f"cryptio_{uuid.uuid4().hex}{file_ext}.encrypted"

        # 保存到 input 目录
        input_dir = folder_paths.get_input_directory()
        file_path = os.path.join(input_dir, unique_filename)

        # 写入加密数据
        with open(file_path, 'wb') as f:
            f.write(encrypted_data)

        return web.json_response({
            "name": unique_filename,
            "subfolder": "",
            "type": "input"
        })

    except Exception as e:
        print(f"Error uploading encrypted image: {e}")
        return web.json_response({"error": str(e)}, status=500)