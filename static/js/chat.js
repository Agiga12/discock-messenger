/**
 * Discock - Основная логика (ПОЛНАЯ ВЕРСИЯ)
 */

let socket = null;
let currentRoomId = null;
let usersInRoom = {};

function initSocket() {
    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
        console.log('✅ Подключено к серверу');
        if (currentRoomId) joinRoom(currentRoomId);
    });

    // Новая логика: получаем список всех, кто уже в комнате
    socket.on('room_users_list', (data) => {
        console.log('📋 Получен список участников:', data.users);
        usersInRoom = {};
        // Добавляем себя
        usersInRoom[CURRENT_USER.id] = CURRENT_USER;
        
        data.users.forEach(user => {
            if (user.id != CURRENT_USER.id) {
                usersInRoom[user.id] = user;
                // Сразу создаем соединение с теми, кто уже там
                initiateCall(user.id);
            }
        });
        updateUsersList();
    });

    socket.on('joined_room', (data) => {
        console.log(`👤 ${data.user.username} вошел`);
        usersInRoom[data.user.id] = data.user;
        updateUsersList();
        
        // Если зашел кто-то новый, звоним ему
        if (data.user.id != CURRENT_USER.id) {
            initiateCall(data.user.id);
        }
    });

    socket.on('left_room', (data) => {
        console.log(`👋 Пользователь ${data.user_id} вышел`);
        removeUserFromRoom(data.user_id);
        if (typeof closePeerConnection === 'function') closePeerConnection(data.user_id);
    });

    socket.on('offer', data => typeof handleOffer === 'function' && handleOffer(data));
    socket.on('answer', data => typeof handleAnswer === 'function' && handleAnswer(data));
    socket.on('ice_candidate', data => typeof handleIceCandidate === 'function' && handleIceCandidate(data));
    socket.on('new_message', msg => addMessageToUI(msg));
}

// Вспомогательная функция для инициации вызова
function initiateCall(targetUserId) {
    setTimeout(() => {
        if (typeof createPeerConnection === 'function') {
            const stream = (typeof localStream !== 'undefined' && localStream && !isMicMuted) ? localStream : null;
            const peerEntry = createPeerConnection(targetUserId, stream);
            
            if (peerEntry && peerEntry.pc) {
                peerEntry.pc.createOffer()
                    .then(offer => peerEntry.pc.setLocalDescription(offer))
                    .then(() => {
                        socket.emit('offer', { 
                            room_id: currentRoomId, 
                            target_user_id: targetUserId, 
                            offer: peerEntry.pc.localDescription 
                        });
                    })
                    .catch(e => console.error("Ошибка Offer:", e));
            }
        }
    }, 1000);
}

function joinRoom(roomId) {
    if (!socket || !socket.connected) {
        setTimeout(() => joinRoom(roomId), 100);
        return;
    }
    if (typeof cleanupVoiceChat === 'function') cleanupVoiceChat();
    socket.emit('join_room', { room_id: roomId });
    currentRoomId = roomId;
    updateCurrentRoomUI(roomId);
}

function updateCurrentRoomUI(id) {
    document.querySelectorAll('.room-item').forEach(item => {
        const link = item.querySelector('a');
        item.classList.toggle('active', link && parseInt(link.getAttribute('data-room-id')) === parseInt(id));
    });
}

function removeUserFromRoom(id) {
    delete usersInRoom[id];
    updateUsersList();
}

function updateUsersList() {
    const list = document.getElementById('users-list');
    if (list) {
        list.innerHTML = '';
        Object.values(usersInRoom).forEach(u => {
            const li = document.createElement('li');
            li.className = 'user-item';
            // Помечаем себя в списке
            const isMe = u.id == CURRENT_USER.id ? ' (Вы)' : '';
            li.innerHTML = `<span>🟢</span> ${u.username}${isMe}`;
            list.appendChild(li);
        });
    }
}

function addMessageToUI(m) {
    const cont = document.getElementById('messages-container');
    if (cont) {
        const d = document.createElement('div');
        d.className = 'message';
        d.innerHTML = `<b>${m.username}:</b> ${m.content}`;
        cont.appendChild(d);
        cont.scrollTop = cont.scrollHeight;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof CURRENT_ROOM_ID !== 'undefined') currentRoomId = CURRENT_ROOM_ID;
    initSocket();
    if (typeof initVoiceChat === 'function') initVoiceChat();
    
    const form = document.getElementById('message-form');
    if (form) form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('message-input');
        if (input.value.trim()) {
            socket.emit('send_message', { room_id: currentRoomId, content: input.value.trim() });
            input.value = '';
        }
    });
});