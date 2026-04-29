# WA Chatbot

WhatsApp Chatbot adalah aplikasi yang memungkinkan Anda untuk membuat dan menjalankan chatbot otomatis di WhatsApp.

## 📋 Deskripsi

Proyek ini menyediakan solusi untuk membangun chatbot yang dapat berinteraksi dengan pengguna melalui WhatsApp. Dengan kemampuan otomasi pesan, bot ini dapat membantu menangani pertanyaan umum, memberikan informasi, dan meningkatkan efisiensi komunikasi.

## 🚀 Fitur

- Otomasi respons pesan WhatsApp
- Dukungan berbagai tipe pesan
- Mudah dikonfigurasi dan diperluas
- Integrasi dengan API WhatsApp

## 📦 Instalasi

### Prerequisites
- Node.js v14 atau lebih tinggi
- npm atau yarn
- Akun WhatsApp Business API

### Langkah-langkah Instalasi

1. Clone repositori ini:
```bash
git clone https://github.com/dedeyoga/wa-chatbot.git
cd wa-chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Konfigurasi environment:
```bash
cp .env.example .env
# Edit file .env dengan konfigurasi Anda
```

4. Jalankan aplikasi:
```bash
npm start
```

## 🔧 Konfigurasi

Buat file `.env` di root direktori dengan konfigurasi berikut:

```env
# WhatsApp Configuration
WHATSAPP_API_KEY=your_api_key
WHATSAPP_PHONE_NUMBER=your_phone_number
WHATSAPP_BUSINESS_ACCOUNT_ID=your_account_id

# Server Configuration
PORT=3000
NODE_ENV=development
```

## 💡 Penggunaan

```javascript
// Contoh dasar penggunaan
const WhatsAppBot = require('./bot');

const bot = new WhatsAppBot({
  apiKey: process.env.WHATSAPP_API_KEY,
  phoneNumber: process.env.WHATSAPP_PHONE_NUMBER
});

bot.on('message', (msg) => {
  console.log('Pesan diterima:', msg.body);
  msg.reply('Terima kasih telah menghubungi kami!');
});

bot.start();
```

## 📁 Struktur Proyek

```
wa-chatbot/
├── src/
│   ├── bot.js
│   ├── handlers/
│   ├── utils/
│   └── config/
├── .env.example
├── package.json
└── README.md
```

## 🤝 Kontribusi

Kontribusi sangat diterima! Silakan:

1. Fork repositori ini
2. Buat branch fitur (`git checkout -b feature/AmazingFeature`)
3. Commit perubahan Anda (`git commit -m 'Add some AmazingFeature'`)
4. Push ke branch (`git push origin feature/AmazingFeature`)
5. Buka Pull Request

## 📝 Lisensi

Proyek ini belum memiliki lisensi yang ditentukan. Silakan tentukan lisensi yang sesuai.

## 📞 Dukungan

Jika Anda mengalami masalah atau memiliki pertanyaan, silakan buka [issue](https://github.com/dedeyoga/wa-chatbot/issues) di repositori ini.

## 👨‍💻 Penulis

- **dedeyoga** - [GitHub Profile](https://github.com/dedeyoga)

---

Dibuat dengan ❤️
