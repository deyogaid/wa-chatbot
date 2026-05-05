const db = require('../database.js');
const { sendMessageWTyping, sendMenuWithButtons, getBusinessName } = require('./utils.js');

const handleSystemCommands = async (sock, msg, text, command, sender, customerName, isNew, userId = 'admin') => {
    // Sambut pelanggan baru
    if (isNew) {
        const businessName = await getBusinessName(userId);
        const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
        const greet = hour < 11 ? 'Selamat Pagi' : hour < 15 ? 'Selamat Siang' : hour < 19 ? 'Selamat Sore' : 'Selamat Malam';

        const welcomeMsg = `${greet} Kak! Selamat datang di *${businessName}* 👋\n\nAda yang bisa kami bantu? Langsung ketik pertanyaan Anda ya!`;
        await sendMenuWithButtons(sock, sender, welcomeMsg, { quoted: msg });
        await db.addMessageToHistory(sender, 'assistant', '[Pesan sambutan awal]');
        return true;
    }

    // Perintah navigasi
    if (['/menu', '/bantuan', '/help', 'menu', 'halo', 'hai', 'hi', 'p'].includes(command)) {
        const businessName = await getBusinessName(userId);
        await sendMessageWTyping(sock, sender, {
            text: `Halo${customerName ? ` Kak ${customerName}` : ''}! 👋 Ada yang bisa dibantu di *${businessName}*?\n\nSilakan ketik pertanyaan Anda langsung ya!`
        }, { quoted: msg });
        return true;
    }

    // Simpan nama
    if (command.startsWith('/simpan-nama ') || command.startsWith('nama saya ')) {
        const prefix = command.startsWith('/simpan-nama ') ? 13 : 9;
        const nama   = text.substring(prefix).trim();
        if (nama) {
            await db.updateCustomerName(sender, nama);
            const res = `✅ Nama *${nama}* sudah tersimpan. Senang melayani Anda!`;
            await sendMessageWTyping(sock, sender, { text: res }, { quoted: msg });
            await db.addMessageToHistory(sender, 'assistant', res);
        }
        return true;
    }

    return false; // Bukan system command
};

module.exports = {
    handleSystemCommands
};
