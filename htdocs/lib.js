// Helper function to connect to the echo endpoint
async function connect(pc) {
    const {protocol} = window.location;
    const ws = new WebSocket((protocol === 'http:' ? 'ws:' : 'wss:') + window.location.origin.substring(protocol.length) + '/ws');
    ws.binaryType = 'arraybuffer';

    await (new Promise((resolve) => {
        ws.addEventListener('open', resolve);
    }))
    await pc.setLocalDescription();
    // wait for ICE gathering to complete
    await (new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
        } else {
            pc.addEventListener('icegatheringstatechange', function listener() {
                if (pc.iceGatheringState === 'complete') {
                    pc.removeEventListener('icegatheringstatechange', listener);
                    resolve();
                }
            });
        }
    }));
    const offer = pc.localDescription;
    ws.send(JSON.stringify(offer));

    const answer = await (new Promise((resolve) => {
        ws.addEventListener('message', function listener(message) {
            ws.removeEventListener('message', listener);
            resolve(JSON.parse(message.data))
        });
    }));
    await pc.setRemoteDescription(answer);
    return ws;
}

// Determine if a packet is an RTCP packet.
// See https://tools.ietf.org/html/rfc5761#section-4
function isRTCP(packet) {
    if (packet.byteLength < 1) {
        return false;
    }
    const view = new DataView(packet);
    const payloadType = view.getUint8(1) & 0x7f;
    return payloadType >= 72 && payloadType <= 79;
}

// RTP parser
function RTP(packet) {
    if (packet.byteLength < 12) {
        return;
    }
    const view = new DataView(packet);
    const firstByte = view.getUint8(0);
    if (firstByte >> 6 !== 2) {
        return;
    }

    let headerlen = 12;
    const contributingSources = [];
    if (firstByte & 0x0f) {
        let offset = headerlen;
        headerlen += 4 * (firstByte & 0x0f); // 12 + 4 * csrc count
        if (headerlen > packet.byteLength) {
            return;
        }
        while(offset < headerlen) {
            contributingSources.push(view.getUint32(offset));
            offset += 4;
        }
    }

    const headerExtensions = [];
    if (firstByte & 0x10) { // header extensions present.
        // https://tools.ietf.org/html/rfc3550#section-5.3.1
        if (headerlen + 4 > packet.byteLength) {
            return;
        }
        let offset = headerlen;
        headerlen += 4 + 4 * view.getUint16(headerlen + 2);
        if (headerlen > packet.byteLength) {
            return;
        }
        // https://tools.ietf.org/html/rfc5285#section-4.2
        if (view.getUint16(offset) === 0xbede) {
            offset += 4;
            while (offset < headerlen) {
                const id = view.getUint8(offset) >> 4;
                if (id === 15) {
                    break;
                }
                const length = (view.getUint8(offset) & 0xf) + 1;
                if (id !== 0) {
                    headerExtensions.push({
                        id,
                        data: new DataView(packet, offset + 1, length),
                    });
                }
                offset += length + 1;
            }
        } else {
            console.warn('TODO: parse two byte extensions');
        }
    }
    let bodylen = packet.byteLength - headerlen;
    if (firstByte & 0x20) { // padding
        bodylen -= view.getUint8(packet.byteLength - 1);
    }
    if (bodylen < 0) {
        return;
    }
    const secondByte = view.getUint8(1);
    return {
        version: firstByte >> 6,
        padding: (firstByte >> 5) & 1,
        extension: (firstByte >> 4) & 1,
        //csrcCount: firstByte & 0x0f,
        marker: secondByte >> 7,
        payloadType: secondByte & 0x7f,
        sequenceNumber: view.getUint16(2),
        timestamp: view.getUint32(4),
        synchronizationSource: view.getUint32(8),
        header: new DataView(packet, 0, headerlen),
        contributingSources,
        headerExtensions,
        payload: new DataView(packet, headerlen, bodylen),
    };
}
