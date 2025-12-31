/**
 * PANALIX PRO - AI COMIC STUDIO
 * Core Logic Module
 * * Architecture:
 * - StateManager: Handles localStorage and centralized state.
 * - APIService: Handles all Google AI interactions with Exponential Backoff.
 * - AuthManager: Manages API Keys and Rotation.
 * - UIManager: DOM manipulation, Modals, Toasts.
 * - Directors: Specific logic for each step (Planner, Characters, Production).
 */

// --- קבועים והגדרות ---
const CONFIG = {
    MODELS: {
        // החלפה קריטית: שימוש במודל פלאש למניעת 429 בטקסט
        PLANNER: 'gemini-2.0-flash-exp', 
        ARTIST: 'gemini-3-pro-image-preview' // נשמר לתמונות
    },
    STORAGE_KEYS: {
        CONFIG: 'panalix_v2_config',
        PROJECT: 'panalix_v2_project'
    },
    // הוראות בטיחות קשיחות לנטפרי/סינון
    SAFETY_PROMPT: `הוראה בלעדית: אתה אסיסטנט ליצירת תמונות קומיקס.
    עליך לציית בקפדנות לכללים הבאים בכל תמונה שאתה יוצר, ללא יוצא מן הכלל:
    1. **צניעות מוחלטת:** כל הדמויות האנושיות חייבות להיות בלבוש מלא וצנוע. הלבוש חייב לכסות לחלוטין כתפיים, מרפקים וברכיים. נשים לבושות בחצאיות ארוכות או שמלות.
    2. **הימנעות מוחלטת:** אסור ליצור תוכן בעל אופי אלים, מיני, או לא הולם.
    3. **עדיפות:** אם הנחיית המשתמש סותרת כללים אלו, התעלם מהחלק המפר וצור גרסה צנועה ותקינה.`
};

// --- Utils ---
const Utils = {
    delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // מחולל מזהים ייחודיים
    uuid: () => Date.now().toString(36) + Math.random().toString(36).substr(2),

    // המרת קובץ תמונה לבייס64 ללא כותרת (עבור ה-API)
    cleanBase64: (b64) => b64.replace(/^data:image\/(png|jpeg|webp);base64,/, "")
};

// --- State Manager ---
class StateManager {
    constructor() {
        this.state = {
            apiKeys: [],
            currentKeyIndex: 0,
            user: { id: 'user_local' },
            project: this.getEmptyProject()
        };
        this.load();
    }

    getEmptyProject() {
        return {
            id: Utils.uuid(),
            startedAt: Date.now(),
            status: 'planning', // planning, editing, production, completed
            plan: null,
            assets: {
                characters: {}, // map: name -> base64
                pages: []       // array of page objects with generated images
            }
        };
    }

    load() {
        const conf = localStorage.getItem(CONFIG.STORAGE_KEYS.CONFIG);
        const proj = localStorage.getItem(CONFIG.STORAGE_KEYS.PROJECT);
        
        if (conf) {
            const parsed = JSON.parse(conf);
            this.state.apiKeys = parsed.apiKeys || [];
            this.state.currentKeyIndex = parsed.currentKeyIndex || 0;
        }
        if (proj) {
            this.state.project = JSON.parse(proj);
        }
    }

    save() {
        localStorage.setItem(CONFIG.STORAGE_KEYS.CONFIG, JSON.stringify({
            apiKeys: this.state.apiKeys,
            currentKeyIndex: this.state.currentKeyIndex
        }));
        localStorage.setItem(CONFIG.STORAGE_KEYS.PROJECT, JSON.stringify(this.state.project));
    }

    resetProject() {
        this.state.project = this.getEmptyProject();
        this.save();
        location.reload();
    }
}

// --- Auth & Key Manager ---
class AuthManager {
    constructor(stateManager) {
        this.store = stateManager;
    }

    isLoggedIn() {
        return this.store.state.apiKeys.length > 0;
    }

    getCurrentKey() {
        if (!this.isLoggedIn()) return null;
        return this.store.state.apiKeys[this.store.state.currentKeyIndex];
    }

    rotateKey() {
        const keys = this.store.state.apiKeys;
        if (keys.length <= 1) return false;
        
        this.store.state.currentKeyIndex = (this.store.state.currentKeyIndex + 1) % keys.length;
        this.store.save();
        window.app.ui.toast(`עבר למפתח גיבוי (${this.store.state.currentKeyIndex + 1}/${keys.length})`, 'info');
        return true;
    }

    addKeys(newKeysInput = null) {
        // אם לא הועבר קלט, קח מהמודל
        const input = newKeysInput || document.getElementById('backup-keys-area').value;
        const keys = input.split(/[\n,]+/).map(k => k.trim()).filter(k => k.length > 10);
        
        if (keys.length > 0) {
            // הוסף רק מפתחות שאין כבר
            const current = new Set(this.store.state.apiKeys);
            let addedCount = 0;
            keys.forEach(k => {
                if (!current.has(k)) {
                    this.store.state.apiKeys.push(k);
                    addedCount++;
                }
            });
            this.store.save();
            window.app.ui.toast(`${addedCount} מפתחות נוספו בהצלחה`, 'success');
            window.app.ui.updateKeyDisplay();
            if(!newKeysInput) window.app.ui.modals.close('keys');
            return true;
        }
        return false;
    }

    async validateAndLogin(key) {
        // בדיקת דמה מהירה
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODELS.PLANNER}:generateContent?key=${key}`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }] })
            });
            
            if (res.ok) {
                this.store.state.apiKeys = [key];
                this.store.save();
                return true;
            }
            return false;
        } catch (e) {
            console.error(e);
            return false;
        }
    }
}

// --- API Service (The Robust One) ---
class APIService {
    constructor(authManager) {
        this.auth = authManager;
    }

    /**
     * פונקציה ראשית לקריאות עם ניהול שגיאות ו-Backoff
     */
    async call(model, payload, retryCount = 0) {
        const key = this.auth.getCurrentKey();
        if (!key) throw new Error("No API Key");

        // השהיה קלה למניעת הצפה במודלים מהירים
        await Utils.delay(500 * (retryCount + 1));

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            // טיפול ב-429 (Too Many Requests)
            if (response.status === 429) {
                console.warn("Rate Limit Hit (429)");
                
                // נסה להחליף מפתח
                const rotated = this.auth.rotateKey();
                if (rotated) {
                    return this.call(model, payload, 0); // נסה מיד עם מפתח חדש
                } else {
                    // אין מפתחות? חכה אקספוננציאלית
                    if (retryCount < 3) {
                        const waitTime = Math.pow(2, retryCount) * 2000; // 2s, 4s, 8s
                        window.app.ui.toast(`עומס על המערכת, מנסה שוב בעוד ${waitTime/1000} שניות...`, 'warning');
                        await Utils.delay(waitTime);
                        return this.call(model, payload, retryCount + 1);
                    } else {
                        throw new Error("המערכת עמוסה מדי כרגע. אנא נסה שוב מאוחר יותר או הוסף מפתחות.");
                    }
                }
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error?.message || `HTTP Error ${response.status}`);
            }

            return await response.json();

        } catch (error) {
            console.error("API Call Failed:", error);
            throw error;
        }
    }

    async generateText(prompt, schema = null) {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            // safetySettings... (optional, handled by Prompt instruction mostly)
        };
        
        if (schema) {
            payload.generationConfig = {
                responseMimeType: "application/json",
                responseSchema: schema
            };
        }

        const data = await this.call(CONFIG.MODELS.PLANNER, payload);
        return data.candidates[0].content.parts[0].text;
    }

    async generateImage(prompt, inputImage = null) {
        // הזרקת הוראות הבטיחות לפרומפט עצמו
        const safePrompt = `${CONFIG.SAFETY_PROMPT}\n\nUSER REQUEST: ${prompt}`;
        
        const payload = {
            contents: [{ parts: [{ text: safePrompt }] }]
        };

        if (inputImage) {
            payload.contents[0].parts.push({
                inlineData: {
                    mimeType: "image/png",
                    data: Utils.cleanBase64(inputImage)
                }
            });
        }

        const data = await this.call(CONFIG.MODELS.ARTIST, payload);
        
        // חילוץ תמונה
        try {
            const part = data.candidates[0].content.parts.find(p => p.inlineData);
            if (part) {
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }
            throw new Error("No image data in response");
        } catch (e) {
            throw new Error("Failed to parse image response");
        }
    }
}

// --- UI Manager ---
class UIManager {
    constructor() {
        this.elements = {
            toastContainer: document.getElementById('toast-container'),
            loader: document.getElementById('app-loader'),
            authScreen: document.getElementById('auth-screen'),
            mainInterface: document.getElementById('main-interface'),
            navItems: document.querySelectorAll('.nav-item'),
            sections: document.querySelectorAll('.step-content')
        };
        
        this.modals = {
            open: (id) => document.getElementById(`modal-${id}`).classList.remove('hidden'),
            close: (id) => document.getElementById(`modal-${id}`).classList.add('hidden')
        };
    }

    init() {
        setTimeout(() => {
            this.elements.loader.classList.add('opacity-0', 'pointer-events-none');
        }, 800);
        lucide.createIcons();
    }

    showAuth() {
        this.elements.authScreen.classList.remove('hidden');
        this.elements.mainInterface.classList.add('hidden');
    }

    showApp() {
        this.elements.authScreen.classList.add('hidden');
        this.elements.mainInterface.classList.remove('hidden');
        this.updateKeyDisplay();
    }

    updateKeyDisplay() {
        const count = window.app.state.state.apiKeys.length;
        document.getElementById('pool-count').textContent = count;
        // מציג חלק מהמפתח הנוכחי
        const key = window.app.auth.getCurrentKey();
        if(key) document.getElementById('key-display').textContent = key.substring(0, 8) + '...';
    }

    navigateTo(step) {
        // עדכון ניווט
        this.elements.navItems.forEach(el => {
            const elStep = parseInt(el.dataset.step);
            el.classList.toggle('active', elStep === step);
            
            // עדכון אייקונים
            if (elStep === step) {
                el.querySelector('.nav-icon-bg').classList.add('bg-blue-600', 'text-white');
                el.querySelector('.nav-icon-bg').classList.remove('bg-blue-50', 'text-blue-600', 'bg-slate-100', 'text-slate-500');
            } else {
                // Reset style... (simplified for brevity)
            }
        });

        // עדכון תוכן
        this.elements.sections.forEach(sec => sec.classList.add('hidden'));
        document.getElementById(`step-${step}`).classList.remove('hidden');

        // עדכון כותרות
        const titles = ["", "תכנון עלילה", "דמויות וסטוריבורד", "ייצור ועיבוד"];
        document.getElementById('page-title').textContent = titles[step];
        document.getElementById('page-subtitle').textContent = `שלב ${step} מתוך 3`;
    }

    toast(msg, type = 'info') {
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        
        let icon = 'info';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'alert-triangle';

        el.innerHTML = `<i data-lucide="${icon}" class="w-5 h-5"></i> <span>${msg}</span>`;
        this.elements.toastContainer.appendChild(el);
        lucide.createIcons({ root: el });

        setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-100%)';
            setTimeout(() => el.remove(), 300);
        }, 4000);
    }

    enableNav(step) {
        const btn = document.querySelector(`.nav-item[data-step="${step}"]`);
        if (btn) btn.disabled = false;
    }
}

// --- Directors (Logic for each step) ---

class PlannerDirector {
    constructor() {
        this.schema = {
            type: "OBJECT",
            properties: {
                title: { type: "STRING" },
                globalStyle: { type: "STRING" },
                characters: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            name: { type: "STRING" },
                            description: { type: "STRING" }
                        },
                        required: ["name", "description"]
                    }
                },
                pages: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            pageNumber: { type: "INTEGER" },
                            sceneDescription: { type: "STRING" },
                            compositionSuggestion: { type: "STRING" },
                            suggestedEmotion: { type: "STRING" },
                            dialogue: {
                                type: "ARRAY",
                                items: {
                                    type: "OBJECT",
                                    properties: {
                                        character: { type: "STRING" },
                                        text: { type: "STRING" }
                                    }
                                }
                            }
                        },
                        required: ["pageNumber", "sceneDescription"]
                    }
                }
            },
            required: ["title", "globalStyle", "characters", "pages"]
        };
    }

    async generatePlan() {
        const promptText = document.getElementById('story-prompt').value;
        if (promptText.length < 20) {
            window.app.ui.toast("אנא כתוב תיאור מפורט יותר (לפחות 20 תווים)", "error");
            return;
        }

        const btn = document.getElementById('btn-generate-plan');
        btn.disabled = true;
        btn.innerHTML = `<div class="loader-ring w-5 h-5 border-2 border-white/50 border-b-white mr-2"></div> מעבד נתונים...`;

        try {
            const prompt = `Create a detailed comic book script in JSON format based on this story: "${promptText}". 
            Language: Hebrew (Unless story is English).`;
            
            const jsonStr = await window.app.api.generateText(prompt, this.schema);
            const plan = JSON.parse(jsonStr);

            window.app.state.state.project.plan = plan;
            window.app.state.state.project.status = 'planning_complete';
            window.app.state.save();

            window.app.ui.toast("תוכנית נוצרה בהצלחה!", "success");
            window.app.ui.enableNav(2);
            window.app.director.renderEditor(); // Render Step 2
            window.app.ui.navigateTo(2);

        } catch (e) {
            window.app.ui.toast("שגיאה ביצירה: " + e.message, "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="wand-2" class="w-4 h-4"></i> צור תוכנית קומיקס`;
            lucide.createIcons();
        }
    }
}

class Director {
    // מנהל את שלב 2 (עריכה ואישור)
    renderEditor() {
        const plan = window.app.state.state.project.plan;
        if (!plan) return;

        // מילוי שדות
        document.getElementById('project-title').value = plan.title;
        document.getElementById('project-style').value = plan.globalStyle;

        // רינדור דמויות
        const charContainer = document.getElementById('characters-container');
        charContainer.innerHTML = '';
        
        plan.characters.forEach((char, idx) => {
            const hasImg = window.app.state.state.project.assets.characters[char.name];
            const card = document.createElement('div');
            card.className = 'character-card bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden group';
            card.innerHTML = `
                <div class="character-img-container h-48 bg-slate-100 relative flex items-center justify-center overflow-hidden">
                    ${hasImg 
                        ? `<img src="${hasImg}" class="w-full h-full object-cover transition-transform group-hover:scale-110">`
                        : `<div class="text-center p-4"><i data-lucide="user" class="w-8 h-8 text-slate-300 mx-auto mb-2"></i><span class="text-xs text-slate-400">טרם נוצר</span></div>`
                    }
                    <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onclick="window.app.director.generateSingleChar('${char.name}')" class="p-2 bg-white rounded-full text-blue-600 hover:scale-110 transition" title="צור מחדש"><i data-lucide="refresh-cw" class="w-4 h-4"></i></button>
                        ${hasImg ? `<button onclick="window.app.director.editImage('character', '${char.name}')" class="p-2 bg-white rounded-full text-purple-600 hover:scale-110 transition" title="ערוך"><i data-lucide="edit" class="w-4 h-4"></i></button>` : ''}
                    </div>
                </div>
                <div class="p-3">
                    <h4 class="font-bold text-slate-800">${char.name}</h4>
                    <p class="text-xs text-slate-500 line-clamp-2 mt-1" title="${char.description}">${char.description}</p>
                </div>
            `;
            charContainer.appendChild(card);
        });

        // רינדור עמודים (טקסטואלי)
        const pagesContainer = document.getElementById('pages-editor-container');
        pagesContainer.innerHTML = '';
        plan.pages.forEach((page, idx) => {
            const div = document.createElement('div');
            div.className = 'bg-white p-6 rounded-xl border border-slate-200 shadow-sm relative';
            div.innerHTML = `
                <div class="absolute -right-3 -top-3 w-8 h-8 bg-slate-800 text-white rounded-lg flex items-center justify-center font-bold shadow-lg text-sm">${page.pageNumber}</div>
                <div class="grid grid-cols-1 gap-4">
                    <div>
                        <span class="text-xs font-bold text-slate-400 uppercase">תיאור הסצנה</span>
                        <p class="text-sm text-slate-700 mt-1 p-2 bg-slate-50 rounded border border-slate-100" contenteditable="true" onblur="window.app.director.updatePage(${idx}, 'sceneDescription', this.innerText)">${page.sceneDescription}</p>
                    </div>
                    <div>
                        <span class="text-xs font-bold text-slate-400 uppercase">דיאלוגים</span>
                        <div class="mt-1 space-y-1">
                            ${page.dialogue.map(d => `<div class="text-sm"><span class="font-bold text-blue-600">${d.character}:</span> ${d.text}</div>`).join('')}
                        </div>
                    </div>
                </div>
            `;
            pagesContainer.appendChild(div);
        });

        lucide.createIcons();
    }

    async generateAllCharacters() {
        const chars = window.app.state.state.project.plan.characters;
        const style = window.app.state.state.project.plan.globalStyle;
        let success = 0;

        window.app.ui.toast("מתחיל ביצירת דמויות...", "info");

        for (const char of chars) {
            try {
                const prompt = `Character Reference Sheet. Style: ${style}. Character Name: ${char.name}. Description: ${char.description}. Full body shot, neutral background, consistent lighting.`;
                const img = await window.app.api.generateImage(prompt);
                window.app.state.state.project.assets.characters[char.name] = img;
                this.renderEditor(); // Update UI live
                success++;
            } catch (e) {
                console.error(e);
            }
        }
        
        window.app.state.save();
        window.app.ui.toast(`תהליך הסתיים. נוצרו ${success}/${chars.length} דמויות.`, success === chars.length ? "success" : "warning");
    }

    async generateSingleChar(name) {
        const char = window.app.state.state.project.plan.characters.find(c => c.name === name);
        if(!char) return;
        
        window.app.ui.toast(`יוצר את ${name}...`, "info");
        try {
            const style = document.getElementById('project-style').value;
            const prompt = `Character Reference Sheet. Style: ${style}. Character: ${char.name}. Description: ${char.description}. Full body shot, white background.`;
            const img = await window.app.api.generateImage(prompt);
            window.app.state.state.project.assets.characters[name] = img;
            window.app.state.save();
            this.renderEditor();
        } catch(e) {
            window.app.ui.toast("נכשל: " + e.message, "error");
        }
    }

    editImage(type, id) {
        // פותח את המודל הגנרי לעריכה
        const modal = document.getElementById('modal-editor');
        const img = document.getElementById('editor-preview-img');
        let src = "";
        
        if (type === 'character') src = window.app.state.state.project.assets.characters[id];
        else if (type === 'page') src = window.app.state.state.project.assets.pages[id]?.image;

        if (!src) return window.app.ui.toast("אין תמונה לעריכה", "error");

        img.src = src;
        window.app.currentEdit = { type, id }; // שומר הקשר גלובלי זמני
        window.app.ui.modals.open('editor');
    }
}

class ProductionDirector {
    async start() {
        // ולידציה
        const hasChars = Object.keys(window.app.state.state.project.assets.characters).length > 0;
        if (!hasChars) {
            if(!confirm("עדיין לא יצרת תמונות לכל הדמויות. האם להמשיך בכל זאת?")) return;
        }

        window.app.ui.enableNav(3);
        window.app.ui.navigateTo(3);

        const pages = window.app.state.state.project.plan.pages;
        const style = window.app.state.state.project.plan.globalStyle;
        const statusText = document.getElementById('prod-status-text');
        const progressBar = document.getElementById('prod-bar');
        const percentText = document.getElementById('prod-percent');
        document.getElementById('production-status').classList.remove('hidden');

        // לולאת ייצור
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            
            // עדכון UI
            const percent = Math.round(((i) / pages.length) * 100);
            progressBar.style.width = `${percent}%`;
            percentText.innerText = `${percent}%`;
            statusText.innerText = `מייצר עמוד ${page.pageNumber}...`;

            // דילוג אם קיים
            if (window.app.state.state.project.assets.pages[i]) {
                this.renderPage(i);
                continue;
            }

            try {
                // בניית הפרומפט החכם
                let prompt = `Comic Panel. Style: ${style}. 
                Scene Description: ${page.sceneDescription}.
                Composition: ${page.compositionSuggestion}.
                Mood: ${page.suggestedEmotion}.`;

                // הוספת מידע על דמויות בסצנה
                const charsInScene = window.app.state.state.project.plan.characters.filter(c => 
                    page.sceneDescription.includes(c.name) || 
                    (page.dialogue && page.dialogue.some(d => d.character === c.name))
                );

                if (charsInScene.length > 0) {
                    prompt += "\n\nCHARACTERS DETAILED APPEARANCE:";
                    charsInScene.forEach(c => prompt += `\n- ${c.name}: ${c.description}`);
                }

                const img = await window.app.api.generateImage(prompt);
                
                // שמירה
                window.app.state.state.project.assets.pages[i] = {
                    image: img,
                    timestamp: Date.now()
                };
                window.app.state.save();
                this.renderPage(i);

            } catch (e) {
                console.error(`Page ${i} fail`, e);
                window.app.ui.toast(`שגיאה בעמוד ${i+1}`, "error");
            }
        }

        // סיום
        progressBar.style.width = '100%';
        percentText.innerText = '100%';
        statusText.innerText = 'הושלם!';
        setTimeout(() => document.getElementById('production-status').classList.add('hidden'), 2000);
    }

    renderPage(idx) {
        const container = document.getElementById('comic-gallery');
        const pageData = window.app.state.state.project.plan.pages[idx];
        const asset = window.app.state.state.project.assets.pages[idx];

        if (!asset) return;

        // בדיקה אם קיים כבר כדי למנוע כפילויות ברינדור חוזר
        const existing = document.getElementById(`comic-page-${idx}`);
        if(existing) existing.remove();

        const div = document.createElement('div');
        div.id = `comic-page-${idx}`;
        div.className = 'comic-panel flex flex-col gap-4 animate-slide-up';
        
        div.innerHTML = `
            <div class="relative group cursor-pointer overflow-hidden rounded-lg">
                <img src="${asset.image}" class="w-full h-auto object-cover">
                <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                    <button onclick="window.app.director.editImage('page', ${idx})" class="bg-white text-slate-800 px-4 py-2 rounded-full font-bold shadow hover:scale-105 transition">ערוך תמונה</button>
                </div>
                <div class="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">#${pageData.pageNumber}</div>
            </div>
            
            <div class="space-y-2">
                ${pageData.dialogue.map(d => `
                    <div class="flex items-start gap-2">
                        <div class="bg-blue-100 text-blue-800 text-[10px] font-bold px-1 py-0.5 rounded uppercase mt-1">${d.character}</div>
                        <div class="speech-bubble flex-1">${d.text}</div>
                    </div>
                `).join('')}
            </div>
        `;

        // הוספה בסדר הנכון (פשוט append כי הלולאה רצה לפי סדר, אבל ליתר ביטחון)
        container.appendChild(div);
    }
}

// --- Main App Bootstrapper ---
class App {
    constructor() {
        this.state = new StateManager();
        this.auth = new AuthManager(this.state);
        this.api = new APIService(this.auth);
        this.ui = new UIManager();
        
        // Sub-modules
        this.planner = new PlannerDirector();
        this.director = new Director(); // Step 2
        this.production = new ProductionDirector(); // Step 3
        
        this.init();
    }

    init() {
        this.ui.init();

        // Event Listeners
        document.getElementById('login-btn').addEventListener('click', () => this.handleLogin());
        document.getElementById('btn-generate-plan').addEventListener('click', () => this.planner.generatePlan());
        document.getElementById('logout-btn').addEventListener('click', () => {
            if(confirm('האם אתה בטוח? המפתחות יימחקו.')) {
                this.state.resetProject();
            }
        });

        // Navigation
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if(btn.disabled) return;
                const step = parseInt(btn.dataset.step);
                this.ui.navigateTo(step);
            });
        });

        // Editor Action
        document.getElementById('btn-run-edit').addEventListener('click', async () => {
            if (!this.currentEdit) return;
            const prompt = document.getElementById('editor-prompt').value;
            const imgEl = document.getElementById('editor-preview-img');
            const btn = document.getElementById('btn-run-edit');
            
            if(!prompt) return;
            btn.disabled = true;
            btn.innerText = "מעבד...";

            try {
                const newImg = await this.api.generateImage(`Edit instruction: ${prompt}`, imgEl.src);
                
                // שמירה במקום הנכון
                if (this.currentEdit.type === 'character') {
                    this.state.state.project.assets.characters[this.currentEdit.id] = newImg;
                    this.director.renderEditor();
                } else {
                    this.state.state.project.assets.pages[this.currentEdit.id].image = newImg;
                    this.state.state.project.assets.pages[this.currentEdit.id].timestamp = Date.now();
                    this.production.renderPage(this.currentEdit.id);
                }
                
                this.state.save();
                imgEl.src = newImg;
                this.ui.toast("עריכה בוצעה!", "success");
            } catch (e) {
                this.ui.toast("שגיאה בעריכה: " + e.message, "error");
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i data-lucide="wand-2" class="w-4 h-4"></i> בצע עריכה`;
                lucide.createIcons();
            }
        });

        // Check Auth
        if (this.auth.isLoggedIn()) {
            this.ui.showApp();
            // שחזור מצב
            if (this.state.state.project.plan) {
                this.ui.enableNav(2);
                this.director.renderEditor();
                this.ui.navigateTo(2);
                if (Object.keys(this.state.state.project.assets.pages).length > 0) {
                    this.ui.enableNav(3);
                    this.production.start(); // Will just render existing
                }
            } else {
                this.ui.navigateTo(1);
            }
        } else {
            this.ui.showAuth();
        }
    }

    async handleLogin() {
        const input = document.getElementById('api-key-input');
        const key = input.value.trim();
        const btn = document.getElementById('login-btn');
        const loader = btn.querySelector('.btn-loader');
        const text = btn.querySelector('.btn-text');
        const errorBox = document.getElementById('auth-error-msg');

        if (!key) return;

        text.classList.add('hidden');
        loader.classList.remove('hidden');
        btn.disabled = true;
        errorBox.classList.add('hidden');

        const success = await this.auth.validateAndLogin(key);

        if (success) {
            this.ui.showApp();
            this.ui.navigateTo(1);
        } else {
            errorBox.classList.remove('hidden');
            errorBox.querySelector('.error-text').innerText = "המפתח שגוי או שאין לו הרשאות מתאימות.";
            text.classList.remove('hidden');
            loader.classList.add('hidden');
            btn.disabled = false;
        }
    }
}

// הפעלה
window.app = new App();
