// File: database.js
// Pure JavaScript database using @seald-io/nedb
// Zero native compilation — works on Termux, Windows, macOS, Linux

const Datastore = require('@seald-io/nedb');
const path = require('path');
const fs   = require('fs');

// === DATASTORES ===
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB = {
    customers:  new Datastore({ filename: path.join(DATA_DIR, 'customers.db'),  autoload: true }),
    history:    new Datastore({ filename: path.join(DATA_DIR, 'history.db'),    autoload: true }),
    receipts:   new Datastore({ filename: path.join(DATA_DIR, 'receipts.db'),   autoload: true }),
    users:      new Datastore({ filename: path.join(DATA_DIR, 'users.db'),      autoload: true }),
    ai_configs: new Datastore({ filename: path.join(DATA_DIR, 'ai_configs.db'), autoload: true }),
    products:   new Datastore({ filename: path.join(DATA_DIR, 'products.db'),   autoload: true }),
    alerts:     new Datastore({ filename: path.join(DATA_DIR, 'alerts.db'),     autoload: true }),
    faqs:       new Datastore({ filename: path.join(DATA_DIR, 'faqs.db'),       autoload: true }),
};

// Helper promise wrapper
function run(store, method, ...args) {
    return new Promise((resolve, reject) => {
        store[method](...args, (err, result) => err ? reject(err) : resolve(result));
    });
}

// === INISIALISASI ===
const initializeDatabase = async () => {
    // Compact semua datastore saat startup
    Object.values(DB).forEach(s => { try { s.persistence.compactDatafile(); } catch (_) {} });

    // Default admin user
    const adminExists = await run(DB.users, 'findOne', { _id: 'admin' });
    if (!adminExists) {
        await run(DB.users, 'insert', { _id: 'admin', username: 'admin', password: 'admin123' });
    }

    // Default AI config — KOSONG, user isi sendiri via dashboard
    const configExists = await run(DB.ai_configs, 'findOne', { user_id: 'admin' });
    if (!configExists) {
        await run(DB.ai_configs, 'insert', {
            user_id:          'admin',
            provider:         'groq',
            api_key:          '',
            model_name:       'llama-3.3-70b-versatile',
            system_prompt:    '',
            business_name:    '',
            company_email:    '',
            company_address:  '',
            company_social:   '',
            company_maps:     '',
            business_context: '',
            gas_url:          '',
            gas_sheet_sync:   false
        });
    }

    console.log('[DB] NeDB siap. Data tersimpan di ./data/');
};

// === CUSTOMERS ===
const getOrAddCustomer = async (phoneNumber) => {
    let customer = await run(DB.customers, 'findOne', { phone_number: phoneNumber });
    if (customer) return { customer, isNew: false };
    const now = new Date().toISOString();
    customer   = await run(DB.customers, 'insert', { phone_number: phoneNumber, name: null, first_seen: now });
    return { customer, isNew: true };
};

const updateCustomerName = (phoneNumber, newName) =>
    run(DB.customers, 'update', { phone_number: phoneNumber }, { $set: { name: newName } }, {});

// === MESSAGE HISTORY ===
const addMessageToHistory = async (jid, role, content) => {
    const doc = await run(DB.history, 'insert', { jid, role, content, timestamp: new Date().toISOString() });
    const all = await run(DB.history, 'find', { jid });
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (all.length > 50) {
        const ids = all.slice(0, all.length - 50).map(r => r._id);
        await run(DB.history, 'remove', { _id: { $in: ids } }, { multi: true });
    }
    return doc;
};

const getHistoryForJid = async (jid) => {
    const rows = await run(DB.history, 'find', { jid });
    rows.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return rows.slice(-10).map(r => ({ role: r.role, content: r.content }));
};

// === READ RECEIPTS ===
const addReadReceipt = async (messageId) => {
    const exists = await run(DB.receipts, 'findOne', { _id: messageId });
    if (exists) return { changes: 0 };
    await run(DB.receipts, 'insert', { _id: messageId, ts: Date.now() });
    const all = await run(DB.receipts, 'find', {});
    all.sort((a, b) => a.ts - b.ts);
    if (all.length > 200) {
        const ids = all.slice(0, all.length - 200).map(r => r._id);
        await run(DB.receipts, 'remove', { _id: { $in: ids } }, { multi: true });
    }
    return { changes: 1 };
};

const isMessageRead = async (messageId) => !!(await run(DB.receipts, 'findOne', { _id: messageId }));

// === AI CONFIG ===
const getAIConfig = (userId) => run(DB.ai_configs, 'findOne', { user_id: userId });

const updateAIConfig = (userId, config) => {
    const {
        provider, api_key, model_name, system_prompt, business_name,
        company_email, company_address, company_social, company_maps,
        business_context, gas_url, gas_sheet_sync
    } = config;
    return run(DB.ai_configs, 'update',
        { user_id: userId },
        { $set: {
            provider, api_key, model_name, system_prompt, business_name,
            company_email, company_address, company_social, company_maps,
            business_context,
            gas_url:        gas_url        || '',
            gas_sheet_sync: gas_sheet_sync || false
        }},
        { upsert: true }
    );
};

// === PRODUCTS ===
const getProducts = async (userId) => {
    const rows = await run(DB.products, 'find', { user_id: userId });
    rows.sort((a, b) => a.kategori.localeCompare(b.kategori));
    return rows.map(p => ({ ...p, id: p._id }));
};

const addProduct = async (userId, product) => {
    const doc = await run(DB.products, 'insert', {
        user_id:    userId,
        kategori:   product.kategori,
        nama_produk: product.nama_produk,
        harga:      parseInt(product.harga) || 0,
        keterangan: product.keterangan || '',
        wa_product_id: null
    });
    return { id: doc._id };
};

const updateProduct = (id, userId, product) =>
    run(DB.products, 'update',
        { _id: id, user_id: userId },
        { $set: {
            kategori:    product.kategori,
            nama_produk: product.nama_produk,
            harga:       parseInt(product.harga) || 0,
            keterangan:  product.keterangan || ''
        }},
        {}
    );

const deleteProduct = (id, userId) =>
    run(DB.products, 'remove', { _id: id, user_id: userId }, {});

const updateWAProductId = (productLocalId, waProductId, userId) => {
    return run(DB.products, 'update',
        { _id: productLocalId, user_id: userId },
        { $set: { wa_product_id: waProductId } },
        {}
    );
};

const upsertProductFromGAS = async (userId, product) => {
    const existing = await run(DB.products, 'findOne', {
        user_id:    userId,
        nama_produk: product.nama_produk,
        kategori:   product.kategori
    });
    if (existing) {
        return updateProduct(existing._id, userId, product);
    }
    return addProduct(userId, product);
};

// === FAQs ===
const getFaqs = async (userId) => {
    const rows = await run(DB.faqs, 'find', { user_id: userId });
    rows.sort((a, b) => a.command.localeCompare(b.command));
    return rows.map(f => ({ ...f, id: f._id }));
};

const addFaq = async (userId, faq) => {
    const doc = await run(DB.faqs, 'insert', { user_id: userId, command: faq.command, response: faq.response });
    return { id: doc._id };
};

const updateFaq = (id, userId, faq) =>
    run(DB.faqs, 'update',
        { _id: id, user_id: userId },
        { $set: { command: faq.command, response: faq.response } },
        {}
    );

const deleteFaq = (id, userId) =>
    run(DB.faqs, 'remove', { _id: id, user_id: userId }, {});

// === SYSTEM ALERTS ===
const addSystemAlert = async (userId, message) => {
    const doc = await run(DB.alerts, 'insert', {
        user_id: userId, message, is_read: false, timestamp: new Date().toISOString()
    });
    const all = await run(DB.alerts, 'find', { user_id: userId });
    all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (all.length > 20) {
        const ids = all.slice(0, all.length - 20).map(r => r._id);
        await run(DB.alerts, 'remove', { _id: { $in: ids } }, { multi: true });
    }
    return { id: doc._id };
};

const getSystemAlerts = async (userId) => {
    const rows = await run(DB.alerts, 'find', { user_id: userId });
    rows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return rows.slice(0, 20).map(a => ({
        id:        a._id,
        message:   a.message,
        is_read:   a.is_read ? 1 : 0,
        timestamp: a.timestamp
    }));
};

const markAlertsAsRead = (userId) =>
    run(DB.alerts, 'update',
        { user_id: userId, is_read: false },
        { $set: { is_read: true } },
        { multi: true }
    );

// === EXPORTS ===
module.exports = {
    initializeDatabase,
    getOrAddCustomer, updateCustomerName,
    addMessageToHistory, getHistoryForJid,
    addReadReceipt, isMessageRead,
    getAIConfig, updateAIConfig,
    getProducts, addProduct, updateProduct, deleteProduct, upsertProductFromGAS,
    updateWAProductId,
    getFaqs, addFaq, updateFaq, deleteFaq,
    addSystemAlert, getSystemAlerts, markAlertsAsRead,
};
