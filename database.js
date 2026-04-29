// File: database.js

let sqlite3;
try {
    sqlite3 = require('sqlite3').verbose();
} catch (err) {
    console.error('===========================================================');
    console.error('Gagal memuat modul sqlite3.');
    if (process.platform === 'android') {
        console.error('INFO TERMUX: Sepertinya Anda menjalankan bot ini di Termux.');
        console.error('Untuk menginstal sqlite3 di Termux, jalankan perintah berikut:');
        console.error('    npm run setup:termux');
        console.error('    ATAU');
        console.error('    pkg install -y python make clang && npm install sqlite3');
    } else {
        console.error('Harap jalankan: npm install');
    }
    console.error('===========================================================');
    process.exit(1);
}
const path = require('path');
const dbPath = path.resolve(__dirname, 'kartini_bot.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Koneksi database SQLite berhasil dibuat.');
    }
});

const initializeDatabase = () => {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY AUTOINCREMENT, phone_number TEXT UNIQUE NOT NULL, name TEXT, first_seen TEXT);`, (err) => {
            if (err) console.error("Error creating customers table", err.message);
            else console.log('Tabel "customers" siap digunakan.');
        });
        db.run(`CREATE TABLE IF NOT EXISTS message_history (id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);`, (err) => {
            if (err) console.error("Error creating message_history table", err.message);
            else console.log('Tabel "message_history" siap digunakan.');
        });
        db.run(`CREATE TABLE IF NOT EXISTS read_receipts (message_id TEXT PRIMARY KEY NOT NULL);`, (err) => {
            if (err) console.error("Error creating read_receipts table", err.message);
            else console.log('Tabel "read_receipts" siap digunakan.');
        });
        
        // --- TABEL SAAS & KONFIGURASI AI ---
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT
        );`, (err) => {
            if (!err) {
                // Insert default admin for local preview
                db.run(`INSERT OR IGNORE INTO users (id, username, password) VALUES ('admin', 'admin', 'admin123')`);
                console.log('Tabel "users" siap digunakan.');
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS ai_configs (
            user_id TEXT PRIMARY KEY,
            provider TEXT DEFAULT 'groq',
            api_key TEXT,
            model_name TEXT DEFAULT 'llama-3.3-70b-versatile',
            system_prompt TEXT,
            business_name TEXT DEFAULT 'Nama Bisnis Anda'
        );`, (err) => {
            if (!err) {
                // Insert default config for admin
                const defaultPrompt = "Anda adalah asisten virtual Customer Service. Jawab dengan ramah, informatif, dan ringkas. Selalu gunakan daftar harga yang diberikan.";
                db.run(`INSERT OR IGNORE INTO ai_configs (user_id, system_prompt) VALUES ('admin', ?)`, [defaultPrompt]);
                console.log('Tabel "ai_configs" siap digunakan.');
            }
        });

        db.run(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            kategori TEXT NOT NULL,
            nama_produk TEXT NOT NULL,
            harga INTEGER NOT NULL,
            keterangan TEXT
        );`, (err) => {
            if (!err) {
                console.log('Tabel "products" siap digunakan.');
            }
        });
    });
};

const getOrAddCustomer = (phoneNumber) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM customers WHERE phone_number = ?`, [phoneNumber], (err, row) => {
            if (err) return reject(err);
            if (row) {
                resolve({ customer: row, isNew: false });
            } else {
                const now = new Date().toISOString();
                db.run(`INSERT INTO customers (phone_number, first_seen) VALUES (?, ?)`, [phoneNumber, now], function(err) {
                    if (err) return reject(err);
                    resolve({ customer: { id: this.lastID, phone_number: phoneNumber, name: null, first_seen: now }, isNew: true });
                });
            }
        });
    });
};

const updateCustomerName = (phoneNumber, newName) => {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE customers SET name = ? WHERE phone_number = ?`, [newName, phoneNumber], function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
};

const addMessageToHistory = (jid, role, content) => {
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO message_history (jid, role, content) VALUES (?, ?, ?)`, [jid, role, content], function(err) {
            if (err) return reject(err);
            db.run(`DELETE FROM message_history WHERE id IN (SELECT id FROM message_history WHERE jid = ? ORDER BY timestamp ASC LIMIT -1 OFFSET 50)`, [jid]);
            resolve({ id: this.lastID });
        });
    });
};

const getHistoryForJid = (jid) => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT role, content FROM message_history WHERE jid = ? ORDER BY timestamp DESC LIMIT 10`, [jid], (err, rows) => {
            if (err) return reject(err);
            resolve(rows.reverse());
        });
    });
};

const addReadReceipt = (messageId) => {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR IGNORE INTO read_receipts (message_id) VALUES (?)`, [messageId], function(err) {
            if (err) return reject(err);
            db.run(`DELETE FROM read_receipts WHERE message_id IN (SELECT message_id FROM read_receipts ORDER BY rowid ASC LIMIT -1 OFFSET 200)`);
            resolve({ changes: this.changes });
        });
    });
};

const isMessageRead = (messageId) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT 1 FROM read_receipts WHERE message_id = ? LIMIT 1`, [messageId], (err, row) => {
            if (err) return reject(err);
            resolve(!!row);
        });
    });
};

// --- SAAS HELPERS ---
const getAIConfig = (userId) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM ai_configs WHERE user_id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

const updateAIConfig = (userId, config) => {
    return new Promise((resolve, reject) => {
        const { provider, api_key, model_name, system_prompt, business_name } = config;
        db.run(
            `UPDATE ai_configs SET provider = ?, api_key = ?, model_name = ?, system_prompt = ?, business_name = ? WHERE user_id = ?`,
            [provider, api_key, model_name, system_prompt, business_name, userId],
            function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            }
        );
    });
};

const getProducts = (userId) => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM products WHERE user_id = ? ORDER BY kategori ASC`, [userId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
};

const addProduct = (userId, product) => {
    return new Promise((resolve, reject) => {
        const { kategori, nama_produk, harga, keterangan } = product;
        db.run(
            `INSERT INTO products (user_id, kategori, nama_produk, harga, keterangan) VALUES (?, ?, ?, ?, ?)`,
            [userId, kategori, nama_produk, harga, keterangan],
            function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID });
            }
        );
    });
};

const updateProduct = (id, userId, product) => {
    return new Promise((resolve, reject) => {
        const { kategori, nama_produk, harga, keterangan } = product;
        db.run(
            `UPDATE products SET kategori = ?, nama_produk = ?, harga = ?, keterangan = ? WHERE id = ? AND user_id = ?`,
            [kategori, nama_produk, harga, keterangan, id, userId],
            function(err) {
                if (err) reject(err);
                else resolve({ changes: this.changes });
            }
        );
    });
};

const deleteProduct = (id, userId) => {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM products WHERE id = ? AND user_id = ?`, [id, userId], function(err) {
            if (err) reject(err);
            else resolve({ changes: this.changes });
        });
    });
};

module.exports = { 
    initializeDatabase, getOrAddCustomer, updateCustomerName, addMessageToHistory, 
    getHistoryForJid, addReadReceipt, isMessageRead,
    getAIConfig, updateAIConfig, getProducts, addProduct, updateProduct, deleteProduct
};