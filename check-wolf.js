import wolfjs from 'wolf.js';
import { io } from 'socket.io-client';

import {
    loadSession,
    closeSessionBrowser
} from './session-loader.js';

const { WOLF, OnlineState } = wolfjs;

// ============================================================
// ⚙️ الإعدادات
// ============================================================

const settings = {
    // البوت الذي نراقب رسائله الخاصة
    gateA: 80277459,
    // الروم الذي نرسل إليه الأمر
    gateB: 224,
    // النص الذي نبحث عنه داخل رسالة gateA
    trigger: "Your animal is back to full energy!",
    // الأمر الذي سيتم إرساله إلى gateB
    action: "!س جلد خاص 51660277",
    // معرف حساب البوت الحالي
    myId: "51660277"
};

// ============================================================
// ⚙️ متغيرات الاتصال
// ============================================================

let service = null;
let socket = null;
let browserClosed = false;

// ============================================================
// أدوات مساعدة
// ============================================================

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ============================================================
// إغلاق آمن
// ============================================================

async function shutdown(code = 0) {
    console.log('');
    console.log('========================================');
    console.log('🛑 جاري إنهاء التشغيل...');
    console.log('========================================');

    try {
        if (socket) socket.disconnect();
    } catch {}

    try {
        if (service?.websocket?.socket) {
            service.websocket.socket.disconnect();
        }
    } catch {}

    try {
        if (!browserClosed) {
            browserClosed = true;
            await closeSessionBrowser();
        }
    } catch (err) {
        console.log('⚠️ تعذر إغلاق الجلسة:', err?.message || err);
    }

    console.log(`🏁 انتهى البرنامج — Code ${code}`);
    process.exit(code);
}

// ============================================================
// انتظار Authorization
// ============================================================

async function waitForSubscriber(timeoutMs = 60000) {
    const started = Date.now();
    console.log('⏳ انتظار Authorization...');

    while (Date.now() - started < timeoutMs) {
        if (service?.currentSubscriber?.id) {
            console.log('');
            console.log('========================================');
            console.log('✅ Authorization complete');
            console.log('========================================');
            console.log(`👤 الحساب: ${
                service.currentSubscriber.username ||
                service.currentSubscriber.nickname ||
                'غير معروف'
            }`);
            console.log(`🆔 ID: ${service.currentSubscriber.id}`);
            return true;
        }
        await sleep(500);
    }
    return false;
}

// ============================================================
// تهيئة WOLF Handlers
// ============================================================

async function initializeHandlers() {
    console.log('⚙️ تهيئة WOLF handlers...');
    await service.websocket.init();
    const count = Object.keys(service.websocket.handlers || {}).length;
    console.log(`⚙️ تم تحميل ${count} handlers`);
}

// ============================================================
// الاتصال باستخدام رموز GitHub
// ============================================================

async function connectUsingGitHubTokens(credentials) {
    const token = credentials?.token;
    const appCheckToken = credentials?.appCheckToken || '';
    const deviceToken = credentials?.deviceToken || '';

    const isAppCheckEnabled = Boolean(
        credentials?.isAppCheckEnabled ?? appCheckToken
    );

    if (!token) {
        throw new Error('لم يتم العثور على v3APIToken في tokens.json');
    }

    console.log('');
    console.log('========================================');
    console.log('🔐 بيانات الجلسة');
    console.log('========================================');
    console.log(`🔐 WOLF Token length: ${token.length}`);
    console.log(
        appCheckToken
            ? `🛡️ AppCheck length: ${appCheckToken.length}`
            : '⚠️ AppCheck Token غير موجود'
    );
    if (deviceToken) {
        console.log(`📱 DeviceToken length: ${deviceToken.length}`);
    }
    console.log('🛡️ App Check: ' + (isAppCheckEnabled ? 'enabled' : 'disabled'));
    console.log('========================================');

    // ========================================================
    // إنشاء WOLF
    // ========================================================

    service = new WOLF();
    service.config.framework.login.token = token;
    service.config.framework.login.onlineState = OnlineState.BUSY;

    if (appCheckToken) {
        service.config.framework.login.appCheckToken = appCheckToken;
    }

    // ========================================================
    // تهيئة Handlers
    // ========================================================

    await initializeHandlers();

    // ========================================================
    // إعداد الاتصال
    // ========================================================

    const connection = service._frameworkConfig?.get?.('connection');
    const host = connection?.host || 'https://v3-rc.palringo.com';
    const port = connection?.port ?? 443;

    // ★★★ الحل: نجبر device = 'web' بدل wjsframework
    const connectionDevice = 'web';

    console.log('');
    console.log('========================================');
    console.log('🔌 بدء اتصال WOLF');
    console.log('========================================');
    console.log(`🌐 Host: ${host}`);
    console.log(`🔌 Port: ${port}`);
    console.log(`📱 Device: ${connectionDevice}`);
    console.log('👻 Online State: INVISIBLE');

    // ========================================================
    // Socket.IO
    // ========================================================

    socket = io(`${host}:${port}`, {
        transports: ['websocket'],
        reconnection: true,
        autoConnect: false,
        query: {
            token,
            device: connectionDevice,
            state: service.config.framework.login.onlineState,
            version: connection?.version || undefined,
            isAppCheckEnabled: isAppCheckEnabled ? 'true' : 'false',
            appCheckToken: isAppCheckEnabled ? appCheckToken : undefined,
            deviceToken: deviceToken || undefined
        }
    });

    service.websocket.socket = socket;

    // ========================================================
    // Connected
    // ========================================================

    socket.on('connect', () => {
        console.log('');
        console.log('========================================');
        console.log('🔗 تم الاتصال بـ WOLF Socket.IO');
        console.log(`🔗 Connection ID: ${socket.id}`);
        console.log('👻 الحالة: Invisible');
        console.log('========================================');
    });

    socket.on('connect_error', error => {
        console.error('❌ Connection error:', error?.message || error);
    });

    socket.on('disconnect', reason => {
        console.log(`🔌 Connection closed: ${reason}`);
    });

    // ========================================================
    // تمرير أحداث WOLF إلى Handlers
    // ========================================================

    socket.onAny(async (eventName, data) => {
        try {
            if (eventName === 'group event update') return;

            const handler = service.websocket.handlers?.[eventName];
            if (!handler) return;

            await handler.process(data?.body ?? data);
        } catch (error) {
            console.error(
                `❌ Handler error [${eventName}]:`,
                error?.message || error
            );
        }
    });

    // ========================================================
    // الاتصال
    // ========================================================

    console.log('🔌 Connecting...');
    socket.connect();

    // ========================================================
    // انتظار Authorization
    // ========================================================

    const ready = await waitForSubscriber(60000);
    if (!ready) {
        throw new Error('WOLF اتصل لكن Authorization لم يكتمل.');
    }

    console.log('');
    console.log('🟢 WOLF جاهز لمراقبة الرسائل.');
}

// ============================================================
// إرسال الأمر إلى الروم
// ============================================================

async function executeAction() {
    try {
        console.log('🎯 محاولة تنفيذ الإرسال...');
        await service.messaging.sendGroupMessage(
            settings.gateB,
            settings.action
        );
        console.log(`🚀 تم الإرسال بنجاح إلى [${settings.gateB}]`);
    } catch (err) {
        console.error('❌ فشل الإرسال:', err?.message || err);
    }
}

// ============================================================
// إرسال أمر التدريب عند بدء التشغيل
// ============================================================

async function sendTrainingCommand() {
    try {
        await service.messaging.sendPrivateMessage(
            settings.gateA,
            '!س تدريب كل 1'
        );
        console.log(`✉️ تم إرسال أمر التدريب إلى [${settings.gateA}]`);
    } catch (err) {
        console.error('❌ فشل إرسال أمر التدريب:', err?.message || err);
    }
}

// ============================================================
// مراقبة الرسائل الخاصة
// ============================================================

function attachPrivateMessageListener() {
    service.on('message', async message => {
        try {
            if (message.isGroup) return;

            const senderId = message.authorId || message.sourceSubscriberId;
            const text = message.content || message.body || '';

            console.log(`📩 Private message | ${senderId}: ${text}`);

            if (String(senderId) === String(settings.gateA)) {
                if (text.includes(settings.trigger)) {
                    console.log('⚡ رصد رسالة الطاقة! جاري التنفيذ...');
                    await executeAction();
                }
            }
        } catch (err) {
            console.error('❌ خطأ في معالجة الرسالة الخاصة:', err?.message || err);
        }
    });
}

// ============================================================
// مراقبة رسائل الروم
// ============================================================

function attachGroupMessageListener() {
    service.on('message', async message => {
        try {
            if (!message.isGroup) return;

            const groupId =
                message.targetGroupId ||
                message.groupId ||
                message.group?.id;

            const text = message.content || message.body || '';

            if (String(groupId) !== String(settings.gateB)) return;
            if (!text.includes('ما زال السباق جاريًا')) return;
            if (!text.includes(settings.myId)) return;

            const match = text.match(/\d+/);
            const waitSeconds = match ? parseInt(match[0], 10) : 25;

            console.log(
                `⚠️ السباق جارٍ لـ [${settings.myId}]. انتظار ${waitSeconds} ثانية...`
            );

            setTimeout(async () => {
                console.log('🔄 انتهى الوقت. إعادة محاولة التنفيذ الآن...');
                await executeAction();
            }, (waitSeconds + 1) * 1000);
        } catch (err) {
            console.error('❌ خطأ في معالجة رسالة الروم:', err?.message || err);
        }
    });
}

// ============================================================
// تهيئة المهام بعد Authorization
// ============================================================

async function initializeTasks() {
    console.log('');
    console.log('========================================');
    console.log('⚙️ تهيئة مهام البوت');
    console.log('========================================');
    console.log(`🎯 Gate A: ${settings.gateA}`);
    console.log(`🏠 Gate B: ${settings.gateB}`);
    console.log(`🔎 Trigger: ${settings.trigger}`);
    console.log(`⚡ Action: ${settings.action}`);
    console.log(`🆔 My ID: ${settings.myId}`);

    try {
        await service.setOnlineState(OnlineState.BUSY);
        console.log('👻 تم ضبط الحالة إلى Invisible');
    } catch (err) {
        console.log('⚠️ تعذر ضبط الحالة عبر API:', err?.message || err);
    }

    attachPrivateMessageListener();
    attachGroupMessageListener();
    await sendTrainingCommand();

    console.log('');
    console.log('🟢 جميع المهام أصبحت فعالة.');
}

// ============================================================
// البرنامج الرئيسي
// ============================================================

async function main() {
    console.log('');
    console.log('========================================');
    console.log('🐺 WOLF Bot');
    console.log('🐺 wolf.js 2.7.10');
    console.log('📦 Tokens from: anaayaar-ops/too');
    console.log('========================================');
    console.log('');

    try {
        // ====================================================
        // 1. قراءة الرموز من GitHub
        // ====================================================

        console.log('🌐 قراءة الرموز من GitHub (too)...');
        const credentials = await loadSession();

        if (!credentials?.token) {
            throw new Error('لم يتم العثور على v3APIToken في tokens.json');
        }

        console.log('✅ تم العثور على v3APIToken');

        if (credentials.appCheckToken) {
            console.log(
                `🛡️ AppCheck length: ${credentials.appCheckToken.length}`
            );
            console.log('✅ تم العثور على App Check Token');
        } else {
            console.log('⚠️ لا يوجد App Check Token');
        }

        if (credentials.deviceToken) {
            console.log(
                `📱 DeviceToken length: ${credentials.deviceToken.length}`
            );
        }

        // ====================================================
        // 2. الاتصال
        // ====================================================

        await connectUsingGitHubTokens(credentials);

        // ====================================================
        // 3. تنفيذ المهام
        // ====================================================

        await initializeTasks();

        console.log('');
        console.log('========================================');
        console.log('🟢 البوت يعمل الآن');
        console.log('👻 الحالة: Invisible');
        console.log('========================================');

    } catch (err) {
        console.error('');
        console.error('========================================');
        console.error('❌ حصل خطأ');
        console.error('========================================');
        console.error(err?.stack || err?.message || err);
        await shutdown(1);
    }
}

// ============================================================
// إيقاف آمن
// ============================================================

process.on('SIGINT', async () => {
    await shutdown(0);
});

process.on('SIGTERM', async () => {
    await shutdown(0);
});

process.on('SIGHUP', async () => {
    await shutdown(0);
});

process.on('uncaughtException', err => {
    console.error('💥 UNCAUGHT EXCEPTION:', err?.stack || err);
});

process.on('unhandledRejection', err => {
    console.error('💥 UNHANDLED REJECTION:', err?.stack || err);
});

// ============================================================
// START
// ============================================================

main();
