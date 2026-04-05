// ==========================================
// CONFIG
// ==========================================
const ABLY_API_KEY = 'VOQpog.EDlRAg:rlTQDbqkffk_GIZI-gX6YGW5yTeSgeAAeQBVYRB-OvU';

let myAlias = '';
let myId = Math.random().toString(36).substring(2, 10);
let roomId = '';
let ably, channel;
let connectedUsers = {};
let usersOnCall = new Set();

// WebRTC
let peer = null;
let localStream = null;
let pendingCall = null;
let currentCallPartner = null;
let isAudioMuted = false;
let isVideoMuted = false;
let isSpeakerMuted = false;
let remoteAudioEl = null;

const ringtone = document.getElementById('ringtone');
const msgSound  = document.getElementById('msgSound');
const chatMessages = document.getElementById('chatMessages');
let callModalObj;
let lastSender = null;

// ==========================================
// TAB SWITCHING
// ==========================================
function switchTab(name) {
    ['chat','participants','call'].forEach(t => {
        document.getElementById(`view-${t}`).classList.add('d-none');
        document.getElementById(`tab-${t}`).classList.remove('active');
    });
    document.getElementById(`view-${name}`).classList.remove('d-none');
    document.getElementById(`tab-${name}`).classList.add('active');

    if (name === 'participants') renderParticipantsGrid();
}

// ==========================================
// INIT
// ==========================================
window.onload = () => {
    callModalObj = new bootstrap.Modal(document.getElementById('incomingCallModal'));

    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        window.history.replaceState(null, '', `?room=${roomId}`);
    }
    document.getElementById('roomIdDisplay').innerText = roomId;

    const joinModal = new bootstrap.Modal(document.getElementById('joinModal'));
    joinModal.show();

    document.getElementById('joinBtn').addEventListener('click', () => {
        const input = document.getElementById('usernameInput').value.trim();
        if (input.length >= 2) {
            myAlias = input;
            joinModal.hide();
            ringtone.load(); msgSound.load();
            initAbly();
        }
    });
    document.getElementById('usernameInput').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('joinBtn').click();
    });
};

function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    const btn = document.getElementById('copyLinkBtn');
    btn.innerHTML = 'Copied!';
    btn.classList.replace('btn-outline-accent','btn-accent');
    setTimeout(() => {
        btn.innerHTML = 'Copy';
        btn.classList.replace('btn-accent','btn-outline-accent');
    }, 2000);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
}

// ==========================================
// ABLY
// ==========================================
function initAbly() {
    ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myId });
    channel = ably.channels.get(`hackchat-room-${roomId}`);

    channel.presence.subscribe(['enter','present','leave'], (msg) => {
        if (msg.action === 'leave') {
            delete connectedUsers[msg.clientId];
            usersOnCall.delete(msg.clientId);
        } else {
            connectedUsers[msg.clientId] = { alias: msg.data.alias };
        }
        renderUsers();
        renderParticipantsGrid();
        updateParticipantCount();
    });
    channel.presence.enterClient(myId, { alias: myAlias });

    channel.subscribe('chat', (msg) => {
        if (msg.clientId !== myId) {
            appendMessage(msg.data.alias, msg.data.text, false, msg.data.fileData, msg.clientId);
            msgSound.play().catch(()=>{});
        }
    });

    channel.subscribe('call_ring',      handleCallRing);
    channel.subscribe('call_accept',    handleCallAccept);
    channel.subscribe('webrtc_signal',  handleWebRTCSignal);
    channel.subscribe('call_end',       handleCallEndEvent);
    channel.subscribe('call_status',    handleCallStatusUpdate);
}

function updateParticipantCount() {
    const n = Object.keys(connectedUsers).length;
    document.getElementById('participantCount').innerText = n;
}

// ==========================================
// SIDEBAR USER LIST
// ==========================================
function renderUsers() {
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    Object.keys(connectedUsers).forEach(key => {
        const isMe = key === myId;
        const onCall = usersOnCall.has(key) && !isMe;
        const alias = connectedUsers[key].alias;
        list.innerHTML += `
            <div class="user-item d-flex align-items-center mb-2" onclick="${!isMe && !onCall ? `initiateCall(false,'${key}')` : ''}">
                <div class="rounded-circle bg-accent text-dark fw-bold d-flex justify-content-center align-items-center me-3 flex-shrink-0" style="width:30px;height:30px;font-size:0.8rem;">
                    ${alias.charAt(0).toUpperCase()}
                </div>
                <div class="d-flex flex-column">
                    <strong class="text-white" style="font-size:0.83rem;">${alias}${isMe ? ' <span style="color:#6b7280;font-weight:400;">(You)</span>' : ''}</strong>
                    ${onCall
                        ? `<span class="user-call-badge">On a call</span>`
                        : `<span class="text-accent" style="font-size:0.62rem;">CONNECTED</span>`}
                </div>
                ${!isMe && !onCall ? `<i class="bi bi-telephone ms-auto text-muted" style="font-size:0.72rem;"></i>` : ''}
            </div>`;
    });
}

// ==========================================
// PARTICIPANTS GRID
// ==========================================
function renderParticipantsGrid() {
    const grid = document.getElementById('participantsGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const keys = Object.keys(connectedUsers);

    if (keys.length === 0) {
        grid.innerHTML = `<div class="text-muted text-center w-100 mt-5" style="font-size:0.85rem;">No participants yet</div>`;
        return;
    }

    keys.forEach(key => {
        const isMe = key === myId;
        const onCall = usersOnCall.has(key);
        const alias = connectedUsers[key].alias;
        const initial = alias.charAt(0).toUpperCase();

        // Pick a deterministic color per user from a palette
        const colors = ['#00ff66','#38bdf8','#f472b6','#fb923c','#a78bfa','#34d399','#facc15'];
        const colorIdx = [...key].reduce((a,c) => a + c.charCodeAt(0), 0) % colors.length;
        const avatarColor = onCall ? '#374151' : colors[colorIdx];
        const textColor   = onCall ? '#9ca3af' : '#000';

        grid.innerHTML += `
            <div class="participant-card${onCall ? ' on-call' : ''}" id="pcard-${key}">
                <div class="participant-avatar" style="background:${avatarColor};color:${textColor};">
                    ${initial}
                    ${!onCall ? `<div class="av-online"></div>` : ''}
                </div>
                <div class="participant-name">${alias}</div>
                ${isMe
                    ? `<span class="participant-me-tag">You</span>`
                    : onCall
                        ? `<span class="participant-status on-call"><i class="bi bi-telephone-fill me-1"></i>On a call</span>`
                        : `<div class="d-flex gap-2 mt-1">
                               <button class="participant-call-btn" onclick="initiateCall(false,'${key}')" title="Voice call"><i class="bi bi-telephone-fill"></i></button>
                               <button class="participant-call-btn" onclick="initiateCall(true,'${key}')" title="Video call"><i class="bi bi-camera-video-fill"></i></button>
                           </div>`
                }
            </div>`;
    });
}

// ==========================================
// MESSAGING
// ==========================================
function sendMessage(fileData = null, textOverride = null) {
    const text = textOverride !== null ? textOverride : document.getElementById('messageInput').value.trim();
    if (!text && !fileData) return;
    appendMessage(myAlias, text, true, fileData, myId);
    document.getElementById('messageInput').value = '';
    channel.publish('chat', { alias: myAlias, text, fileData });
}

document.getElementById('sendBtn').addEventListener('click', () => sendMessage());
document.getElementById('messageInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 100 * 1024) { alert("File too large. Max 100KB."); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
        const base64 = ev.target.result;
        const msgText = file.type.startsWith('image/') ? '📷 Sent an Image' : `📎 Sent File: ${file.name}`;
        sendMessage(base64, msgText);
        e.target.value = '';
    };
    reader.readAsDataURL(file);
}

function appendMessage(sender, text, isMe, fileData = null, senderId = null) {
    const div = document.createElement('div');
    const showSender = !isMe && senderId !== lastSender;
    div.className = `message-bubble ${isMe ? 'sent' : 'received'}${showSender ? ' has-sender' : ''}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let contentHtml = `<span>${text || ''}</span>`;
    if (fileData) {
        if (fileData.startsWith('data:image/')) {
            contentHtml += `<br><img src="${fileData}" class="chat-img" onclick="window.open('${fileData}')">`;
        } else {
            contentHtml += `<br><a href="${fileData}" download class="text-accent fw-bold" style="font-size:0.8rem;">[DOWNLOAD FILE]</a>`;
        }
    }
    div.innerHTML = `
        ${showSender ? `<span class="msg-sender">${sender}</span>` : ''}
        ${contentHtml}
        <span class="msg-time">${time}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    lastSender = isMe ? null : senderId;
}

function appendLog(text) {
    const div = document.createElement('div');
    div.className = 'log-msg';
    div.innerText = text;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    lastSender = null;
}

// ==========================================
// CALL STATUS BROADCAST
// ==========================================
function broadcastCallStatus(active) {
    channel.publish('call_status', { userId: myId, active });
    if (active) usersOnCall.add(myId); else usersOnCall.delete(myId);
    renderUsers();
    renderParticipantsGrid();
}

function handleCallStatusUpdate(msg) {
    if (msg.data.active) usersOnCall.add(msg.data.userId);
    else usersOnCall.delete(msg.data.userId);
    renderUsers();
    renderParticipantsGrid();
}

// ==========================================
// WEBRTC CALLING
// ==========================================
window.initiateCall = function(isVideo, targetId) {
    if (peer) return alert("Call already in progress.");
    appendLog(`[SYS] Dialing node...`);
    channel.publish('call_ring', { callerId: myId, callerName: myAlias, isVideo, targetId });
};

function handleCallRing(msg) {
    if (msg.data.callerId === myId) return;
    if (peer) return;
    if (msg.data.targetId && msg.data.targetId !== myId) return;

    pendingCall = msg.data;
    document.getElementById('incomingCallerName').innerText = msg.data.callerName;
    document.getElementById('callTypeIcon').className = msg.data.isVideo
        ? "bi bi-camera-video-fill text-dark fs-1"
        : "bi bi-telephone-inbound-fill text-dark fs-1";
    document.getElementById('callTypeText').innerText = `Incoming ${msg.data.isVideo ? 'Video' : 'Voice'} Link...`;
    ringtone.play().catch(()=>{});
    callModalObj.show();
}

document.getElementById('acceptBtn').onclick = async () => {
    ringtone.pause(); ringtone.currentTime = 0;
    callModalObj.hide();
    if (!pendingCall) return;
    const { callerId, callerName, isVideo } = pendingCall;
    currentCallPartner = callerName;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        openCallView(currentCallPartner, isVideo);
        broadcastCallStatus(true);
        channel.publish('call_accept', { acceptorId: myId, acceptorName: myAlias, targetId: callerId, isVideo });
        initSimplePeer(false, callerId);
    } catch(e) { alert("Mic/Camera access denied."); }
};

document.getElementById('rejectBtn').onclick = () => {
    ringtone.pause(); ringtone.currentTime = 0;
    callModalObj.hide();
    pendingCall = null;
};

async function handleCallAccept(msg) {
    if (msg.data.targetId !== myId) return;
    if (peer) return;
    currentCallPartner = msg.data.acceptorName;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: msg.data.isVideo, audio: true });
        openCallView(currentCallPartner, msg.data.isVideo);
        broadcastCallStatus(true);
        initSimplePeer(true, msg.data.acceptorId);
    } catch(e) { alert("Mic/Camera access denied."); }
}

function initSimplePeer(isInitiator, partnerId) {
    peer = new SimplePeer({ initiator: isInitiator, stream: localStream, trickle: true });

    peer.on('signal', data => {
        channel.publish('webrtc_signal', { targetId: partnerId, signal: data });
    });

    peer.on('stream', remoteStream => {
        // Update call status badge
        const badge = document.getElementById('callStatus');
        badge.innerText = "Connected";
        badge.classList.replace('bg-dark','bg-accent');
        badge.classList.replace('text-white','text-dark');
        document.getElementById('callStatusText').innerText = "Secure connection established";
        document.getElementById('callRingWrap').classList.remove('ringing');

        const remoteVideo = document.getElementById('remoteVideo');
        remoteVideo.srcObject = remoteStream;

        remoteAudioEl = new Audio();
        remoteAudioEl.srcObject = remoteStream;
        remoteAudioEl.autoplay = true;

        if (remoteStream.getVideoTracks().length > 0) {
            remoteVideo.classList.remove('d-none');
            document.getElementById('callAvatarContainer').classList.add('d-none');
        }
    });

    peer.on('close', endCallCleanUp);
    peer.on('error', err => { console.warn("Peer error:", err); endCallCleanUp(); });
}

function handleWebRTCSignal(msg) {
    if (msg.data.targetId === myId && peer) peer.signal(msg.data.signal);
}

// ==========================================
// CALL VIEW (third tab)
// ==========================================
function openCallView(partnerName, isVideo) {
    // Switch to Call tab
    switchTab('call');

    document.getElementById('callPeerName').innerText = partnerName;
    document.getElementById('callAvatar').innerText = partnerName.charAt(0).toUpperCase();
    document.getElementById('callStatusText').innerText = 'Establishing secure link...';

    const badge = document.getElementById('callStatus');
    badge.innerText = "Connecting...";
    badge.classList.replace('bg-accent','bg-dark');
    badge.classList.replace('text-dark','text-white');

    document.getElementById('callAvatarContainer').classList.remove('d-none');
    document.getElementById('remoteVideo').classList.add('d-none');
    document.getElementById('callRingWrap').classList.add('ringing');

    // Show call dot on tab
    document.getElementById('callTabDot').classList.remove('d-none');

    document.getElementById('localVideo').srcObject = localStream;

    isAudioMuted = false;
    isVideoMuted = !isVideo;
    isSpeakerMuted = false;
    updateCallButtons();

    appendLog(`[SYS] Secure link opened with ${partnerName}`);
}

// ==========================================
// CALL CONTROLS
// ==========================================
document.getElementById('ctrl-mute').onclick = () => {
    isAudioMuted = !isAudioMuted;
    if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
    updateCallButtons();
};

document.getElementById('ctrl-speaker').onclick = () => {
    isSpeakerMuted = !isSpeakerMuted;
    if (remoteAudioEl) remoteAudioEl.muted = isSpeakerMuted;
    const rv = document.getElementById('remoteVideo');
    if (rv) rv.muted = isSpeakerMuted;
    updateCallButtons();
};

document.getElementById('ctrl-video').onclick = () => {
    isVideoMuted = !isVideoMuted;
    if (localStream && localStream.getVideoTracks().length > 0)
        localStream.getVideoTracks()[0].enabled = !isVideoMuted;
    updateCallButtons();
};

document.getElementById('ctrl-hangup').onclick = () => {
    channel.publish('call_end', { senderId: myId });
    endCallCleanUp();
};

function handleCallEndEvent() {
    if (peer) endCallCleanUp();
}

function updateCallButtons() {
    const btnMute    = document.getElementById('ctrl-mute');
    const btnSpeaker = document.getElementById('ctrl-speaker');
    const btnVideo   = document.getElementById('ctrl-video');

    btnMute.innerHTML = isAudioMuted
        ? '<i class="bi bi-mic-mute-fill text-danger"></i>'
        : '<i class="bi bi-mic-fill"></i>';
    btnMute.className = isAudioMuted
        ? 'btn btn-outline-danger rounded-circle call-ctrl-btn shadow'
        : 'btn btn-dark border-secondary text-accent rounded-circle call-ctrl-btn shadow';

    btnSpeaker.innerHTML = isSpeakerMuted
        ? '<i class="bi bi-volume-mute-fill text-danger"></i>'
        : '<i class="bi bi-volume-up-fill"></i>';
    btnSpeaker.className = isSpeakerMuted
        ? 'btn btn-outline-danger rounded-circle call-ctrl-btn shadow'
        : 'btn btn-dark border-secondary text-accent rounded-circle call-ctrl-btn shadow';

    btnVideo.innerHTML = isVideoMuted
        ? '<i class="bi bi-camera-video-off-fill text-danger"></i>'
        : '<i class="bi bi-camera-video-fill"></i>';
    btnVideo.className = isVideoMuted
        ? 'btn btn-outline-danger rounded-circle call-ctrl-btn shadow'
        : 'btn btn-dark border-secondary text-accent rounded-circle call-ctrl-btn shadow';
}

function endCallCleanUp() {
    if (peer)        { peer.destroy(); peer = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (remoteAudioEl) { remoteAudioEl.srcObject = null; remoteAudioEl = null; }

    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('remoteVideo').classList.add('d-none');
    document.getElementById('callAvatarContainer').classList.remove('d-none');
    document.getElementById('callRingWrap').classList.remove('ringing');

    // Reset call view to idle
    document.getElementById('callPeerName').innerText = 'No active call';
    document.getElementById('callStatusText').innerText = 'Start a call from the Chat tab or Participants tab';
    const badge = document.getElementById('callStatus');
    badge.innerText = "Idle";
    badge.classList.replace('bg-accent','bg-dark');
    badge.classList.replace('text-dark','text-white');
    document.getElementById('callAvatar').innerText = '?';

    // Remove dot
    document.getElementById('callTabDot').classList.add('d-none');

    broadcastCallStatus(false);
    appendLog(`[SYS] Secure link disconnected.`);
    currentCallPartner = null;
    pendingCall = null;
}
