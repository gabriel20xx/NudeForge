import svgCaptcha from 'svg-captcha';
import crypto from 'crypto';
import Logger from '../utils/logger.js';

// In-memory store for CAPTCHA tokens and solutions
const captchaStore = {};

function generateCaptcha(req, res) {
    const captcha = svgCaptcha.create({
        size: 6,
        noise: 4,
        color: true,
        background: '#f2f2f2',
        width: 180,
        height: 60,
        fontSize: 48,
        ignoreChars: '0o1ilI',
    });
    const token = crypto.randomBytes(16).toString('hex');
    captchaStore[token] = captcha.text;
    setTimeout(() => { delete captchaStore[token]; }, 180000); // 3-minute expiry
    res.type('json').send({
        token,
        image: captcha.data
    });
}

function verifyCaptcha(req, res, next) {
    function isLocalOrPrivate(ip) {
        if (!ip) return false;
        if (ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
        if (ip === '127.0.0.1' || ip === '::1' || req.hostname === 'localhost') return true;
        if (ip.startsWith('10.')) return true;
        if (ip.startsWith('172.')) {
            const second = parseInt(ip.split('.')[1], 10);
            if (second >= 16 && second <= 31) return true;
        }
        if (ip.startsWith('192.168.')) return true;
        return false;
    }

    const isLocal = isLocalOrPrivate(req.ip);
    if (isLocal || process.env.CAPTCHA_DISABLED === 'true') {
        return next();
    }

    const { captcha_answer, captcha_token } = req.body;

    if (!captcha_answer || !captcha_token || !captchaStore[captcha_token] || captchaStore[captcha_token].toLowerCase() !== captcha_answer.trim().toLowerCase()) {
        Logger.error('CAPTCHA', `CAPTCHA failed or missing. Token: ${captcha_token}, Answer: ${captcha_answer}`);
        if (captcha_token) {
            delete captchaStore[captcha_token];
        }
        return res.status(400).send("CAPTCHA validation failed.");
    }

    delete captchaStore[captcha_token];
    next();
}

export { generateCaptcha, verifyCaptcha };
