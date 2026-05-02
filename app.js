/* ========================================
   رفيق الحفظ - App Logic v10.1 (Fixed Edition)
   ======================================== */

const STORAGE_KEYS = {
    THEME: 'quran_theme',
    PLAN: 'quran_plan',
    STATS: 'quran_stats',
    SETTINGS: 'quran_settings',
    CACHE: 'quran_cache',
    FEEDBACK: 'quran_feedback',
    MUSHAF_DOWNLOADED: 'q_mushaf_downloaded',
    FIRST_OPEN: 'q_first_open',
    BADGES: 'q_badges',
    HEATMAP: 'q_heatmap',
    SPACED_REP: 'q_spaced_rep',
    AUDIO_RECORDINGS: 'q_audio_rec'
};

let downloadAbortController = null;
let deferredPrompt = null;
let mediaRecorder = null;
let audioChunks = [];

const AppStore = {
    get(key, defaultValue = null) {
        try { const data = localStorage.getItem(key); return data ? JSON.parse(data) : defaultValue; }
        catch { return defaultValue; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); }
        catch (e) { console.error('Storage error:', e); }
    },
    update(key, partialData) {
        const currentData = this.get(key, {});
        const updatedData = { ...currentData, ...partialData };
        this.set(key, updatedData);
        return updatedData;
    }
};

const PLAN_TEMPLATES = {
    khatma30: { name: 'مراجعة مكثفة (30 يوم)', pagesPerDay: 20, totalDays: 30, startPage: 1, endPage: 604 },
    khatma60: { name: 'حفظ متوسط (60 يوم)', pagesPerDay: 10, totalDays: 60, startPage: 1, endPage: 604 },
    khatma365: { name: 'حفظ ميسر (سنة)', pagesPerDay: 2, totalDays: 302, startPage: 1, endPage: 604 }
};

const BADGES_DEF = [
    { id: 'streak_5', name: 'حافظ الفجر', icon: 'fa-moon', desc: '5 أيام متتالية', condition: (s) => s.streak >= 5 },
    { id: 'streak_30', name: 'خاتم الشهر', icon: 'fa-fire', desc: '30 يوم بدون انقطاع', condition: (s) => s.streak >= 30 },
    { id: 'perfect_10', name: 'صائد الأخطاء', icon: 'fa-bullseye', desc: '10 اختبارات بدون أخطاء', condition: (s) => s.perfectQuizzes >= 10 },
    { id: 'khatma', name: 'مجود القرآن', icon: 'fa-book-open', desc: 'إكمال 30 ورد', condition: (s) => s.completedWerds >= 30 },
    { id: 'pages_100', name: 'قارئ المئة', icon: 'fa-book-reader', desc: 'قراءة 100 صفحة', condition: (s) => s.pagesRead >= 100 },
    { id: 'pages_604', name: 'خاتم المصحف', icon: 'fa-star', desc: 'قراءة 604 صفحات', condition: (s) => s.pagesRead >= 604 },
    { id: 'night_7', name: 'ساهر الليالي', icon: 'fa-cloud-moon', desc: '7 مراجعات ليلية', condition: (s) => s.nightReviews >= 7 },
    { id: 'accuracy_90', name: 'حافظ متقن', icon: 'fa-check-double', desc: 'دقة 90%+', condition: (s) => s.accuracy >= 90 }
];

// ========================================
// UI Utils
// ========================================
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: 'fa-check-circle', error: 'fa-times-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    toast.innerHTML = `<i class="fas ${icons[type]}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration + 300);
}

function applyTheme(themeName) {
    document.body.className = themeName;
    AppStore.set(STORAGE_KEYS.THEME, themeName);
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = themeName === 'dark-theme' ? 'fas fa-sun' : 'fas fa-moon';
}

function toggleDarkMode() {
    const isDark = document.body.classList.contains('dark-theme');
    applyTheme(isDark ? 'light-theme' : 'dark-theme');
}

function switchScreen(id) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    const target = document.getElementById(id + 'Screen');
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }

    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navItem = document.getElementById('nav' + id.charAt(0).toUpperCase() + id.slice(1));
    if (navItem) navItem.classList.add('active');

    const titles = { 'plan': 'خطة الحفظ', 'quiz': 'الاختبارات', 'stats': 'الإحصائيات', 'settings': 'الإعدادات' };
    const titleEl = document.getElementById('viewTitle');
    if (titleEl) titleEl.innerText = titles[id] || 'رفيق الحفظ';

    if (id === 'plan') { renderPlanScreen(); renderHeatmap(); renderBadges(); renderNightReview(); }
    if (id === 'stats') renderStatsScreen();
    if (id === 'settings') loadSettings();
    if (id === 'quiz') updateQuizStatsBar();
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

function getStats() {
    return AppStore.get(STORAGE_KEYS.STATS, {
        streak: 0, bestStreak: 0, completedWerds: 0, pagesRead: 0, quizzesTaken: 0,
        correctAnswers: 0, wrongAnswers: 0, perfectQuizzes: 0, nightReviews: 0,
        weeklyActivity: [0, 0, 0, 0, 0, 0, 0], lastActiveDate: null, accuracy: 0
    });
}

function saveStats(stats) { AppStore.set(STORAGE_KEYS.STATS, stats); }

// ========================================
// Onboarding
// ========================================
let onboardingStep = 0;
const onboardingSteps = [
    { icon: 'fa-book-open', title: 'مرحباً بك في رفيق الحفظ!', text: 'رفيقك الذكي لحفظ القرآن الكريم ومتابعة تقدمك باحترافية.' },
    { icon: 'fa-route', title: 'اختر خطة حفظ', text: 'نقدم لك خططاً جاهزة (30/60/365 يوم) أو يمكنك إنشاء خطة مخصصة تناسبك.' },
    { icon: 'fa-book-reader', title: 'اقرأ وردك اليومي', text: 'المصحف كاملاً متاح offline بعد التحميل الأول. اقرأ وردك بسهولة.' },
    { icon: 'fa-brain', title: 'اختبر حفظك', text: 'اختبار إلزامي بعد كل ورد لتأكيد الحفظ، بالإضافة لاختبارات حرة.' },
    { icon: 'fa-chart-line', title: 'راقب تقدمك', text: 'خريطة حرارية للمصحف، إحصائيات دقيقة، وشارات تحفيزية.' },
    { icon: 'fa-microphone', title: 'سجّل تسميعك', text: 'سجّل صوتك وأنت تحفظ، واستمع له لاحقاً لمقارنة تلاوتك.' }
];

function initOnboarding() {
    if (localStorage.getItem('onboarding_done')) { checkFirstDownload(); return; }
    document.getElementById('onboardingModal').classList.remove('hidden');
    renderOnboardingStep();
}

function renderOnboardingStep() {
    const step = onboardingSteps[onboardingStep];
    const content = document.getElementById('onboardingContent');
    content.innerHTML = `
        <div class="onboarding-step">
            <div class="step-icon"><i class="fas ${step.icon}"></i></div>
            <h3>${step.title}</h3>
            <p>${step.text}</p>
        </div>
        <div class="onboarding-dots">
            ${onboardingSteps.map((_, i) => `<div class="dot ${i === onboardingStep ? 'active' : ''}"></div>`).join('')}
        </div>
    `;
    const nextBtn = document.getElementById('onboardingNextBtn');
    const prevBtn = document.getElementById('onboardingPrevBtn');
    if (prevBtn) prevBtn.style.visibility = onboardingStep === 0 ? 'hidden' : 'visible';
    if (nextBtn) nextBtn.innerText = onboardingStep === onboardingSteps.length - 1 ? 'ابدأ رحلتك 🚀' : 'التالي';
}

function nextOnboarding() {
    if (onboardingStep < onboardingSteps.length - 1) { onboardingStep++; renderOnboardingStep(); }
    else { closeOnboarding(); }
}

function prevOnboarding() {
    if (onboardingStep > 0) { onboardingStep--; renderOnboardingStep(); }
}

function closeOnboarding() {
    closeModal('onboardingModal');
    localStorage.setItem('onboarding_done', 'true');
    checkFirstDownload();
}

// ========================================
// Service Worker & PWA
// ========================================
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.error('SW error:', err));
    }
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installBtn');
    if (btn) btn.classList.remove('hidden');
});

function installPWA() {
    if (!deferredPrompt) { showToast('التثبيت غير متاح حالياً', 'warning'); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => { deferredPrompt = null; });
}

// ========================================
// Offline/Online
// ========================================
function updateOnlineStatus() {
    const indicator = document.getElementById('offlineIndicator');
    if (!indicator) return;
    if (navigator.onLine) indicator.classList.add('hidden');
    else indicator.classList.remove('hidden');
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

function checkOnline() {
    if (!navigator.onLine) {
        showToast('⚠️ أنت offline. بعض الميزات قد لا تعمل.', 'warning', 5000);
        return false;
    }
    return true;
}

// ========================================
// Plans Logic
// ========================================
function startPlan(planId) {
    const template = PLAN_TEMPLATES[planId];
    if (!template) return;
    const plan = { ...template, id: planId, startDate: new Date().toISOString(), completedDays: [], currentDay: 1 };
    AppStore.set(STORAGE_KEYS.PLAN, plan);
    initHeatmap();
    showToast(`تم بدء خطة ${template.name}!`, 'success');
    renderPlanScreen();
}

function startCustomPlan() { document.getElementById('customPlanModal').classList.remove('hidden'); }

function confirmCustomPlan() {
    const pagesPerDay = parseInt(document.getElementById('customPagesPerDay').value);
    const startPage = parseInt(document.getElementById('customStartPage').value);
    const endPage = parseInt(document.getElementById('customEndPage').value);
    if (!pagesPerDay || !startPage || !endPage || startPage > endPage) { showToast('يرجى ملء جميع الحقول بشكل صحيح', 'warning'); return; }
    const totalDays = Math.ceil((endPage - startPage + 1) / pagesPerDay);
    const plan = { name: 'خطة مخصصة', pagesPerDay, totalDays, startPage, endPage, id: 'custom', startDate: new Date().toISOString(), completedDays: [], currentDay: 1 };
    AppStore.set(STORAGE_KEYS.PLAN, plan);
    initHeatmap();
    closeModal('customPlanModal'); showToast('تم بدء الخطة بنجاح!', 'success'); renderPlanScreen();
}

function resetPlanOnly() {
    if (confirm('هل أنت متأكد من تغيير الخطة؟ سيتم مسح تقدم الخطة الحالية.')) {
        localStorage.removeItem(STORAGE_KEYS.PLAN);
        showToast('تم إلغاء الخطة. اختر خطة جديدة الآن.', 'success');
        renderPlanScreen();
    }
}

function renderPlanScreen() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    const activeCard = document.getElementById('activePlanCard');
    const werdCard = document.getElementById('dailyWerdCard');
    const noPlan = document.getElementById('noPlanState');
    const templates = document.getElementById('planTemplatesContainer');

    const stats = getStats();
    document.getElementById('streakCountPreview').innerText = stats.streak;
    document.getElementById('pagesCountPreview').innerText = stats.pagesRead;
    const totalQ = stats.correctAnswers + stats.wrongAnswers;
    document.getElementById('accuracyCountPreview').innerText = totalQ > 0 ? Math.round((stats.correctAnswers / totalQ) * 100) + '%' : '0%';

    if (!plan) {
        activeCard.classList.add('hidden'); werdCard.classList.add('hidden');
        noPlan.classList.remove('hidden'); templates.classList.remove('hidden');
        return;
    }

    activeCard.classList.remove('hidden'); werdCard.classList.remove('hidden');
    noPlan.classList.add('hidden'); templates.classList.add('hidden');

    document.getElementById('activePlanName').innerText = plan.name;
    const progress = (plan.completedDays.length / plan.totalDays) * 100;
    document.getElementById('planProgressFill').style.width = progress + '%';
    document.getElementById('planProgressText').innerText = Math.round(progress) + '%';
    document.getElementById('planDaysLeft').innerText = `متبقي ${plan.totalDays - plan.completedDays.length} يوم`;

    const todayStr = new Date().toDateString();
    const isCompletedToday = plan.completedDays.includes(todayStr);
    const startPage = plan.startPage + (plan.completedDays.length * plan.pagesPerDay);
    const endPage = Math.min(startPage + plan.pagesPerDay - 1, plan.endPage);

    document.getElementById('werdText').innerText = isCompletedToday ? '✅ أتممت حفظ ورد اليوم!' : `من صفحة ${startPage} إلى ${endPage}`;
    document.getElementById('werdProgressFill').style.width = progress + '%';
    document.getElementById('werdProgress').innerText = Math.round(progress) + '%';
    document.getElementById('readWerdBtn').style.display = isCompletedToday ? 'none' : 'flex';

    const delayWarning = document.getElementById('delayWarning');
    if (delayWarning) {
        const lastActive = stats.lastActiveDate;
        if (lastActive) {
            const diff = Math.floor((new Date() - new Date(lastActive)) / (1000 * 60 * 60 * 24));
            if (diff > 1) { delayWarning.innerText = `⚠️ لم تفتح التطبيق منذ ${diff} أيام! استمر في وردك.`; delayWarning.classList.remove('hidden'); }
            else { delayWarning.classList.add('hidden'); }
        }
    }
}

function showPlanCalendar() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    if (!plan) return;

    const modal = document.getElementById('planCalendarModal');
    const grid = document.getElementById('planCalendarGrid');
    const startDate = new Date(plan.startDate);
    const today = new Date();

    // FIXED: Smart calendar starts from plan start day, not always Saturday
    const startDayIndex = startDate.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    // Reorder headers to start from plan start day
    let html = '';
    for (let i = 0; i < 7; i++) {
        const dayIdx = (startDayIndex + i) % 7;
        html += `<div class="calendar-day-header">${dayNames[dayIdx]}</div>`;
    }

    // Add empty cells for offset
    for (let i = 0; i < startDayIndex; i++) {
        html += `<div class="calendar-day" style="opacity:0.3;"></div>`;
    }

    for (let i = 0; i < plan.totalDays; i++) {
        const dayDate = new Date(startDate);
        dayDate.setDate(startDate.getDate() + i);
        const dayStr = dayDate.toDateString();
        const isCompleted = plan.completedDays.includes(dayStr);
        const isToday = dayStr === today.toDateString();
        let classes = 'calendar-day';
        if (isCompleted) classes += ' completed';
        if (isToday) classes += ' today';
        html += `<div class="${classes}">${i + 1}</div>`;
    }
    grid.innerHTML = html;
    modal.classList.remove('hidden');
}

// ========================================
// Heatmap Logic
// ========================================
function initHeatmap() {
    if (AppStore.get(STORAGE_KEYS.HEATMAP)) return;
    const heatmap = {};
    for (let i = 1; i <= 604; i++) heatmap[i] = { status: 'unread', accuracy: 0, attempts: 0 };
    AppStore.set(STORAGE_KEYS.HEATMAP, heatmap);
}

function updateHeatmapPage(page, isCorrect) {
    const heatmap = AppStore.get(STORAGE_KEYS.HEATMAP, {});
    if (!heatmap[page]) heatmap[page] = { status: 'unread', accuracy: 0, attempts: 0 };
    heatmap[page].attempts++;
    if (isCorrect) heatmap[page].accuracy = ((heatmap[page].accuracy * (heatmap[page].attempts - 1)) + 100) / heatmap[page].attempts;
    else heatmap[page].accuracy = ((heatmap[page].accuracy * (heatmap[page].attempts - 1)) + 0) / heatmap[page].attempts;

    if (heatmap[page].accuracy >= 90 && heatmap[page].attempts >= 2) heatmap[page].status = 'mastered';
    else if (heatmap[page].accuracy >= 50) heatmap[page].status = 'medium';
    else if (heatmap[page].attempts > 0) heatmap[page].status = 'weak';
    AppStore.set(STORAGE_KEYS.HEATMAP, heatmap);
}

function renderHeatmap() {
    const container = document.getElementById('heatmapContainer');
    const grid = document.getElementById('heatmapGrid');
    if (!container || !grid) return;
    const heatmap = AppStore.get(STORAGE_KEYS.HEATMAP, {});
    let html = '';
    for (let i = 1; i <= 604; i++) {
        const cell = heatmap[i] || { status: 'unread' };
        html += `<div class="heatmap-cell ${cell.status}" title="صفحة ${i}" onclick="openPageQuiz(${i})"></div>`;
    }
    grid.innerHTML = html;
}

function openPageQuiz(page) {
    if (!checkOnline()) return;
    document.getElementById('freePageStart').value = page;
    document.getElementById('freePageEnd').value = page;
    switchScreen('quiz');
    showToast(`تم تحديد صفحة ${page} للاختبار`, 'info');
}

// ========================================
// Badges
// ========================================
function checkBadges() {
    const stats = getStats();
    const total = stats.correctAnswers + stats.wrongAnswers;
    stats.accuracy = total > 0 ? Math.round((stats.correctAnswers / total) * 100) : 0;
    const badges = AppStore.get(STORAGE_KEYS.BADGES, {});
    let newUnlock = false;
    BADGES_DEF.forEach(b => {
        if (!badges[b.id] && b.condition(stats)) {
            badges[b.id] = { unlocked: true, date: new Date().toISOString() };
            newUnlock = true;
            showToast(`🏆 تم فتح شارة: ${b.name}!`, 'success', 5000);
        }
    });
    if (newUnlock) AppStore.set(STORAGE_KEYS.BADGES, badges);
    return badges;
}

function renderBadges() {
    const container = document.getElementById('badgesContainer');
    const grid = document.getElementById('badgesGrid');
    if (!container || !grid) return;
    const badges = checkBadges();
    grid.innerHTML = BADGES_DEF.map(b => {
        const unlocked = badges[b.id]?.unlocked;
        return `<div class="badge-item ${unlocked ? 'unlocked' : ''}" title="${b.desc}">
            <i class="fas ${b.icon}"></i><span>${b.name}</span>
        </div>`;
    }).join('');
}

// ========================================
// Night Review
// ========================================
function getSpacedRep() {
    return AppStore.get(STORAGE_KEYS.SPACED_REP, { queue: [], lastReview: null });
}

function addToSpacedRep(pages) {
    const sr = getSpacedRep();
    const today = new Date().toDateString();
    pages.forEach(p => {
        if (!sr.queue.find(x => x.page === p)) {
            sr.queue.push({ page: p, date: today, interval: 1, repetitions: 0 });
        }
    });
    AppStore.set(STORAGE_KEYS.SPACED_REP, sr);
}

function getNightReviewPages() {
    const sr = getSpacedRep();
    const today = new Date();
    const due = sr.queue.filter(item => {
        const itemDate = new Date(item.date);
        const diff = Math.floor((today - itemDate) / (1000 * 60 * 60 * 24));
        return diff >= item.interval;
    });
    const heatmap = AppStore.get(STORAGE_KEYS.HEATMAP, {});
    const weakPages = Object.keys(heatmap).filter(p => heatmap[p].status === 'weak').map(Number);
    const combined = [...new Set([...due.map(x => x.page), ...weakPages])];
    return combined.slice(0, 5);
}

function renderNightReview() {
    const container = document.getElementById('nightReviewContainer');
    const btn = document.getElementById('startNightReviewBtn');
    if (!container || !btn) return;
    const pages = getNightReviewPages();
    if (pages.length === 0) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    btn.onclick = () => startNightReviewQuiz(pages);
}

function startNightReviewQuiz(pages) {
    if (!checkOnline()) return;
    nightReviewPages = pages;
    nightReviewIndex = 0;
    document.getElementById('nightReviewQuizModal').classList.remove('hidden');
    loadNightReviewQuestion();
}

let nightReviewPages = [];
let nightReviewIndex = 0;

async function loadNightReviewQuestion() {
    if (nightReviewIndex >= nightReviewPages.length) {
        closeModal('nightReviewQuizModal');
        const stats = getStats();
        stats.nightReviews = (stats.nightReviews || 0) + 1;
        saveStats(stats);
        showToast('✅ تمت المراجعة الليلية بنجاح!', 'success');
        checkBadges();
        return;
    }
    const page = nightReviewPages[nightReviewIndex];
    document.getElementById('nightReviewProgress').innerText = `سؤال ${nightReviewIndex + 1} من ${nightReviewPages.length}`;
    document.getElementById('nightReviewQuestion').innerHTML = '<div class="splash-loader"></div>';
    document.getElementById('nightShowAnswerBtn').classList.add('hidden');
    document.getElementById('nightCorrectAnswerBox').classList.add('hidden');

    try {
        const res = await fetch(`https://api.alquran.cloud/v1/page/${page}/ar.quran-uthmani`);
        const data = await res.json();
        const ayahs = data.data.ayahs;
        const ayah = ayahs[Math.floor(Math.random() * ayahs.length)];
        document.getElementById('nightReviewLocation').innerText = `${ayah.surah.name} - صفحة ${page}`;
        const words = ayah.text.split(' '); const cut = Math.floor(words.length / 2);
        document.getElementById('nightReviewQuestion').innerText = `﴿${words.slice(0, cut).join(' ')} ...﴾`;
        nightReviewState = { answer: words.slice(cut).join(' '), page };
        document.getElementById('nightShowAnswerBtn').classList.remove('hidden');
    } catch {
        setTimeout(() => loadNightReviewQuestion(), 500);
    }
}

let nightReviewState = { answer: '', page: 1 };

function showNightAnswer() {
    document.getElementById('nightShowAnswerBtn').classList.add('hidden');
    document.getElementById('nightCorrectAnswerText').innerText = `﴿${nightReviewState.answer}﴾`;
    document.getElementById('nightCorrectAnswerBox').classList.remove('hidden');
}

function handleNightAnswer(isCorrect) {
    updateHeatmapPage(nightReviewState.page, isCorrect);
    const stats = getStats();
    if (isCorrect) stats.correctAnswers++; else stats.wrongAnswers++;
    saveStats(stats);
    nightReviewIndex++;
    loadNightReviewQuestion();
}

// ========================================
// Mushaf Reader & Download
// ========================================
let werdState = { startPage: 1, endPage: 1, currentPage: 1 };

function getMushafImageUrl(page) {
    return `https://archive.quran.com/images/mushaf/v1/page${page}.png`;
}

async function checkFirstDownload() {
    const isDownloaded = AppStore.get(STORAGE_KEYS.MUSHAF_DOWNLOADED, false);
    if (!isDownloaded) {
        document.getElementById('firstDownloadModal').classList.remove('hidden');
        await startFirstTimeDownload();
    }
}

async function startFirstTimeDownload() {
    const progressFill = document.getElementById('firstDownloadProgressFill');
    const progressText = document.getElementById('firstDownloadProgressText');
    const statusText = document.getElementById('firstDownloadStatus');
    const skipBtn = document.getElementById('skipDownloadBtn');

    if (skipBtn) skipBtn.onclick = () => {
        downloadAbortController?.abort();
        closeModal('firstDownloadModal');
        showToast('يمكنك تحميل المصحف لاحقاً من الإعدادات', 'info');
    };

    downloadAbortController = new AbortController();
    const signal = downloadAbortController.signal;
    let successCount = 0;
    const cache = await caches.open('hifz-companion-v10-mushaf');
    const BATCH_SIZE = 5;

    try {
        for (let batchStart = 1; batchStart <= 604; batchStart += BATCH_SIZE) {
            if (signal.aborted) break;
            const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, 604);
            const promises = [];
            for (let i = batchStart; i <= batchEnd; i++) {
                const imageUrl = getMushafImageUrl(i);
                promises.push(
                    (async () => {
                        try {
                            const cached = await cache.match(imageUrl);
                            if (cached) { successCount++; return; }
                            const response = await fetch(imageUrl);
                            if (response.ok) {
                                await cache.put(imageUrl, response.clone());
                                successCount++;
                            }
                        } catch (e) { console.error("Error downloading page", i); }
                    })()
                );
            }
            await Promise.all(promises);
            const percent = Math.round((batchEnd / 604) * 100);
            if (progressFill) progressFill.style.width = percent + '%';
            if (progressText) progressText.innerText = `${batchEnd} / 604 صفحة`;
        }
        if (!signal.aborted) {
            AppStore.set(STORAGE_KEYS.MUSHAF_DOWNLOADED, true);
            if (statusText) statusText.innerText = '✅ اكتمل التحميل!';
            setTimeout(() => closeModal('firstDownloadModal'), 1000);
        }
    } catch (e) {
        console.error('Download error:', e);
        showToast('حدث خطأ في التحميل', 'error');
    }
}

function checkBeforeWerd() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    if (!plan) { showToast('اختر خطة أولاً', 'warning'); return; }
    openWerdReader();
}

async function openWerdReader() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    if (!plan) return;
    werdState.startPage = plan.startPage + (plan.completedDays.length * plan.pagesPerDay);
    werdState.endPage = Math.min(werdState.startPage + plan.pagesPerDay - 1, plan.endPage);
    werdState.currentPage = werdState.startPage;
    document.getElementById('werdReaderModal').classList.remove('hidden');
    loadWerdImage();
}

function loadWerdImage() {
    const loader = document.getElementById('werdImageLoader');
    if (loader) loader.classList.remove('hidden');
    const img = document.getElementById('werdWerdImage');

    // FIXED: Better error handling that doesn't destroy the image element
    img.onerror = function () {
        if (loader) loader.classList.add('hidden');
        showToast('تعذر تحميل الصفحة. تأكد من الإنترنت.', 'error');
    };

    img.onload = function () {
        if (loader) loader.classList.add('hidden');
    };

    img.src = getMushafImageUrl(werdState.currentPage);
    document.getElementById('werdCurrentPageLabel').innerText = `صفحة ${werdState.currentPage}`;
    document.getElementById('werdPagesLeftLabel').innerText = `متبقي ${werdState.endPage - werdState.currentPage} صفحة`;
    const finishBtn = document.getElementById('finishWerdBtn');
    if (finishBtn) finishBtn.disabled = (werdState.currentPage !== werdState.endPage);
}

function nextWerdPage() {
    if (werdState.currentPage < werdState.endPage) { werdState.currentPage++; loadWerdImage(); }
    else { showToast('وصلت لنهاية ورد اليوم!', 'success'); }
}

function prevWerdPage() {
    if (werdState.currentPage > werdState.startPage) { werdState.currentPage--; loadWerdImage(); }
}

// ========================================
// Audio Recording System
// ========================================
async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('التسجيل الصوتي غير مدعوم في هذا المتصفح', 'error');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            saveRecording(audioUrl, werdState.currentPage);
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        document.getElementById('recordBtn').classList.add('hidden');
        document.getElementById('stopRecordBtn').classList.remove('hidden');
        showToast('🔴 جاري التسجيل...', 'info');
    } catch (err) {
        showToast('لم يتم منح إذن الميكروفون', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        document.getElementById('recordBtn').classList.remove('hidden');
        document.getElementById('stopRecordBtn').classList.add('hidden');
        showToast('✅ تم حفظ التسجيل', 'success');
    }
}

function saveRecording(audioUrl, page) {
    const recordings = AppStore.get(STORAGE_KEYS.AUDIO_RECORDINGS, []);
    recordings.push({
        url: audioUrl,
        page: page,
        date: new Date().toISOString(),
        id: Date.now()
    });
    AppStore.set(STORAGE_KEYS.AUDIO_RECORDINGS, recordings);
    renderRecordingsList();
}

function renderRecordingsList() {
    const list = document.getElementById('recordingsList');
    if (!list) return;
    const recordings = AppStore.get(STORAGE_KEYS.AUDIO_RECORDINGS, []);
    if (recordings.length === 0) {
        list.innerHTML = '<p style="opacity:0.6; text-align:center; padding:20px;">لا توجد تسجيلات بعد</p>';
        return;
    }
    list.innerHTML = recordings.map(r => `
        <div style="display:flex; align-items:center; gap:10px; padding:10px; background:var(--bg); border-radius:10px; margin-bottom:8px;">
            <button onclick="playRecording('${r.url}')" style="background:var(--primary); color:white; border:none; width:36px; height:36px; border-radius:50%; cursor:pointer;"><i class="fas fa-play"></i></button>
            <div style="flex:1;">
                <div style="font-weight:700; font-size:0.85em;">صفحة ${r.page}</div>
                <div style="font-size:0.75em; opacity:0.6;">${new Date(r.date).toLocaleDateString('ar-SA')}</div>
            </div>
            <button onclick="deleteRecording(${r.id})" style="background:none; border:none; color:var(--danger); cursor:pointer; font-size:1.2em;"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
}

function playRecording(url) {
    const audio = new Audio(url);
    audio.play();
}

function deleteRecording(id) {
    if (!confirm('حذف هذا التسجيل؟')) return;
    let recordings = AppStore.get(STORAGE_KEYS.AUDIO_RECORDINGS, []);
    recordings = recordings.filter(r => r.id !== id);
    AppStore.set(STORAGE_KEYS.AUDIO_RECORDINGS, recordings);
    renderRecordingsList();
}

// ========================================
// Strict Quiz
// ========================================
let strictQuizState = { currentIndex: 0, mistakes: 0, total: 5, currentAnswer: '' };

function finishWerdAndStartQuiz() {
    if (werdState.currentPage !== werdState.endPage) {
        showToast('أكمل قراءة جميع صفحات الورد أولاً', 'warning'); return;
    }
    if (!checkOnline()) return;
    closeModal('werdReaderModal');
    initiateStrictQuiz(5);
}

function initiateStrictQuiz(total) {
    strictQuizState = { currentIndex: 0, mistakes: 0, total: total, currentAnswer: '' };
    document.getElementById('strictQuizModal').classList.remove('hidden');
    document.getElementById('strictQuizMistakes').innerText = `الأخطاء: 0 / 3`;
    loadStrictQuestion();
}

async function loadStrictQuestion() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    const startPage = plan.startPage + (plan.completedDays.length * plan.pagesPerDay);
    const endPage = Math.min(startPage + plan.pagesPerDay - 1, plan.endPage);
    const randomPage = Math.floor(Math.random() * (endPage - startPage + 1)) + startPage;

    document.getElementById('strictQuizProgress').innerText = `السؤال ${strictQuizState.currentIndex + 1} من ${strictQuizState.total}`;
    document.getElementById('strictQuizQuestion').innerHTML = '<div class="splash-loader"></div>';
    document.getElementById('strictShowAnswerBtn').classList.add('hidden');
    document.getElementById('strictCorrectAnswerBox').classList.add('hidden');

    try {
        const res = await fetch(`https://api.alquran.cloud/v1/page/${randomPage}/ar.quran-uthmani`);
        const data = await res.json();
        const ayahs = data.data.ayahs;
        const correctAyah = ayahs[Math.floor(Math.random() * ayahs.length)];

        if (Math.random() > 0.5) {
            const words = correctAyah.text.split(' ');
            const cut = Math.floor(words.length / 2);
            document.getElementById('strictQuizQuestion').innerText = `﴿${words.slice(0, cut).join(' ')} ...﴾`;
            strictQuizState.currentAnswer = words.slice(cut).join(' ');
        } else {
            document.getElementById('strictQuizQuestion').innerHTML = `قال تعالى: ﴿${correctAyah.text}﴾ <br><br> ما هي الآية التالية؟`;
            const nextNum = correctAyah.number + 1;
            if (nextNum > 6236) throw new Error('Last ayah');
            const nRes = await fetch(`https://api.alquran.cloud/v1/ayah/${nextNum}/ar.quran-uthmani`);
            const nData = await nRes.json();
            strictQuizState.currentAnswer = nData.data.text;
        }
        strictQuizState.currentPage = randomPage;
        document.getElementById('strictShowAnswerBtn').classList.remove('hidden');
    } catch {
        setTimeout(() => loadStrictQuestion(), 500);
    }
}

function showStrictAnswer() {
    document.getElementById('strictShowAnswerBtn').classList.add('hidden');
    document.getElementById('strictCorrectAnswerText').innerText = `﴿${strictQuizState.currentAnswer}﴾`;
    document.getElementById('strictCorrectAnswerBox').classList.remove('hidden');
}

function handleStrictAnswer(isCorrect) {
    updateHeatmapPage(strictQuizState.currentPage, isCorrect);
    if (isCorrect) {
        strictQuizState.currentIndex++;
        if (strictQuizState.currentIndex >= strictQuizState.total) {
            closeModal('strictQuizModal'); markWerdComplete();
        } else { loadStrictQuestion(); }
    } else {
        strictQuizState.mistakes++;
        document.getElementById('strictQuizMistakes').innerText = `الأخطاء: ${strictQuizState.mistakes} / 3`;
        if (strictQuizState.mistakes >= 3) {
            showToast("راجع وردك جيداً وحاول لاحقاً", "error"); closeModal('strictQuizModal');
        } else { loadStrictQuestion(); }
    }
}

function markWerdComplete() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    const todayStr = new Date().toDateString();
    if (!plan.completedDays.includes(todayStr)) {
        plan.completedDays.push(todayStr);
        AppStore.set(STORAGE_KEYS.PLAN, plan);
        const stats = getStats();

        const lastActive = stats.lastActiveDate;
        if (lastActive) {
            const diff = Math.floor((new Date(todayStr) - new Date(lastActive)) / (1000 * 60 * 60 * 24));
            if (diff === 1) stats.streak++;
            else if (diff > 1) stats.streak = 1;
        } else { stats.streak = 1; }
        if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
        stats.lastActiveDate = todayStr;

        stats.pagesRead += plan.pagesPerDay;
        stats.completedWerds++;

        const dayIdx = new Date().getDay();
        const weekly = stats.weeklyActivity;
        weekly[dayIdx] = (weekly[dayIdx] || 0) + plan.pagesPerDay;
        stats.weeklyActivity = weekly;

        const pages = [];
        const start = plan.startPage + ((plan.completedDays.length - 1) * plan.pagesPerDay);
        const end = Math.min(start + plan.pagesPerDay - 1, plan.endPage);
        for (let p = start; p <= end; p++) pages.push(p);
        addToSpacedRep(pages);

        saveStats(stats);
        checkBadges();
        showToast("تم إكمال ورد اليوم بنجاح! 🎉", "success");
        renderPlanScreen();
    }
}

// ========================================
// Free Quiz Logic
// ========================================
let freeQuizState = { currentAnswer: '', page: 1, streak: 0 };

function selectChallengeType(el, type) {
    document.querySelectorAll('.radio-option').forEach(opt => opt.classList.remove('selected'));
    el.classList.add('selected');
    el.querySelector('input').checked = true;
}

function updateQuizStatsBar() {
    const stats = getStats();
    const elCorrect = document.getElementById('quizCorrectCount');
    const elWrong = document.getElementById('quizWrongCount');
    const elStreak = document.getElementById('quizStreakCount');
    if (elCorrect) elCorrect.innerText = stats.correctAnswers;
    if (elWrong) elWrong.innerText = stats.wrongAnswers;
    if (elStreak) elStreak.innerText = freeQuizState.streak;
}

async function startFreeQuiz() {
    if (!checkOnline()) return;
    const start = parseInt(document.getElementById('freePageStart').value) || 1;
    const end = parseInt(document.getElementById('freePageEnd').value) || 604;
    let type = document.querySelector('input[name="challengeType"]:checked').value;
    if (type === 'mix') {
        const types = ['complete', 'next', 'prev'];
        type = types[Math.floor(Math.random() * types.length)];
    }

    document.getElementById('quizSetupArea').classList.add('hidden');
    document.getElementById('freeQuizArea').classList.remove('hidden');
    document.getElementById('freeQuizQuestion').innerHTML = '<div class="splash-loader"></div>';
    document.getElementById('freeShowAnswerBtn').classList.add('hidden');
    document.getElementById('freeCorrectAnswerBox').classList.add('hidden');

    const randomPage = Math.floor(Math.random() * (end - start + 1)) + start;

    try {
        const res = await fetch(`https://api.alquran.cloud/v1/page/${randomPage}/ar.quran-uthmani`);
        const data = await res.json();
        const ayahs = data.data.ayahs;
        const ayah = ayahs[Math.floor(Math.random() * ayahs.length)];
        document.getElementById('freeQuizLocation').innerText = `${ayah.surah.name} - صفحة ${randomPage}`;

        if (type === 'complete') {
            const words = ayah.text.split(' '); const cut = Math.floor(words.length / 2);
            document.getElementById('freeQuizQuestion').innerText = `﴿${words.slice(0, cut).join(' ')} ...﴾`;
            freeQuizState.currentAnswer = words.slice(cut).join(' ');
        } else if (type === 'next') {
            document.getElementById('freeQuizQuestion').innerHTML = `﴿${ayah.text}﴾ <br><br> ما هي الآية التالية؟`;
            const nextNum = ayah.number + 1;
            if (nextNum > 6236) throw new Error('Last ayah');
            const r = await fetch(`https://api.alquran.cloud/v1/ayah/${nextNum}/ar.quran-uthmani`);
            const d = await r.json(); freeQuizState.currentAnswer = d.data.text;
        } else if (type === 'prev') {
            document.getElementById('freeQuizQuestion').innerHTML = `﴿${ayah.text}﴾ <br><br> ما هي الآية السابقة؟`;
            const prevNum = ayah.number - 1;
            if (prevNum < 1) throw new Error('First ayah');
            const r = await fetch(`https://api.alquran.cloud/v1/ayah/${prevNum}/ar.quran-uthmani`);
            const d = await r.json(); freeQuizState.currentAnswer = d.data.text;
        }
        freeQuizState.page = randomPage;
        document.getElementById('freeShowAnswerBtn').classList.remove('hidden');
    } catch {
        setTimeout(() => startFreeQuiz(), 500);
    }
}

function showFreeAnswer() {
    document.getElementById('freeShowAnswerBtn').classList.add('hidden');
    document.getElementById('freeCorrectAnswerText').innerText = `﴿${freeQuizState.currentAnswer}﴾`;
    document.getElementById('freeCorrectAnswerBox').classList.remove('hidden');
}

function submitFreeAnswer(isCorrect) {
    const stats = getStats();
    if (isCorrect) { stats.correctAnswers++; freeQuizState.streak++; }
    else { stats.wrongAnswers++; freeQuizState.streak = 0; }

    const total = stats.correctAnswers + stats.wrongAnswers;
    stats.accuracy = total > 0 ? Math.round((stats.correctAnswers / total) * 100) : 0;

    if (isCorrect && freeQuizState.streak >= 10) stats.perfectQuizzes = (stats.perfectQuizzes || 0) + 1;

    saveStats(stats);
    updateHeatmapPage(freeQuizState.page, isCorrect);
    updateQuizStatsBar();
    checkBadges();
    startFreeQuiz();
}

function endFreeQuiz() {
    document.getElementById('freeQuizArea').classList.add('hidden');
    document.getElementById('quizSetupArea').classList.remove('hidden');
    freeQuizState.streak = 0;
    updateQuizStatsBar();
}

// ========================================
// Stats & Charts
// ========================================
function renderStatsScreen() {
    const stats = getStats();
    document.getElementById('statStreak').innerText = stats.streak;
    document.getElementById('statBestStreak').innerText = stats.bestStreak || 0;
    document.getElementById('statPages').innerText = stats.pagesRead;
    document.getElementById('statCompleted').innerText = stats.completedWerds;
    document.getElementById('statAccuracy').innerText = stats.accuracy + '%';
    document.getElementById('statQuizzes').innerText = stats.quizzesTaken || 0;

    const chart = document.getElementById('weeklyChart');
    if (chart) {
        const bars = chart.querySelectorAll('.bar-fill');
        const max = Math.max(...stats.weeklyActivity, 1);
        bars.forEach((bar, i) => {
            const h = (stats.weeklyActivity[i] / max) * 100;
            bar.style.height = Math.max(h, 4) + '%';
        });
    }
}

// ========================================
// PDF Export
// ========================================
function exportPlanPDF() {
    const plan = AppStore.get(STORAGE_KEYS.PLAN);
    if (!plan) { showToast('لا يوجد خطة نشطة', 'warning'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.setR2L(true);

    doc.setFontSize(20);
    doc.text('خطة الحفظ - رفيق الحفظ', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.text(`الخطة: ${plan.name}`, 105, 35, { align: 'center' });
    doc.text(`الصفحات اليومية: ${plan.pagesPerDay}`, 105, 42, { align: 'center' });
    doc.text(`المدة: ${plan.totalDays} يوم`, 105, 49, { align: 'center' });

    let y = 65;
    doc.setFontSize(10);
    for (let i = 0; i < plan.totalDays; i++) {
        const dayDate = new Date(plan.startDate); dayDate.setDate(dayDate.getDate() + i);
        const dayStr = dayDate.toLocaleDateString('ar-SA');
        const start = plan.startPage + (i * plan.pagesPerDay);
        const end = Math.min(start + plan.pagesPerDay - 1, plan.endPage);
        const done = plan.completedDays.includes(dayDate.toDateString()) ? '✅' : '⬜';
        doc.text(`${done} اليوم ${i + 1} (${dayStr}): صفحة ${start} إلى ${end}`, 190, y, { align: 'right' });
        y += 7;
        if (y > 280) { doc.addPage(); y = 20; }
    }

    doc.save('quran-plan.pdf');
    showToast('تم تصدير الخطة بنجاح', 'success');
}

// ========================================
// Data Management
// ========================================
function exportData() {
    const data = {};
    Object.values(STORAGE_KEYS).forEach(k => { data[k] = AppStore.get(k); });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `hifz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast('تم حفظ النسخة الاحتياطية', 'success');
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                Object.entries(data).forEach(([k, v]) => { if (v !== null) AppStore.set(k, v); });
                showToast('تم استعادة البيانات بنجاح', 'success');
                renderPlanScreen(); renderStatsScreen();
            } catch { showToast('ملف غير صالح', 'error'); }
        };
        reader.readAsText(file);
    };
    input.click();
}

function resetAllData() {
    if (confirm('هل أنت متأكد من مسح جميع البيانات؟ لا يمكن التراجع عن هذا.')) {
        Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
        location.reload();
    }
}

// ========================================
// Settings
// ========================================
function loadSettings() {
    const s = AppStore.get(STORAGE_KEYS.SETTINGS, { fajrTime: '05:00', maghribTime: '18:00', notifications: false });
    document.getElementById('fajrTime').value = s.fajrTime;
    document.getElementById('maghribTime').value = s.maghribTime;
    const notifToggle = document.getElementById('notifToggle');
    if (notifToggle) notifToggle.checked = s.notifications;
}

function saveAppSettings() {
    const notifToggle = document.getElementById('notifToggle');
    AppStore.update(STORAGE_KEYS.SETTINGS, {
        fajrTime: document.getElementById('fajrTime').value,
        maghribTime: document.getElementById('maghribTime').value,
        notifications: notifToggle ? notifToggle.checked : false
    });
    showToast('تم حفظ الإعدادات', 'success');
}

function requestNotificationPermission() {
    if (!('Notification' in window)) { showToast('التنبيهات غير مدعومة في هذا المتصفح', 'warning'); return; }
    Notification.requestPermission().then(perm => {
        if (perm === 'granted') showToast('تم تفعيل التنبيهات', 'success');
        else showToast('تم رفض الإذن', 'warning');
    });
}

// ========================================
// Feedback
// ========================================
function setRating(n) {
    document.getElementById('ratingValue').value = n;
    const stars = document.querySelectorAll('.rating-stars i');
    stars.forEach((s, i) => { s.style.color = i < n ? 'var(--accent)' : '#ccc'; });
}

function sendFeedback(e) {
    e.preventDefault();
    const msg = document.getElementById('feedbackMessage').value;
    const rating = document.getElementById('ratingValue').value;
    if (!msg) return;

    const feedbacks = AppStore.get(STORAGE_KEYS.FEEDBACK, []);
    feedbacks.push({ msg, rating, date: new Date().toISOString() });
    AppStore.set(STORAGE_KEYS.FEEDBACK, feedbacks);

    showToast('شكراً لك! تم حفظ تقييمك.', 'success');
    closeModal('weeklyFeedbackModal');
    document.getElementById('feedbackForm').reset();
    setRating(5);
}

function handleImageError(img, id) {
    showToast('تعذر تحميل الصفحة. تأكد من الإنترنت.', 'error');
}

// ========================================
// Init
// ========================================
window.addEventListener('DOMContentLoaded', () => {
    registerSW();
    updateOnlineStatus();

    setTimeout(() => {
        document.getElementById('splashScreen').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
    }, 3000);

    applyTheme(AppStore.get(STORAGE_KEYS.THEME, 'light-theme'));
    switchScreen('plan');
    initOnboarding();
    initHeatmap();

    setInterval(() => {
        const s = AppStore.get(STORAGE_KEYS.SETTINGS, { fajrTime: '05:00', maghribTime: '18:00', notifications: false });
        if (!s.notifications) return;
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if ((time === s.fajrTime || time === s.maghribTime) && Notification.permission === 'granted') {
            new Notification('رفيق الحفظ', { body: 'حان موعد الورد 🕌', icon: 'icon.png' });
        }
    }, 60000);
});