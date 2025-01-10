require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

// إعداد Express
const app = express();
const PORT = process.env.PORT || 3000;

// الاتصال بقاعدة البيانات (نفس URI الخاص بالبوت)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('Failed to connect to MongoDB', err));

// استيراد نموذج المستخدم من البوت
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
  crypt: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model('User', userSchema);

// إعدادات الجلسة
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
}));

// إعداد Body Parser
app.use(bodyParser.urlencoded({ extended: true }));

// إعداد EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// المجلد العام للملفات الثابتة
app.use(express.static(path.join(__dirname, 'public')));

// الصفحة الرئيسية (تسجيل الدخول)
app.get('/', (req, res) => {
  res.render('login', { error: null });
});

// معالجة تسجيل الدخول
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // البحث عن المستخدم في قاعدة البيانات
  const user = await User.findOne({ username, password });
  if (!user) {
    return res.render('login', { error: 'Invalid username or password' });
  }

  req.session.user = user;
  res.redirect('/daily');
});

// صفحة الراتب اليومي
app.get('/daily', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const captcha = Math.random().toString(36).substring(2, 8).toUpperCase();
  req.session.captcha = captcha; // حفظ الكابتشا في الجلسة
  res.render('daily', {
    username: req.session.user.username,
    captcha,
    error: null,
    success: null,
  });
});

// معالجة الراتب اليومي
app.post('/daily', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/');
  }

  const { captchaInput } = req.body;

  // التحقق من الكابتشا
  if (captchaInput !== req.session.captcha) {
    return res.render('daily', {
      username: req.session.user.username,
      captcha: req.session.captcha,
      error: 'Invalid captcha. Please try again.',
      success: null,
    });
  }

  // تحديث رصيد المستخدم
  const user = await User.findById(req.session.user._id);
  user.crypt += 100; // إضافة الراتب اليومي
  await user.save();

  req.session.user = user; // تحديث بيانات الجلسة
  res.render('daily', {
    username: user.username,
    captcha: req.session.captcha,
    error: null,
    success: 'You have received your daily crypt reward!',
  });
});

// بدء تشغيل الخادم
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
