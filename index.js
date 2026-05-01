// =================================================================
// WA CHATBOT - UNIVERSAL CS BOT (Modular Architecture)
// Compatible: Linux, macOS, Windows, Android (Termux)
// =================================================================

require('dotenv').config();
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const { Boom }    = require('@hapi/boom');
const pino        = require('pino');
const qrcode      = require('qrcode-terminal');
const db          = require('./database.js');
const router      = require('./router.js');
const { summarizeConversation } = require('./roles/aiRole.js');
const { sendTelegramNotification } = require('./roles/paymentRole.js');

const CONFIG = {
    ownerPauseDuration: (parseInt(process.env.OWNER_PAUSE_MINUTES) || 5) * 60 * 1000,
};

const logger = pino({ transport: { target: 'pino-pretty' } });
const userActivityCache = {};

// =================================================================
// EVENT HANDLERS
// =================================================================
const handleConnectionUpdate = (sock) => ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'close') {
        const reconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger.warn(`[WA] Koneksi terputus. Reconnect: ${reconnect}`);
        if (reconnect) setTimeout(startBot, 5000);
        else logger.fatal('[WA] Sesi tidak valid. Hapus auth_info_baileys/ dan scan ulang.');
    } else if (connection === 'open') {
        logger.info('[WA] ✅ Bot tersambung dan siap!');
    }
};

const handleMessagesUpsert = (sock) => async ({ messages }) => {
    const msg = messages[0];
    await router.handleIncomingMessage(sock, msg, userActivityCache, CONFIG);
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
                userActivityCache[id] = Date.now() + CONFIG.ownerPauseDuration;
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

app.post('/connect', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone)        return res.json({ error: 'Nomor tidak boleh kosong' });
        if (!currentSock)  return res.json({ error: 'Bot belum siap' });
        const code = await currentSock.requestPairingCode(phone);
        res.json({ success: true, pairing_code: code });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.get('/', (req, res) => res.send('✅ Bot aktif'));

const BOT_PORT = process.env.BOT_PORT || 3001;
app.listen(BOT_PORT, () => logger.info(`[BOT] Server berjalan di port ${BOT_PORT}`));