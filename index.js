// =================================================================
// WA CHATBOT - UNIVERSAL CS BOT
// Semua data bisnis dikonfigurasi via Dashboard, bukan di sini.
// Compatible: Linux, macOS, Windows, Android (Termux)
// =================================================================

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
const { OpenAI }  = require('openai');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios       = require('axios');
const db          = require('./database.js');
const AIFactory   = require('./ai_factory.js');

// Telegram bot opsional
let TelegramBot;
try { TelegramBot = require('node-telegram-bot-api'); } catch (_) {}

// =================================================================
// KONFIGURASI TEKNIS (bukan data bisnis)
// =================================================================
const TECH = {
    ownerPauseDuration: (parseInt(process.env.OWNER_PAUSE_MINUTES) || 5) * 60 * 1000,
    telegramBotToken:   process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:     process.env.TELEGRAM_CHAT_ID,
    n8nWebhookUrl:      process.env.N8N_WEBHOOK_URL,
    // Model fallback chains (bisa di-override dari DB)
    groqModels:         ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'],
    openrouterModels:   ['meta-llama/llama-3.1-8b-instruct:free', 'google/gemma-2-9b-it:free'],
};

const logger = pino({ transport: { target: 'pino-pretty' } });

let telegramBot;
if (TelegramBot && TECH.telegramBotToken && TECH.telegramChatId) {
    telegramBot = new TelegramBot(TECH.telegramBotToken, { polling: false });
    logger.info('Notifikasi Telegram aktif.');
}

const userActivityCache = {};
const OWNER_NUMBERS = (process.env.OWNER_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
let botStatus = {
    status: 'disconnected', // 'connecting' | 'connected' | 'disconnected'
    qr: null,
    phone: null,
    since: null,
};

// =================================================================
// DYNAMIC SYSTEM PROMPT (dari database, bukan hardcode)
// =================================================================
async function buildDynamicSystemPrompt(userId) {
    const aiConfig = await db.getAIConfig(userId);
    const products  = await db.getProducts(userId);

    const categories = {};
    products.forEach(p => {
        if (!categories[p.kategori]) categories[p.kategori] = [];
        const harga = Number(p.harga).toLocaleString('id-ID');
        const ket   = p.keterangan ? ` (${p.keterangan})` : '';
        categories[p.kategori].push(`- ${p.nama_produk}${ket}: Rp${harga}`);
    });

    const priceListString = Object.entries(categories)
        .map(([cat, items]) => `\nKategori: *${cat}*\n${items.join('\n')}`)
        .join('\n');

    const businessName = aiConfig?.business_name || 'Toko Kami';
    const basePrompt   = aiConfig?.system_prompt  || `Anda adalah asisten virtual Customer Service untuk "${businessName}". Jawab dengan ramah dan informatif.`;

    let companyContext = '';
    if (aiConfig?.company_email)   companyContext += `- Email: ${aiConfig.company_email}\n`;
    if (aiConfig?.company_address) companyContext += `- Alamat: ${aiConfig.company_address}\n`;
    if (aiConfig?.company_social)  companyContext += `- Sosial Media: ${aiConfig.company_social}\n`;
    if (aiConfig?.company_maps)    companyContext += `- Google Maps: ${aiConfig.company_maps}\n`;
    if (aiConfig?.business_context) companyContext += `\nKonteks Bisnis:\n${aiConfig.business_context}\n`;

    const now = new Date();
    const wibTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    const wibDate = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' };
    const timeContext = `\n\n[Waktu Sekarang]: ${now.toLocaleDateString('id-ID', wibDate)}, pukul ${now.toLocaleTimeString('id-ID', wibTime)} WIB.`;

    const priceSection = priceListString
        ? `\n--- DAFTAR HARGA RESMI ---\n${priceListString}\n--- AKHIR DAFTAR HARGA ---`
        : '\n[Belum ada daftar harga. Sampaikan bahwa harga akan dikonfirmasi oleh tim kami.]';

    return `${basePrompt}\n\nATURAN UTAMA:\n1. JAWAB SINGKAT & JELAS: Langsung ke inti, hindari bertele-tele.\n2. GUNAKAN DAFTAR HARGA: Jangan menebak harga. Gunakan harga PASTI dari daftar.\n3. SAPA PERSONAL: Sapa pelanggan dengan nama jika tersedia.\n4. HITUNG OTOMATIS: Bantu hitung biaya jika diminta.\n\n--- PROFIL PERUSAHAAN ---\n${companyContext || '[Profil belum diisi. Isi di Dashboard → Pengaturan AI]'}\n${priceSection}${timeContext}`;
}

// =================================================================
// HELPERS
// =================================================================
const sendMessageWTyping = async (sock, jid, content, options = {}) => {
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1200);
    await sock.sendPresenceUpdate('paused', jid);
    return sock.sendMessage(jid, content, options);
};

const getMessageContent = (msg) =>
    msg.message?.conversation              ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption     ||
    msg.message?.videoMessage?.caption     || '';

async function getBusinessName(userId = 'admin') {
    const cfg = await db.getAIConfig(userId);
    return cfg?.business_name || 'Toko Kami';
}

// =================================================================
// AI REPLY
// =================================================================
async function getAIReply(userText, history = [], customerName = null, userId = 'admin') {
    const config = await db.getAIConfig(userId);

    if (!config?.api_key) {
        return '⚙️ Sistem AI belum dikonfigurasi. Hubungi admin untuk mengatur API Key di Dashboard.';
    }

    const systemPrompt = await buildDynamicSystemPrompt(userId);
    const fullConfig   = { ...config, system_prompt: systemPrompt };

    logger.info(`[AI] Menghubungi provider: ${fullConfig.provider}`);
    return AIFactory.generateReply(fullConfig, userText, history, customerName);
}

async function summarizeConversation(history, userId = 'admin') {
    if (!history?.length) return null;
    const text   = history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'Bot'}: ${m.content}`).join('\n');
    const prompt = `Buat rangkuman singkat poin-poin penting dari percakapan CS ini:\n\n${text}`;
    const config = await db.getAIConfig(userId);
    if (!config?.api_key) return null;
    return AIFactory.generateReply(config, prompt, [], null);
}

// =================================================================
// INTEGRASI EKSTERNAL
// =================================================================
async function forwardPaymentToN8N(sender, caption, imageBuffer) {
    if (!TECH.n8nWebhookUrl) return;
    try {
        await axios.post(TECH.n8nWebhookUrl, {
            sender:       sender.split('@')[0],
            caption:      caption || 'Tidak ada caption',
            image_base64: imageBuffer.toString('base64'),
            timestamp:    new Date().toISOString(),
        }, { headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        logger.error('[N8N] Gagal forward:', e.message);
    }
}

async function sendTelegramNotification(text, imageBuffer = null) {
    if (!telegramBot) return;
    try {
        if (imageBuffer) {
            await telegramBot.sendPhoto(TECH.telegramChatId, imageBuffer, { caption: text, parse_mode: 'Markdown' });
        } else {
            await telegramBot.sendMessage(TECH.telegramChatId, text, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        logger.error('[Telegram] Gagal kirim:', e.message);
    }
}

async function sendMenuWithButtons(sock, jid, greeting, quoted = {}) {
    // Gunakan teks biasa karena button WA sudah deprecated di banyak versi
    await sendMessageWTyping(sock, jid, { text: greeting }, { quoted });
}

// =================================================================
// EVENT HANDLERS
// =================================================================
const handleConnectionUpdate = (sock) => ({ connection, lastDisconnect, qr }) => {
    if (qr) {
        botStatus.qr = qr;
        botStatus.status = 'connecting';
        qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
        botStatus.status = 'disconnected';
        botStatus.qr = null;
        botStatus.phone = null;
        const reconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn(`[WA] Koneksi terputus. Reconnect: ${reconnect}`);
        if (reconnect) setTimeout(startBot, 5000);
        else logger.fatal('[WA] Sesi tidak valid. Hapus auth_info_baileys/ dan scan ulang.');
    } else if (connection === 'open') {
        botStatus.status = 'connected';
        botStatus.qr = null;
        botStatus.since = new Date().toISOString();
        botStatus.phone = sock.user?.id?.split(':')[0] || null;
        logger.info('[WA] ✅ Bot tersambung dan siap!');
    }
};

const handleMessagesUpsert = (sock) => async ({ messages }) => {
    const msg = messages[0];
    if (!msg?.message) return;

    // Pesan dari owner → cek perintah /pause
    if (msg.key.fromMe) {
        const text = getMessageContent(msg).trim().toLowerCase();
        if (text === '/pause') {
            const jid = msg.key.remoteJid;
            userActivityCache[jid] = Date.now() + TECH.ownerPauseDuration;
            logger.info(`[PAUSE] Bot di-pause untuk ${jid} selama ${TECH.ownerPauseDuration / 60000} menit.`);
        }
        return;
    }

    const sender = msg.key.remoteJid;
    if (!sender || sender.endsWith('@g.us') || sender.endsWith('@broadcast')) return;
    if (await db.isMessageRead(msg.key.id)) return;

    // Cek apakah bot sedang di-pause untuk user ini
    if (userActivityCache[sender] && Date.now() < userActivityCache[sender]) {
        logger.info(`[PAUSE] Pesan dari ${sender} diabaikan (owner mode).`);
        return;
    }

    // Ambil data customer
    const { customer, isNew } = await db.getOrAddCustomer(sender);
    const customerName = customer?.name || null;
    const userId = 'admin'; // Single-tenant. Multi-tenant: mapping nomor WA ke userId

    if (msg.message.stickerMessage) return;

    // ── GAMBAR ────────────────────────────────────────────────────
    if (msg.message.imageMessage) {
        try {
            const caption     = getMessageContent(msg);
            const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
            const userHistory = await db.getHistoryForJid(sender);

            // Deteksi sederhana bukti pembayaran dari caption
            const isBayar = caption && /bayar|transfer|bukti|payment/i.test(caption);

            if (isBayar) {
                const txt = `Terima kasih${customerName ? ` Kak ${customerName}` : ''}, bukti pembayaran diterima! Tim kami akan segera verifikasi.`;
                await sendMessageWTyping(sock, sender, { text: txt }, { quoted: msg });
                await Promise.all([
                    forwardPaymentToN8N(sender, caption, imageBuffer),
                    sendTelegramNotification(
                        `*💰 Bukti Pembayaran Masuk*\nDari: \`${sender.split('@')[0]}\`\nNama: ${customerName || 'N/A'}\nKet: ${caption || '-'}`,
                        imageBuffer
                    ),
                ]);
            } else {
                const question = caption || 'Saya mengirim gambar ini.';
                const reply    = await getAIReply(question, userHistory, customerName, userId);
                if (reply) {
                    await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
                    await db.addMessageToHistory(sender, 'user', question);
                    await db.addMessageToHistory(sender, 'assistant', reply);
                }
            }
        } catch (e) {
            logger.error('[GAMBAR] Error:', e.message);
        }
        return;
    }

    // ── TEKS ──────────────────────────────────────────────────────
    const text    = getMessageContent(msg).trim();
    if (!text) return;
    const command = text.toLowerCase();
    logger.info(`[MSG] ${sender.split('@')[0]}: ${text.substring(0, 80)}`);

    // Tandai sudah dibaca
    await db.addReadReceipt(msg.key.id);

    // Sambut pelanggan baru
    if (isNew) {
        const businessName = await getBusinessName(userId);
        const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
        const greet = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 19 ? 'Selamat Sore' : 'Selamat Malam';

        const welcomeMsg = `${greet} Kak! Selamat datang di *${businessName}* 👋\n\nAda yang bisa kami bantu? Langsung ketik pertanyaan Anda ya!`;
        await sendMenuWithButtons(sock, sender, welcomeMsg, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', '[Pesan sambutan awal]');
        return;
    }

    // Perintah navigasi
    if (['/menu', '/bantuan', '/help', 'menu', 'halo', 'hai', 'hi', 'p'].includes(command)) {
        const businessName = await getBusinessName(userId);
        await sendMessageWTyping(sock, sender, {
            text: `Halo${customerName ? ` Kak ${customerName}` : ''}! 👋 Ada yang bisa dibantu di *${businessName}*?\n\nSilakan ketik pertanyaan Anda langsung ya!`
        }, { quoted: msg });
        return;
    }

    // Simpan nama
    if (command.startsWith('/simpan-nama ') || command.startsWith('nama saya ')) {
        const prefix = command.startsWith('/simpan-nama ') ? 13 : 9;
        const nama   = text.substring(prefix).trim();
        if (nama) {
            await db.updateCustomerName(sender, nama);
            const res = `✅ Nama *${nama}* sudah tersimpan. Senang melayani Anda!`;
            await sendMessageWTyping(sock, sender, { text: res }, { quoted: msg });
            await db.addMessageToHistory(sender, 'assistant', res);
        }
        return;
    }

    // Cek FAQ/balasan cepat dari database
    const faqs       = await db.getFaqs(userId);
    const matchedFaq = faqs.find(f => f.command.toLowerCase() === command);
    if (matchedFaq) {
        await sendMessageWTyping(sock, sender, { text: matchedFaq.response }, { quoted: msg });
        await db.addMessageToHistory(sender, 'user', text);
        await db.addMessageToHistory(sender, 'assistant', matchedFaq.response);
        return;
    }

    // Pesan bebas → AI
    const userHistory = await db.getHistoryForJid(sender);
    await db.addMessageToHistory(sender, 'user', text);

    const reply = await getAIReply(text, userHistory, customerName, userId);
    if (reply) {
        await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', reply);
    }
};

// =================================================================
// MAIN
// =================================================================
async function startBot() {
    await db.initializeDatabase();

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version }          = await fetchLatestBaileysVersion();
    logger.info(`[WA] Baileys v${version.join('.')}`);

    const isTermux = process.platform === 'android' ||
                     process.env.PREFIX?.includes('com.termux') ||
                     process.env.TERMUX_VERSION;

    const sock = makeWASocket({
        version,
        auth:    state,
        browser: isTermux ? ['Termux', 'Chrome', '1.0.0'] : Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        logger:  pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update',      saveCreds);
    sock.ev.on('connection.update', handleConnectionUpdate(sock));
    sock.ev.on('messages.upsert',   handleMessagesUpsert(sock));

    // Auto-pause saat owner mengetik
    sock.ev.on('presence.update', async ({ id, presences }) => {
        const myId = sock.user?.id;
        if (!myId) return;
        const myNumber = myId.split(':')[0];
        const isOwner  = Object.keys(presences).some(k => k.includes(myNumber));

        if (isOwner && presences[myId]?.lastKnownPresence === 'composing') {
            if (!userActivityCache[id] || Date.now() > userActivityCache[id]) {
                userActivityCache[id] = Date.now() + TECH.ownerPauseDuration;
                logger.info(`[PAUSE] Owner mengetik ke ${id}. Bot pause.`);

                const hist = await db.getHistoryForJid(id);
                if (hist?.length) {
                    const summ = await summarizeConversation(hist);
                    if (summ) {
                        const { customer } = await db.getOrAddCustomer(id);
                        await sendTelegramNotification(
                            `*📋 Rangkuman Percakapan*\nPelanggan: \`${id.split('@')[0]}\` (${customer?.name || 'N/A'})\n\n${summ}`
                        );
                    }
                }
            }
        }
    });

    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            if (update.receipt?.receiptType === 'read' && !key.fromMe) {
                await db.addReadReceipt(key.id);
            }
        }
    });

    return sock;
}

// Express untuk endpoint pairing code (opsional)
const express = require('express');
const app = express();
app.use(express.json());

let currentSock = null;
startBot().then(sock => {
    currentSock = sock;
}).catch(err => {
    logger.fatal('[FATAL]', err);
    process.exit(1);
});

app.get('/status', (req, res) => {
    res.json({ success: true, ...botStatus });
});

app.post('/connect', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone)       return res.json({ success: false, error: 'Nomor tidak boleh kosong' });
        if (!currentSock) return res.json({ success: false, error: 'Bot belum siap' });
        const code = await currentSock.requestPairingCode(phone);
        res.json({ success: true, pairing_code: code });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/', (req, res) => res.json({ status: 'ok', bot: botStatus.status }));

const BOT_PORT = process.env.BOT_PORT || 3001;
app.listen(BOT_PORT, () => logger.info(`[BOT] Server berjalan di port ${BOT_PORT}`));
