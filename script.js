// ==========================================
// 🔴 CONFIGURATION - PUT YOUR ABLY API KEY HERE
// ==========================================
const ABLY_API_KEY = 'VOQpog.EDlRAg:rlTQDbqkffk_GIZI-gX6YGW5yTeSgeAAeQBVYRB-OvU';

// Global State
let myUsername = '';
let myPeerId = '';
let roomId = '';
let ably, channel, peer;
let connectedUsers = {}; // Object to track users
let currentCall = null;
let localStream = null;
let typingTimeout = null;
let hostedFiles = {}; // Stores files for PeerJS data transfer { fileId: File }

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
    // Determine Room ID from URL or Generate a new one
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('room');
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        window.history.replaceState(null, '', `?room=${roomId}`);
    }
    document.getElementById('roomIdDisplay').innerText = roomId;

    // Show Username Modal
    const usernameModal = new bootstrap.Modal(document.getElementById('usernameModal'));
    usernameModal.show();

    // Handle Join
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

// Copy Link functionality
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
    // Initialize PeerJS for WebRTC (Calls & File Data)
    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        initializeAbly();
    });

    // Listen for incoming calls & data connections
    peer.on('call', handleIncomingCall);
    peer.on('connection', handleIncomingDataConnection); 
}

function initializeAbly() {
    if(ABLY_API_KEY === 'YOUR_ABLY_API_KEY_HERE') {
        alert("ERROR: Please add your Ably API key in script.js!");
        return;
    }

    // Set clientId to our unique PeerID to avoid duplicate message echoes instantly
    ably = new Ably.Realtime({ key: ABLY_API_KEY, clientId: myPeerId });
    channel = ably.channels.get(`room-${roomId}`);

    // --- Presence (Tracks who joins/leaves) ---
    channel.presence.subscribe(['enter', 'present', 'leave'], (msg) => {
        if (msg.action === 'leave') {
            delete connectedUsers[msg.clientId];
            showSystemMessage(`${msg.data.username} left the chat`, 'leave');
        } else {
            // Announce 'enter' for new users (ignore 'present' state of already connected users)
            if (msg.action === 'enter' && msg.clientId !== myPeerId) {
                showSystemMessage(`${msg.data.username} joined the chat`, 'join');
                playNotificationSound();
            }
            connectedUsers[msg.clientId] = { username: msg.data.username, peerId: msg.data.peerId };
        }
        renderUsers();
    });
    channel.presence.enterClient(myPeerId, { username: myUsername, peerId: myPeerId });

    // --- Messaging ---
    channel.subscribe('message', (msg) => {
        // Stop duplicate rendering if we already rendered it optimistically
        if (msg.clientId === myPeerId) return; 
        renderMessage(msg.data.username, msg.data.text, msg.data.time, false);
        playNotificationSound();
    });

    // --- File Sharing (Metadata) ---
    channel.subscribe('file_offer', (msg) => {
        if (msg.clientId === myPeerId) return;
        renderFileMessage(msg.data.username, msg.data.fileName, msg.data.fileSize, msg.data.time, false, msg.data.senderPeerId, msg.data.fileId);
        playNotificationSound();
    });

    // --- Typing Indicator ---
    channel.subscribe('typing', (msg) => {
        if (msg.clientId !== myPeerId) {
            typingIndicator.innerText = `${msg.data.username} is typing...`;
            typingIndicator.classList.toggle('d-none', !msg.data.isTyping);
        }
    });
}

// ==========================================
// 3. UI RENDERERS (Users & Messages)
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
                <button class="btn btn-sm btn-light text-primary rounded-circle" onclick="initiateCall('${user.peerId}', false)" title="Voice Call"><i class="bi bi-telephone-fill"></i></button>
                <button class="btn btn-sm btn-light text-primary rounded-circle" onclick="initiateCall('${user.peerId}', true)" title="Video Call"><i class="bi bi-camera-video-fill"></i></button>
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
    
    // Smooth auto-scroll
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// ==========================================
// 4. TEXT CHAT ACTIONS (Optimistic Update)
// ==========================================
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // ⚡ INSTANT UI UPDATE (Optimistic Rendering removes latency perception)
    renderMessage(myUsername, text, time, true);
    messageInput.value = '';

    // Publish to Ably silently
    channel.publish('message', { username: myUsername, text: text, time: time }, (err) => {
        if(err) showSystemMessage("Error: Failed to send message", 'leave');
    });
    
    channel.publish('typing', { username: myUsername, isTyping: false });
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

messageInput.addEventListener('input', () => {
    channel.publish('typing', { username: myUsername, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        channel.publish('typing', { username: myUsername, isTyping: false });
    }, 1500);
});

// ==========================================
// 5. FILE TRANSFER SYSTEM (PeerJS Data Channel)
// ==========================================
document.getElementById('fileAttachBtn').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(!file) return;

    // Generate unique ID & store file locally
    const fileId = Math.random().toString(36).substring(7);
    hostedFiles[fileId] = file; 
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedSize = formatBytes(file.size);

    // Render locally instantly
    renderFileMessage(myUsername, file.name, formattedSize, time, true, null, fileId);

    // Alert room via Ably that a file is available
    channel.publish('file_offer', { 
        username: myUsername, fileName: file.name, fileSize: formattedSize, 
        fileId: fileId, time: time, senderPeerId: myPeerId 
    });
    
    fileInput.value = ''; // Reset input
});

function renderFileMessage(sender, fileName, size, time, isSent, senderPeerId, fileId) {
    const div = document.createElement('div');
    div.className = `message-bubble ${isSent ? 'sent' : 'received'} d-flex flex-column`;
    
    let actionBtn = isSent ? 
        `<span class="badge bg-light text-dark shadow-sm">Sent</span>` : 
        `<button class="btn btn-sm btn-primary py-0 shadow-sm" onclick="downloadFile('${senderPeerId}', '${fileId}', '${fileName}', this)">
            <i class="bi bi-download"></i> Get
        </button>`;

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

// Receiver requests file via PeerJS DataConnection
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
                a.href = url;
                a.download = data.name;
                a.click();
                btnElement.innerHTML = `<i class="bi bi-check2"></i> Saved`;
                btnElement.classList.replace('btn-primary', 'btn-success');
            } else if(data.type === 'error') {
                alert(data.message);
                btnElement.innerHTML = `<i class="bi bi-download"></i> Get`;
                btnElement.disabled = false;
            }
            setTimeout(() => conn.close(), 1000);
        });
    });

    conn.on('error', () => {
        alert("Transfer failed. Peer may have disconnected.");
        btnElement.innerHTML = `<i class="bi bi-download"></i> Get`;
        btnElement.disabled = false;
    });
}

// Sender automatically sends file upon connection request
function handleIncomingDataConnection(conn) {
    conn.on('open', () => {
        if(conn.metadata && conn.metadata.requestFile) {
            const file = hostedFiles[conn.metadata.requestFile];
            if(file) {
                conn.send({ type: 'file_transfer', file: file, name: file.name });
            } else {
                conn.send({ type: 'error', message: 'File is no longer available.' });
            }
        }
    });
}

// ==========================================
// 6. VIDEO/AUDIO CALLING (SNAPCHAT-STYLE)
// ==========================================

// Top-Right Snapchat-style Call Modals
function showCallSelectModal(isVideo) {
    const activeKeys = Object.keys(connectedUsers).filter(k => k !== myPeerId);
    if(activeKeys.length === 0) return alert("No other users online right now.");

    const listDiv = document.getElementById('callUserList');
    listDiv.innerHTML = '';
    
    activeKeys.forEach(k => {
        const user = connectedUsers[k];
        listDiv.innerHTML += `
            <button class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" 
                onclick="startCallFromModal('${user.peerId}', ${isVideo})">
                ${user.username}
                <i class="bi ${isVideo ? 'bi-camera-video' : 'bi-telephone'} text-primary"></i>
            </button>`;
    });
    
    window.currentCallModal = new bootstrap.Modal(document.getElementById('callSelectModal'));
    window.currentCallModal.show();
}

document.getElementById('topAudioCallBtn').onclick = () => showCallSelectModal(false);
document.getElementById('topVideoCallBtn').onclick = () => showCallSelectModal(true);

window.startCallFromModal = (peerId, isVideo) => {
    if(window.currentCallModal) window.currentCallModal.hide();
    initiateCall(peerId, isVideo);
};

// Start a Call
function initiateCall(targetPeerId, isVideo) {
    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then(stream => {
            setupLocalStream(stream, isVideo);
            showCallUI();
            currentCall = peer.call(targetPeerId, stream, { metadata: { video: isVideo } });
            handleCallEvents(currentCall, isVideo);
        })
        .catch(err => { alert("Microphone/Camera access denied."); });
}

// Receive a Call
function handleIncomingCall(call) {
    const isVideo = call.metadata ? call.metadata.video : true;
    if (!confirm(`Incoming ${isVideo ? 'Video' : 'Audio'} call. Accept?`)) {
        call.close();
        return;
    }

    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then(stream => {
            setupLocalStream(stream, isVideo);
            showCallUI();
            call.answer(stream);
            currentCall = call;
            handleCallEvents(call, isVideo);
        })
        .catch(err => alert("Mic/Camera required to answer."));
}

function handleCallEvents(call, isVideo) {
    document.getElementById('callStatus').classList.add('d-none');
    call.on('stream', remoteStream => {
        const remoteVid = document.getElementById('remoteVideo');
        remoteVid.srcObject = remoteStream;
        if(isVideo) remoteVid.classList.remove('d-none');
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
// 7. CALL UI & CONTROLS
// ==========================================
function showCallUI() {
    const callPanel = document.getElementById('call-panel');
    const chatSection = document.getElementById('chat-section');
    callPanel.classList.remove('d-none'); callPanel.classList.add('d-flex');
    chatSection.classList.remove('col-lg-9'); chatSection.classList.add('col-lg-5');
    document.getElementById('callStatus').classList.remove('d-none');
}

function endCall() {
    if (currentCall) currentCall.close();
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    currentCall = null; localStream = null;

    document.getElementById('localVideo').classList.add('d-none');
    document.getElementById('remoteVideo').classList.add('d-none');
    
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
    }
});

// ==========================================
// 8. UTILITIES
// ==========================================
function formatBytes(bytes) {
    if(bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function playNotificationSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch(e) { console.log("Audio not supported"); }
}