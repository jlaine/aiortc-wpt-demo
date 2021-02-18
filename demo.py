import functools
import os

from starlette.applications import Starlette
from starlette.endpoints import WebSocketEndpoint
from starlette.routing import Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles

from aiortc import RTCPeerConnection, RTCSessionDescription

ROOT = os.path.dirname(__file__)
STATIC_ROOT = os.environ.get("STATIC_ROOT", os.path.join(ROOT, "htdocs"))


async def handle_rtp_data(websocket, data: bytes, arrival_time_ms: int) -> None:
    await websocket.send_bytes(data)


class Endpoint(WebSocketEndpoint):
    encoding = "json"

    async def on_connect(self, websocket):
        websocket.state.pc = RTCPeerConnection()

        await websocket.accept()

    async def on_receive(self, websocket, message):
        pc = websocket.state.pc
        offer = RTCSessionDescription(sdp=message["sdp"], type=message["type"])

        # handle offer
        await pc.setRemoteDescription(offer)

        # monkey-patch RTCDtlsTransport
        for transceiver in pc.getTransceivers():
            transport = transceiver.receiver.transport
            transport._handle_rtp_data = functools.partial(handle_rtp_data, websocket)

        # create answer
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        # send answer
        await websocket.send_json(
            {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type}
        )

    async def on_disconnect(self, websocket, close_code):
        await websocket.state.pc.close()


app = Starlette(
    routes=[
        WebSocketRoute("/ws", Endpoint),
        Mount("/", StaticFiles(directory=STATIC_ROOT, html=True)),
    ],
)
