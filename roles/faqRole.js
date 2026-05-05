const db = require('../database.js');
const { sendMessageWTyping } = require('./utils.js');

const handleFAQ = async (sock, msg, text, command, sender, userId = 'admin') => {
    const faqs = await db.getFaqs(userId);
    const matchedFaq = faqs.find(f => f.command.toLowerCase() === command);
    if (matchedFaq) {
        await sendMessageWTyping(sock, sender, { text: matchedFaq.response }, { quoted: msg });
        await db.addMessageToHistory(sender, 'user', text);
        await db.addMessageToHistory(sender, 'assistant', matchedFaq.response);
        return true;
    }
    return false;
};

module.exports = {
    handleFAQ
};
