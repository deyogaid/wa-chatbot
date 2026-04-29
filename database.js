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

module.exports = { initializeDatabase, getOrAddCustomer, updateCustomerName, addMessageToHistory, getHistoryForJid, addReadReceipt, isMessageRead };