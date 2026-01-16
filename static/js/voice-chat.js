/**
 * Discock - Голосовой чат через WebRTC (ПОЛНАЯ ВЕРСИЯ)
 */

let localStream = null;
let peers = {}; // {userId: {pc: RTCPeerConnection, iceQueue: []}}
let isMicMuted = true;
let isSpeakerMuted = false;

function initVoiceChat() {
    console.log('🎤 Инициализация голосового чата...');
    const micBtn = document.getElementById('toggle-mic-btn');
    const speakerBtn = document.getElementById('toggle-speaker-btn');
    
    if (micBtn) micBtn.addEventListener('click', toggleMicrophone);
    if (speakerBtn) speakerBtn.addEventListener('click', toggleSpeaker);
}

// Управление микрофоном
async function toggleMicrophone() {
    try {
        if (!localStream) {
            console.log('Запрос доступа к микрофону...');
            localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { echoCancellation: true, noiseSuppression: true } 
            });
            console.log('Микрофон получен');
        }

        isMicMuted = !isMicMuted;
        localStream.getAudioTracks().forEach(track => track.enabled = !isMicMuted);
        updateMicButton(isMicMuted);

        if (!isMicMuted) {
            const track = localStream.getAudioTracks()[0];
            for (const userId in peers) {
                const pc = peers[userId].pc;
                const senders = pc.getSenders();
                const audioSender = senders.find(s => s.track && s.track.kind === 'audio');

                if (!audioSender) {
                    pc.addTrack(track, localStream);
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    socket.emit('offer', { room_id: currentRoomId, target_user_id: userId, offer: pc.localDescription });
                }
            }
            socket.emit('user_mic_enabled', { room_id: currentRoomId, user_id: CURRENT_USER.id });
        } else {
            socket.emit('user_mic_muted', { room_id: currentRoomId });
        }
    } catch (error) {
        console.error('❌ Ошибка микрофона (подробно):', error.name, error.message);
        alert(`Ошибка микрофона: ${error.message}`);
    }
}

// Создание соединения
function createPeerConnection(userId, stream) {
    if (peers[userId]) closePeerConnection(userId);

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    });

    const peerEntry = { pc: pc, iceQueue: [] };
    peers[userId] = peerEntry;

    if (stream) {
        stream.getAudioTracks().forEach(track => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', { room_id: currentRoomId, target_user_id: userId, candidate: event.candidate });
        }
    };

    pc.ontrack = (event) => {
        console.log('🎧 Получен аудио поток от:', userId);
        let audio = pc.audioElement || new Audio();
        audio.srcObject = event.streams[0];
        audio.autoplay = true;
        pc.audioElement = audio;
        event.streams[0].getAudioTracks().forEach(t => t.enabled = !isSpeakerMuted);
    };

    return peerEntry;
}

// Функции обновления кнопок (БЫЛИ ПРОПУЩЕНЫ)
function updateMicButton(muted) {
    const micBtn = document.getElementById('toggle-mic-btn');
    const micIcon = document.getElementById('mic-icon');
    const micStatus = document.getElementById('mic-status');
    if (micBtn) {
        micBtn.classList.toggle('active', !muted);
        micBtn.classList.toggle('muted', muted);
        if (micIcon) micIcon.textContent = '🎤';
        if (micStatus) micStatus.textContent = muted ? 'Выключен' : 'Включен';
    }
}

function updateSpeakerButton(muted) {
    const speakerBtn = document.getElementById('toggle-speaker-btn');
    const speakerIcon = document.getElementById('speaker-icon');
    if (speakerBtn) {
        speakerBtn.classList.toggle('active', !muted);
        if (speakerIcon) speakerIcon.textContent = muted ? '🔇' : '🔊';
    }
}

// Обработка сигналов
async function handleOffer(data) {
    const peerEntry = createPeerConnection(data.from_user_id, (localStream && !isMicMuted) ? localStream : null);
    try {
        await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerEntry.pc.createAnswer();
        await peerEntry.pc.setLocalDescription(answer);
        socket.emit('answer', { room_id: currentRoomId, target_user_id: data.from_user_id, answer: peerEntry.pc.localDescription });
        processIceQueue(data.from_user_id);
    } catch (e) { console.error('Ошибка Offer:', e); }
}

async function handleAnswer(data) {
    const peerEntry = peers[data.from_user_id];
    if (!peerEntry) return;
    try {
        await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        processIceQueue(data.from_user_id);
    } catch (e) { console.error('Ошибка Answer:', e); }
}

function handleIceCandidate(data) {
    const peerEntry = peers[data.from_user_id];
    if (!peerEntry) return;
    if (peerEntry.pc.remoteDescription) {
        peerEntry.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(console.error);
    } else {
        peerEntry.iceQueue.push(data.candidate);
    }
}

function processIceQueue(userId) {
    const peerEntry = peers[userId];
    if (peerEntry && peerEntry.iceQueue.length > 0) {
        peerEntry.iceQueue.forEach(can => peerEntry.pc.addIceCandidate(new RTCIceCandidate(can)).catch(console.error));
        peerEntry.iceQueue = [];
    }
}

function toggleSpeaker() {
    isSpeakerMuted = !isSpeakerMuted;
    updateSpeakerButton(isSpeakerMuted);
    Object.values(peers).forEach(p => {
        if (p.pc.audioElement && p.pc.audioElement.srcObject) {
            p.pc.audioElement.srcObject.getAudioTracks().forEach(t => t.enabled = !isSpeakerMuted);
        }
    });
}

function closePeerConnection(userId) {
    if (peers[userId]) {
        const pc = peers[userId].pc;
        if (pc.audioElement) { pc.audioElement.pause(); pc.audioElement.srcObject = null; }
        pc.close();
        delete peers[userId];
    }
}

function cleanupVoiceChat() {
    Object.keys(peers).forEach(closePeerConnection);
}