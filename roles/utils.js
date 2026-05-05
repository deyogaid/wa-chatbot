const { delay } = require('@whiskeysockets/baileys');
const db = require('../database.js');

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

const getBusinessName = async (userId = 'admin') => {
    const cfg = await db.getAIConfig(userId);
    return cfg?.business_name || 'Toko Kami';
};

const sendMenuWithButtons = async (sock, jid, greeting, options = {}) => {
    // Fallback teks biasa
    await sendMessageWTyping(sock, jid, { text: greeting }, options);
};

module.exports = {
    sendMessageWTyping,
    getMessageContent,
    getBusinessName,
    sendMenuWithButtons
};
