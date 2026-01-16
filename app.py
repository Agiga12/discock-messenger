"""
Discock - Веб-мессенджер наподобие Discord
Главный файл приложения Flask
"""
import os
from flask import Flask, render_template, request, jsonify, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import BadRequest
from datetime import datetime
from dotenv import load_dotenv
import traceback

from models import db, User, Room, Message
from forms import RegisterForm, LoginForm

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv(
    'DATABASE_URL', 
    'sqlite:///discock.db'
).replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)
# Используем threading для локальной разработки (лучше работает на Windows)
# Для продакшена на Amvera используется eventlet через amvera.yaml
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
users_by_room = {} # {room_id: {user_id: user_data}}
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Пожалуйста, войдите для доступа к этой странице.'


@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))


def create_tables():
    """Создание таблиц в БД при первом запуске"""
    with app.app_context():
        db.create_all()
        # Создаём общую комнату по умолчанию
        if Room.query.filter_by(name='Общий чат').first() is None:
            general_room = Room(name='Общий чат', description='Главная комната для общения')
            db.session.add(general_room)
            db.session.commit()


# Инициализация БД при запуске
with app.app_context():
    create_tables()


@app.route('/')
def index():
    """Главная страница - редирект на логин или чат"""
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    return redirect(url_for('login'))


@app.route('/login', methods=['GET', 'POST'])
def login():
    """Страница входа"""
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    
    form = LoginForm()
    if form.validate_on_submit():
        user = User.query.filter_by(username=form.username.data).first()
        if user and check_password_hash(user.password_hash, form.password.data):
            login_user(user, remember=form.remember_me.data)
            return redirect(url_for('chat'))
        return render_template('login.html', form=form, error='Неверное имя пользователя или пароль')
    
    return render_template('login.html', form=form)


@app.route('/register', methods=['GET', 'POST'])
def register():
    """Страница регистрации"""
    if current_user.is_authenticated:
        return redirect(url_for('chat'))
    
    form = RegisterForm()
    if form.validate_on_submit():
        try:
            if User.query.filter_by(username=form.username.data).first():
                return render_template('register.html', form=form, error='Пользователь с таким именем уже существует')
            if User.query.filter_by(email=form.email.data).first():
                return render_template('register.html', form=form, error='Пользователь с таким email уже существует')
            
            user = User(
                username=form.username.data,
                email=form.email.data,
                password_hash=generate_password_hash(form.password.data),
                city=form.city.data or 'Не указан'
            )
            db.session.add(user)
            db.session.commit()
            login_user(user)
            return redirect(url_for('chat'))
        except Exception as e:
            db.session.rollback()
            app.logger.error(f'Ошибка при регистрации: {str(e)}')
            app.logger.error(traceback.format_exc())
            return render_template('register.html', form=form, error=f'Ошибка при регистрации: {str(e)}')
    
    return render_template('register.html', form=form)


@app.route('/logout')
@login_required
def logout():
    """Выход из системы"""
    logout_user()
    return redirect(url_for('login'))


@app.route('/chat')
@login_required
def chat():
    """Главная страница чата"""
    try:
        rooms = Room.query.all()
        current_room_id = request.args.get('room', None)
        
        if current_room_id:
            try:
                current_room_id = int(current_room_id)
                current_room = Room.query.get(current_room_id)
            except (ValueError, TypeError):
                current_room = None
        else:
            current_room = rooms[0] if rooms else None
        
        if not current_room and rooms:
            current_room = rooms[0]
        
        messages = []
        if current_room:
            messages = Message.query.filter_by(room_id=current_room.id).order_by(Message.timestamp.asc()).limit(100).all()
        
        return render_template('chat.html', 
                             rooms=rooms, 
                             current_room=current_room,
                             current_user=current_user,
                             messages=messages)
    except Exception as e:
        app.logger.error(f'Ошибка при загрузке чата: {str(e)}')
        app.logger.error(traceback.format_exc())
        return f'Ошибка при загрузке чата: {str(e)}<br><pre>{traceback.format_exc()}</pre>', 500


@app.route('/api/rooms', methods=['GET'])
@login_required
def get_rooms():
    """API: получить список комнат"""
    rooms = Room.query.all()
    return jsonify([{
        'id': room.id,
        'name': room.name,
        'description': room.description,
        'created_at': room.created_at.isoformat()
    } for room in rooms])


@app.route('/api/rooms', methods=['POST'])
@login_required
def create_room():
    """API: создать новую комнату"""
    try:
        data = request.get_json()
        if not data or not data.get('name'):
            return jsonify({'error': 'Название комнаты обязательно'}), 400
        
        name = data['name'].strip()
        if not name:
            return jsonify({'error': 'Название комнаты не может быть пустым'}), 400
        
        # Проверяем, существует ли комната с таким именем
        if Room.query.filter_by(name=name).first():
            return jsonify({'error': 'Комната с таким именем уже существует'}), 400
        
        room = Room(name=name, description=data.get('description', '').strip())
        db.session.add(room)
        db.session.commit()
        
        app.logger.info(f'Комната "{name}" создана пользователем {current_user.username}')
        
        return jsonify({
            'id': room.id,
            'name': room.name,
            'description': room.description
        }), 201
    except Exception as e:
        db.session.rollback()
        app.logger.error(f'Ошибка при создании комнаты: {str(e)}')
        app.logger.error(traceback.format_exc())
        return jsonify({'error': f'Ошибка при создании комнаты: {str(e)}'}), 500


@app.route('/api/messages/<int:room_id>', methods=['GET'])
@login_required
def get_messages(room_id):
    """API: получить сообщения комнаты"""
    limit = request.args.get('limit', 100, type=int)
    messages = Message.query.filter_by(room_id=room_id).order_by(Message.timestamp.desc()).limit(limit).all()
    messages.reverse()
    
    return jsonify([{
        'id': msg.id,
        'content': msg.content,
        'username': msg.user.username,
        'user_city': msg.user.city,
        'timestamp': msg.timestamp.isoformat(),
        'room_id': msg.room_id
    } for msg in messages])


# WebSocket события

@socketio.on('connect')
@login_required
def handle_connect(auth):
    """Обработка подключения пользователя"""
    if current_user.is_authenticated:
        emit('connected', {'username': current_user.username, 'status': 'connected'})
        print(f'Пользователь {current_user.username} подключился')


@socketio.on('disconnect')
def handle_disconnect():
    """Обработка отключения пользователя"""
    if current_user.is_authenticated:
        print(f'Пользователь {current_user.username} отключился')


@socketio.on('join_room')
@login_required
def handle_join_room(data):
    room_id = str(data.get('room_id'))
    if room_id:
        join_room(room_id)
        join_room(f'user_{current_user.id}')
        
        user_data = {
            'id': current_user.id,
            'username': current_user.username,
            'city': current_user.city
        }
        
        # Сохраняем пользователя в список комнаты
        if room_id not in users_by_room:
            users_by_room[room_id] = {}
        users_by_room[room_id][current_user.id] = user_data
        
        # 1. Отправляем новичку список ВСЕХ, кто уже в комнате
        emit('room_users_list', {
            'room_id': room_id,
            'users': list(users_by_room[room_id].values())
        })
        
        # 2. Уведомляем остальных о приходе новичка
        emit('joined_room', {
            'room_id': room_id, 
            'user': user_data
        }, room=room_id, include_self=False)
        
        print(f'User {current_user.username} joined room {room_id}')


@socketio.on('leave_room')
@login_required
def handle_leave_room(data):
    room_id = str(data.get('room_id'))
    if room_id and room_id in users_by_room:
        if current_user.id in users_by_room[room_id]:
            del users_by_room[room_id][current_user.id]
            
    leave_room(room_id)
    emit('left_room', {
        'room_id': room_id, 
        'user_id': current_user.id
    }, room=room_id)


@socketio.on('get_room_users')
@login_required
def handle_get_room_users(data):
    """Получить список пользователей в комнате"""
    room_id = data.get('room_id')
    if room_id:
        # Получаем список сессий в комнате (Socket.IO не предоставляет прямой доступ к пользователям)
        # Отправляем событие для сбора информации от всех пользователей
        emit('request_user_list', {'room_id': room_id}, room=str(room_id))


@socketio.on('send_message')
@login_required
def handle_send_message(data):
    """Отправка сообщения через WebSocket"""
    room_id = data.get('room_id')
    content = data.get('content', '').strip()
    
    if not room_id or not content:
        emit('error', {'message': 'Комната и текст сообщения обязательны'})
        return
    
    # Проверяем существование комнаты
    room = Room.query.get(room_id)
    if not room:
        emit('error', {'message': 'Комната не найдена'})
        return
    
    # Сохраняем сообщение в БД
    message = Message(
        content=content,
        user_id=current_user.id,
        room_id=room_id,
        timestamp=datetime.utcnow()
    )
    db.session.add(message)
    db.session.commit()
    
    # Отправляем сообщение всем в комнате
    message_data = {
        'id': message.id,
        'content': message.content,
        'username': current_user.username,
        'user_city': current_user.city,
        'timestamp': message.timestamp.isoformat(),
        'room_id': message.room_id
    }
    
    emit('new_message', message_data, room=str(room_id), broadcast=True)
    print(f'Сообщение от {current_user.username} в комнате {room_id}: {content[:50]}')


# WebRTC события для голосового чата

@socketio.on('offer')
@login_required
def handle_offer(data):
    """Получение WebRTC offer от пользователя"""
    room_id = data.get('room_id')
    target_user_id = data.get('target_user_id')
    
    if room_id and target_user_id:
        emit('offer', {
            'room_id': room_id,
            'from_user_id': current_user.id,
            'offer': data.get('offer')
        }, room=f'user_{target_user_id}')


@socketio.on('answer')
@login_required
def handle_answer(data):
    """Получение WebRTC answer от пользователя"""
    room_id = data.get('room_id')
    target_user_id = data.get('target_user_id')
    
    if room_id and target_user_id:
        emit('answer', {
            'room_id': room_id,
            'from_user_id': current_user.id,
            'answer': data.get('answer')
        }, room=f'user_{target_user_id}')


@socketio.on('ice_candidate')
@login_required
def handle_ice_candidate(data):
    """Получение ICE кандидата"""
    room_id = data.get('room_id')
    target_user_id = data.get('target_user_id')
    
    if room_id and target_user_id:
        emit('ice_candidate', {
            'room_id': room_id,
            'from_user_id': current_user.id,
            'candidate': data.get('candidate')
        }, room=f'user_{target_user_id}')


@socketio.on('user_mic_enabled')
@login_required
def handle_user_mic_enabled(data):
    """Пользователь включил микрофон"""
    room_id = data.get('room_id')
    user_id = data.get('user_id')
    
    if room_id:
        # Уведомляем всех в комнате, кроме отправителя
        emit('user_mic_enabled', {
            'room_id': room_id,
            'user_id': current_user.id
        }, room=str(room_id), include_self=False)
        print(f'Пользователь {current_user.username} включил микрофон в комнате {room_id}')


@socketio.on('user_mic_muted')
@login_required
def handle_user_mic_muted(data):
    """Пользователь выключил микрофон"""
    room_id = data.get('room_id')
    
    if room_id:
        # Уведомляем всех в комнате, кроме отправителя
        emit('user_mic_muted', {
            'room_id': room_id,
            'user_id': current_user.id
        }, room=str(room_id), include_self=False)
        print(f'Пользователь {current_user.username} выключил микрофон в комнате {room_id}')


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    # Включаем debug для локальной разработки (отключайте для продакшена!)
    socketio.run(app, host='0.0.0.0', port=port, debug=True, allow_unsafe_werkzeug=True)
