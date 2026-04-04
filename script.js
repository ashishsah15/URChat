// ==========================================
// 🔴 CONFIGURATION
// ==========================================
const ABLY_API_KEY = 'VOQpog.EDlRAg:rlTQDbqkffk_GIZI-gX6YGW5yTeSgeAAeQBVYRB-OvU';

// Global State
let myUsername = '';
let myPeerId = '';
let roomId = '';
let ably, channel, peer;
let connectedUsers = {}; 
let currentCall = null;
let pendingCall = null; // For incoming calls
let localStream = null;
let typingTimeout = null;
let hostedFiles = {}; 

// Modals
let incomingCallModalObj = null;

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const usersList = document.getElementById('usersList');
const typingIndicator = document.getElementById('typingIndicator');
const fileInput = document.getElementById('fileInput');

// ==========================================
// 1. INITIALIZATION & ROOM LOGIC
// ==========================================
window.onload = () => {
    incomingCallModalObj = new bootstrap.Modal(document.getElementById('incomingCallModal'));

    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        window.history.replaceState(null, '', `?room=${roomId}`);
    }
    document.getElementById('roomIdDisplay').innerText = roomId;

    const usernameModal = new bootstrap.Modal(document.getElementById('usernameModal'));
    usernameModal.show();

    document.getElementById('joinBtn').addEventListener('click', () => {
        const input = document.getElementById('usernameInput').value.trim();
        if (input.length >= 2) {
            myUsername = input;
            document.getElementById('myUsernameDisplay').innerText = myUsername;
            usernameModal.hide();
            startServices();
        } else {
            alert("Username must be at least 2 characters.");
        }
    });
};

document.getElementById('copyLinkBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    const btn = document.getElementById('copyLinkBtn');
    btn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
    setTimeout(() => btn.innerHTML = '<i class="bi bi-link-45deg"></i> Copy', 2000);
});

// ==========================================
// 2. PEERJS & ABLY SETUP
// ==========================================
function startServices() {
    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        initializeAbly();
    });

    peer.on('call', handleIncomingCall);
    peer.on('connection', handleIncomingDataConnection); 
}

function initializeAbly() {
    ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myPeerId });
    channel = ably.channels.get(`room-${roomId}`);

    channel.presence.subscribe(['enter', 'present', 'leave'], (msg) => {
        if (msg.action === 'leave') {
            delete connectedUsers[msg.clientId];
            showSystemMessage(`${msg.data.username} left the chat`, 'leave');
        } else {
            if (msg.action === 'enter' && msg.clientId !== myPeerId) {
                showSystemMessage(`${msg.data.username} joined the chat`, 'join');
                playNotificationSound();
            }
            connectedUsers[msg.clientId] = { username: msg.data.username, peerId: msg.data.peerId };
        }
        renderUsers();
    });
    channel.presence.enterClient(myPeerId, { username: myUsername, peerId: myPeerId });

    channel.subscribe('message', (msg) => {
        if (msg.clientId === myPeerId) return; 
        renderMessage(msg.data.username, msg.data.text, msg.data.time, false);
        playNotificationSound();
    });

    channel.subscribe('file_offer', (msg) => {
        if (msg.clientId === myPeerId) return;
        renderFileMessage(msg.data.username, msg.data.fileName, msg.data.fileSize, msg.data.time, false, msg.data.senderPeerId, msg.data.fileId);
        playNotificationSound();
    });

    channel.subscribe('typing', (msg) => {
        if (msg.clientId !== myPeerId) {
            typingIndicator.innerText = `${msg.data.username} is typing...`;
            typingIndicator.classList.toggle('d-none', !msg.data.isTyping);
        }
    });
}

// ==========================================
// 3. UI RENDERERS
// ==========================================
function renderUsers(filterText = '') {
    usersList.innerHTML = '';
    const userKeys = Object.keys(connectedUsers);
    document.getElementById('onlineCount').innerText = `${userKeys.length} online`;

    userKeys.forEach(key => {
        const user = connectedUsers[key];
        if (filterText && !user.username.toLowerCase().includes(filterText.toLowerCase())) return;

        const isMe = user.peerId === myPeerId;
        const div = document.createElement('div');
        div.className = 'user-item p-2 mb-2 d-flex align-items-center justify-content-between border shadow-sm';
        
        div.innerHTML = `
            <div class="d-flex align-items-center">
                <div class="online-dot me-2"></div>
                <strong class="text-dark">${user.username} ${isMe ? '(You)' : ''}</strong>
            </div>
            ${!isMe ? `
            <div class="d-flex gap-1">
                <button class="btn btn-sm btn-light text-primary rounded-circle" onclick="initiateCall('${user.peerId}', false, '${user.username}')" title="Voice Call"><i class="bi bi-telephone-fill"></i></button>
                <button class="btn btn-sm btn-light text-primary rounded-circle" onclick="initiateCall('${user.peerId}', true, '${user.username}')" title="Video Call"><i class="bi bi-camera-video-fill"></i></button>
            </div>
            ` : ''}
        `;
        usersList.appendChild(div);
    });
}

document.getElementById('searchInput').addEventListener('input', (e) => renderUsers(e.target.value));

function renderMessage(sender, text, time, isSent) {
    const div = document.createElement('div');
    div.className = `message-bubble ${isSent ? 'sent' : 'received'} d-flex flex-column`;
    div.innerHTML = `
        ${!isSent ? `<span class="msg-sender">${sender}</span>` : ''}
        <span class="msg-text">${text}</span>
        <span class="msg-time">${time}</span>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showSystemMessage(text, type = 'info') {
    const div = document.createElement('div');
    div.className = 'text-center my-3 system-msg transition-all';
    
    let badgeClass = 'bg-secondary bg-opacity-10 text-secondary border-secondary'; 
    let icon = '<i class="bi bi-info-circle me-1"></i>';
    
    if (type === 'join') {
        badgeClass = 'bg-success bg-opacity-10 text-success border-success';
        icon = '<i class="bi bi-person-plus-fill me-1"></i>';
    } else if (type === 'leave') {
        badgeClass = 'bg-danger bg-opacity-10 text-danger border-danger';
        icon = '<i class="bi bi-person-dash-fill me-1"></i>';
    }

    div.innerHTML = `<span class="badge border px-3 py-2 rounded-pill shadow-sm fw-medium ${badgeClass}">${icon} ${text}</span>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    renderMessage(myUsername, text, time, true);
    messageInput.value = '';

    channel.publish('message', { username: myUsername, text: text, time: time });
    channel.publish('typing', { username: myUsername, isTyping: false });
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
messageInput.addEventListener('input', () => {
    channel.publish('typing', { username: myUsername, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => channel.publish('typing', { username: myUsername, isTyping: false }), 1500);
});

// ==========================================
// 4. FILE TRANSFER
// ==========================================
document.getElementById('fileAttachBtn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(!file) return;

    const fileId = Math.random().toString(36).substring(7);
    hostedFiles[fileId] = file; 
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedSize = formatBytes(file.size);

    renderFileMessage(myUsername, file.name, formattedSize, time, true, null, fileId);

    channel.publish('file_offer', { 
        username: myUsername, fileName: file.name, fileSize: formattedSize, 
        fileId: fileId, time: time, senderPeerId: myPeerId 
    });
    fileInput.value = '';
});

function renderFileMessage(sender, fileName, size, time, isSent, senderPeerId, fileId) {
    const div = document.createElement('div');
    div.className = `message-bubble ${isSent ? 'sent' : 'received'} d-flex flex-column`;
    let actionBtn = isSent ? 
        `<span class="badge bg-light text-dark shadow-sm">Sent</span>` : 
        `<button class="btn btn-sm btn-primary py-0 shadow-sm" onclick="downloadFile('${senderPeerId}', '${fileId}', '${fileName}', this)"><i class="bi bi-download"></i> Get</button>`;

    div.innerHTML = `
        ${!isSent ? `<span class="msg-sender">${sender}</span>` : ''}
        <div class="file-bubble">
            <i class="bi bi-file-earmark-fill fs-3 ${isSent ? 'text-white' : 'text-primary'}"></i>
            <div class="d-flex flex-column me-2 flex-grow-1 overflow-hidden">
                <strong class="text-truncate" style="max-width: 150px;">${fileName}</strong>
                <small style="opacity: 0.8">${size}</small>
            </div>
            ${actionBtn}
        </div>
        <span class="msg-time mt-1">${time}</span>
    `;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function downloadFile(senderPeerId, fileId, fileName, btnElement) {
    btnElement.innerHTML = `<span class="spinner-border spinner-border-sm"></span>`;
    btnElement.disabled = true;

    const conn = peer.connect(senderPeerId, { metadata: { requestFile: fileId } });
    conn.on('open', () => {
        conn.on('data', (data) => {
            if(data.type === 'file_transfer') {
                const blob = new Blob([data.file]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = data.name; a.click();
                btnElement.innerHTML = `<i class="bi bi-check2"></i> Saved`;
                btnElement.classList.replace('btn-primary', 'btn-success');
            }
            setTimeout(() => conn.close(), 1000);
        });
    });
}

function handleIncomingDataConnection(conn) {
    conn.on('open', () => {
        if(conn.metadata && conn.metadata.requestFile) {
            const file = hostedFiles[conn.metadata.requestFile];
            if(file) conn.send({ type: 'file_transfer', file: file, name: file.name });
        }
    });
}

// ==========================================
// 5. CALLING SYSTEM (WITH BIG AVATARS)
// ==========================================
function showCallSelectModal(isVideo) {
    const activeKeys = Object.keys(connectedUsers).filter(k => k !== myPeerId);
    if(activeKeys.length === 0) return alert("No other users online right now.");

    const listDiv = document.getElementById('callUserList');
    listDiv.innerHTML = '';
    
    activeKeys.forEach(k => {
        const user = connectedUsers[k];
        listDiv.innerHTML += `
            <button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" 
                onclick="startCallFromModal('${user.peerId}', ${isVideo}, '${user.username}')">
                ${user.username}
                <i class="bi ${isVideo ? 'bi-camera-video' : 'bi-telephone'} text-primary"></i>
            </button>`;
    });
    
    window.currentCallModal = new bootstrap.Modal(document.getElementById('callSelectModal'));
    window.currentCallModal.show();
}

document.getElementById('topAudioCallBtn').onclick = () => showCallSelectModal(false);
document.getElementById('topVideoCallBtn').onclick = () => showCallSelectModal(true);

window.startCallFromModal = (peerId, isVideo, username) => {
    if(window.currentCallModal) window.currentCallModal.hide();
    initiateCall(peerId, isVideo, username);
};

// OUTGOING CALL
function initiateCall(targetPeerId, isVideo, targetUsername) {
    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then(stream => {
            setupLocalStream(stream, isVideo);
            showCallUI(targetUsername, "Dialing...");
            
            // Pass my username so receiver knows who is calling
            currentCall = peer.call(targetPeerId, stream, { 
                metadata: { video: isVideo, callerName: myUsername } 
            });
            handleCallEvents(currentCall, isVideo);
        })
        .catch(err => { alert("Microphone/Camera access denied."); });
}

// INCOMING CALL TRIGGER
function handleIncomingCall(call) {
    pendingCall = call;
    const isVideo = call.metadata ? call.metadata.video : true;
    const callerName = call.metadata && call.metadata.callerName ? call.metadata.callerName : "Someone";
    
    // Update Incoming UI
    document.getElementById('incomingCallerName').innerText = callerName;
    document.getElementById('incomingCallType').innerText = `Incoming ${isVideo ? 'Video' : 'Audio'} Call...`;
    document.getElementById('incomingCallIcon').className = isVideo ? "bi bi-camera-video-fill text-white fs-1" : "bi bi-telephone-inbound-fill text-white fs-1";
    
    incomingCallModalObj.show();
    playNotificationSound();
}

// ACCEPT CALL
document.getElementById('acceptCallBtn').addEventListener('click', () => {
    if(!pendingCall) return;
    incomingCallModalObj.hide();
    
    const isVideo = pendingCall.metadata ? pendingCall.metadata.video : true;
    const callerName = pendingCall.metadata ? pendingCall.metadata.callerName : "Unknown";

    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then(stream => {
            setupLocalStream(stream, isVideo);
            showCallUI(callerName, "Connecting...");
            pendingCall.answer(stream);
            currentCall = pendingCall;
            handleCallEvents(pendingCall, isVideo);
            pendingCall = null;
        })
        .catch(err => alert("Mic/Camera required to answer."));
});

// REJECT CALL
document.getElementById('rejectCallBtn').addEventListener('click', () => {
    if(pendingCall) {
        pendingCall.close();
        pendingCall = null;
    }
    incomingCallModalObj.hide();
});


function handleCallEvents(call, isVideo) {
    call.on('stream', remoteStream => {
        document.getElementById('callStatus').innerText = "Connected";
        document.getElementById('callLiveBadge').classList.remove('d-none');
        
        const remoteVid = document.getElementById('remoteVideo');
        remoteVid.srcObject = remoteStream;
        
        // Show video only if it has video tracks, otherwise keep big avatar
        if(isVideo && remoteStream.getVideoTracks().length > 0) {
            remoteVid.classList.remove('d-none');
            document.getElementById('callAvatarContainer').classList.add('d-none');
        } else {
            remoteVid.classList.add('d-none');
            document.getElementById('callAvatarContainer').classList.remove('d-none');
        }
    });

    call.on('close', endCall);
    call.on('error', endCall);
}

function setupLocalStream(stream, isVideo) {
    localStream = stream;
    const localVid = document.getElementById('localVideo');
    localVid.srcObject = stream;
    if(isVideo) localVid.classList.remove('d-none');
}

// ==========================================
// 6. CALL UI UPDATES
// ==========================================
function showCallUI(peerName, status) {
    const callPanel = document.getElementById('call-panel');
    const chatSection = document.getElementById('chat-section');
    
    // Update Big Avatar
    document.getElementById('callPeerNameDisplay').innerText = peerName;
    document.getElementById('callAvatar').innerText = peerName.charAt(0).toUpperCase();
    document.getElementById('callStatus').innerText = status;
    
    // Show UI
    callPanel.classList.remove('d-none'); callPanel.classList.add('d-flex');
    chatSection.classList.remove('col-lg-9'); chatSection.classList.add('col-lg-5');
    document.getElementById('callAvatarContainer').classList.remove('d-none');
}

function endCall() {
    if (currentCall) currentCall.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    currentCall = null; localStream = null;

    document.getElementById('localVideo').classList.add('d-none');
    document.getElementById('remoteVideo').classList.add('d-none');
    document.getElementById('callLiveBadge').classList.add('d-none');
    
    const callPanel = document.getElementById('call-panel');
    const chatSection = document.getElementById('chat-section');
    callPanel.classList.add('d-none'); callPanel.classList.remove('d-flex');
    chatSection.classList.add('col-lg-9'); chatSection.classList.remove('col-lg-5');
}

document.getElementById('endCallBtn').addEventListener('click', endCall);

document.getElementById('toggleMicBtn').addEventListener('click', function() {
    if (localStream && localStream.getAudioTracks().length > 0) {
        const track = localStream.getAudioTracks()[0];
        track.enabled = !track.enabled;
        this.innerHTML = track.enabled ? '<i class="bi bi-mic-fill"></i>' : '<i class="bi bi-mic-mute-fill text-danger"></i>';
        this.classList.toggle('btn-outline-light', track.enabled);
        this.classList.toggle('btn-light', !track.enabled);
    }
});

document.getElementById('toggleCamBtn').addEventListener('click', function() {
    if (localStream && localStream.getVideoTracks().length > 0) {
        const track = localStream.getVideoTracks()[0];
        track.enabled = !track.enabled;
        this.innerHTML = track.enabled ? '<i class="bi bi-camera-video-fill"></i>' : '<i class="bi bi-camera-video-off-fill text-danger"></i>';
        this.classList.toggle('btn-outline-light', track.enabled);
        this.classList.toggle('btn-light', !track.enabled);
        
        // If I turn off camera, hide my small local video feed
        if(!track.enabled) {
            document.getElementById('localVideo').classList.add('d-none');
        } else {
            document.getElementById('localVideo').classList.remove('d-none');
        }
    }
});

// Utilities
function formatBytes(bytes) {
    if(bytes === 0) return '0 Bytes';
    const k = 1024; const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}
