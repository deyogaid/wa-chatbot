const axios = require('axios');
const db = require('../database.js');
const pino = require('pino');
const logger = pino({ transport: { target: 'pino-pretty' } });

// Get GAS URL from DB
async function getGasUrl(userId = 'admin') {
    const config = await db.getAIConfig(userId);
    return config?.gas_url;
}

// 1. Simpan Data ke Sheet
async function saveToSheet(rowData, userId = 'admin') {
    const gasUrl = await getGasUrl(userId);
    if (!gasUrl) return false;

    const payload = {
        action: "sheet_write",
        payload: { rowData }
    };

    try {
        await axios.post(gasUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        return true;
    } catch (e) {
        logger.error('[GAS] Gagal saveToSheet:', e.message);
        return false;
    }
}

// 2. Upload Bukti TF (Gambar Base64) ke Drive
async function uploadToDrive(fileName, mimeType, base64Data, userId = 'admin') {
    const gasUrl = await getGasUrl(userId);
    if (!gasUrl) return false;

    const payload = {
        action: "drive_upload",
        payload: { 
            fileName, 
            mimeType, 
            base64: base64Data
        }
    };

    try {
        const res = await axios.post(gasUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        logger.info('[GAS] Gambar berhasil diunggah ke Google Drive');
        return res.data; // URL hasil upload jika GAS mengembalikan URL
    } catch (e) {
        logger.error('[GAS] Gagal uploadToDrive:', e.message);
        return false;
    }
}

// 3. Mengirim Email Eskalasi ke Admin via Gmail
async function sendEscalationEmail(subject, body, userId = 'admin') {
    const gasUrl = await getGasUrl(userId);
    if (!gasUrl) return false;

    const payload = {
        action: "gmail_send",
        payload: { subject, body }
    };

    try {
        await axios.post(gasUrl, payload, { headers: { 'Content-Type': 'application/json' } });
        return true;
    } catch (e) {
        logger.error('[GAS] Gagal sendEscalationEmail:', e.message);
        return false;
    }
}

module.exports = {
    saveToSheet,
    uploadToDrive,
    sendEscalationEmail
};
