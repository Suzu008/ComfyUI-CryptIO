from aiohttp import web
from server import PromptServer
from .keys import _get_keys


@PromptServer.instance.routes.get("/cryptio/public_key")
async def get_public_key(request):
    keys = _get_keys()
    pub = keys.get("server_public_key")
    if pub:
        return web.json_response({"public_key": pub.decode("utf-8")})
    else:
        return web.json_response({"error": "Public key not found"}, status=404)