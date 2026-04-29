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

// Initialize DB and start server
db.initializeDatabase();
app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 Dashboard Web Berjalan di Port ${PORT}`);
    console.log(`👉 Buka: http://localhost:${PORT}`);
    console.log(`=========================================`);
});
