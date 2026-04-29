// =================================================================
// KARTINI DIGITAL PRINTING - WHATSAPP BOT V3.8
// AI: Gemini 2.0 -> OpenAI -> OpenRouter -> Groq (Lapis 4, GRATIS & CEPAT)
// =================================================================

// 1. IMPORTS & DEPENDENCIES
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
const priceData   = require('./pricelist.js');

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

if (!config.geminiApiKey) {
    logger.fatal('GEMINI_API_KEY tidak diatur. Program berhenti.');
    process.exit(1);
}

// =================================================================
// 4. INISIALISASI KLIEN AI
// =================================================================

// ── Lapis 1: Google Gemini ────────────────────────────────────────
const genAI = new GoogleGenerativeAI(config.geminiApiKey);
logger.info(`[AI-1] Gemini siap (${config.geminiModel}).`);

// ── Lapis 2: OpenAI ───────────────────────────────────────────────
const openai = new OpenAI({ apiKey: config.openaiApiKey || "dummy", timeout: 30_000 });
logger.info(config.openaiApiKey ? '[AI-2] OpenAI siap.' : '[AI-2] OpenAI: API key kosong, akan dilewati.');

// ── Lapis 3: OpenRouter ───────────────────────────────────────────
const openrouter = new OpenAI({
    apiKey:   config.openrouterApiKey || "dummy",
    baseURL:  "https://openrouter.ai/api/v1",
    timeout:  30_000,
    defaultHeaders: {
        "HTTP-Referer": "https://kartinidigitalprinting.com",
        "X-Title":      config.businessName,
    },
});
logger.info(
    config.openrouterApiKey
        ? `[AI-3] OpenRouter siap. Model cadangan: ${config.openrouterModels.join(' | ')}`
        : '[AI-3] OpenRouter: API key kosong, akan dilewati.'
);

// ── Lapis 4: Groq (GRATIS, cepat) ────────────────────────────────
const groq = new OpenAI({
    apiKey:  config.groqApiKey || "dummy",
    baseURL: "https://api.groq.com/openai/v1",
    timeout: 20_000,   // Groq sangat cepat, timeout lebih pendek
});
logger.info(
    config.groqApiKey
        ? `[AI-4] Groq siap. Model cadangan: ${config.groqModels.join(' | ')}`
        : '[AI-4] Groq: API key kosong, akan dilewati. Daftar GRATIS di https://console.groq.com'
);

// ── Telegram ──────────────────────────────────────────────────────
let telegramBot;
if (config.telegramBotToken && config.telegramChatId) {
    telegramBot = new TelegramBot(config.telegramBotToken, { polling: false });
    logger.info('Notifikasi Telegram aktif.');
}

const userActivityCache = {};

// =================================================================
// 5. SYSTEM PROMPT
// =================================================================
function formatPriceListForAI(data) {
    const categories = {};
    data.produk.forEach(p => {
        if (!categories[p.kategori]) categories[p.kategori] = [];
        const harga = p.harga.toLocaleString('id-ID');
        const ket   = p.keterangan ? ` (${p.keterangan})` : '';
        categories[p.kategori].push(`- ${p.nama_produk}${ket}: Rp${harga}`);
    });
    return Object.entries(categories)
        .map(([cat, items]) => `\nKategori: *${cat}*\n${items.join('\n')}`)
        .join('\n');
}

const priceListString    = formatPriceListForAI(priceData);
const systemPromptContent = `Anda adalah asisten virtual Customer Service untuk "${config.businessName}". Melayani pelanggan dengan informatif, profesional, ramah, dan efisien.

ATURAN UTAMA:
1. JAWAB SINGKAT & JELAS: Langsung ke inti jawaban, hindari bertele-tele.
2. GUNAKAN DAFTAR HARGA: Jangan pernah menebak harga. Gunakan harga PASTI sesuai daftar.
3. SAPA PERSONAL: Sapa pelanggan dengan nama jika tersedia.
4. HITUNG OTOMATIS: Bantu hitung biaya pesanan jika diminta (luas x harga, jumlah x satuan, dll).

--- DAFTAR HARGA RESMI ---
${priceListString}
--- AKHIR DAFTAR HARGA ---`;

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
// 7. FUNGSI AI – SISTEM FALLBACK 4 LAPIS
// =================================================================

/**
 * Coba semua model dari satu provider secara berurutan.
 * Lanjut ke model berikutnya hanya jika error 404 / "No endpoints".
 * Error lain (rate limit, server, dll) → berhenti dan lempar ke lapis berikutnya.
 */
async function tryModels(client, models, messages, layerName) {
    for (const model of models) {
        try {
            logger.info(`   ${layerName} – mencoba model: ${model}`);
            const res   = await client.chat.completions.create({ model, messages });
            const reply = res.choices[0]?.message?.content?.trim();
            if (reply) {
                logger.info(`   ${layerName} – berhasil dengan model: ${model}`);
                return reply;
            }
            logger.warn(`   ${layerName} – model ${model} mengembalikan respons kosong.`);
        } catch (err) {
            const msg         = err.message || "";
            const is404       = msg.includes('404') || msg.includes('No endpoints') || msg.includes('not found');
            const isRateLimit = msg.includes('429') || msg.includes('rate') || msg.includes('quota');

            if (is404) {
                logger.warn(`   ${layerName} – ${model}: tidak tersedia (404), coba model berikutnya...`);
                continue; // Coba model berikutnya di provider yang sama
            }
            if (isRateLimit) {
                logger.warn(`   ${layerName} – ${model}: rate limit/quota habis. Pindah ke lapis berikutnya.`);
                break; // Rate limit? Tidak perlu coba model lain di provider ini
            }
            // Error lain
            logger.error({ err: msg }, `   ${layerName} – ${model}: error tidak terduga.`);
            break;
        }
    }
    return null;
}

/**
 * getAIReply – Balasan AI dengan 4 lapis fallback:
 *   1. Gemini 2.0-flash     (Google, gratis dengan API key)
 *   2. OpenAI gpt-4o-mini   (berbayar, skip jika quota habis)
 *   3. OpenRouter            (5 model free dicoba berurutan)
 *   4. Groq                  (GRATIS, cepat, sangat direkomendasikan)
 */
async function getAIReply(userText, history = [], customerName = null) {
    const now = new Date();
    const wibTime = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    const wibDate = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' };

    // Prompt teks penuh untuk Gemini
    let geminiPrompt = systemPromptContent;
    geminiPrompt += `\n\n[Waktu Sekarang]: Hari ${now.toLocaleDateString('id-ID', wibDate)}, pukul ${now.toLocaleTimeString('id-ID', wibTime)} WIB.`;
    if (customerName) geminiPrompt += `\n[Nama Pelanggan]: "${customerName}"`;
    geminiPrompt += "\n\n--- RIWAYAT CHAT ---\n";
    geminiPrompt += history.length > 0
        ? history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'CS'}: ${m.content}`).join('\n')
        : "(Percakapan baru)";
    geminiPrompt += `\n\nPelanggan: ${userText}\nCS:`;

    // Format pesan OpenAI/OpenRouter/Groq
    const messages = [
        { role: "system", content: systemPromptContent },
        ...history,
        { role: "user", content: userText },
    ];

    // ── Lapis 1: Gemini ──────────────────────────────────────────
    logger.info(`[AI-1] Menghubungi Gemini (${config.geminiModel})...`);
    try {
        const model  = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent(geminiPrompt);
        const reply  = result.response.text()?.trim();
        if (reply) { logger.info('[AI-1] Gemini berhasil.'); return reply; }
        throw new Error("Respons kosong.");
    } catch (e) {
        logger.error({ err: e.message }, '[AI-1] Gemini gagal -> coba lapis 2...');
    }

    // ── Lapis 2: OpenAI ──────────────────────────────────────────
    if (config.openaiApiKey) {
        logger.info('[AI-2] Menghubungi OpenAI (gpt-4o-mini)...');
        try {
            const res   = await openai.chat.completions.create({ model: "gpt-4o-mini", messages });
            const reply = res.choices[0]?.message?.content?.trim();
            if (reply) { logger.info('[AI-2] OpenAI berhasil.'); return reply; }
        } catch (e) {
            const label = (e.message?.includes('429') || e.message?.includes('quota'))
                ? 'quota habis' : 'error';
            logger.error({ err: e.message }, `[AI-2] OpenAI ${label} -> coba lapis 3...`);
        }
    } else {
        logger.warn('[AI-2] OpenAI dilewati (tidak ada API key) -> coba lapis 3...');
    }

    // ── Lapis 3: OpenRouter ──────────────────────────────────────
    if (config.openrouterApiKey) {
        logger.info('[AI-3] Menghubungi OpenRouter...');
        const reply = await tryModels(openrouter, config.openrouterModels, messages, 'OpenRouter');
        if (reply) { logger.info('[AI-3] OpenRouter berhasil.'); return reply; }
        logger.error('[AI-3] Semua model OpenRouter gagal -> coba lapis 4...');
    } else {
        logger.warn('[AI-3] OpenRouter dilewati (tidak ada API key) -> coba lapis 4...');
    }

    // ── Lapis 4: Groq (GRATIS & CEPAT) ──────────────────────────
    if (config.groqApiKey) {
        logger.info('[AI-4] Menghubungi Groq...');
        const reply = await tryModels(groq, config.groqModels, messages, 'Groq');
        if (reply) { logger.info('[AI-4] Groq berhasil!'); return reply; }
        logger.error('[AI-4] Semua model Groq gagal.');
    } else {
        logger.warn('[AI-4] Groq dilewati (tidak ada API key). Daftar GRATIS: https://console.groq.com');
    }

    // ── Semua lapis gagal ────────────────────────────────────────
    logger.error('Semua 4 lapis AI gagal. Mengirim pesan manual ke pelanggan.');
    return "Maaf, sistem kami sedang mengalami kendala teknis. Tim kami akan segera merespon. Terima kasih atas kesabarannya!";
}

/**
 * summarizeConversation – Rangkum chat dengan fallback Gemini -> Groq
 */
async function summarizeConversation(history) {
    if (!history?.length) return null;
    const text   = history.map(m => `${m.role === 'user' ? 'Pelanggan' : 'Bot'}: ${m.content}`).join('\n');
    const prompt = `Buat rangkuman singkat poin-poin dari percakapan CS percetakan ini:\n\n${text}`;
    const msgs   = [{ role: "user", content: prompt }];

    // Coba Gemini
    try {
        const model  = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent(prompt);
        const summ   = result.response.text()?.trim();
        if (summ) return summ;
    } catch (e) {
        logger.error({ err: e.message }, '[Rangkuman] Gemini gagal -> coba Groq...');
    }

    // Fallback Groq (lebih cepat & gratis)
    if (config.groqApiKey) {
        const summ = await tryModels(groq, config.groqModels, msgs, 'Groq-Rangkuman');
        if (summ) return summ;
    }

    // Fallback OpenRouter
    if (config.openrouterApiKey) {
        const summ = await tryModels(openrouter, config.openrouterModels, msgs, 'OpenRouter-Rangkuman');
        if (summ) return summ;
    }

    return "Gagal membuat rangkuman otomatis.";
}

/**
 * classifyImageWithAI – Klasifikasi gambar via Gemini Vision
 */
async function classifyImageWithAI(imageBuffer) {
    const b64    = imageBuffer.toString('base64');
    const prompt = "Analisis gambar ini. Balas HANYA dengan satu kata: 'bukti_pembayaran', 'dokumen', atau 'gambar_umum'.";
    try {
        const model  = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: b64, mimeType: 'image/jpeg' } },
        ]);
        return result.response.text().trim().toLowerCase().replace(/['"`\s]/g, '');
    } catch (e) {
        logger.error({ err: e.message }, 'Vision AI gagal. Default: gambar_umum.');
        return 'gambar_umum';
    }
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

    // Command statis
    const cmds = {
        '/layanan':   `*Layanan Kami:*\n\n*Print Digital:* Poster, Flyer, Brosur\n*Print Besar:* Banner, Spanduk, Stiker Vinyl\n*Merchandise:* Kaos, Mug, Totebag\n\nTanya harga detail langsung ya!`,
        '/carapesan': `*Cara Pesan:*\n\n1. Kirim file desain ke: *${config.email}*\n2. Konfirmasi ukuran, material & jumlah.\n3. Bayar setelah total dikonfirmasi.\n4. Pesanan diproses & siap!`,
        '/alamat':    `*Lokasi:*\n${config.address}\n\nMaps: ${config.gmapsUrl}\n\nBuka 24 Jam!`,
    };

    if (cmds[command]) {
        await sendMessageWTyping(sock, sender, { text: cmds[command] }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', cmds[command]);
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

startBot().catch(err => {
    logger.fatal({ err }, 'Gagal memulai bot.');
    process.exit(1);
});