"""
Формы для аутентификации
"""
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, BooleanField
from wtforms.validators import DataRequired, Email, Length, EqualTo, Optional


class LoginForm(FlaskForm):
    """Форма входа"""
    username = StringField('Имя пользователя', validators=[DataRequired(), Length(min=3, max=80)])
    password = PasswordField('Пароль', validators=[DataRequired(), Length(min=4)])
    remember_me = BooleanField('Запомнить меня')


class RegisterForm(FlaskForm):
    """Форма регистрации"""
    username = StringField('Имя пользователя', validators=[DataRequired(), Length(min=3, max=80)])
    email = StringField('Email', validators=[DataRequired(), Email(), Length(max=120)])
    password = PasswordField('Пароль', validators=[DataRequired(), Length(min=4)])
    password_confirm = PasswordField('Подтвердите пароль', validators=[
        DataRequired(), 
        EqualTo('password', message='Пароли должны совпадать')
    ])
    city = StringField('Город (необязательно)', validators=[Optional(), Length(max=100)])
