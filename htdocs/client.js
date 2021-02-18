// get DOM elements
const iceConnectionLog = document.getElementById('ice-connection-state');
const iceGatheringLog = document.getElementById('ice-gathering-state');
const signalingLog = document.getElementById('signaling-state');
const rtpLog = document.getElementById('rtp');

// peer connection
let pc = null;

// websocket
let ws = null;

function createPeerConnection() {
    const config = {
        sdpSemantics: 'unified-plan'
    };

    if (document.getElementById('use-stun').checked) {
        config.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    }

    const pc = new RTCPeerConnection(config);

    // register some listeners to help debugging
    pc.addEventListener('icegatheringstatechange', () => {
        iceGatheringLog.textContent += ' -> ' + pc.iceGatheringState;
    }, false);
    iceGatheringLog.textContent = pc.iceGatheringState;

    pc.addEventListener('iceconnectionstatechange', () => {
        iceConnectionLog.textContent += ' -> ' + pc.iceConnectionState;
    }, false);
    iceConnectionLog.textContent = pc.iceConnectionState;

    pc.addEventListener('signalingstatechange', () => {
        signalingLog.textContent += ' -> ' + pc.signalingState;
    }, false);
    signalingLog.textContent = pc.signalingState;

    return pc;
}

function start() {
    document.getElementById('start').style.display = 'none';

    pc = createPeerConnection();
    ws = new WebSocket('ws' + window.location.origin.substring(4) + '/ws');

    new Promise((resolve) => {
        ws.addEventListener('open', resolve);
    }).then(() => {
        return navigator.mediaDevices.getUserMedia({
            audio: false,
            video: true
        });
    }).then((stream) => {
        stream.getTracks().forEach((track) => {
            pc.addTrack(track, stream);
        });
        return pc.createOffer();
    }).then((offer) => {
        return pc.setLocalDescription(offer);
    }).then(() => {
        // wait for ICE gathering to complete
        return new Promise((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                const listener = () => {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', listener);
                        resolve();
                    }
                }
                pc.addEventListener('icegatheringstatechange', listener);
            }
        });
    }).then(() => {
        const offer = pc.localDescription;

        document.getElementById('offer-sdp').textContent = offer.sdp;
        ws.send(JSON.stringify({
            sdp: offer.sdp,
            type: offer.type
        }));

        return new Promise((resolve) => {
            const listener = (message) => {
                ws.removeEventListener('message', listener);
                resolve(JSON.parse(message.data))
            };
            ws.addEventListener('message', listener);
        });
    }).then((answer) => {
        document.getElementById('answer-sdp').textContent = answer.sdp;
        return pc.setRemoteDescription(answer);
    }).then(() => {
        // log packets
        ws.addEventListener('message', (message) => {
            rtpLog.textContent += message.data.size + ' bytes\n';
        });
    }).catch((e) => {
        alert(e);
    });

    document.getElementById('stop').style.display = 'inline-block';
}

function stop() {
    document.getElementById('stop').style.display = 'none';

    // close transceivers
    pc.getTransceivers().forEach((transceiver) => {
        if (transceiver.stop) {
            transceiver.stop();
        }
    });

    // close peer connection
    setTimeout(() => {
        pc.close();
    }, 500);

    // close WebSocket
    ws.close();
}
