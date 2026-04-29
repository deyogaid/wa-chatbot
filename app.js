// =================================================================
// KARTINI DIGITAL PRINTING - WHATSAPP BOT V3.7 (FIXED ALL AI ERRORS)
// Dibuat dengan Baileys + Gemini 2.0 (Utama) + OpenAI + OpenRouter (Fallback)
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
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { OpenAI } = require("openai");
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const db = require('./database.js');
const priceData = require('./pricelist.js');

// =================================================================
// 2. CONFIGURATION
// =================================================================
const config = {
    // --- API Keys ---
    openaiApiKey:     process.env.OPENAI_API_KEY,
    geminiApiKey:     process.env.GEMINI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,

    // --- Model AI ---
    // FIX #1: Ganti gemini-1.5-flash -> gemini-2.0-flash (model aktif terbaru)
    geminiModel: process.env.GEMINI_MODEL || "gemini-2.0-flash",

    // FIX #3: Daftar model OpenRouter sebagai cadangan (dicoba urut dari atas)
    // Jika model pertama tidak ada endpoint-nya, otomatis coba model berikutnya
    openrouterModels: (process.env.OPENROUTER_MODEL
        ? [process.env.OPENROUTER_MODEL]
        : [
            "mistralai/mistral-7b-instruct:free",
            "google/gemma-2-9b-it:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "qwen/qwen-2-7b-instruct:free",
            "microsoft/phi-3-mini-128k-instruct:free",
        ]
    ),

    // --- Integrasi Eksternal ---
    n8nWebhookUrl:    process.env.N8N_WEBHOOK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:   process.env.TELEGRAM_CHAT_ID,

    // --- Informasi Bisnis ---
    businessName: "KARTINI DIGITAL PRINTING 24 JAM",
    email:        "kartinidigitalprinting24jam@gmail.com",
    instagram:    "kartinidigitalprinting",
    address:      "Jl. Kartini No.5, Depok, Kec. Pancoran Mas, Kota Depok, Jawa Barat 16436",
    gmapsUrl:     "https://maps.app.goo.gl/yourmaplink",

    // --- Pengaturan Bot ---
    ownerPauseDuration: 5 * 60 * 1000,
};

const logger = pino({ transport: { target: 'pino-pretty' } });

if (!config.geminiApiKey) {
    logger.fatal('Kesalahan: GEMINI_API_KEY tidak diatur. Program berhenti.');
    process.exit(1);
}

// --- Inisialisasi Klien AI ---
const genAI = new GoogleGenerativeAI(config.geminiApiKey);
logger.info(`Google Gemini siap (model: ${config.geminiModel}).`);

const openai = new OpenAI({ apiKey: config.openaiApiKey || "dummy-key", timeout: 30 * 1000 });
if (config.openaiApiKey) {
    logger.info('OpenAI siap sebagai Fallback 1.');
} else {
    logger.warn('OPENAI_API_KEY tidak diatur. OpenAI Fallback dilewati.');
}

const openrouter = new OpenAI({
    apiKey: config.openrouterApiKey || "dummy-key",
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 30 * 1000,
    defaultHeaders: {
        "HTTP-Referer": "https://kartinidigitalprinting.com",
        "X-Title": config.businessName,
    },
});
if (config.openrouterApiKey) {
    logger.info(`OpenRouter siap sebagai Fallback 2. Model cadangan: [${config.openrouterModels.join(', ')}]`);
} else {
    logger.warn('OPENROUTER_API_KEY tidak diatur. OpenRouter Fallback dilewati.');
}

let telegramBot;
if (config.telegramBotToken && config.telegramChatId) {
    telegramBot = new TelegramBot(config.telegramBotToken, { polling: false });
    logger.info('Notifikasi Telegram aktif.');
}

const userActivityCache = {};

// =================================================================
// 3. SYSTEM PROMPT
// =================================================================
function formatPriceListForAI(data) {
    let priceText = "";
    const categories = {};
    data.produk.forEach(p => {
        if (!categories[p.kategori]) categories[p.kategori] = [];
        const priceFormatted = p.harga.toLocaleString('id-ID');
        const description = p.keterangan ? `(${p.keterangan})` : '';
        categories[p.kategori].push(`- ${p.nama_produk} ${description}: Rp${priceFormatted}`);
    });
    for (const category in categories) {
        priceText += `\nKategori: *${category}*\n${categories[category].join('\n')}\n`;
    }
    return priceText;
}

const priceListString = formatPriceListForAI(priceData);

const systemPromptContent = `Anda adalah asisten virtual Customer Service untuk "${config.businessName}". Peran Anda adalah melayani pelanggan dengan informatif, profesional, ramah, dan efisien.

ATURAN UTAMA:
1. JAWAB SINGKAT & JELAS: Selalu berikan jawaban yang singkat dan langsung ke intinya.
2. GUNAKAN DAFTAR HARGA: Jangan pernah menebak harga. Berikan harga PASTI sesuai daftar.
3. SAPA DENGAN PERSONAL: Selalu sapa pelanggan dengan nama dan waktu yang sesuai.
4. KEMAMPUAN MATEMATIKA: Anda bisa melakukan perhitungan dasar terkait pesanan (misal: luas x harga per meter).

--- DAFTAR HARGA RESMI ---
${priceListString}
--- AKHIR DAFTAR HARGA ---`;

// =================================================================
// 4. HELPER FUNCTIONS
// =================================================================
const sendMessageWTyping = async (sock, jid, content, options = {}) => {
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1200);
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, content, options);
};

const getMessageContent = (msg) => {
    return (
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        ""
    );
};

// =================================================================
// 5. FUNGSI AI
// =================================================================

/**
 * FIX #3: Coba semua model OpenRouter satu per satu sampai berhasil.
 * Jika model pertama 404, otomatis lanjut ke model berikutnya.
 */
async function tryOpenRouterModels(messages) {
    for (const model of config.openrouterModels) {
        try {
            logger.info(`   Mencoba OpenRouter model: ${model}`);
            const response = await openrouter.chat.completions.create({ model, messages });
            const reply = response.choices[0]?.message?.content?.trim();
            if (reply) {
                logger.info(`   Berhasil dengan model: ${model}`);
                return reply;
            }
        } catch (err) {
            const isNotFound = err.message?.includes('404') || err.message?.includes('No endpoints');
            logger.warn(`   Model ${model} gagal: ${isNotFound ? 'Tidak tersedia (404), coba model berikutnya...' : err.message}`);
            if (!isNotFound) break; // Error bukan 404? Berhenti, jangan coba model lain
        }
    }
    return null;
}

/**
 * getAIReply — Sistem fallback AI 3 lapis:
 * Gemini 2.0-flash -> OpenAI gpt-4o-mini -> OpenRouter (semua model dicoba)
 */
async function getAIReply(userText, history = [], customerName = null) {
    const now = new Date();
    const wibTimeOptions = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    const wibDateOptions = { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' };

    // Prompt lengkap untuk Gemini
    let fullPrompt = systemPromptContent;
    fullPrompt += `\n\n[Konteks Waktu]: Hari ${now.toLocaleDateString('id-ID', wibDateOptions)}, pukul ${now.toLocaleTimeString('id-ID', wibTimeOptions)} WIB.`;
    if (customerName) fullPrompt += `\n[Konteks Pelanggan]: Nama pelanggan adalah "${customerName}".`;
    fullPrompt += "\n\n--- RIWAYAT PERCAKAPAN ---\n";
    if (history.length > 0) {
        history.forEach(msg => { fullPrompt += `${msg.role === 'user' ? 'Pelanggan' : 'CS'}: ${msg.content}\n`; });
    } else {
        fullPrompt += "(Belum ada riwayat)\n";
    }
    fullPrompt += `\nPelanggan: ${userText}\nCS:`;

    // Format messages untuk OpenAI/OpenRouter
    const openAIMessages = [
        { role: "system", content: systemPromptContent },
        ...history,
        { role: "user", content: userText }
    ];

    // -------------------------------------------------------
    // LAPIS 1: Google Gemini (FIX: gunakan gemini-2.0-flash)
    // -------------------------------------------------------
    try {
        logger.info(`[AI-1] Menghubungi Gemini (${config.geminiModel})...`);
        const model = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent(fullPrompt);
        const reply = result.response.text()?.trim();
        if (reply) {
            logger.info("[AI-1] Gemini berhasil.");
            return reply;
        }
        throw new Error("Respons Gemini kosong.");
    } catch (geminiError) {
        logger.error({ err: geminiError.message }, "[AI-1] Gemini gagal. Mencoba OpenAI...");
    }

    // -------------------------------------------------------
    // LAPIS 2: OpenAI (hanya coba jika ada API key)
    // -------------------------------------------------------
    if (config.openaiApiKey) {
        try {
            logger.info("[AI-2] Menghubungi OpenAI gpt-4o-mini...");
            const response = await openai.chat.completions.create({ model: "gpt-4o-mini", messages: openAIMessages });
            const reply = response.choices[0]?.message?.content?.trim();
            if (reply) {
                logger.info("[AI-2] OpenAI berhasil.");
                return reply;
            }
            throw new Error("Respons OpenAI kosong.");
        } catch (openaiError) {
            const isQuota = openaiError.message?.includes('429') || openaiError.message?.includes('quota');
            logger.error(
                { err: openaiError.message },
                isQuota ? "[AI-2] OpenAI quota habis. Mencoba OpenRouter..." : "[AI-2] OpenAI error. Mencoba OpenRouter..."
            );
        }
    } else {
        logger.warn("[AI-2] OpenAI dilewati (tidak ada API key). Langsung ke OpenRouter...");
    }

    // -------------------------------------------------------
    // LAPIS 3: OpenRouter (FIX: coba semua model satu per satu)
    // -------------------------------------------------------
    if (config.openrouterApiKey) {
        logger.info("[AI-3] Menghubungi OpenRouter...");
        const reply = await tryOpenRouterModels(openAIMessages);
        if (reply) {
            logger.info("[AI-3] OpenRouter berhasil.");
            return reply;
        }
        logger.error("[AI-3] Semua model OpenRouter gagal.");
    } else {
        logger.warn("[AI-3] OpenRouter dilewati (tidak ada API key).");
    }

    // Semua lapis gagal
    logger.error("Semua lapis AI gagal. Mengirim pesan fallback ke pelanggan.");
    return "Maaf, sistem AI kami sedang mengalami kendala teknis. Tim kami akan merespon secara manual segera. Terima kasih atas kesabarannya!";
}

/**
 * summarizeConversation — Rangkum riwayat chat dengan fallback ke OpenRouter
 */
async function summarizeConversation(history) {
    if (!history || history.length === 0) return null;
    const conversationText = history
        .map(msg => `${msg.role === 'user' ? 'Pelanggan' : 'Bot'}: ${msg.content}`)
        .join('\n');
    const prompt = `Buatlah rangkuman singkat dalam poin-poin dari percakapan CS percetakan berikut:\n\n${conversationText}`;

    // Coba Gemini
    try {
        const model = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent(prompt);
        const summary = result.response.text()?.trim();
        if (summary) return summary;
    } catch (e) {
        logger.error({ err: e.message }, "[Rangkuman] Gemini gagal. Coba OpenRouter...");
    }

    // Fallback OpenRouter
    if (config.openrouterApiKey) {
        const reply = await tryOpenRouterModels([{ role: "user", content: prompt }]);
        if (reply) return reply;
    }

    return "Gagal membuat rangkuman otomatis.";
}

/**
 * classifyImageWithAI — Klasifikasi gambar dengan Gemini Vision
 */
async function classifyImageWithAI(imageBuffer) {
    const imageBase64 = imageBuffer.toString('base64');
    const prompt = `Analisis gambar ini. Balas HANYA dengan salah satu kata: 'bukti_pembayaran', 'dokumen', atau 'gambar_umum'.`;
    try {
        logger.info("Menganalisis gambar dengan Gemini Vision...");
        const model = genAI.getGenerativeModel({ model: config.geminiModel });
        const result = await model.generateContent([
            prompt,
            { inlineData: { data: imageBase64, mimeType: 'image/jpeg' } }
        ]);
        return result.response.text().trim().toLowerCase().replace(/['"`\s]/g, '');
    } catch (error) {
        logger.error({ err: error.message }, "Vision AI error. Default ke gambar_umum.");
        return 'gambar_umum';
    }
}

// =================================================================
// 6. INTEGRASI EKSTERNAL
// =================================================================
async function forwardPaymentToN8N(sender, caption, imageBuffer) {
    if (!config.n8nWebhookUrl) return false;
    try {
        await axios.post(config.n8nWebhookUrl, {
            sender: sender.split('@')[0],
            caption: caption || "Tidak ada caption",
            image_base64: imageBuffer.toString('base64'),
            timestamp: new Date().toISOString()
        }, { headers: { 'Content-Type': 'application/json' } });
        return true;
    } catch (error) {
        logger.error("Gagal forward ke n8n.");
        return false;
    }
}

async function sendTelegramNotification(messageText, imageBuffer = null) {
    if (!telegramBot) return;
    try {
        if (imageBuffer) {
            await telegramBot.sendPhoto(config.telegramChatId, imageBuffer, { caption: messageText, parse_mode: 'Markdown' });
        } else {
            await telegramBot.sendMessage(config.telegramChatId, messageText, { parse_mode: 'Markdown' });
        }
    } catch (error) {
        logger.error("Gagal kirim notifikasi Telegram.");
    }
}

async function sendMenuWithButtons(sock, jid, greeting, quoted = {}) {
    const buttonMessage = {
        text: greeting,
        footer: `© ${config.businessName}`,
        buttons: [
            { buttonId: '/layanan',   buttonText: { displayText: 'Info Layanan & Produk' }, type: 1 },
            { buttonId: '/carapesan', buttonText: { displayText: 'Cara Pemesanan'         }, type: 1 },
            { buttonId: '/alamat',    buttonText: { displayText: 'Lokasi Kami'             }, type: 1 }
        ],
        headerType: 1
    };
    await sendMessageWTyping(sock, jid, buttonMessage, { quoted });
}

// =================================================================
// 7. EVENT HANDLERS
// =================================================================
const handleConnectionUpdate = (sock) => ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn(`Koneksi terputus. Reconnect: ${shouldReconnect}`);
        if (shouldReconnect) setTimeout(startBot, 5000);
    } else if (connection === 'open') {
        logger.info(`Asisten CS ${config.businessName} tersambung dan siap!`);
    }
};

const handleMessagesUpsert = (sock) => async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    if (!sender || sender.endsWith('@g.us')) return;

    if (await db.isMessageRead(msg.key.id)) return;
    if (userActivityCache[sender] && Date.now() < userActivityCache[sender]) {
        logger.info(`Bot pause untuk ${sender}. Pesan diabaikan.`);
        return;
    }

    const { customer, isNew } = await db.getOrAddCustomer(sender);
    const customerName = customer?.name;

    if (msg.message.stickerMessage) return;

    // -------------------------------------------------------
    // Handler Gambar
    // -------------------------------------------------------
    if (msg.message.imageMessage) {
        try {
            const caption = getMessageContent(msg);
            const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
            const classification = await classifyImageWithAI(imageBuffer);
            const userHistory = await db.getHistoryForJid(sender);

            if (classification.includes('bukti_pembayaran')) {
                const replyText = `Terima kasih ${customerName ? 'Kak ' + customerName : 'Kak'}, bukti pembayaran telah kami terima! Pesanan Anda akan segera kami proses.`;
                await sendMessageWTyping(sock, sender, { text: replyText }, { quoted: msg });
                const telegramCaption = `*Bukti Pembayaran Masuk*\nDari: \`${sender.split('@')[0]}\`\nNama: ${customerName || 'N/A'}\nPesan: ${caption || '-'}`;
                await Promise.all([
                    forwardPaymentToN8N(sender, caption, imageBuffer),
                    sendTelegramNotification(telegramCaption, imageBuffer)
                ]);
            } else if (classification.includes('dokumen')) {
                await sendMessageWTyping(sock, sender, { text: `Terima kasih, dokumen Anda telah kami terima.` }, { quoted: msg });
            } else {
                const finalReply = await getAIReply(caption || "Saya mengirim sebuah gambar.", userHistory, customerName);
                if (finalReply) {
                    await sendMessageWTyping(sock, sender, { text: finalReply }, { quoted: msg });
                    await db.addMessageToHistory(sender, 'user', caption || "Kirim gambar");
                    await db.addMessageToHistory(sender, 'assistant', finalReply);
                }
            }
        } catch (error) {
            logger.error({ err: error.message }, "Error saat memproses gambar.");
        }
        return;
    }

    // -------------------------------------------------------
    // Handler Teks
    // -------------------------------------------------------
    const text = getMessageContent(msg).trim();
    if (!text) return;
    const command = text.toLowerCase();

    const navigationCommands = ['/menu', '/bantuan', '/help'];
    if (!navigationCommands.includes(command)) {
        await db.addMessageToHistory(sender, 'user', text);
    }

    // Sambut pelanggan baru
    if (isNew) {
        const hourNum = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
        const greeting = hourNum < 11 ? 'Selamat Pagi' : hourNum < 15 ? 'Selamat Siang' : hourNum < 19 ? 'Selamat Sore' : 'Selamat Malam';
        await sendMenuWithButtons(
            sock, sender,
            `${greeting} Kak! Selamat datang di *${config.businessName}*.\n\nAda yang bisa kami bantu hari ini?`,
            { quoted: msg }
        );
        await db.addMessageToHistory(sender, 'assistant', 'Kirim menu sambutan awal');
        return;
    }

    const commandHandlers = {
        '/layanan': `*Layanan Kami:*\n\n*Print Digital:*\n- Poster, Flyer, Brosur\n\n*Print Besar:*\n- Banner, Spanduk, Stiker Vinyl\n\n*Merchandise:*\n- Kaos, Mug, Totebag\n\nUntuk info harga detail, silakan tanyakan langsung!`,
        '/carapesan': `*Cara Pesan:*\n\n1. Kirim file desain ke email:\n*${config.email}*\n\n2. Konfirmasi spesifikasi (ukuran, material, jumlah) via chat ini.\n\n3. Lakukan pembayaran setelah kami konfirmasi total biaya.\n\n4. Pesanan diproses & siap dikirim/diambil!`,
        '/alamat': `*Lokasi Kami:*\n${config.address}\n\nGoogle Maps: ${config.gmapsUrl}\n\nBuka 24 Jam!`,
    };

    if (commandHandlers[command]) {
        await sendMessageWTyping(sock, sender, { text: commandHandlers[command] }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', commandHandlers[command]);
        return;
    }

    if (navigationCommands.includes(command)) {
        await sendMenuWithButtons(sock, sender, `Ada yang bisa kami bantu lagi, Kak?`, { quoted: msg });
        return;
    }

    if (command.startsWith('/simpan-nama ')) {
        const newName = text.substring(13).trim();
        if (newName.length > 0) {
            await db.updateCustomerName(sender, newName);
            const resText = `Terima kasih, Kak *${newName}*! Nama Anda sudah kami simpan.`;
            await sendMessageWTyping(sock, sender, { text: resText }, { quoted: msg });
            await db.addMessageToHistory(sender, 'assistant', resText);
        }
        return;
    }

    // Pesan bebas -> AI
    const userHistory = await db.getHistoryForJid(sender);
    const finalReply = await getAIReply(text, userHistory, customerName);
    if (finalReply) {
        await sendMessageWTyping(sock, sender, { text: finalReply }, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', finalReply);
    }
};

// =================================================================
// 8. MAIN BOT EXECUTION
// =================================================================
async function startBot() {
    await db.initializeDatabase();
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();
    logger.info(`Baileys WA v${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: state,
        // Penyesuaian Termux: Gunakan nama OS yang tepat dan hemat memori
        browser: process.platform === 'android' ? ['Termux', 'Chrome', '1.0.0'] : Browsers.ubuntu('Chrome'),
        generateHighQualityLinkPreview: false,
        logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', handleConnectionUpdate(sock));
    sock.ev.on('messages.upsert', handleMessagesUpsert(sock));

    sock.ev.on('presence.update', async ({ id, presences }) => {
        const presenceData = presences[sock.user?.id];
        if (presenceData?.lastKnownPresence === 'composing') {
            if (!userActivityCache[id] || Date.now() > userActivityCache[id]) {
                userActivityCache[id] = Date.now() + config.ownerPauseDuration;
                logger.info(`Owner mengetik ke ${id}. Bot di-pause 5 menit.`);
                const history = await db.getHistoryForJid(id);
                if (history?.length > 0) {
                    const summary = await summarizeConversation(history);
                    if (summary) {
                        const { customer } = await db.getOrAddCustomer(id);
                        await sendTelegramNotification(
                            `*Auto-Pause & Rangkuman*\nPelanggan: \`${id.split('@')[0]}\` (${customer?.name || 'N/A'})\n\n---\n${summary}`
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
}

startBot().catch(err => {
    logger.fatal({ err }, "Gagal memulai bot.");
    process.exit(1);
});