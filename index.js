// =================================================================
// KARTINI DIGITAL PRINTING - WHATSAPP BOT V3.8
// AI: Gemini 2.0 -> OpenAI -> OpenRouter -> Groq (Lapis 4, GRATIS & CEPAT)
// =================================================================

// 1. IMPORTS & DEPENDENCIES
const express = require('express');
const app = express();

app.use(express.json());

let currentSock = null;

require('dotenv').config();
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
    delay,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');
const { Boom }    = require('@hapi/boom');
const pino        = require('pino');
const qrcode      = require('qrcode-terminal');
const { OpenAI }  = require("openai");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const db          = require('./database.js');
const AIFactory   = require('./ai_factory.js');

// =================================================================
// 2. CONFIGURATION
// =================================================================
const config = {
    // ── API Keys ──────────────────────────────────────────────────
    geminiApiKey:     process.env.GEMINI_API_KEY,
    openaiApiKey:     process.env.OPENAI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    groqApiKey:       process.env.GROQ_API_KEY,           // ← LAPIS 4 (gratis di groq.com)

    // ── Model AI ──────────────────────────────────────────────────
    // Lapis 1 – Gemini
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",

    // Lapis 3 – OpenRouter: dicoba satu per satu sampai ada yang berhasil
    openrouterModels: process.env.OPENROUTER_MODEL
        ? [process.env.OPENROUTER_MODEL]
        : [
            "mistralai/mistral-7b-instruct:free",
            "google/gemma-2-9b-it:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "qwen/qwen-2-7b-instruct:free",
            "microsoft/phi-3-mini-128k-instruct:free",
        ],

    // Lapis 4 – Groq: model gratis paling stabil per April 2026
    groqModels: process.env.GROQ_MODEL
        ? [process.env.GROQ_MODEL]
        : [
            "llama-3.3-70b-versatile",   // terbaik, cepat, gratis
            "llama-3.1-8b-instant",       // ultra cepat, fallback ringan
            "gemma2-9b-it",               // alternatif Google
            "mixtral-8x7b-32768",         // konteks panjang
        ],

    // ── Integrasi Eksternal ───────────────────────────────────────
    n8nWebhookUrl:    process.env.N8N_WEBHOOK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:   process.env.TELEGRAM_CHAT_ID,

    // ── Informasi Bisnis ──────────────────────────────────────────
    businessName: "KARTINI DIGITAL PRINTING 24 JAM",
    email:        "kartinidigitalprinting24jam@gmail.com",
    instagram:    "kartinidigitalprinting",
    address:      "Jl. Kartini No.5, Depok, Kec. Pancoran Mas, Kota Depok, Jawa Barat 16436",
    gmapsUrl:     "https://maps.app.goo.gl/yourmaplink",

    // ── Pengaturan Bot ────────────────────────────────────────────
    ownerPauseDuration: 5 * 60 * 1000,
};

// =================================================================
// 3. LOGGER & VALIDASI
// =================================================================
const logger = pino({ transport: { target: 'pino-pretty' } });

let telegramBot;
if (config.telegramBotToken && config.telegramChatId) {
    telegramBot = new TelegramBot(config.telegramBotToken, { polling: false });
    logger.info('Notifikasi Telegram aktif.');
}

const userActivityCache = {};

// =================================================================
// 4. DYNAMIC SYSTEM PROMPT
// =================================================================
async function buildDynamicSystemPrompt(userId) {
    const aiConfig = await db.getAIConfig(userId);
    const products = await db.getProducts(userId);
    
    if (!aiConfig) return "Anda adalah asisten virtual Customer Service.";

    const categories = {};
    products.forEach(p => {
        if (!categories[p.kategori]) categories[p.kategori] = [];
        const harga = p.harga.toLocaleString('id-ID');
        const ket   = p.keterangan ? ` (${p.keterangan})` : '';
        categories[p.kategori].push(`- ${p.nama_produk}${ket}: Rp${harga}`);
    });
    
    const priceListString = Object.entries(categories)
        .map(([cat, items]) => `\nKategori: *${cat}*\n${items.join('\n')}`)
        .join('\n');
        
    const businessName = aiConfig?.business_name || "SaaS Bot";
    const basePrompt = aiConfig?.system_prompt || `Anda adalah asisten virtual Customer Service untuk "${businessName}".`;

    let companyContext = "";
    if (aiConfig?.company_email) companyContext += `- Email: ${aiConfig.company_email}\n`;
    if (aiConfig?.company_address) companyContext += `- Alamat: ${aiConfig.company_address}\n`;
    if (aiConfig?.company_social) companyContext += `- Sosial Media: ${aiConfig.company_social}\n`;
    if (aiConfig?.company_maps) companyContext += `- Maps: ${aiConfig.company_maps}\n`;
    if (aiConfig?.business_context) companyContext += `\nKonteks Tambahan Bisnis:\n${aiConfig.business_context}\n`;

    const fullPrompt = `${basePrompt}\n\nATURAN UTAMA:\n1. JAWAB SINGKAT & JELAS: Langsung ke inti jawaban, hindari bertele-tele.\n2. GUNAKAN DAFTAR HARGA: Jangan pernah menebak harga. Gunakan harga PASTI sesuai daftar.\n3. SAPA PERSONAL: Sapa pelanggan dengan nama jika tersedia.\n4. HITUNG OTOMATIS: Bantu hitung biaya pesanan jika diminta (luas x harga, jumlah x satuan, dll).\n\n--- PROFIL PERUSAHAAN ---\n${companyContext}\n--- DAFTAR HARGA RESMI ---\n${priceListString}\n--- AKHIR DAFTAR HARGA ---`;
    return fullPrompt;
}

// =================================================================
// 6. HELPER FUNCTIONS
// =================================================================
const sendMessageWTyping = async (sock, jid, content, options = {}) => {
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1200);
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, content, options);
};

const getMessageContent = (msg) =>
    msg.message?.conversation                  ||
    msg.message?.extendedTextMessage?.text     ||
    msg.message?.imageMessage?.caption         ||
    msg.message?.videoMessage?.caption         || "";

// =================================================================
// 6. FUNGSI AI (DYNAMIC)
// =================================================================

async function getAIReply(userText, history = [], customerName = null) {
    const userId = 'admin'; // Single-tenant fallback
    const config = await db.getAIConfig(userId);
    
    if (!config || !config.api_key) {
        logger.error(`API Key belum dikonfigurasi untuk user: ${userId}`);
        return "Maaf, sistem AI belum dikonfigurasi oleh pemilik bot. Silakan masukkan API Key di Dashboard.";
    }

    const systemPrompt = await buildDynamicSystemPrompt(userId);
    const now = new Date();
    const wibTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    const wibDate = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' };
    
    let timeContext = `\n\n[Waktu Sekarang]: Hari ${now.toLocaleDateString('id-ID', wibDate)}, pukul ${now.toLocaleTimeString('id-ID', wibTime)} WIB.`;
    
    const fullConfig = {
        ...config,
        system_prompt: systemPrompt + timeContext
    };

    logger.info(`Menghubungi AI Factory (${fullConfig.provider})...`);
    return await AIFactory.generateReply(fullConfig, userText, history, customerName);
}

/**
 * summarizeConversation
 */
async function summarizeConversation(history) {
    if (!history?.length) return null;
    const text   = history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'Bot'}: ${m.content}`).join('\n');
    const prompt = `Buat rangkuman singkat poin-poin dari percakapan CS percetakan ini:\n\n${text}`;
    
    const userId = 'admin';
    const config = await db.getAIConfig(userId);
    if (!config || !config.api_key) return "Gagal merangkum: API Key belum dikonfigurasi.";
    
    return await AIFactory.generateReply(config, prompt, [], null);
}

/**
 * classifyImageWithAI – Klasifikasi gambar
 */
async function classifyImageWithAI(imageBuffer) {
    // Saat ini disederhanakan karena tidak semua API Key (seperti Groq Llama 3 standar) 
    // mendukung Vision secara native. 
    // Untuk pengembangan SaaS lebih lanjut, ini akan menggunakan provider yang mendukung vision (contoh: OpenAI gpt-4o / Gemini).
    return 'gambar_umum';
}

// =================================================================
// 8. INTEGRASI EKSTERNAL
// =================================================================
async function forwardPaymentToN8N(sender, caption, imageBuffer) {
    if (!config.n8nWebhookUrl) return;
    try {
        await axios.post(config.n8nWebhookUrl, {
            sender:       sender.split('@')[0],
            caption:      caption || "Tidak ada caption",
            image_base64: imageBuffer.toString('base64'),
            timestamp:    new Date().toISOString(),
        }, { headers: { 'Content-Type': 'application/json' } });
    } catch { logger.error('Gagal forward ke n8n.'); }
}

async function sendTelegramNotification(text, imageBuffer = null) {
    if (!telegramBot) return;
    try {
        if (imageBuffer) {
            await telegramBot.sendPhoto(config.telegramChatId, imageBuffer, { caption: text, parse_mode: 'Markdown' });
        } else {
            await telegramBot.sendMessage(config.telegramChatId, text, { parse_mode: 'Markdown' });
        }
    } catch { logger.error('Gagal kirim Telegram.'); }
}

async function sendMenuWithButtons(sock, jid, greeting, quoted = {}) {
    await sendMessageWTyping(sock, jid, {
        text:   greeting,
        footer: `© ${config.businessName}`,
        buttons: [
            { buttonId: '/layanan',   buttonText: { displayText: 'Info Layanan & Produk' }, type: 1 },
            { buttonId: '/carapesan', buttonText: { displayText: 'Cara Pemesanan'         }, type: 1 },
            { buttonId: '/alamat',    buttonText: { displayText: 'Lokasi Kami'             }, type: 1 },
        ],
        headerType: 1,
    }, { quoted });
}

// =================================================================
// 9. EVENT HANDLERS
// =================================================================
const handleConnectionUpdate = (sock) => ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
        const reconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn(`Koneksi terputus. Reconnect: ${reconnect}`);
        if (reconnect) setTimeout(startBot, 5000);
    } else if (connection === 'open') {
        logger.info(`Bot ${config.businessName} tersambung dan siap!`);
    }
};

const handleMessagesUpsert = (sock) => async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    if (!sender || sender.endsWith('@g.us')) return;

    if (await db.isMessageRead(msg.key.id)) return;

    if (userActivityCache[sender] && Date.now() < userActivityCache[sender]) {
        logger.info(`Bot pause untuk ${sender}.`);
        return;
    }

    const { customer, isNew } = await db.getOrAddCustomer(sender);
    const customerName = customer?.name;

    if (msg.message.stickerMessage) return;

    // ── Handler Gambar ────────────────────────────────────────────
    if (msg.message.imageMessage) {
        try {
            const caption     = getMessageContent(msg);
            const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
            const type        = await classifyImageWithAI(imageBuffer);
            const userHistory = await db.getHistoryForJid(sender);

            if (type.includes('bukti_pembayaran')) {
                const txt = `Terima kasih ${customerName ? 'Kak ' + customerName : 'Kak'}, bukti pembayaran sudah kami terima! Pesanan segera diproses.`;
                await sendMessageWTyping(sock, sender, { text: txt }, { quoted: msg });
                await Promise.all([
                    forwardPaymentToN8N(sender, caption, imageBuffer),
                    sendTelegramNotification(
                        `*Bukti Pembayaran Masuk*\nDari: \`${sender.split('@')[0]}\`\nNama: ${customerName || 'N/A'}\nKet: ${caption || '-'}`,
                        imageBuffer
                    ),
                ]);
            } else if (type.includes('dokumen')) {
                await sendMessageWTyping(sock, sender, { text: 'Dokumen diterima, terima kasih!' }, { quoted: msg });
            } else {
                const reply = await getAIReply(caption || "Saya mengirim gambar.", userHistory, customerName);
                if (reply) {
                    await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
                    await db.addMessageToHistory(sender, 'user', caption || "Kirim gambar");
                    await db.addMessageToHistory(sender, 'assistant', reply);
                }
            }
        } catch (e) {
            logger.error({ err: e.message }, 'Error proses gambar.');
        }
        return;
    }

    // ── Handler Teks ──────────────────────────────────────────────
    const text    = getMessageContent(msg).trim();
    if (!text) return;
    const command = text.toLowerCase();

    const navCmds = ['/menu', '/bantuan', '/help'];
    if (!navCmds.includes(command)) await db.addMessageToHistory(sender, 'user', text);

    // Sambut pelanggan baru
    if (isNew) {
        const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
        const greet = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 19 ? 'Selamat Sore' : 'Selamat Malam';
        await sendMenuWithButtons(
            sock, sender,
            `${greet} Kak! Selamat datang di *${config.businessName}*.\n\nAda yang bisa kami bantu?`,
            { quoted: msg }
        );
        await db.addMessageToHistory(sender, 'assistant', 'Menu sambutan awal');
        return;
    }

    // Command FAQ Dinamis (Balasan Cepat)
    const faqs = await db.getFaqs('admin');
    const matchedFaq = faqs.find(f => f.command.toLowerCase() === command);
    
    if (matchedFaq) {
        await sendMessageWTyping(sock, sender, { text: matchedFaq.response }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', matchedFaq.response);
        return;
    }
    if (navCmds.includes(command)) {
        await sendMenuWithButtons(sock, sender, 'Ada yang bisa dibantu lagi, Kak?', { quoted: msg });
        return;
    }
    if (command.startsWith('/simpan-nama ')) {
        const nama = text.substring(13).trim();
        if (nama) {
            await db.updateCustomerName(sender, nama);
            const res = `Nama *${nama}* sudah tersimpan. Senang melayani Anda!`;
            await sendMessageWTyping(sock, sender, { text: res }, { quoted: msg });
            await db.addMessageToHistory(sender, 'assistant', res);
        }
        return;
    }

    // Pesan bebas -> AI 4 lapis
    const userHistory = await db.getHistoryForJid(sender);
    const reply       = await getAIReply(text, userHistory, customerName);
    if (reply) {
        await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', reply);
    }
};

// =================================================================
// 10. MAIN
// =================================================================
async function startBot() {
    await db.initializeDatabase();
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version }          = await fetchLatestBaileysVersion();
    logger.info(`Baileys WA v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth:    state,
        // Penyesuaian Termux: Gunakan nama OS yang tepat dan hemat memori
        browser: process.platform === 'android' ? ['Termux', 'Chrome', '1.0.0'] : Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        logger:  pino({ level: 'silent' }),
    });
currentSock = sock;

    sock.ev.on('creds.update',       saveCreds);
    sock.ev.on('connection.update',  handleConnectionUpdate(sock));
    sock.ev.on('messages.upsert',    handleMessagesUpsert(sock));

    // Deteksi owner mengetik -> pause bot & kirim rangkuman ke Telegram
    sock.ev.on('presence.update', async ({ id, presences }) => {
        if (presences[sock.user?.id]?.lastKnownPresence === 'composing') {
            if (!userActivityCache[id] || Date.now() > userActivityCache[id]) {
                userActivityCache[id] = Date.now() + config.ownerPauseDuration;
                logger.info(`Owner mengetik ke ${id}. Bot pause 5 menit.`);
                const hist = await db.getHistoryForJid(id);
                if (hist?.length) {
                    const summ = await summarizeConversation(hist);
                    if (summ) {
                        const { customer } = await db.getOrAddCustomer(id);
                        await sendTelegramNotification(
                            `*Auto-Pause & Rangkuman*\nPelanggan: \`${id.split('@')[0]}\` (${customer?.name || 'N/A'})\n\n---\n${summ}`
                        );
                    }
                }
            }
        }
    });

    // Tandai pesan sudah dibaca
    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            if (update.receipt?.receiptType === 'read' && !key.fromMe) {
                await db.addReadReceipt(key.id);
            }
        }
    });
}
app.post('/connect', async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.json({ error: "Nomor tidak boleh kosong" });
        }

        if (!currentSock) {
            return res.json({ error: "Bot belum siap" });
        }

        const code = await currentSock.requestPairingCode(phone);

        res.json({
            success: true,
            pairing_code: code
        });

    } catch (err) {
        res.json({
            error: err.message
        });
    }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Server jalan di port", PORT);
});

app.get('/', (req, res) => {
    res.send("Bot aktif 🚀");
});

startBot().catch(err => {
    logger.fatal({ err }, 'Gagal memulai bot.');
    process.exit(1);
});