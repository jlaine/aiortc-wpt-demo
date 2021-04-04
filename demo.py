import asyncio
import functools
import os

from aiortc import (
    RTCCertificate,
    RTCDtlsFingerprint,
    RTCDtlsParameters,
    RTCDtlsTransport,
    RTCIceGatherer,
    RTCIceParameters,
    RTCIceTransport,
)
from aiortc.sdp import candidate_from_sdp, candidate_to_sdp
from starlette.applications import Starlette
from starlette.endpoints import WebSocketEndpoint
from starlette.routing import Mount, WebSocketRoute
from starlette.staticfiles import StaticFiles

ROOT = os.path.dirname(__file__)
STATIC_ROOT = os.environ.get("STATIC_ROOT", os.path.join(ROOT, "htdocs"))


async def handle_rtp_data(websocket, data: bytes, arrival_time_ms: int) -> None:
    await websocket.send_bytes(data)


async def handle_rtcp_data(websocket, data: bytes) -> None:
    await websocket.send_bytes(data)


class Endpoint(WebSocketEndpoint):
    encoding = "json"

    async def on_connect(self, websocket):
        gatherer = RTCIceGatherer(iceServers=[])
        websocket.state.iceTransport = RTCIceTransport(gatherer)
        certificate = RTCCertificate.generateCertificate()
        websocket.state.dtlsTransport = RTCDtlsTransport(
            websocket.state.iceTransport, [certificate]
        )

        # monkey-patch RTCDtlsTransport
        websocket.state.dtlsTransport._handle_rtp_data = functools.partial(
            handle_rtp_data, websocket
        )
        websocket.state.dtlsTransport._handle_rtcp_data = functools.partial(
            handle_rtcp_data, websocket
        )

        await websocket.accept()

        iceTransport = websocket.state.iceTransport
        iceParameters = iceTransport.iceGatherer.getLocalParameters()
        dtlsTransport = websocket.state.dtlsTransport
        dtlsParameters = dtlsTransport.getLocalParameters()

        await iceTransport.iceGatherer.gather()
        await websocket.send_json(
            {
                "ice": {
                    "usernameFragment": iceParameters.usernameFragment,
                    "password": iceParameters.password,
                },
                "dtls": {
                    "role": "auto",
                    "fingerprints": list(
                        map(
                            lambda fp: {
                                "algorithm": fp.algorithm,
                                "value": fp.value,
                            },
                            dtlsParameters.fingerprints,
                        )
                    ),
                },
                "candidates": list(
                    map(
                        lambda c: "candidate:" + candidate_to_sdp(c),
                        iceTransport.iceGatherer.getLocalCandidates(),
                    )
                ),
            }
        )

    async def on_receive(self, websocket, message):
        if self.encoding == "json":
            iceTransport = websocket.state.iceTransport
            dtlsTransport = websocket.state.dtlsTransport

            coros = map(
                iceTransport.addRemoteCandidate,
                map(candidate_from_sdp, message["candidates"]),
            )
            await asyncio.gather(*coros)

            remoteIceParameters = RTCIceParameters(
                usernameFragment=message["ice"]["usernameFragment"],
                password=message["ice"]["password"],
            )
            remoteDtlsParameters = RTCDtlsParameters(
                fingerprints=list(
                    map(
                        lambda fp: RTCDtlsFingerprint(
                            algorithm=fp["algorithm"], value=fp["value"]
                        ),
                        message["dtls"]["fingerprints"],
                    )
                )
            )

            iceTransport._connection.ice_controlling = False

            await iceTransport.start(remoteIceParameters)
            await dtlsTransport.start(remoteDtlsParameters)
            self.encoding = "bytes"
        elif self.encoding == "bytes":
            await websocket.state.dtlsTransport._send_rtp(message)
        else:
            print("Unhandled encoding", self.encoding)

    async def on_disconnect(self, websocket, close_code):
        await websocket.state.dtlsTransport.stop()
        await websocket.state.iceTransport.stop()


app = Starlette(
    routes=[
        WebSocketRoute("/ws", Endpoint),
        Mount("/", StaticFiles(directory=STATIC_ROOT, html=True)),
    ],
)
