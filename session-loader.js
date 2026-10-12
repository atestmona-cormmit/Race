// session-loader.js
// يقرأ الجلسة من مجلد wolf-profile (المحمّل من سيكرت WOLF) ويلتقط الرموز من اتصال المتصفح

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const WOLF_URL = 'https://wolf.live';
const PROFILE_DIR = path.resolve('wolf-profile');
const CAPTURE_TIMEOUT = 45000;

let activeContext = null;

function maskToken(value) {
    if (!value) return 'غير موجود';
    const text = String(value);
    if (text.length <= 16) return `${text.slice(0, 4)}...${text.slice(-4)}`;
    return `${text.slice(0, 8)}...${text.slice(-8)}`;
}

function parseWsUrl(rawUrl) {
    if (!rawUrl.includes('token=')) return null;
    const u = new URL(rawUrl.replace(/^ws/, 'http'));
    const token = u.searchParams.get('token');
    if (!token) return null;
    return {
        v3APIToken: token,
        appCheckToken: u.searchParams.get('appCheckToken') || '',
        deviceToken: u.searchParams.get('deviceToken') || ''
    };
}

async function captureTokens(context) {
    const page = context.pages()[0] || await context.newPage();

    const wait = new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error('انتهت المهلة دون التقاط رموز الاتصال')),
            CAPTURE_TIMEOUT
        );
        page.on('websocket', ws => {
            const t = parseWsUrl(ws.url());
            if (t) {
                clearTimeout(timer);
                resolve(t);
            }
        });
    });

    await page.goto(WOLF_URL, { waitUntil: 'domcontentloaded' });
    return wait;
}

async function tryProfile() {
    console.log('🧩 المحاولة 1: الملف الشخصي (wolf-profile)');
    activeContext = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    return captureTokens(activeContext);
}

async function tryStorageState() {
    const statePath = path.join(PROFILE_DIR, 'storage-state.json');
    if (!fs.existsSync(statePath)) throw new Error('storage-state.json غير موجود');

    console.log('🧩 المحاولة 2: storage-state.json');
    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    activeContext = await browser.newContext({ storageState: statePath });
    activeContext._ownerBrowser = browser;
    return captureTokens(activeContext);
}

function readSnapshot() {
    const snapPath = path.join(PROFILE_DIR, 'tokens-snapshot.json');
    if (!fs.existsSync(snapPath)) return null;
    console.log('🧩 المحاولة 3: الرموز المحفوظة (قد تكون منتهية)');
    return JSON.parse(fs.readFileSync(snapPath, 'utf8'));
}

export async function closeSessionBrowser() {
    try {
        if (activeContext) {
            const owner = activeContext._ownerBrowser;
            await activeContext.close();
            if (owner) await owner.close();
            activeContext = null;
            console.log('🧹 تم إغلاق متصفح الجلسة');
        }
    } catch (err) {
        console.log('⚠️ تعذر إغلاق المتصفح:', err?.message || err);
    }
}

export async function loadSession() {
    console.log('');
    console.log('========================================');
    console.log('🔐 تحميل الجلسة من wolf-profile');
    console.log('========================================');

    if (!fs.existsSync(PROFILE_DIR)) {
        throw new Error('❌ مجلد wolf-profile غير موجود — تأكد من تحميل السيكرت WOLF');
    }

    let tokens = null;

    for (const attempt of [tryProfile, tryStorageState]) {
        try {
            tokens = await attempt();
            if (tokens) break;
        } catch (err) {
            console.log('⚠️', err?.message || err);
            await closeSessionBrowser();
        }
    }

    await closeSessionBrowser();

    if (!tokens) tokens = readSnapshot();

    if (!tokens?.v3APIToken) {
        throw new Error('❌ تعذر الحصول على الرموز — أعد تسجيل الدخول وارفع الجلسة من جديد');
    }

    console.log(`🔐 v3APIToken: ${maskToken(tokens.v3APIToken)}`);
    console.log(`🛡️ appCheckToken: ${maskToken(tokens.appCheckToken)}`);
    if (tokens.deviceToken) console.log(`📱 deviceToken: ${maskToken(tokens.deviceToken)}`);

    return {
        token: tokens.v3APIToken,
        appCheckToken: tokens.appCheckToken || '',
        deviceToken: tokens.deviceToken || '',
        device: 'web',
        isAppCheckEnabled: Boolean(tokens.appCheckToken),
        page: null
    };
}
