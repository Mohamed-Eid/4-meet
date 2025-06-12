// 4Meet - Enhanced Multi-User Video Conference App
const firebaseConfig = {
    apiKey: "AIzaSyCg3wt0k2SflSEt-mk0kElg3oBvTr0chBs",
    authDomain: "meet-ad5c1.firebaseapp.com",
    databaseURL: "https://meet-ad5c1-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "meet-ad5c1",
    storageBucket: "meet-ad5c1.firebasestorage.app",
    messagingSenderId: "30076614367",
    appId: "1:30076614367:web:fcd2f8c007c230ada21b6a",
    measurementId: "G-K8Z7735RZX"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// Application State
let localStream;
let previewStream;
let peerConnections = new Map(); // Map of userId -> RTCPeerConnection
let participants = new Map(); // Map of userId -> participant data
let iceCandidateQueues = new Map(); // Queue ICE candidates until peer connection is ready
let roomId;
let userName;
let userId;
let isAudioEnabled = true;
let isVideoEnabled = false;
let isScreenSharing = false;
let callStartTime;
let timerInterval;

const servers = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        // Free TURN servers for better connectivity
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
        }
    ]
};

// DOM Elements
const preJoinScreen = document.getElementById('preJoinScreen');
const videoGrid = document.getElementById('videoGrid');
const controlsBar = document.getElementById('controlsBar');
const participantsPanel = document.getElementById('participantsPanel');
const chatPanel = document.getElementById('chatPanel');
const previewVideo = document.getElementById('previewVideo');

// Initialize the application
document.addEventListener('DOMContentLoaded', async () => {
    userId = generateUserId();
    await initPreview();
    
    // Enter key listeners
    document.getElementById('roomId').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
    
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});

function generateUserId() {
    return 'user_' + Math.random().toString(36).substr(2, 9);
}

async function initPreview() {
    try {
        previewStream = await navigator.mediaDevices.getUserMedia({ 
            audio: true, 
            video: true 
        });
        previewVideo.srcObject = previewStream;
        
        // Ensure preview video is muted to prevent echo
        previewVideo.muted = true;
        previewVideo.volume = 0;
        previewVideo.setAttribute('muted', 'true');
        
        isAudioEnabled = true;
        isVideoEnabled = true;
        updatePreviewButtons();
    } catch (error) {
        console.log('Preview media access failed:', error);
        updateStatus('Camera/microphone access denied');
    }
}

function updatePreviewButtons() {
    const audioBtn = document.getElementById('previewAudioBtn');
    const videoBtn = document.getElementById('previewVideoBtn');
    
    audioBtn.innerHTML = isAudioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    audioBtn.className = `control-btn text-sm ${isAudioEnabled ? 'bg-gray-600' : 'bg-red-600'}`;
    
    videoBtn.innerHTML = isVideoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    videoBtn.className = `control-btn text-sm ${isVideoEnabled ? 'bg-gray-600' : 'bg-red-600'}`;
}

function togglePreviewAudio() {
    if (previewStream && previewStream.getAudioTracks().length > 0) {
        isAudioEnabled = !isAudioEnabled;
        previewStream.getAudioTracks()[0].enabled = isAudioEnabled;
        updatePreviewButtons();
    }
}

function togglePreviewVideo() {
    if (previewStream && previewStream.getVideoTracks().length > 0) {
        isVideoEnabled = !isVideoEnabled;
        previewStream.getVideoTracks()[0].enabled = isVideoEnabled;
        updatePreviewButtons();
    }
}

async function createRoom() {
    roomId = generateRoomId();
    document.getElementById('roomId').value = roomId;
    await joinMeeting(true);
}

async function joinRoom() {
    roomId = document.getElementById('roomId').value.trim();
    if (!roomId) {
        updateStatus('Please enter a meeting ID');
        return;
    }
    await joinMeeting(false);
}

function generateRoomId() {
    return Math.random().toString(36).substr(2, 9);
}

async function joinMeeting(isCreator) {
    userName = document.getElementById('userName').value.trim() || 'Anonymous';
    
    if (!roomId) {
        updateStatus('Please enter a meeting ID');
        return;
    }

    try {
        // Get user media with preview settings
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: isAudioEnabled,
            video: isVideoEnabled
        });

        // Hide pre-join screen and show meeting UI
        preJoinScreen.classList.add('hidden');
        videoGrid.classList.remove('hidden');
        controlsBar.classList.remove('hidden');
        document.getElementById('meetingInfo').classList.remove('hidden');
        document.getElementById('roomIdDisplay').textContent = `Meeting ID: ${roomId}`;

        // Stop preview stream
        if (previewStream) {
            previewStream.getTracks().forEach(track => track.stop());
            previewStream = null;
        }

        // Add local video
        addLocalVideo();
        updateControlButtons();

        // Join Firebase room
        await joinFirebaseRoom(isCreator);
        
        updateStatus('Connected to meeting');
        startTimer();

    } catch (error) {
        updateStatus(`Error joining meeting: ${error.message}`);
        console.error('Error joining meeting:', error);
    }
}

function addLocalVideo() {
    const localVideoContainer = createVideoContainer(userId, userName, true);
    videoGrid.appendChild(localVideoContainer);
    
    const video = localVideoContainer.querySelector('video');
    video.srcObject = localStream;
    video.muted = true; // Always mute local video to prevent echo
    video.volume = 0; // Extra safety to prevent audio feedback
    video.setAttribute('muted', 'true'); // Ensure muted attribute is set
    
    // Store local participant data
    participants.set(userId, {
        id: userId,
        name: userName,
        isLocal: true,
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled
    });
    
    updateVideoGrid();
    updateParticipantCount();
}

function createVideoContainer(participantId, participantName, isLocal = false) {
    const container = document.createElement('div');
    container.className = 'participant-video video-container';
    container.id = `video-${participantId}`;
    
    // Ensure local video is always muted to prevent echo
    const mutedAttribute = isLocal ? 'muted' : '';
    
    container.innerHTML = `
        <video autoplay ${mutedAttribute} playsinline class="w-full h-full object-cover" ${isLocal ? 'volume="0"' : ''}></video>
        <div class="absolute bottom-2 left-2 bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
            <i class="fas fa-microphone mr-1 audio-icon"></i>
            <span class="name">${participantName}${isLocal ? ' (You)' : ''}</span>
        </div>
        <div class="absolute top-2 right-2 text-white text-xs">
            <i class="fas fa-video video-icon"></i>
        </div>
    `;
    
    // Additional safety for local video
    if (isLocal) {
        const video = container.querySelector('video');
        video.muted = true;
        video.volume = 0;
        video.setAttribute('muted', 'true');
    }
    
    return container;
}

async function joinFirebaseRoom(isCreator) {
    const roomRef = database.ref(`rooms/${roomId}`);
    const participantRef = roomRef.child(`participants/${userId}`);
    
    // Add ourselves to the room
    await participantRef.set({
        name: userName,
        joinedAt: firebase.database.ServerValue.TIMESTAMP,
        audioEnabled: isAudioEnabled,
        videoEnabled: isVideoEnabled
    });    // Listen for other participants
    roomRef.child('participants').on('child_added', async (snapshot) => {
        const participantId = snapshot.key;
        const participantData = snapshot.val();
        
        if (participantId !== userId) {
            await handleNewParticipant(participantId, participantData);
        }
    });    // Listen for participant updates
    roomRef.child('participants').on('child_changed', (snapshot) => {
        const participantId = snapshot.key;
        const participantData = snapshot.val();
        if (participantId !== userId) {
            updateParticipantStatus(participantId, participantData);
        }
    });

    // Listen for participant leaving
    roomRef.child('participants').on('child_removed', (snapshot) => {
        const participantId = snapshot.key;
        if (participantId !== userId) {
            handleParticipantLeft(participantId);
        }
    });// Listen for offers
    roomRef.child(`offers/${userId}`).on('child_added', async (snapshot) => {
        try {
            const offerData = snapshot.val();
            await handleOffer(offerData.from, JSON.parse(offerData.offer));
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    });

    // Listen for answers
    roomRef.child(`answers/${userId}`).on('child_added', async (snapshot) => {
        try {
            const answerData = snapshot.val();
            await handleAnswer(answerData.from, JSON.parse(answerData.answer));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    });

    // Listen for ICE candidates
    roomRef.child(`candidates/${userId}`).on('child_added', async (snapshot) => {
        try {
            const candidateData = snapshot.val();
            await handleIceCandidate(candidateData.from, JSON.parse(candidateData.candidate));
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    });    // Listen for chat messages
    roomRef.child('chat').on('child_added', (snapshot) => {
        const message = snapshot.val();
        if (message && message.timestamp) {
            displayChatMessage(message);
        }
    });

    // Cleanup on disconnect
    participantRef.onDisconnect().remove();
}

async function handleNewParticipant(participantId, participantData) {
    console.log('New participant joined:', participantId, participantData);
    
    // Check if we already have a connection with this participant
    if (peerConnections.has(participantId)) {
        console.log(`Already have connection with ${participantId}`);
        return;
    }
    
    // Initialize ICE candidate queue for this participant
    iceCandidateQueues.set(participantId, []);
    
    // Store participant data
    participants.set(participantId, {
        id: participantId,
        name: participantData.name,
        isLocal: false,
        audioEnabled: participantData.audioEnabled,
        videoEnabled: participantData.videoEnabled
    });

    // Create video container
    const videoContainer = createVideoContainer(participantId, participantData.name);
    videoGrid.appendChild(videoContainer);

    // Create peer connection with enhanced configuration
    const peerConnection = new RTCPeerConnection({
        ...servers,
        iceCandidatePoolSize: 10
    });
    peerConnections.set(participantId, peerConnection);

    // Handle ICE candidates with improved timing
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Sending ICE candidate to ${participantId}`);
            sendIceCandidate(participantId, event.candidate);
        } else {
            console.log(`ICE gathering complete for ${participantId}`);
        }
    };

    // Enhanced connection state monitoring
    peerConnection.onconnectionstatechange = () => {
        console.log(`Connection state with ${participantId}: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'connected') {
            console.log(`✅ Successfully connected to ${participantId}`);
            updateStatus(`Connected to ${participantData.name}`);
        } else if (peerConnection.connectionState === 'failed') {
            console.log(`❌ Connection failed with ${participantId}`);
            updateStatus(`Connection failed with ${participantData.name}`);
        } else if (peerConnection.connectionState === 'disconnected') {
            console.log(`⚠️ Disconnected from ${participantId}`);
        }
    };

    peerConnection.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${participantId}: ${peerConnection.iceConnectionState}`);
        if (peerConnection.iceConnectionState === 'failed') {
            console.log(`ICE connection failed with ${participantId}, restarting...`);
            peerConnection.restartIce();
        }
    };

    // Handle remote stream with improved error handling
    peerConnection.ontrack = (event) => {
        console.log(`Received ${event.track.kind} track from ${participantId}`);
        try {
            const video = videoContainer.querySelector('video');
            if (video && event.streams && event.streams[0]) {
                video.srcObject = event.streams[0];
                console.log(`Video stream assigned to ${participantId}`);
            }
        } catch (error) {
            console.error(`Error handling remote track from ${participantId}:`, error);
        }
    };

    // Add local stream tracks to peer connection FIRST
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log(`Adding ${track.kind} track to peer connection with ${participantId}`);
            try {
                peerConnection.addTrack(track, localStream);
            } catch (error) {
                console.error(`Error adding track to ${participantId}:`, error);
            }
        });
    }

    // Wait a moment for everything to be set up
    await new Promise(resolve => setTimeout(resolve, 200));

    // Only initiate offer if our userId is "greater" than theirs to avoid race conditions
    if (userId > participantId) {
        console.log(`🚀 Initiating offer to ${participantId} (${userId} > ${participantId})`);
        try {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            await sendOffer(participantId, offer);
            console.log(`Offer sent to ${participantId}`);
        } catch (error) {
            console.error(`Error creating offer for ${participantId}:`, error);
        }
    } else {
        console.log(`⏳ Waiting for offer from ${participantId} (${userId} < ${participantId})`);
    }

    updateVideoGrid();
    updateParticipantCount();
    updateParticipantsList();
}

async function handleOffer(fromId, offer) {
    console.log('📨 Received offer from:', fromId);
    
    let peerConnection = peerConnections.get(fromId);
    if (!peerConnection) {
        console.log(`Creating new peer connection for offer from ${fromId}`);
        
        // Initialize ICE candidate queue
        iceCandidateQueues.set(fromId, []);
        
        peerConnection = new RTCPeerConnection({
            ...servers,
            iceCandidatePoolSize: 10
        });
        peerConnections.set(fromId, peerConnection);

        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${fromId}`);
                sendIceCandidate(fromId, event.candidate);
            }
        };

        // Enhanced connection state monitoring
        peerConnection.onconnectionstatechange = () => {
            console.log(`Connection state with ${fromId}: ${peerConnection.connectionState}`);
            if (peerConnection.connectionState === 'connected') {
                console.log(`✅ Successfully connected to ${fromId}`);
            } else if (peerConnection.connectionState === 'failed') {
                console.log(`❌ Connection failed with ${fromId}`);
            }
        };

        peerConnection.oniceconnectionstatechange = () => {
            console.log(`ICE connection state with ${fromId}: ${peerConnection.iceConnectionState}`);
            if (peerConnection.iceConnectionState === 'failed') {
                console.log(`ICE connection failed with ${fromId}, restarting...`);
                peerConnection.restartIce();
            }
        };

        // Handle remote stream
        peerConnection.ontrack = (event) => {
            console.log(`Received ${event.track.kind} track from ${fromId}`);
            const videoContainer = document.getElementById(`video-${fromId}`);
            if (videoContainer && event.streams && event.streams[0]) {
                const video = videoContainer.querySelector('video');
                if (video) {
                    video.srcObject = event.streams[0];
                    console.log(`Video stream assigned to ${fromId}`);
                }
            }
        };

        // Add local stream tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                console.log(`Adding ${track.kind} track to peer connection with ${fromId}`);
                try {
                    peerConnection.addTrack(track, localStream);
                } catch (error) {
                    console.error(`Error adding track to ${fromId}:`, error);
                }
            });
        }
    }

    // Check if we can set remote description
    if (peerConnection.signalingState === 'stable' || peerConnection.signalingState === 'have-local-offer') {
        console.log(`Setting remote description for ${fromId}, current state: ${peerConnection.signalingState}`);
        try {
            await peerConnection.setRemoteDescription(offer);
            
            // Process any queued ICE candidates now that remote description is set
            await processQueuedIceCandidates(fromId);
            
            const answer = await peerConnection.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(answer);
            await sendAnswer(fromId, answer);
            console.log(`✅ Answer sent to ${fromId}`);
        } catch (error) {
            console.error(`❌ Error handling offer from ${fromId}:`, error);
        }
    } else {
        console.log(`⚠️ Cannot handle offer from ${fromId}, peer connection state: ${peerConnection.signalingState}`);
    }
}

async function handleAnswer(fromId, answer) {
    console.log('📨 Received answer from:', fromId);
    const peerConnection = peerConnections.get(fromId);
    if (peerConnection) {
        // Check if we can set remote description
        if (peerConnection.signalingState === 'have-local-offer') {
            console.log(`Setting remote answer for ${fromId}, current state: ${peerConnection.signalingState}`);
            try {
                await peerConnection.setRemoteDescription(answer);
                
                // Process any queued ICE candidates now that remote description is set
                await processQueuedIceCandidates(fromId);
                
                console.log(`✅ Answer processed for ${fromId}`);
            } catch (error) {
                console.error(`❌ Error handling answer from ${fromId}:`, error);
            }
        } else {
            console.log(`⚠️ Cannot handle answer from ${fromId}, peer connection state: ${peerConnection.signalingState}`);
        }
    }
}

async function handleIceCandidate(fromId, candidate) {
    const peerConnection = peerConnections.get(fromId);
    
    if (peerConnection && peerConnection.remoteDescription) {
        // Peer connection is ready, add candidate immediately
        try {
            await peerConnection.addIceCandidate(candidate);
            console.log(`✅ ICE candidate added for ${fromId}`);
        } catch (error) {
            console.error(`❌ Error adding ICE candidate from ${fromId}:`, error);
        }
    } else {
        // Queue the candidate until peer connection is ready
        console.log(`📦 Queueing ICE candidate from ${fromId} (peer connection not ready)`);
        if (!iceCandidateQueues.has(fromId)) {
            iceCandidateQueues.set(fromId, []);
        }
        iceCandidateQueues.get(fromId).push(candidate);
    }
}

// Process queued ICE candidates after remote description is set
async function processQueuedIceCandidates(participantId) {
    const queue = iceCandidateQueues.get(participantId);
    const peerConnection = peerConnections.get(participantId);
    
    if (queue && queue.length > 0 && peerConnection && peerConnection.remoteDescription) {
        console.log(`Processing ${queue.length} queued ICE candidates for ${participantId}`);
        
        for (const candidate of queue) {
            try {
                await peerConnection.addIceCandidate(candidate);
                console.log(`✅ Queued ICE candidate processed for ${participantId}`);
            } catch (error) {
                console.error(`❌ Error processing queued ICE candidate for ${participantId}:`, error);
            }
        }
        
        // Clear the queue
        iceCandidateQueues.set(participantId, []);
    }
}

function handleParticipantLeft(participantId) {
    console.log('Participant left:', participantId);
    
    // Remove video container
    const videoContainer = document.getElementById(`video-${participantId}`);
    if (videoContainer) {
        videoContainer.remove();
    }

    // Close peer connection
    const peerConnection = peerConnections.get(participantId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(participantId);
    }

    // Clean up ICE candidate queue
    iceCandidateQueues.delete(participantId);

    // Remove from participants
    participants.delete(participantId);

    updateVideoGrid();
    updateParticipantCount();
    updateParticipantsList();
}

// Firebase messaging functions
async function sendOffer(toId, offer) {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        await roomRef.child(`offers/${toId}`).push({
            from: userId,
            offer: JSON.stringify(offer),
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        console.log(`Offer sent to ${toId}`);
    } catch (error) {
        console.error('Error sending offer:', error);
    }
}

async function sendAnswer(toId, answer) {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        await roomRef.child(`answers/${toId}`).push({
            from: userId,
            answer: JSON.stringify(answer),
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        console.log(`Answer sent to ${toId}`);
    } catch (error) {
        console.error('Error sending answer:', error);
    }
}

async function sendIceCandidate(toId, candidate) {
    try {
        const roomRef = database.ref(`rooms/${roomId}`);
        await roomRef.child(`candidates/${toId}`).push({
            from: userId,
            candidate: JSON.stringify(candidate),
            timestamp: firebase.database.ServerValue.TIMESTAMP
        });
        console.log(`ICE candidate sent to ${toId}`);
    } catch (error) {
        console.error('Error sending ICE candidate:', error);
    }
}

// Media control functions
function toggleAudio() {
    if (localStream && localStream.getAudioTracks().length > 0) {
        isAudioEnabled = !isAudioEnabled;
        localStream.getAudioTracks()[0].enabled = isAudioEnabled;
        updateControlButtons();
        updateParticipantStatus(userId, { audioEnabled: isAudioEnabled });
        
        // Update in Firebase
        if (roomId) {
            database.ref(`rooms/${roomId}/participants/${userId}`).update({
                audioEnabled: isAudioEnabled
            });
        }
    }
}

async function toggleVideo() {
    if (!localStream.getVideoTracks().length && isVideoEnabled) {
        // Add video track
        try {
            const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const track = videoStream.getVideoTracks()[0];
            localStream.addTrack(track);
            
            // Add track to all peer connections
            peerConnections.forEach(async (pc, participantId) => {
                pc.addTrack(track, localStream);
                // Renegotiate
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                await sendOffer(participantId, offer);
            });
            
            // Update local video
            const localVideo = document.querySelector(`#video-${userId} video`);
            if (localVideo) {
                localVideo.srcObject = localStream;
            }
            
        } catch (error) {
            updateStatus(`Error accessing camera: ${error.message}`);
            return;
        }
    } else if (localStream.getVideoTracks().length > 0) {
        // Toggle existing video track
        isVideoEnabled = !isVideoEnabled;
        localStream.getVideoTracks()[0].enabled = isVideoEnabled;
    }
    
    updateControlButtons();
    updateParticipantStatus(userId, { videoEnabled: isVideoEnabled });
    
    // Update in Firebase
    if (roomId) {
        database.ref(`rooms/${roomId}/participants/${userId}`).update({
            videoEnabled: isVideoEnabled
        });
    }
}

async function toggleScreenShare() {
    if (!isScreenSharing) {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true, 
                audio: true 
            });
            
            const videoTrack = screenStream.getVideoTracks()[0];
            
            // Replace video track in all peer connections
            peerConnections.forEach(async (pc) => {
                const sender = pc.getSenders().find(s => 
                    s.track && s.track.kind === 'video'
                );
                if (sender) {
                    await sender.replaceTrack(videoTrack);
                }
            });
            
            // Update local video
            const localVideo = document.querySelector(`#video-${userId} video`);
            if (localVideo) {
                localVideo.srcObject = screenStream;
            }
            
            isScreenSharing = true;
            
            // Handle screen share ending
            videoTrack.onended = () => {
                stopScreenShare();
            };
            
        } catch (error) {
            updateStatus(`Error sharing screen: ${error.message}`);
        }
    } else {
        stopScreenShare();
    }
    
    updateControlButtons();
}

async function stopScreenShare() {
    if (localStream && localStream.getVideoTracks().length > 0) {
        const videoTrack = localStream.getVideoTracks()[0];
        
        // Replace back to camera in all peer connections
        peerConnections.forEach(async (pc) => {
            const sender = pc.getSenders().find(s => 
                s.track && s.track.kind === 'video'
            );
            if (sender) {
                await sender.replaceTrack(videoTrack);
            }
        });
        
        // Update local video
        const localVideo = document.querySelector(`#video-${userId} video`);
        if (localVideo) {
            localVideo.srcObject = localStream;
        }
    }
    
    isScreenSharing = false;
    updateControlButtons();
}

function updateControlButtons() {
    const audioBtn = document.getElementById('muteAudioBtn');
    const videoBtn = document.getElementById('toggleVideoBtn');
    
    audioBtn.innerHTML = isAudioEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
    audioBtn.className = `control-btn ${isAudioEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-700'} text-white`;
    
    videoBtn.innerHTML = isVideoEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
    videoBtn.className = `control-btn ${isVideoEnabled ? 'bg-gray-600 hover:bg-gray-500' : 'bg-red-600 hover:bg-red-700'} text-white`;
}

function updateParticipantStatus(participantId, updates) {
    const participant = participants.get(participantId);
    if (participant) {
        Object.assign(participant, updates);
        
        const videoContainer = document.getElementById(`video-${participantId}`);
        if (videoContainer) {
            const audioIcon = videoContainer.querySelector('.audio-icon');
            const videoIcon = videoContainer.querySelector('.video-icon');
            
            if (audioIcon) {
                audioIcon.className = `fas mr-1 audio-icon ${participant.audioEnabled ? 'fa-microphone' : 'fa-microphone-slash'}`;
            }
            
            if (videoIcon) {
                videoIcon.className = `fas video-icon ${participant.videoEnabled ? 'fa-video' : 'fa-video-slash'}`;
            }
        }
        
        updateParticipantsList();
    }
}

// UI Update functions
function updateVideoGrid() {
    const participantCount = participants.size;
    const gridClass = `grid-${Math.min(participantCount, 9)}`;
    
    videoGrid.className = `video-grid ${gridClass} h-full`;
}

function updateParticipantCount() {
    const count = participants.size;
    document.getElementById('participantCount').textContent = 
        `${count} participant${count !== 1 ? 's' : ''}`;
}

function updateParticipantsList() {
    const list = document.getElementById('participantsList');
    list.innerHTML = '';
    
    participants.forEach((participant) => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-3 hover:bg-gray-700 rounded';
        item.innerHTML = `
            <div class="flex items-center space-x-3">
                <div class="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-sm font-semibold">
                    ${participant.name.charAt(0).toUpperCase()}
                </div>
                <span>${participant.name}${participant.isLocal ? ' (You)' : ''}</span>
            </div>
            <div class="flex space-x-2 text-sm">
                <i class="fas ${participant.audioEnabled ? 'fa-microphone text-green-400' : 'fa-microphone-slash text-red-400'}"></i>
                <i class="fas ${participant.videoEnabled ? 'fa-video text-green-400' : 'fa-video-slash text-red-400'}"></i>
            </div>
        `;
        list.appendChild(item);
    });
}

// Chat functions
function toggleChat() {
    chatPanel.classList.toggle('translate-x-full');
    hideParticipants();
}

function hideChat() {
    chatPanel.classList.add('translate-x-full');
}

function showParticipants() {
    participantsPanel.classList.remove('translate-x-full');
    hideChat();
    updateParticipantsList();
}

function hideParticipants() {
    participantsPanel.classList.add('translate-x-full');
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message && roomId) {
        const messageData = {
            from: userId,
            name: userName,
            message: message,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };
        
        database.ref(`rooms/${roomId}/chat`).push(messageData);
        input.value = '';
    }
}

function displayChatMessage(messageData) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `mb-3 ${messageData.from === userId ? 'text-right' : 'text-left'}`;
    
    const time = new Date(messageData.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
    
    messageDiv.innerHTML = `
        <div class="text-xs text-gray-400 mb-1">${messageData.name} • ${time}</div>
        <div class="inline-block px-3 py-2 rounded-lg ${
            messageData.from === userId 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-700 text-white'
        }">${messageData.message}</div>
    `;
    
    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Timer functions
function startTimer() {
    callStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    document.getElementById('timer').textContent = '';
}

function updateTimer() {
    if (!callStartTime) return;
    
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;
    
    const timeString = hours > 0 
        ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${minutes}:${seconds.toString().padStart(2, '0')}`;
    
    document.getElementById('timer').textContent = timeString;
}

// Utility functions
function updateStatus(message) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.classList.remove('hidden');
    
    setTimeout(() => {
        statusEl.classList.add('hidden');
    }, 5000);
    
    console.log(message);
}

function showSettings() {
    // TODO: Implement settings modal
    updateStatus('Settings coming soon!');
}

// Leave call function
function leaveCall() {
    // Close all peer connections
    peerConnections.forEach(pc => pc.close());
    peerConnections.clear();
    
    // Clear ICE candidate queues
    iceCandidateQueues.clear();
    
    // Stop local stream
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    // Remove from Firebase
    if (roomId && userId) {
        database.ref(`rooms/${roomId}/participants/${userId}`).remove();
        database.ref(`rooms/${roomId}`).off();
    }
    
    // Clear participants
    participants.clear();
    
    // Reset UI
    preJoinScreen.classList.remove('hidden');
    videoGrid.classList.add('hidden');
    controlsBar.classList.add('hidden');
    document.getElementById('meetingInfo').classList.add('hidden');
    
    // Clear video grid
    videoGrid.innerHTML = '';
    
    // Hide panels
    hideChat();
    hideParticipants();
    
    // Reset state
    isAudioEnabled = true;
    isVideoEnabled = false;
    isScreenSharing = false;
    
    stopTimer();
    updateStatus('Left the meeting');
    
    // Restart preview
    setTimeout(initPreview, 1000);
}

// Initialize preview when page loads
window.addEventListener('load', initPreview);
