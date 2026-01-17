/**
 * Discock - Voice Chat Logic (WebRTC Mesh)
 */

let localStream = null;
let peers = {}; // { user_id: { pc: RTCPeerConnection, iceQueue: [] } }
let isMicMuted = true;

// Конфигурация с публичными STUN-серверами Google (для связи между городами)
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
    ]
};

async function initVoiceChat() {
    try {
        // Сразу запрашиваем доступ к микрофону при загрузке
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // По умолчанию микрофон выключен (track.enabled = false)
        localStream.getAudioTracks().forEach(track => track.enabled = !isMicMuted);
        console.log("🎤 Микрофон готов");
    } catch (e) {
        console.error("❌ Доступ к микрофону запрещен:", e);
    }
}

function createPeerConnection(targetUserId, stream) {
    if (peers[targetUserId]) return peers[targetUserId];

    const pc = new RTCPeerConnection(rtcConfig);
    peers[targetUserId] = { pc: pc, iceQueue: [], remoteDescSet: false };

    // 1. Сразу добавляем наш поток в соединение, чтобы звук пошел сразу
    if (stream) {
        stream.getTracks().forEach(track => pc.addTrack(track, stream));
    }

    // Обработка ICE-кандидатов
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                room_id: currentRoomId,
                target_user_id: targetUserId,
                candidate: event.candidate
            });
        }
    };

    // Когда получаем звук от собеседника
    pc.ontrack = (event) => {
        console.log(`🎧 Получен аудио поток от: ${targetUserId}`);
        let remoteAudio = document.getElementById(`audio-${targetUserId}`);
        if (!remoteAudio) {
            remoteAudio = document.createElement('audio');
            remoteAudio.id = `audio-${targetUserId}`;
            remoteAudio.autoplay = true;
            document.body.appendChild(remoteAudio);
        }
        remoteAudio.srcObject = event.streams[0];
    };

    return peers[targetUserId];
}

// Обработка Offer (предложение связи)
async function handleOffer(data) {
    const { from_user_id, offer } = data;
    const peerEntry = createPeerConnection(from_user_id, localStream);
    const pc = peerEntry.pc;

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        peerEntry.remoteDescSet = true;

        // Обрабатываем накопившиеся ICE-кандидаты
        while (peerEntry.iceQueue.length > 0) {
            const cand = peerEntry.iceQueue.shift();
            await pc.addIceCandidate(cand);
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit('answer', {
            room_id: currentRoomId,
            target_user_id: from_user_id,
            answer: pc.localDescription
        });
    } catch (e) {
        console.error("❌ Ошибка при обработке Offer:", e);
    }
}

// Обработка Answer (ответ на предложение)
async function handleAnswer(data) {
    const { from_user_id, answer } = data;
    const peerEntry = peers[from_user_id];
    if (peerEntry) {
        try {
            if (peerEntry.pc.signalingState !== "stable") {
                await peerEntry.pc.setRemoteDescription(new RTCSessionDescription(answer));
                peerEntry.remoteDescSet = true;
                
                while (peerEntry.iceQueue.length > 0) {
                    const cand = peerEntry.iceQueue.shift();
                    await peerEntry.pc.addIceCandidate(cand);
                }
            }
        } catch (e) {
            console.error("❌ Ошибка при обработке Answer:", e);
        }
    }
}

// Обработка ICE-кандидатов (важно: очередь!)
async function handleIceCandidate(data) {
    const { from_user_id, candidate } = data;
    const peerEntry = peers[from_user_id];
    
    if (peerEntry) {
        try {
            if (peerEntry.remoteDescSet) {
                await peerEntry.pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
                // Если описание еще не установлено, кладем в очередь
                peerEntry.iceQueue.push(new RTCIceCandidate(candidate));
            }
        } catch (e) {
            console.error("❌ Ошибка добавления ICE:", e);
        }
    }
}

// Переключение микрофона (только у себя!)
function toggleMicrophone() {
    if (!localStream) return;

    isMicMuted = !isMicMuted;
    
    // Включаем/выключаем треки в нашем локальном стриме
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMicMuted;
    });

    // Обновляем UI кнопки
    const btn = document.getElementById('mic-toggle');
    if (btn) {
        btn.innerHTML = isMicMuted ? 
            '<i class="fas fa-microphone-slash"></i> Выключен' : 
            '<i class="fas fa-microphone"></i> Включен';
        btn.classList.toggle('btn-danger', isMicMuted);
        btn.classList.toggle('btn-success', !isMicMuted);
    }

    // Уведомляем сервер (только для иконок в списке пользователей)
    if (isMicMuted) {
        socket.emit('user_mic_muted', { room_id: currentRoomId });
    } else {
        socket.emit('user_mic_enabled', { room_id: currentRoomId });
    }
}

function cleanupVoiceChat() {
    Object.keys(peers).forEach(id => closePeerConnection(id));
    peers = {};
}

function closePeerConnection(userId) {
    if (peers[userId]) {
        peers[userId].pc.close();
        delete peers[userId];
        const audio = document.getElementById(`audio-${userId}`);
        if (audio) audio.remove();
    }
}
