// =================================================================
// KARTINI DIGITAL PRINTING - WHATSAPP BOT V2.1 (REVISI FINAL)
// Dibuat dengan Baileys, OpenAI, dan Google Gemini
// Fitur:
// - Asisten CS berbasis AI (GPT-4o & Gemini)
// - Respons perintah statis (/layanan, /alamat, dll)
// - Deteksi & Klasifikasi Gambar (Bukti Pembayaran vs Umum)
// - Integrasi Webhook n8n untuk bukti pembayaran
// - Kontrol manual Pemilik dengan perintah /pause
// =================================================================

// 1. IMPORTS & DEPENDENCIES
// =================================================================
require('dotenv').config();
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    isJidBroadcast,
    fetchLatestBaileysVersion,
    delay,
    makeCacheableSignalKeyStore,
    downloadMediaMessage,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require("openai");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const db = require('./database.js');

// 2. CONFIGURATION & INITIALIZATION
// =================================================================
const config = {
    // API Keys & Webhook
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    n8nWebhookUrl: process.env.N8N_WEBHOOK_URL,

    // Business Info (sesuaikan dengan bisnis Anda)
    businessName: "KARTINI DIGITAL PRINTING 24 JAM",
    email: "kartinidigitalprinting24jam@gmail.com",
    instagram: "kartinidigitalprinting",
    address: "Jl. Kartini Raya No. 54, Jakarta Pusat", // Contoh
    gmapsUrl: "https://maps.app.goo.gl/example", // Contoh

    // Bot Settings
    conversationHistoryLimit: 10,
};

// Logger
const logger = pino({ transport: { target: 'pino-pretty' } });

// Validasi Konfigurasi
if (!config.openaiApiKey) {
    logger.fatal('❌ Kesalahan: OPENAI_API_KEY tidak diatur. Program berhenti.');
    process.exit(1);
}
if (!config.geminiApiKey) {
    logger.warn('⚠️ Peringatan: GEMINI_API_KEY tidak diatur. Fallback ke Gemini tidak akan berfungsi.');
}
if (!config.n8nWebhookUrl) {
    logger.warn('⚠️ Peringatan: N8N_WEBHOOK_URL tidak diatur. Fungsi upload bukti pembayaran tidak akan berjalan.');
}

// Service Clients
const openai = new OpenAI({ apiKey: config.openaiApiKey, timeout: 30 * 1000 });
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

// Global State
const conversationHistory = {};
const userActivityCache = {}; // Digunakan untuk fitur /pause

// 3. SYSTEM PROMPT
// =================================================================
const systemPromptContent = `Anda adalah asisten virtual Customer Service untuk "${config.businessName}". Peran Anda adalah melayani pelanggan dengan informatif, profesional, ramah, dan efisien.

Berikut adalah aturan dan instruksi Anda:

1.  **Identitas Anda**:
    * Nama Bisnis: ${config.businessName}
    * Layanan Utama: Jasa percetakan digital dan offset.
    * Keunggulan: Pelayanan 24 jam, kualitas terjamin, proses cepat.

2.  **Gaya Bahasa**:
    * Gunakan bahasa Indonesia yang baik, sopan, dan profesional.
    * Sapa pelanggan dengan ramah, contoh: "Selamat pagi Kak, ada yang bisa kami bantu?".

3.  **Tugas Utama & Tanggapan**:
    * **Salam & Sapaan**: Balas dengan sapaan hangat dan tanyakan kebutuhan pelanggan.
    * **Pertanyaan Layanan**: Jawab pertanyaan mengenai jasa yang kami tawarkan. Jika tidak tahu, katakan "Untuk detail layanan tersebut, akan saya sambungkan ke tim kami ya Kak."
    * **Permintaan Harga**: Minta pelanggan memberikan spesifikasi detail (jenis bahan, ukuran, jumlah, finishing). JANGAN memberikan harga pasti.
    * **Prosedur Pemesanan**: Jelaskan alur pemesanan: "Untuk pemesanan, Kakak bisa kirim file desain ke email kami di ${config.email}, lalu konfirmasi via chat ini dengan menyertakan spesifikasi lengkapnya ya."
    * **Follow-up Pesanan**: Jawab "Baik Kak, mohon ditunggu sebentar, saya bantu cek status pengerjaannya." dan teruskan ke tim.
    * **Komplain**: Segera berikan notifikasi ke pemilik dengan membalas: "Baik Kak, terima kasih atas informasinya. Pesan Anda akan segera kami teruskan ke manajer kami untuk penanganan lebih lanjut."

4.  **Informasi Bisnis**:
    * **Nama**: ${config.businessName}
    * **Jam Operasional**: 24 Jam Non-Stop.
    * **Layanan**: Print Digital (A3+), Print Indoor/Outdoor (Spanduk, Banner, Stiker), Kartu Nama, Brosur, Stiker Cutting, Jilid & Finishing, Merchandise (Mug, Pin, Kaos), dll.
    * **Alamat**: ${config.address}
    * **Email untuk File**: ${config.email}
    * **Instagram**: ${config.instagram}

5.  **Keterbatasan**: Anda tidak bisa mengambil keputusan desain atau memberikan diskon tanpa persetujuan. Jika ada pertanyaan di luar pengetahuan Anda, eskalasikan ke manusia.`;

// 4. HELPER FUNCTIONS
// =================================================================

/**
 * Mengirim pesan dengan simulasi mengetik.
 */
const sendMessageWTyping = async (sock, jid, content, options = {}) => {
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1200);
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, content, options);
};

/**
 * Mendapatkan balasan dari AI (OpenAI dengan fallback ke Gemini).
 */
async function getAIReply(userText, history = []) {
    const messages = [
        { role: "system", content: systemPromptContent },
        ...history,
        { role: "user", content: userText }
    ];
    try {
        logger.info("↪️ Menghubungi OpenAI...");
        const aiResponse = await openai.chat.completions.create({ model: "gpt-4o-mini", messages });
        const reply = aiResponse.choices[0]?.message?.content?.trim();
        if (reply) return reply;
    } catch (error) {
        logger.error({ err: error.message }, "❌ Error OpenAI, mencoba fallback ke Gemini...");
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(userText);
            const reply = result.response.text()?.trim();
            if (reply) return reply;
        } catch (geminiError) {
            logger.error({ err: geminiError.message }, "❌ Error Gemini.");
        }
    }
    return "Maaf, sistem kami sedang mengalami kendala. Tim kami akan segera merespon Anda secara manual.";
}

/**
 * Mengekstrak konten teks dari berbagai jenis pesan.
 */
const getMessageContent = (msg) => {
    return msg.message?.conversation ||
           msg.message?.extendedTextMessage?.text ||
           msg.message?.imageMessage?.caption ||
           msg.message?.videoMessage?.caption ||
           "";
};

/**
 * Meneruskan bukti pembayaran ke webhook n8n.
 */
async function forwardPaymentToN8N(sender, caption, imageBuffer) {
    if (!config.n8nWebhookUrl) {
        logger.warn("Webhook n8n tidak diatur. Melewatkan pengiriman bukti pembayaran.");
        return false;
    }
    try {
        logger.info(`📦 Mengirim bukti pembayaran dari ${sender} ke n8n...`);
        const payload = {
            sender: sender.split('@')[0],
            caption: caption || "Tidak ada caption",
            image_base64: imageBuffer.toString('base64'),
            timestamp: new Date().toISOString(),
        };

        await axios.post(config.n8nWebhookUrl, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        logger.info(`✅ Bukti pembayaran dari ${sender} berhasil dikirim ke n8n.`);
        return true;
    } catch (error) {
        logger.error({ err: error.message }, "❌ Gagal mengirim bukti pembayaran ke n8n.");
        return false;
    }
}

/**
 * Menganalisis dan mengklasifikasikan gambar menggunakan Vision AI.
 */
async function classifyImageWithAI(imageBuffer) {
    const imageBase64 = imageBuffer.toString('base64');
    const prompt = `Analisis gambar ini dan tentukan kategorinya. Balas HANYA dengan salah satu dari kata kunci berikut: 'bukti_pembayaran', 'dokumen', 'gambar_umum'.`;

    try {
        logger.info("↪️ Menganalisis gambar dengan OpenAI Vision...");
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ],
            }],
            max_tokens: 10,
        });
        const classification = response.choices[0].message.content.trim().toLowerCase().replace(/['"`]/g, '');
        if (['bukti_pembayaran', 'dokumen', 'gambar_umum'].includes(classification)) {
            logger.info(`✅ Gambar berhasil diklasifikasikan sebagai: ${classification}`);
            return classification;
        }
    } catch (error) {
        logger.error({ err: error.message }, "❌ Error OpenAI Vision, mencoba fallback ke Gemini...");
    }

    try {
        logger.info("↪️ Menganalisis gambar dengan Gemini Vision (Fallback)...");
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent([prompt, { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } }]);
        const classification = result.response.text().trim().toLowerCase().replace(/['"`]/g, '');
        if (['bukti_pembayaran', 'dokumen', 'gambar_umum'].includes(classification)) {
             logger.info(`✅ Gambar berhasil diklasifikasikan sebagai: ${classification}`);
            return classification;
        }
    } catch (error) {
        logger.error({ err: error.message }, "❌ Error Gemini Vision.");
    }

    logger.warn("⚠️ Gagal mengklasifikasikan gambar, mengasumsikan sebagai 'tidak_diketahui'.");
    return 'tidak_diketahui';
}


// 5. EVENT & COMMAND HANDLERS
// =================================================================

/**
 * Menangani update koneksi dengan logika reconnect yang lebih baik.
 */
const handleConnectionUpdate = (sock) => ({ connection, lastDisconnect, qr }) => {
    if (qr) {
        logger.info("Silakan pindai kode QR di bawah ini:");
        qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = reason !== DisconnectReason.loggedOut;
        const reasonText = DisconnectReason[reason] || 'Tidak Diketahui';

        logger.info(`🔌 Koneksi ditutup. Alasan: ${reasonText} (${reason}). Akan reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
            logger.info("Mencoba menyambung kembali...");
            startBot();
        } else {
            logger.fatal("Tidak dapat menyambung kembali. Sesi tidak valid. Hapus folder 'auth_info_baileys' dan jalankan ulang.");
        }
    } else if (connection === 'open') {
        logger.info(`🤖 Asisten CS ${config.businessName} berhasil tersambung!`);
    }
};

/**
 * Menangani pesan masuk dengan logika "owner pause" yang telah diperbaiki.
 */
const handleMessagesUpsert = (sock) => async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) {
        return;
    }

    // --- LOGIKA KONTROL MANUAL PEMILIK ---
    if (msg.key.fromMe) {
        const text = getMessageContent(msg).trim().toLowerCase();
        const targetJid = msg.key.remoteJid;

        // Perintah untuk pemilik menjeda bot di chat tertentu selama 5 menit
        if (text === '/pause') {
            // Set cooldown untuk 5 menit (300,000 milidetik)
            const pauseDuration = 5 * 60 * 1000;
            userActivityCache[targetJid] = Date.now() + pauseDuration;
            logger.info(`🤖 Bot di-pause secara manual untuk JID: ${targetJid} selama 5 menit.`);
        }
        // Abaikan semua pesan lain dari pemilik agar tidak memicu loop
        return;
    }
    
    const sender = msg.key.remoteJid;
    if (!sender || isJidBroadcast(sender)) return;

    // --- LOGIKA PENGECEKAN COOLDOWN/PAUSE ---
    const pauseTimestamp = userActivityCache[sender];
    if (pauseTimestamp && Date.now() < pauseTimestamp) {
        const remainingTime = Math.ceil((pauseTimestamp - Date.now()) / 60000);
        logger.info({ jid: sender }, `Bot sedang di-pause untuk user ini. Sisa waktu: ${remainingTime} menit.`);
        return;
    }

    const isImageMessage = !!msg.message.imageMessage;
    const isStickerMessage = !!msg.message.stickerMessage;

    if (isStickerMessage) {
        logger.info(`Stiker diterima dari ${sender}, mengabaikan.`);
        return;
    }

    if (isImageMessage) {
        try {
            const caption = getMessageContent(msg);
            logger.info(`Mendownload gambar dari ${sender} untuk dianalisis...`);
            const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });

            const classification = await classifyImageWithAI(imageBuffer);

            switch (classification) {
                case 'bukti_pembayaran':
                    logger.info(`Gambar terdeteksi sebagai BUKTI PEMBAYARAN. Meneruskan ke n8n...`);
                    await sendMessageWTyping(sock, sender, { text: "Terima kasih Kak, bukti pembayaran Anda telah kami terima dan akan segera kami periksa. Mohon ditunggu konfirmasi selanjutnya ya." }, { quoted: msg });
                    await forwardPaymentToN8N(sender, caption, imageBuffer);
                    break;
                case 'dokumen':
                    logger.info(`Gambar terdeteksi sebagai DOKUMEN.`);
                    await sendMessageWTyping(sock, sender, { text: "Terima kasih, kami telah menerima dokumen yang Anda kirim. Tim kami akan segera memeriksanya." }, { quoted: msg });
                    break;
                case 'gambar_umum':
                case 'tidak_diketahui':
                default:
                    logger.info(`Gambar terdeteksi sebagai GAMBAR UMUM.`);
                    const question = caption ? `${caption} (user mengirim gambar ini)` : "Terima kasih untuk gambarnya. Ada yang bisa saya bantu terkait gambar ini?";
                    const userHistory = conversationHistory[sender] || [];
                    const finalReply = await getAIReply(question, userHistory);
                    if (finalReply) {
                        await sendMessageWTyping(sock, sender, { text: finalReply }, { quoted: msg });
                        userHistory.push({ role: 'user', content: question }, { role: 'assistant', content: finalReply });
                        conversationHistory[sender] = userHistory.slice(-config.conversationHistoryLimit);
                    }
                    break;
            }
            return;
        } catch (error) {
            logger.error({ err: error }, `Gagal memproses gambar dari ${sender}`);
            await sendMessageWTyping(sock, sender, { text: "Maaf, terjadi kesalahan saat memproses gambar yang Anda kirim. Mohon coba lagi." }, { quoted: msg });
            return;
        }
    }
    
    const text = getMessageContent(msg).trim();
    if (!text) return;

    logger.info({ from: sender, text }, `📩 Pesan teks baru diterima untuk diproses`);
    
    const { customer, isNew } = await db.getOrAddCustomer(sender);
    const command = text.toLowerCase();

    const menuKeywords = ['menu', 'bantuan', 'info', 'halo', 'hai', 'hi', 'p', 'assalamualaikum'];
    if (isNew || menuKeywords.some(keyword => command.startsWith(keyword))) {
        const menuText = isNew
            ? `Halo Kak! Selamat datang di *${config.businessName}*. Terima kasih telah menghubungi kami.\n\nSaya asisten virtual yang siap membantu. Ada yang bisa dibantu?`
            : `Ada lagi yang bisa saya bantu, Kak?`;
        const fullMenu = `${menuText}\n\nBerikut adalah menu informasi cepat kami:\n*ketik perintah yang di dalam kurung siku*\n\n*📁 Produk & Layanan*\n • [/katalog] - Lihat katalog produk kami.\n • [/layanan] - Lihat daftar layanan utama.\n • [/carapesan] - Info cara pemesanan.\n\n*📍 Informasi & Kontak*\n • [/alamat] - Cek lokasi kami.\n • [/jamkerja] - Info jam operasional.\n • [/kontak] - Kontak lain yang bisa dihubungi.\n\nJika pertanyaan Anda tidak ada di menu, silakan langsung tanyakan saja ya!`;
        await sendMessageWTyping(sock, sender, { text: fullMenu }, { quoted: msg });
        return;
    }
    
    const commandHandlers = {
        '/layanan': 'Layanan kami sangat beragam, antara lain:\n\n*🖨️ Print Digital & Offset:*\n • Print A3+, Brosur, Poster\n • Kartu Nama, Flyer\n\n*🖼️ Print Skala Besar:*\n • Spanduk, Banner, Backdrop\n • Stiker Vinyl, Oneway, Branding Mobil\n\n*👕 Merchandise:*\n • Sablon Kaos DTF\n • Mug, Pin, Gantungan Kunci\n\n*📚 Finishing:*\n • Jilid, Laminating, Potong Pola\n\nUntuk info lebih lengkap, bisa langsung ditanyakan saja Kak.',
        '/carapesan': `Cara pemesanan sangat mudah Kak:\n\n1. *Kirim File Desain* siap cetak ke email kami di: *${config.email}*\n2. *Konfirmasi* via chat WhatsApp ini.\n3. *Sertakan Spesifikasi Lengkap*:\n    - Jenis Bahan\n    - Ukuran\n    - Jumlah\n    - Keterangan Finishing (jika ada)\n4. Tim kami akan memberikan penawaran harga dan instruksi pembayaran.\n5. Pesanan diproses setelah pembayaran diterima.`,
        '/alamat': `📍 Lokasi kami berada di:\n${config.address}\n\nCek di Google Maps: ${config.gmapsUrl}`,
        '/jamkerja': '⏰ Kami siap melayani Anda *24 JAM NON-STOP*, setiap hari!',
        '/kontak': `Selain via WhatsApp, Kakak juga bisa menghubungi kami melalui:\n\n✉️ Email: *${config.email}*\n📱 Instagram: *@${config.instagram}*\n\nJangan ragu untuk menghubungi kami ya!`,
        '/info-saya': async () => {
            const currentCustomer = (await db.getOrAddCustomer(sender)).customer;
            const infoText = `Berikut data Anda yang tersimpan:\n- Nama: ${currentCustomer?.name || '(belum diatur, ketik /simpan-nama NAMA ANDA)'}\n- Nomor: ${currentCustomer?.phone_number || 'Tidak diketahui'}`;
            await sendMessageWTyping(sock, sender, {text: infoText}, { quoted: msg });
        },
    };

    if (commandHandlers[command]) {
        const response = commandHandlers[command];
        if (typeof response === 'string') {
            await sendMessageWTyping(sock, sender, {text: response}, { quoted: msg });
        } else if (typeof response === 'function') {
            await response();
        }
        return;
    }

    if (command.startsWith('/simpan-nama ')) {
        const newName = text.substring(13).trim();
        if(newName){
            await db.updateCustomerName(sender, newName);
            await sendMessageWTyping(sock, sender, {text: `✅ Terima kasih, Kak ${newName}! Nama Anda sudah kami simpan.`}, { quoted: msg });
        }
        return;
    }
    
    const userHistory = conversationHistory[sender] || [];
    const finalReply = await getAIReply(text, userHistory);
    
    if (finalReply) {
        await sendMessageWTyping(sock, sender, { text: finalReply }, { quoted: msg });
        userHistory.push({ role: 'user', content: text }, { role: 'assistant', content: finalReply });
        conversationHistory[sender] = userHistory.slice(-config.conversationHistoryLimit);
    }
};


// 6. MAIN BOT EXECUTION
// =================================================================

async function startBot() {
    await db.initializeDatabase();
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Menggunakan WA v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: Browsers.macOS('Chrome'),
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', handleConnectionUpdate(sock));
    sock.ev.on('messages.upsert', handleMessagesUpsert(sock));
    
    return sock;
}

startBot().catch(err => {
    logger.fatal({ err }, "❌ Gagal total memulai bot:");
    process.exit(1);
});