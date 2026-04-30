# WA Chatbot - AI-Powered WhatsApp Bot

WhatsApp Chatbot adalah aplikasi otomatis yang menggunakan AI untuk memberikan respons cerdas di WhatsApp. Bot ini mendukung multi-layer AI (Gemini, OpenAI, Groq, OpenRouter) dan dapat dijalankan di berbagai platform termasuk **Android via Termux**.

## 🎯 Fitur Utama

- 🤖 **AI Multi-Layer** - Fallback otomatis ke provider AI lain jika yang pertama gagal
- 💬 **Respons Otomatis** - Jawab pertanyaan pelanggan dengan AI yang cerdas
- 📸 **Proses Gambar** - Deteksi bukti pembayaran & dokumen
- 💾 **Database SQLite** - Menyimpan history percakapan & data pelanggan
- 🔔 **Notifikasi Telegram** - Kirim notifikasi ke Telegram admin
- 📊 **Dashboard Web** - Kelola produk, FAQ, dan konfigurasi AI
- 🔄 **Webhook N8N** - Integrasi dengan N8N untuk workflow automation
- ⚡ **Kompatibel Android** - Bisa dijalankan di Termux

## 🌍 Kompatibilitas Platform

| Platform | Status | Catatan |
|----------|--------|---------|
| **Linux/VPS** | ✅ Recommended | Setup paling mudah |
| **macOS** | ✅ Supported | Sama seperti Linux |
| **Windows** | ✅ Supported | Install Node.js dari nodejs.org |
| **Android (Termux)** | ✅ Working | Memerlukan setup khusus |

---

## 📥 Instalasi

### **Opsi 1: Windows/macOS/Linux (Recommended)**

#### Prerequisites:
- Node.js v14+ ([Download](https://nodejs.org))
- npm atau yarn
- Git

#### Langkah Instalasi:

```bash
# 1. Clone repository
git clone https://github.com/dedeyoga/wa-chatbot.git
cd wa-chatbot

# 2. Install dependencies
npm install

# 3. Buat file .env
cp .env.example .env
# Edit .env dengan konfigurasi Anda

# 4. Jalankan bot
node index.js

# Atau jalankan dashboard (terminal lain)
node server.js
```

Buka browser di `http://localhost:3000` untuk akses dashboard.

---

### **Opsi 2: Android via Termux** 📱

Termux adalah emulator terminal untuk Android yang memungkinkan Anda menjalankan Node.js dan bot ini di smartphone.

#### **Step 1: Install Termux**

1. Download Termux dari [F-Droid](https://f-droid.org/en/packages/com.termux/) atau [GitHub Releases](https://github.com/termux/termux-app/releases)
2. Install aplikasi
3. Buka Termux

#### **Step 2: Setup Package Manager**

Di terminal Termux, jalankan:

```bash
# Update package manager
pkg update -y && pkg upgrade -y

# Install build tools (PENTING untuk sqlite3)
pkg install -y python make clang git

# Install Node.js
pkg install -y nodejs npm

# Verifikasi instalasi
node --version
npm --version
```

#### **Step 3: Clone & Setup Bot**

```bash
# Clone repository
git clone https://github.com/dedeyoga/wa-chatbot.git
cd wa-chatbot

# Install dependencies dengan setup khusus Termux
npm run setup:termux
# ATAU jalankan manual:
# npm install

# Jika npm install gagal di sqlite3, coba:
npm install sqlite3 --build-from-source
```

#### **Step 4: Konfigurasi Environment**

```bash
# Buat file .env
nano .env
```

Isi dengan:
```env
# AI Providers (pilih salah satu)
GROQ_API_KEY=your_groq_api_key
# ATAU
OPENROUTER_API_KEY=your_openrouter_api_key
# ATAU
OPENAI_API_KEY=your_openai_api_key
# ATAU
GEMINI_API_KEY=your_gemini_api_key

# Telegram Notifications (optional)
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Webhook N8N (optional)
N8N_WEBHOOK_URL=your_n8n_webhook_url

# Server Port
PORT=3000
```

> **Tips:** Gunakan `Ctrl+X` → `Y` → `Enter` untuk save di nano

#### **Step 5: Jalankan Bot**

```bash
# Terminal 1: Jalankan bot WhatsApp
node index.js

# Scan QR code dengan WhatsApp
# Bot akan tersambung dalam beberapa detik

# ATAU di Terminal 2 (baru): Jalankan dashboard
node server.js
```

#### **Step 6: Akses Dashboard dari Browser**

Jika Anda ingin mengakses dashboard dari device lain:

```bash
# Di Termux, cek IP address lokal
ifconfig wlan0
# Atau
hostname -I
```

Kemudian akses di browser: `http://<IP_ADDRESS>:3000`

---

## 🔧 Konfigurasi AI Provider

Bot mendukung 4 provider AI dengan prioritas fallback otomatis:

### **1. Groq (RECOMMENDED - Gratis & Cepat)** ⚡

```env
GROQ_API_KEY=gsk_xxxxxxxxxxxxx
GROQ_MODEL=llama-3.3-70b-versatile
```

- [Daftar gratis di groq.com](https://console.groq.com)
- Model gratis tanpa limit (per April 2026)
- Paling cepat untuk Indonesia

### **2. OpenRouter (Free Models)**

```env
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxxx
OPENROUTER_MODEL=mistralai/mistral-7b-instruct:free
```

- [Daftar di openrouter.ai](https://openrouter.ai)
- Berbagai model gratis tersedia
- Support vision/gambar

### **3. OpenAI (Berbayar)**

```env
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
OPENAI_MODEL=gpt-4o-mini
```

- [Buat API Key di platform.openai.com](https://platform.openai.com/api-keys)
- Kualitas terbaik tapi berbayar

### **4. Google Gemini (Gratis)**

```env
GEMINI_API_KEY=AIzaSyxxxxxxxxxxxx
GEMINI_MODEL=gemini-2.0-flash
```

- [Daftar gratis di ai.google.dev](https://ai.google.dev)
- Model gratis dengan limit daily

---

## 📊 Database & Produk

### **Setup Produk & FAQ**

Bot akan otomatis membuat database. Untuk menambah produk dan FAQ, gunakan dashboard atau API:

#### Via Dashboard:
1. Buka `http://localhost:3000`
2. Login dengan `admin` / `admin123`
3. Tambah produk & kategori
4. Setup system prompt AI

#### Via API (cURL):

```bash
# Tambah produk
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{
    "kategori": "Percetakan",
    "nama_produk": "Kartu Nama",
    "harga": 50000,
    "keterangan": "100 lembar, full color"
  }'

# Tambah FAQ
curl -X POST http://localhost:3000/api/faqs \
  -H "Content-Type: application/json" \
  -d '{
    "command": "/layanan",
    "response": "Layanan kami: Percetakan, Design, Fotokopi, Laminating"
  }'
```

---

## 💬 Pesan Pembukaan Bot

Bot akan menyambut pelanggan baru dengan menu interaktif:

```
Selamat Pagi Kak! Selamat datang di KARTINI DIGITAL PRINTING 24 JAM.

Ada yang bisa kami bantu?

[Info Layanan & Produk] [Cara Pemesanan] [Lokasi Kami]
```

Pelanggan bisa mengetik:
- `/layanan` - Daftar produk & harga
- `/carapesan` - Cara memesan
- `/alamat` - Lokasi toko
- `/simpan-nama John` - Simpan nama
- Pertanyaan bebas - Dijawab oleh AI

---

## 📱 Panduan untuk User Android (Termux)

### **Troubleshooting Termux**

#### **Problem: sqlite3 installation failed**

```bash
# Solution: Install build tools dulu
pkg install -y python make clang
npm install sqlite3 --build-from-source
```

#### **Problem: Port 3000 sudah digunakan**

```bash
# Ubah port di .env
PORT=3001

# Atau kill process yang menggunakan port
lsof -i :3000
kill -9 <PID>
```

#### **Problem: Bot disconnect/reconnect terus**

```bash
# Cek log error
node index.js 2>&1 | tee bot.log

# Pastikan API Key valid di .env
# Restart bot
```

#### **Problem: Can't access dashboard dari device lain**

```bash
# 1. Cek IP Termux
ifconfig wlan0

# 2. Pastikan server listening di 0.0.0.0
# Modifikasi server.js line ~180:
app.listen(PORT, '0.0.0.0', () => {...})

# 3. Akses dari device lain
http://<TERMUX_IP>:3000
```

#### **Problem: WhatsApp QR Code tidak keluar**

```bash
# Pastikan Termux punya akses storage
termux-setup-storage

# Clear auth data dan scan ulang
rm -rf auth_info_baileys/
node index.js
```

---

## 🎓 Struktur Code

```
wa-chatbot/
├── index.js              # Main bot WhatsApp (Baileys)
├── server.js             # Express dashboard
├── database.js           # SQLite3 database layer
├── ai_factory.js         # AI provider abstraction
├── package.json          # Dependencies
├── .env                  # Konfigurasi (create from .env.example)
├── auth_info_baileys/    # WhatsApp auth session
├── kartini_bot.db        # SQLite database
└── public/               # Frontend dashboard
```

### **Alur Kerja Bot:**

```
Pesan masuk → index.js
    ↓
Cek tipe (teks/gambar)
    ↓
Teks → Cek command FAQ
      → AI Factory → Groq/OpenRouter/OpenAI/Gemini
      → Respons AI
    ↓
Gambar → Deteksi tipe
       → Proses pembayaran/dokumen
       → Atau AI + gambar caption
    ↓
Kirim balik ke WhatsApp
    ↓
Simpan history DB
    ↓
Notifikasi Telegram (optional)
```

---

## 🚀 Deployment

### **Untuk VPS/Cloud:**

```bash
# Install PM2 untuk auto-restart
npm install -g pm2

# Start bot dengan PM2
pm2 start index.js --name "wa-bot"
pm2 start server.js --name "wa-dashboard"
pm2 save
pm2 startup

# Logs
pm2 logs wa-bot
```

### **Untuk Docker:**

```bash
# Build image
docker build -t wa-chatbot .

# Run container
docker run -d \
  --name wa-bot \
  -e GROQ_API_KEY=your_key \
  -p 3000:3000 \
  -v $(pwd)/auth_info_baileys:/app/auth_info_baileys \
  -v $(pwd)/kartini_bot.db:/app/kartini_bot.db \
  wa-chatbot
```

---

## 📚 Contoh Penggunaan

### **1. Setup AI dengan Groq (Rekomendasi)**

```bash
# 1. Daftar di groq.com, dapatkan API key
# 2. Edit .env
GROQ_API_KEY=gsk_xxxxxx
GROQ_MODEL=llama-3.3-70b-versatile

# 3. Run
node index.js
```

### **2. Setup Multi-AI Fallback**

Bot sudah otomatis fallback. Urutan:
1. Provider pilihan (di .env)
2. Groq models (jika groq dipilih)
3. OpenRouter (jika ada fallback)
4. Error message

### **3. Custom System Prompt**

Di Dashboard → AI Config:

```
Anda adalah Customer Service untuk toko percetakan KARTINI DIGITAL.

ATURAN:
1. Jawab singkat & ramah
2. Gunakan daftar harga yang ada
3. Tawarkan produk sesuai kebutuhan
4. Informasi jam operasional: 24 JAM
5. Kirim notifikasi pembayaran ke admin
```

---

## 🔐 Keamanan

⚠️ **PENTING untuk Production:**

1. Ganti default admin password di database.js
2. Gunakan HTTPS untuk dashboard (setup reverse proxy)
3. Jangan share API keys di public repo
4. Gunakan environment variables untuk semua secrets
5. Backup database secara berkala

---

## 📞 Support & Kontribusi

- 🐛 Bug Report: [Buka Issue](https://github.com/dedeyoga/wa-chatbot/issues)
- 💡 Feature Request: [Diskusi](https://github.com/dedeyoga/wa-chatbot/discussions)
- 🤝 Kontribusi: Fork → Branch → PR

### Kontributor Welcome! ✨

```bash
git clone https://github.com/dedeyoga/wa-chatbot.git
git checkout -b feature/amazing-feature
git commit -m 'Add amazing feature'
git push origin feature/amazing-feature
# Buat Pull Request
```

---

## 📝 Lisensi

ISC License - Bebas digunakan untuk keperluan komersial & non-komersial

---

## 👨‍💻 Penulis & Kredit

- **dedeyoga** - [GitHub](https://github.com/dedeyoga)
- Powered by: Baileys, Groq, OpenAI, Google Gemini, Express.js, SQLite3

---

## 🎯 Roadmap

- [ ] Support WebChat (integrasi di website)
- [ ] Multi-WhatsApp account
- [ ] Scheduled messages
- [ ] Analytics dashboard
- [ ] Mobile app untuk management
- [ ] Payment gateway integration

---

**Terakhir diupdate:** April 2026  
Dibuat dengan ❤️ untuk UMKM Indonesia
