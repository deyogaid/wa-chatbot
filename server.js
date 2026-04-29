const express = require('express');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Dummy authentication middleware for local preview
// In a real SaaS, this would use JWT or session cookies
const mockAuth = (req, res, next) => {
    req.user = { id: 'admin' };
    next();
};

// --- AI CONFIG ENDPOINTS ---

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
        res.json({ success: true, message: 'Configuration saved successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- PRODUCT ENDPOINTS ---

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
        res.json({ success: true, id: result.id, message: 'Product added successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/products/:id', mockAuth, async (req, res) => {
    try {
        await db.updateProduct(req.params.id, req.user.id, req.body);
        res.json({ success: true, message: 'Product updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/products/:id', mockAuth, async (req, res) => {
    try {
        await db.deleteProduct(req.params.id, req.user.id);
        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- FETCH MODELS ENDPOINT ---
const axios = require('axios');
app.post('/api/models', mockAuth, async (req, res) => {
    const { provider, api_key } = req.body;
    
    if (!api_key && provider !== 'openrouter') {
        return res.json({ success: false, error: 'API Key diperlukan untuk mengambil daftar model.' });
    }

    try {
        let models = [];
        if (provider === 'groq') {
            const response = await axios.get('https://api.groq.com/openai/v1/models', {
                headers: { Authorization: `Bearer ${api_key}` }
            });
            models = response.data.data.map(m => m.id);
        } else if (provider === 'openai') {
            const response = await axios.get('https://api.openai.com/v1/models', {
                headers: { Authorization: `Bearer ${api_key}` }
            });
            models = response.data.data.map(m => m.id).filter(id => id.includes('gpt'));
        } else if (provider === 'openrouter') {
            const response = await axios.get('https://openrouter.ai/api/v1/models');
            models = response.data.data.map(m => m.id);
        } else if (provider === 'gemini') {
            const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${api_key}`);
            models = response.data.models.map(m => m.name.replace('models/', '')).filter(name => name.includes('gemini'));
        } else {
            return res.json({ success: false, error: 'Provider tidak didukung.' });
        }
        
        // Urutkan model secara alfabet
        models.sort();
        res.json({ success: true, models });
    } catch (err) {
        let errorMsg = 'Gagal mengambil model. Periksa API Key Anda.';
        if (err.response && err.response.data && err.response.data.error) {
            errorMsg = err.response.data.error.message || err.response.data.error;
        }
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// Initialize DB and start server
db.initializeDatabase();
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Dashboard Web Berjalan di Port ${PORT}`);
    console.log(`👉 Buka: http://localhost:${PORT}`);
    console.log(`=========================================`);
});
