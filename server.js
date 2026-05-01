// server.js — Dashboard Web untuk WA Chatbot
// Semua data bisnis diinput user via form, bukan hardcode.

require('dotenv').config();
const express = require('express');
const path    = require('path');
const axios   = require('axios');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware auth sederhana (single-tenant local)
// Untuk multi-tenant: ganti dengan JWT / session
const mockAuth = (req, res, next) => {
    req.user = { id: 'admin' };
    next();
};

// ─── AI CONFIG ────────────────────────────────────────────────────
app.get('/api/ai-config', mockAuth, async (req, res) => {
    try {
        const config = await db.getAIConfig(req.user.id);
        res.json({ success: true, config });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/ai-config', mockAuth, async (req, res) => {
    try {
        await db.updateAIConfig(req.user.id, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── PRODUCTS ─────────────────────────────────────────────────────
app.get('/api/products', mockAuth, async (req, res) => {
    try {
        const products = await db.getProducts(req.user.id);
        res.json({ success: true, products });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/products', mockAuth, async (req, res) => {
    try {
        const result = await db.addProduct(req.user.id, req.body);
        res.json({ success: true, id: result.id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/products/:id', mockAuth, async (req, res) => {
    try {
        await db.updateProduct(req.params.id, req.user.id, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/products/:id', mockAuth, async (req, res) => {
    try {
        await db.deleteProduct(req.params.id, req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── FAQs ─────────────────────────────────────────────────────────
app.get('/api/faqs', mockAuth, async (req, res) => {
    try {
        const faqs = await db.getFaqs(req.user.id);
        res.json({ success: true, faqs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/faqs', mockAuth, async (req, res) => {
    try {
        const result = await db.addFaq(req.user.id, req.body);
        res.json({ success: true, id: result.id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/faqs/:id', mockAuth, async (req, res) => {
    try {
        await db.updateFaq(req.params.id, req.user.id, req.body);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/faqs/:id', mockAuth, async (req, res) => {
    try {
        await db.deleteFaq(req.params.id, req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── SYSTEM ALERTS ────────────────────────────────────────────────
app.get('/api/alerts', mockAuth, async (req, res) => {
    try {
        const alerts     = await db.getSystemAlerts(req.user.id);
        const unreadCount = alerts.filter(a => a.is_read === 0).length;
        res.json({ success: true, alerts, unreadCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/alerts/read', mockAuth, async (req, res) => {
    try {
        await db.markAlertsAsRead(req.user.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── FETCH AI MODELS ──────────────────────────────────────────────
app.post('/api/models', mockAuth, async (req, res) => {
    const { provider, api_key } = req.body;
    if (!api_key && provider !== 'openrouter') {
        return res.json({ success: false, error: 'API Key diperlukan.' });
    }
    try {
        let models = [];
        if (provider === 'groq') {
            const r = await axios.get('https://api.groq.com/openai/v1/models',
                { headers: { Authorization: `Bearer ${api_key}` } });
            models = r.data.data.map(m => m.id);
        } else if (provider === 'openai') {
            const r = await axios.get('https://api.openai.com/v1/models',
                { headers: { Authorization: `Bearer ${api_key}` } });
            models = r.data.data.map(m => m.id).filter(id => id.includes('gpt'));
        } else if (provider === 'openrouter') {
            const r = await axios.get('https://openrouter.ai/api/v1/models');
            models = r.data.data.map(m => m.id);
        } else if (provider === 'gemini') {
            const r = await axios.get(
                `https://generativelanguage.googleapis.com/v1beta/models?key=${api_key}`);
            models = r.data.models
                .map(m => m.name.replace('models/', ''))
                .filter(n => n.includes('gemini'));
        }
        models.sort();
        res.json({ success: true, models });
    } catch (err) {
        const msg = err.response?.data?.error?.message || err.message || 'Gagal mengambil model.';
        res.status(500).json({ success: false, error: msg });
    }
});

// ─── GOOGLE APPS SCRIPT (GAS) INTEGRATION ─────────────────────────
//
// GAS Web App bertindak sebagai "gerbang data" dari Google Workspace.
// Bot memanggil GAS URL untuk mengambil atau mengirim data ke Sheets.
//
// Endpoint ini dipanggil dari dashboard untuk:
//   1. TEST  — verifikasi koneksi ke GAS
//   2. SYNC PRODUCTS — tarik data dari Google Sheets → simpan ke local DB
//   3. SYNC ORDERS  — (opsional) kirim data pesanan ke Google Sheets

// Test koneksi ke GAS Web App
app.post('/api/gas/test', mockAuth, async (req, res) => {
    const { gas_url } = req.body;
    if (!gas_url) return res.json({ success: false, error: 'GAS URL kosong.' });

    try {
        const r = await axios.get(`${gas_url}?action=ping`, { timeout: 8000 });
        if (r.data?.status === 'ok') {
            res.json({ success: true, message: `Terhubung ke GAS. Spreadsheet: "${r.data.sheet_name || 'N/A'}"` });
        } else {
            res.json({ success: false, error: 'GAS merespons tapi format tidak dikenal.', raw: r.data });
        }
    } catch (err) {
        res.json({ success: false, error: `Gagal terhubung: ${err.message}` });
    }
});

// Sync produk dari Google Sheets → database lokal
app.post('/api/gas/sync-products', mockAuth, async (req, res) => {
    try {
        const config = await db.getAIConfig(req.user.id);
        if (!config?.gas_url) return res.json({ success: false, error: 'GAS URL belum dikonfigurasi.' });

        const r = await axios.get(`${config.gas_url}?action=getProducts`, { timeout: 15000 });

        if (!r.data?.products || !Array.isArray(r.data.products)) {
            return res.json({ success: false, error: 'Format data dari GAS tidak valid.' });
        }

        let synced = 0, errors = 0;
        for (const item of r.data.products) {
            // Validasi kolom wajib
            if (!item.nama_produk || !item.kategori) { errors++; continue; }
            try {
                await db.upsertProductFromGAS(req.user.id, {
                    kategori:    String(item.kategori).trim(),
                    nama_produk: String(item.nama_produk).trim(),
                    harga:       parseInt(item.harga) || 0,
                    keterangan:  item.keterangan ? String(item.keterangan).trim() : ''
                });
                synced++;
            } catch (_) { errors++; }
        }

        await db.addSystemAlert(req.user.id,
            `✅ Sync GAS selesai: ${synced} produk disinkronkan, ${errors} gagal.`);

        res.json({ success: true, synced, errors, total: r.data.products.length });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// Push pesanan/pesan ke Google Sheets (dipanggil dari bot jika perlu)
app.post('/api/gas/push-order', mockAuth, async (req, res) => {
    try {
        const config = await db.getAIConfig(req.user.id);
        if (!config?.gas_url) return res.json({ success: false, error: 'GAS URL belum dikonfigurasi.' });

        const payload = { ...req.body, timestamp: new Date().toISOString() };
        const r = await axios.post(`${config.gas_url}?action=addOrder`, payload, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

        res.json({ success: true, gas_response: r.data });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ─── START ─────────────────────────────────────────────────────────
db.initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`\n=========================================`);
        console.log(`🚀 Dashboard berjalan di http://localhost:${PORT}`);
        console.log(`=========================================\n`);
    });
});