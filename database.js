// File: database.js
// Database layer using @seald-io/nedb (pure JavaScript, zero native compilation)
// Compatible with Termux, Windows, macOS, Linux without build tools

const Datastore = require('@seald-io/nedb');
const path = require('path');

// === DATASTORES (satu file per "tabel") ===
const DB = {
    customers:    new Datastore({ filename: path.join(__dirname, 'data', 'customers.db'),    autoload: true }),
    history:      new Datastore({ filename: path.join(__dirname, 'data', 'history.db'),      autoload: true }),
    receipts:     new Datastore({ filename: path.join(__dirname, 'data', 'receipts.db'),     autoload: true }),
    users:        new Datastore({ filename: path.join(__dirname, 'data', 'users.db'),        autoload: true }),
    ai_configs:   new Datastore({ filename: path.join(__dirname, 'data', 'ai_configs.db'),  autoload: true }),
    products:     new Datastore({ filename: path.join(__dirname, 'data', 'products.db'),     autoload: true }),
    alerts:       new Datastore({ filename: path.join(__dirname, 'data', 'alerts.db'),       autoload: true }),
    faqs:         new Datastore({ filename: path.join(__dirname, 'data', 'faqs.db'),         autoload: true }),
};

// Helper: jalankan NeDB callback sebagai Promise
function run(store, method, ...args) {
    return new Promise((resolve, reject) => {
        store[method](...args, (err, result) => {
            if (err) return reject(err);
            resolve(result);
        });
    });
}

// === INISIALISASI ===
const initializeDatabase = async () => {
    // Buat folder data jika belum ada
    const fs = require('fs');
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Compact semua store saat startup
    Object.values(DB).forEach(store => {
        try { store.persistence.compactDatafile(); } catch (_) {}
    });

    // Seed default admin jika belum ada
    const adminExists = await run(DB.users, 'findOne', { _id: 'admin' });
    if (!adminExists) {
        await run(DB.users, 'insert', { _id: 'admin', username: 'admin', password: 'admin123' });
    }

    // Seed default AI config jika belum ada
    const configExists = await run(DB.ai_configs, 'findOne', { user_id: 'admin' });
    if (!configExists) {
        await run(DB.ai_configs, 'insert', {
            user_id: 'admin',
            provider: 'groq',
            api_key: '',
            model_name: 'llama-3.3-70b-versatile',
            system_prompt: 'Anda adalah asisten virtual Customer Service. Jawab dengan ramah, informatif, dan ringkas.',
            business_name: 'Nama Bisnis Anda',
            company_email: '',
            company_address: '',
            company_social: '',
            company_maps: '',
            business_context: ''
        });
    }

    console.log('[DB] NeDB datastores siap. Data tersimpan di ./data/');
};

// === CUSTOMERS ===
const getOrAddCustomer = async (phoneNumber) => {
    let customer = await run(DB.customers, 'findOne', { phone_number: phoneNumber });
    if (customer) return { customer, isNew: false };

    const now = new Date().toISOString();
    customer = await run(DB.customers, 'insert', {
        phone_number: phoneNumber,
        name: null,
        first_seen: now
    });
    return { customer, isNew: true };
};

const updateCustomerName = async (phoneNumber, newName) => {
    return run(DB.customers, 'update',
        { phone_number: phoneNumber },
        { $set: { name: newName } },
        {}
    );
};

// === MESSAGE HISTORY ===
const addMessageToHistory = async (jid, role, content) => {
    const doc = await run(DB.history, 'insert', {
        jid, role, content,
        timestamp: new Date().toISOString()
    });

    // Hapus history lebih dari 50 pesan per JID
    const all = await run(DB.history, 'find', { jid });
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (all.length > 50) {
        const toDelete = all.slice(0, all.length - 50).map(r => r._id);
        await run(DB.history, 'remove', { _id: { $in: toDelete } }, { multi: true });
    }

    return doc;
};

const getHistoryForJid = async (jid) => {
    const rows = await run(DB.history, 'find', { jid });
    rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last10 = rows.slice(-10);
    return last10.map(r => ({ role: r.role, content: r.content }));
};

// === READ RECEIPTS ===
const addReadReceipt = async (messageId) => {
    const exists = await run(DB.receipts, 'findOne', { _id: messageId });
    if (exists) return { changes: 0 };

    await run(DB.receipts, 'insert', { _id: messageId, ts: Date.now() });

    // Batasi 200 entri terakhir
    const all = await run(DB.receipts, 'find', {});
    all.sort((a, b) => a.ts - b.ts);
    if (all.length > 200) {
        const toDelete = all.slice(0, all.length - 200).map(r => r._id);
        await run(DB.receipts, 'remove', { _id: { $in: toDelete } }, { multi: true });
    }

    return { changes: 1 };
};

const isMessageRead = async (messageId) => {
    const doc = await run(DB.receipts, 'findOne', { _id: messageId });
    return !!doc;
};

// === AI CONFIG ===
const getAIConfig = async (userId) => {
    return run(DB.ai_configs, 'findOne', { user_id: userId });
};

const updateAIConfig = async (userId, config) => {
    const {
        provider, api_key, model_name, system_prompt, business_name,
        company_email, company_address, company_social, company_maps, business_context
    } = config;

    return run(DB.ai_configs, 'update',
        { user_id: userId },
        { $set: {
            provider, api_key, model_name, system_prompt, business_name,
            company_email, company_address, company_social, company_maps, business_context
        }},
        { upsert: true }
    );
};

// === PRODUCTS ===
const getProducts = async (userId) => {
    const products = await run(DB.products, 'find', { user_id: userId });
    products.sort((a, b) => a.kategori.localeCompare(b.kategori));
    // Normalisasi: tambah field 'id' agar frontend tetap bisa pakai
    return products.map(p => ({ ...p, id: p._id }));
};

const addProduct = async (userId, product) => {
    const { kategori, nama_produk, harga, keterangan } = product;
    const doc = await run(DB.products, 'insert', {
        user_id: userId, kategori, nama_produk,
        harga: parseInt(harga) || 0, keterangan: keterangan || ''
    });
    return { id: doc._id };
};

const updateProduct = async (id, userId, product) => {
    const { kategori, nama_produk, harga, keterangan } = product;
    return run(DB.products, 'update',
        { _id: id, user_id: userId },
        { $set: { kategori, nama_produk, harga: parseInt(harga) || 0, keterangan: keterangan || '' } },
        {}
    );
};

const deleteProduct = async (id, userId) => {
    return run(DB.products, 'remove', { _id: id, user_id: userId }, {});
};

// === FAQs ===
const getFaqs = async (userId) => {
    const faqs = await run(DB.faqs, 'find', { user_id: userId });
    faqs.sort((a, b) => a.command.localeCompare(b.command));
    return faqs.map(f => ({ ...f, id: f._id }));
};

const addFaq = async (userId, faq) => {
    const doc = await run(DB.faqs, 'insert', {
        user_id: userId,
        command: faq.command,
        response: faq.response
    });
    return { id: doc._id };
};

const updateFaq = async (id, userId, faq) => {
    return run(DB.faqs, 'update',
        { _id: id, user_id: userId },
        { $set: { command: faq.command, response: faq.response } },
        {}
    );
};

const deleteFaq = async (id, userId) => {
    return run(DB.faqs, 'remove', { _id: id, user_id: userId }, {});
};

// === SYSTEM ALERTS ===
const addSystemAlert = async (userId, message) => {
    const doc = await run(DB.alerts, 'insert', {
        user_id: userId,
        message,
        is_read: false,
        timestamp: new Date().toISOString()
    });

    // Batasi 20 alert terakhir per user
    const all = await run(DB.alerts, 'find', { user_id: userId });
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (all.length > 20) {
        const toDelete = all.slice(0, all.length - 20).map(r => r._id);
        await run(DB.alerts, 'remove', { _id: { $in: toDelete } }, { multi: true });
    }

    return { id: doc._id };
};

const getSystemAlerts = async (userId) => {
    const alerts = await run(DB.alerts, 'find', { user_id: userId });
    alerts.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return alerts.slice(0, 20).map(a => ({
        id: a._id,
        message: a.message,
        is_read: a.is_read ? 1 : 0,
        timestamp: a.timestamp
    }));
};

const markAlertsAsRead = async (userId) => {
    return run(DB.alerts, 'update',
        { user_id: userId, is_read: false },
        { $set: { is_read: true } },
        { multi: true }
    );
};

module.exports = {
    initializeDatabase,
    getOrAddCustomer, updateCustomerName,
    addMessageToHistory, getHistoryForJid,
    addReadReceipt, isMessageRead,
    getAIConfig, updateAIConfig,
    getProducts, addProduct, updateProduct, deleteProduct,
    getFaqs, addFaq, updateFaq, deleteFaq,
    addSystemAlert, getSystemAlerts, markAlertsAsRead
};