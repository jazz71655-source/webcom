const fileInput = document.getElementById("fileInput");
const connectButton = document.getElementById("connectButton");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusText = document.getElementById("status");

const signalingUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

let ws;
let pc;
let localStream;
let isInitiator = false;
let isReady = false;
let isStarted = false;

function setStatus(text) {
  statusText.textContent = text;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];

  if (!file) {
    return;
  }

  localVideo.src = URL.createObjectURL(file);
  localVideo.load();
  setStatus("File selected");
});

async function addPlayerTracks(stream) {
  if (!localVideo.src) {
    return;
  }

  // captureStream() sends the selected local media file through WebRTC.
  await localVideo.play();
  const captured = localVideo.captureStream();

  for (const track of captured.getTracks()) {
    stream.addTrack(track);
  }
}

async function addMicrophoneTracks(stream) {
  try {
    // Microphone audio is added for VoIP.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    for (const track of micStream.getAudioTracks()) {
      stream.addTrack(track);
    }

    return true;
  } catch (error) {
    console.warn("Microphone unavailable:", error);
    return false;
  }
}

async function buildLocalStream() {
  const stream = new MediaStream();

  await addPlayerTracks(stream);
  const hasMic = await addMicrophoneTracks(stream);

  if (stream.getTracks().length === 0) {
    throw new Error("Select a media file or allow microphone access.");
  }

  if (!hasMic) {
    setStatus("Microphone denied. Sharing selected media only.");
  }

  localStream = stream;
  return stream;
}

function createPeerConnection() {
  pc = new RTCPeerConnection(rtcConfig);

  // Relay ICE candidates through the WebSocket signaling server.
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(
        JSON.stringify({
          type: "candidate",
          candidate: event.candidate,
        }),
      );
    }
  };

  // Attach the remote peer's media stream to the remote video element.
  pc.ontrack = (event) => {
    const [remoteStream] = event.streams;
    remoteVideo.srcObject = remoteStream;
  };

  pc.onconnectionstatechange = () => {
    setStatus(`WebRTC: ${pc.connectionState}`);
  };

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }
}

async function makeOffer() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", sdp: offer }));
}

async function startPeerIfReady() {
  if (!isReady || isStarted || !localStream) {
    return;
  }

  isStarted = true;
  createPeerConnection();

  if (isInitiator) {
    await makeOffer();
  }
}

async function handleSignal(message) {
  switch (message.type) {
    case "role":
      isInitiator = message.initiator;
      setStatus(isInitiator ? "Waiting for peer" : "Preparing connection");
      break;

    case "ready":
      isReady = true;
      setStatus("Starting P2P connection");
      await startPeerIfReady();
      break;

    case "offer":
      if (!pc) {
        createPeerConnection();
      }
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", sdp: answer }));
      break;

    case "answer":
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      break;

    case "candidate":
      if (pc && message.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
      }
      break;

    case "peer-left":
      setStatus("Peer disconnected");
      break;

    case "full":
      setStatus("Room is full. This demo supports 1-to-1 only.");
      break;
  }
}

connectButton.addEventListener("click", async () => {
  connectButton.disabled = true;

  try {
    setStatus("Preparing local media");
    await buildLocalStream();

    ws = new WebSocket(signalingUrl);

    ws.onopen = () => {
      setStatus("Connected to signaling server");
      startPeerIfReady();
    };

    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      await handleSignal(message);
    };

    ws.onclose = () => {
      setStatus("Disconnected from signaling server");
    };

    ws.onerror = () => {
      setStatus("Signaling error");
    };
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`);
    connectButton.disabled = false;
  }
});
