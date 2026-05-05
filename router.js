const db = require('./database.js');
const { getMessageContent } = require('./roles/utils.js');
const { handleSystemCommands } = require('./roles/systemRole.js');
const { handleFAQ } = require('./roles/faqRole.js');
const { handlePayment } = require('./roles/paymentRole.js');
const { handleAI } = require('./roles/aiRole.js');
const workspaceService = require('./services/workspaceService.js');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

const handleIncomingMessage = async (sock, msg, userActivityCache, CONFIG) => {
    try {
        if (!msg?.message) return;

        // Owner Command Check (/pause)
        if (msg.key.fromMe) {
            const text = getMessageContent(msg).trim().toLowerCase();
            if (text === '/pause') {
                const jid = msg.key.remoteJid;
                userActivityCache[jid] = Date.now() + CONFIG.ownerPauseDuration;
                logger.info(`[PAUSE] Bot di-pause untuk ${jid} selama ${CONFIG.ownerPauseDuration / 60000} menit.`);
            }
            return;
        }

        const sender = msg.key.remoteJid;
        if (!sender || sender.endsWith('@g.us') || sender.endsWith('@broadcast')) return;
        if (await db.isMessageRead(msg.key.id)) return;

        // Cek Pause
        if (userActivityCache[sender] && Date.now() < userActivityCache[sender]) {
            logger.info(`[PAUSE] Pesan dari ${sender} diabaikan (owner mode).`);
            return;
        }

        // Init Customer DB
        const { customer, isNew } = await db.getOrAddCustomer(sender);
        const customerName = customer?.name || null;
        const userId = 'admin'; // Single-tenant

        if (msg.message.stickerMessage) return;

        // Tandai dibaca
        await db.addReadReceipt(msg.key.id);

        // ROUTING LOGIC
        // 1. Gambar -> PaymentRole
        if (msg.message.imageMessage) {
            await handlePayment(sock, msg, sender, customerName, userId);
            return;
        }

        const text    = getMessageContent(msg).trim();
        if (!text) return;
        const command = text.toLowerCase();
        logger.info(`[MSG] ${sender.split('@')[0]}: ${text.substring(0, 80)}`);

        // Log ke Google Sheet via GAS (non-blocking)
        const dateStr = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
        workspaceService.saveToSheet([dateStr, sender.split('@')[0], text], userId).catch(() => {});

        // 2. System Commands (/menu, /simpan-nama, isNew) -> SystemRole
        const isSystemHandled = await handleSystemCommands(sock, msg, text, command, sender, customerName, isNew, userId);
        if (isSystemHandled) return;

        // 3. FAQ Commands -> FaqRole
        const isFaqHandled = await handleFAQ(sock, msg, text, command, sender, userId);
        if (isFaqHandled) return;

        // 4. Default -> AIRole
        await handleAI(sock, msg, text, sender, customerName, userId);
        
    } catch (e) {
        logger.error('[ROUTER ERROR]', e);
    }
};

module.exports = {
    handleIncomingMessage
};
