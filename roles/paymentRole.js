const axios = require('axios');
const db = require('../database.js');
const { sendMessageWTyping, getMessageContent } = require('./utils.js');
const { getAIReply } = require('./aiRole.js');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

let TelegramBot;
try { TelegramBot = require('node-telegram-bot-api'); } catch (_) {}

const CONFIG = {
    telegramBotToken:   process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId:     process.env.TELEGRAM_CHAT_ID,
    n8nWebhookUrl:      process.env.N8N_WEBHOOK_URL,
};

let telegramBot;
if (TelegramBot && CONFIG.telegramBotToken && CONFIG.telegramChatId) {
    telegramBot = new TelegramBot(CONFIG.telegramBotToken, { polling: false });
}

async function forwardPaymentToN8N(sender, caption, imageBuffer) {
    if (!CONFIG.n8nWebhookUrl) return;
    try {
        await axios.post(CONFIG.n8nWebhookUrl, {
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
            await telegramBot.sendPhoto(CONFIG.telegramChatId, imageBuffer, { caption: text, parse_mode: 'Markdown' });
        } else {
            await telegramBot.sendMessage(CONFIG.telegramChatId, text, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        logger.error('[Telegram] Gagal kirim:', e.message);
    }
}

const handlePayment = async (sock, msg, sender, customerName, userId = 'admin') => {
    try {
        const caption     = getMessageContent(msg);
        const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
        const userHistory = await db.getHistoryForJid(sender);

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
            return true;
        } else {
            const question = caption || 'Saya mengirim gambar ini.';
            const reply    = await getAIReply(question, userHistory, customerName, userId);
            if (reply) {
                await sendMessageWTyping(sock, sender, { text: reply }, { quoted: msg });
                await db.addMessageToHistory(sender, 'user', question);
                await db.addMessageToHistory(sender, 'assistant', reply);
            }
            return true;
        }
    } catch (e) {
        logger.error('[GAMBAR] Error:', e.message);
    }
    return false;
};

module.exports = {
    handlePayment,
    sendTelegramNotification
};
