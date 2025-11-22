"use strict";

/* ==============================================
  קובץ הסקריפט הראשי של פאנליקס (Panalix)
  גרסה מלאה, מאוחדת ותקינה (ללא כפילויות)
  ==============================================
*/

// ייבוא ה-SDK של Google Gemini
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "https://esm.run/@google/generative-ai";

// --- 1. משתנים גלובליים ומצב האפליקציה ---

let genAI;
let modelPlanner; // (gemini-3-pro-preview) - לתכנון ה-JSON
let modelArtist;  // (gemini-3-pro-image-preview) - ליצירת התמונות

// מאגר מפתחות ה-API (Key Pool)
let apiKeyPool = [];
let currentKeyIndex = 0;

// אובייקט שיחזיק את כל נתוני הפרויקט הנוכחי
let currentProject = {
    story: "",
    jsonPlan: null,     // התוכנית המלאה מה-AI
    characters: [],     // מערך של { name, description, referenceImageB64 }
    generatedPages: []  // מערך של { pageNumber, imageB64, mimeType }
};

// הוראת מערכת קבועה לבטיחות וצניעות - נשלחת עם כל בקשת תמונה
const SAFETY_SYSTEM_PROMPT = `
הוראה בלעדית: אתה אסיסטנט ליצירת תמונות קומיקס.
עליך לציית בקפדנות לכללים הבאים בכל תמונה שאתה יוצר, ללא יוצא מן הכלל:
1.  **צניעות מוחלטת:** כל הדמויות האנושיות, גברים ונשים כאחד, חייבות להיות בלבוש מלא וצנוע. הלבוש חייב לכסות לחלוטין את הכתפיים, המרפקים, פלג הגוף העליון (עד הצוואר) והברכיים.
2.  **הימנעות מוחלטת:** אסור ליצור כל תוכן בעל אופי רומנטי, אלים, או כל סצנה שעלולה להתפרש כלא הולמת או לא צנועה.
3.  **עדיפות:** אם הנחיית המשתמש מבקשת משהו שסותר כללים אלו, עליך להתעלם מהחלק המפר בהנחיה וליצור גרסה צנועה ותקינה של התמונה התואמת לכללים אלו במלואם.
`;

// הגדרות בטיחות מחמירות עבור ה-API
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }, // חסימה מחמירה
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

// מפתחות לשמירה ב-LocalStorage
const STORAGE_KEYS_KEY = 'panalix_api_keys';
const STORAGE_PROJECT_KEY = 'panalix_current_project';

// --- 2. בחירת רכיבי DOM (ריכוז כל האלמנטים) ---
const dom = {
    // מסכים
    apiKeyScreen: document.getElementById('api-key-screen'),
    mainApp: document.getElementById('main-app'),
    
    // קלט API
    apiKeyInput: document.getElementById('api-key-input'),
    saveApiKeyBtn: document.getElementById('save-api-key-btn'),
    
    // שלב 1: קלט סיפור
    storyInputSection: document.getElementById('story-input-section'),
    storyPromptInput: document.getElementById('story-prompt-input'),
    generatePlanBtn: document.getElementById('generate-plan-btn'),
    
    // שלב 2: אישורים
    approvalSection: document.getElementById('approval-section'),
    characterApprovalContainer: document.getElementById('character-approval-container'),
    planEditorContainer: document.getElementById('plan-editor-container'),
    improvePlanBtn: document.getElementById('improve-plan-btn'),
    approvePlanBtn: document.getElementById('approve-plan-btn'),
    
    // שלב 3: יצירה
    generationSection: document.getElementById('generation-section'),
    generationProgress: document.getElementById('generation-progress'),
    progressBarFill: document.getElementById('progress-bar-fill'),
    progressText: document.getElementById('progress-text'),
    comicViewerContainer: document.getElementById('comic-viewer-container'),
    exportPdfBtn: document.getElementById('export-pdf-btn'),
    exportCbzBtn: document.getElementById('export-cbz-btn'),
    
    // הגדרות וניהול
    settingsSection: document.getElementById('settings-section'),
    keyCountDisplay: document.getElementById('key-count-display'),
    manageKeysBtn: document.getElementById('manage-keys-btn'),
    storageUsageDisplay: document.getElementById('storage-usage-display'),
    clearStorageBtn: document.getElementById('clear-storage-btn'),
    
    // מודאלים (חלונות קופצים)
    loadingModal: document.getElementById('loading-modal'),
    loadingText: document.getElementById('loading-text'),
    
    keyPoolModal: document.getElementById('key-pool-modal'),
    keyPoolMessage: document.getElementById('key-pool-message'),
    backupKeysInput: document.getElementById('backup-keys-input'),
    addBackupKeysBtn: document.getElementById('add-backup-keys-btn'),
    
    editModal: document.getElementById('edit-modal'),
    editModalImage: document.getElementById('edit-modal-image'),
    editModalPrompt: document.getElementById('edit-modal-prompt'),
    applyEditBtn: document.getElementById('apply-edit-btn'),
    closeEditModalBtn: document.getElementById('close-edit-modal-btn'),
    editModalTitle: document.querySelector('#edit-modal h3')
};

// --- 3. פונקציית אתחול ראשית ---

// הרצה בעת טעינת הדף
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    console.log("מערכת פאנליקס אותחלה בהצלחה.");
    
    // ניסיון טעינת מצב קודם
    loadInitialState();
    
    // רישום מאזינים (פעם אחת בלבד!)
    registerEventListeners();
}

/**
 * רישום מרוכז של כל מאזיני האירועים למניעת כפילויות
 */
function registerEventListeners() {
    // מסך מפתחות
    dom.saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    dom.addBackupKeysBtn.addEventListener('click', handleAddBackupKeys);
    
    // שלב 1: יצירה
    dom.generatePlanBtn.addEventListener('click', handleGeneratePlan);
    
    // שלב 2: אישור ועריכה
    dom.improvePlanBtn.addEventListener('click', handleImprovePlan);
    dom.approvePlanBtn.addEventListener('click', handleApprovePlan);

    // מודאל עריכה (חל על דמויות ועמודים)
    dom.applyEditBtn.addEventListener('click', handleApplyEdit);
    dom.closeEditModalBtn.addEventListener('click', () => dom.editModal.classList.remove('visible'));

    // שלב 3: ייצוא
    dom.exportPdfBtn.addEventListener('click', handleExportPdf);
    dom.exportCbzBtn.addEventListener('click', handleExportCbz);

    // הגדרות וניהול
    dom.manageKeysBtn.addEventListener('click', () => showKeyPoolModal("ניהול מפתחות", 0));
    dom.clearStorageBtn.addEventListener('click', handleClearStorage);
}

// --- 4. ניהול API ומפתחות גיבוי ---

function initializeApi(keys) {
    apiKeyPool = keys;
    currentKeyIndex = 0;
    
    if (apiKeyPool.length > 0) {
        setApiKey(apiKeyPool[currentKeyIndex]);
        updateKeyCountDisplay();
    }
}

function setApiKey(key) {
    try {
        genAI = new GoogleGenerativeAI(key);
        
        // הגדרת מודל ה"תכנון" (טקסט בלבד, חשיבה גבוהה)
        modelPlanner = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            safetySettings: safetySettings
        });

        // הגדרת מודל ה"אמן" (יצירת תמונות)
        modelArtist = genAI.getGenerativeModel({
            model: "gemini-3-pro-image-preview",
            safetySettings: safetySettings,
            systemInstruction: SAFETY_SYSTEM_PROMPT, // הטמעת הוראות הצניעות
        });
        
        console.log(`מפתח API הוגדר (אינדקס: ${currentKeyIndex})`);
    } catch (error) {
        console.error("שגיאה באתחול ה-API:", error);
    }
}

function switchToNextKey() {
    console.warn(`מפתח API באינדקס ${currentKeyIndex} הגיע למגבלה.`);
    currentKeyIndex++;
    
    if (currentKeyIndex < apiKeyPool.length) {
        console.log(`מחליף למפתח הבא באינדקס ${currentKeyIndex}...`);
        setApiKey(apiKeyPool[currentKeyIndex]);
        return true;
    } else {
        console.error("נגמרו כל מפתחות ה-API במאגר!");
        showKeyPoolModal("כל המפתחות הגיעו למגבלה. אנא הוסף מפתחות גיבוי.", 1);
        return false;
    }
}

/**
 * פונקציית מעטפת לביצוע קריאות ל-API עם מנגנון Retry והחלפת מפתחות
 */
async function generateWithRetry(model, generationConfig, contents) {
    // מספר הניסיונות כמספר המפתחות הזמינים
    const maxRetries = Math.max(apiKeyPool.length, 1);
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await model.generateContent({
                contents: contents,
                generationConfig: generationConfig
            });
            return result; // הצלחה
            
        } catch (error) {
            console.error(`שגיאה ב-API (ניסיון ${attempt + 1}):`, error);
            const errorStr = error.toString().toLowerCase();
            
            // זיהוי שגיאות של מכסה/עומס
            const isRateLimitError = errorStr.includes("429") || 
                                     errorStr.includes("rate_limit_exceeded") ||
                                     errorStr.includes("resource_exhausted") ||
                                     errorStr.includes("quota");

            if (isRateLimitError) {
                const switched = switchToNextKey();
                if (switched) {
                    showLoading(true, `מגבלת שימוש. מחליף למפתח גיבוי (${currentKeyIndex + 1}/${apiKeyPool.length})...`);
                    continue; // נסה שוב עם המפתח החדש
                } else {
                    throw new Error("כל מפתחות ה-API הגיעו למגבלת השימוש שלהם.");
                }
            } else {
                // שגיאה אחרת (למשל Safety) - זרוק אותה החוצה
                throw error;
            }
        }
    }
    throw new Error("היצירה נכשלה לאחר ניסיון עם כל המפתחות הזמינים.");
}

function handleSaveApiKey() {
    const key = dom.apiKeyInput.value.trim();
    if (key) {
        const keys = [key];
        saveKeysToStorage(keys);
        initializeApi(keys);
        showScreen('main-app');
        saveInitialStateToStorage(key, keys);
    } else {
        alert("אנא הזן מפתח API חוקי.");
    }
}

function handleAddBackupKeys() {
    const newKeysText = dom.backupKeysInput.value.trim();
    if (newKeysText) {
        const newKeys = newKeysText.split('\n').map(k => k.trim()).filter(k => k.length > 0);
        if (newKeys.length > 0) {
            apiKeyPool = [...apiKeyPool, ...newKeys];
            saveKeysToStorage(apiKeyPool);
            updateKeyCountDisplay();
            // אם היינו תקועים בלי מפתחות, נסה לאתחול מחדש את הנוכחי
            if (!genAI) setApiKey(apiKeyPool[currentKeyIndex]);
            
            dom.backupKeysInput.value = '';
            dom.keyPoolModal.classList.remove('visible');
            alert(`נוספו ${newKeys.length} מפתחות בהצלחה.`);
        }
    }
}

function updateKeyCountDisplay() {
    dom.keyCountDisplay.textContent = apiKeyPool.length;
}

// --- 5. שלב 1: יצירת תוכנית (Planner Logic) ---

function getComicPlanSchema() {
    return {
        type: "OBJECT",
        properties: {
            "title": { "type": "STRING", "description": "שם קצר וקליט לקומיקס" },
            "globalStyle": { "type": "STRING", "description": "תיאור סגנון הציור הגלובלי (למשל: 'סגנון מנגה שחור-לבן', 'סגנון קומיקס אמריקאי וינטג'')" },
            "characters": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": { "type": "STRING", "description": "שם הדמות" },
                        "description": { "type": "STRING", "description": "תיאור חזותי מפורט של הדמות (גיל, שיער, לבוש עיקרי) ליצירת תמונת ייחוס." }
                    },
                    "required": ["name", "description"]
                }
            },
            "pages": {
                "type": "ARRAY",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "pageNumber": { "type": "NUMBER" },
                        "sceneDescription": { "type": "STRING", "description": "תיאור חזותי מפורט של הסצנה בעמוד זה." },
                        "compositionSuggestion": { "type": "STRING", "description": "הצעה לקומפוזיציה (זווית, פוקוס)." },
                        "suggestedEmotion": { "type": "STRING", "description": "הרגש המרכזי בסצנה." },
                        "dialogue": {
                            "type": "ARRAY",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "character": { "type": "STRING" },
                                    "type": { "type": "STRING", "enum": ["speech", "thought"] },
                                    "text": { "type": "STRING" }
                                }
                            }
                        },
                        "narration": { "type": "STRING" }
                    },
                    "required": ["pageNumber", "sceneDescription"]
                }
            }
        },
        "required": ["title", "globalStyle", "characters", "pages"]
    };
}

async function handleGeneratePlan() {
    const storyPrompt = dom.storyPromptInput.value.trim();
    if (!storyPrompt) {
        alert("אנא הזן סיפור.");
        return;
    }
    if (!modelPlanner) {
        alert("שגיאה: מודל ה-API לא אותחל.");
        return;
    }

    showLoading(true, "יוצר תוכנית עלילה... (שלב 1/3)");
    currentProject.story = storyPrompt;

    try {
        const fullPrompt = `
            בהתבסס על הסיפור: "${storyPrompt}", צור תוכנית קומיקס מפורטת.
            עליך להחזיר אך ורק JSON חוקי התואם לסכמה. צור לפחות 3 דמויות ו-5 עמודים.
        `;
        
        const generationConfig = {
            responseMimeType: "application/json",
            responseSchema: getComicPlanSchema()
        };
        
        const result = await generateWithRetry(modelPlanner, generationConfig, [fullPrompt]);
        const responseText = result.response.candidates[0].content.parts[0].text;
        currentProject.jsonPlan = JSON.parse(responseText);
        
        saveProjectToStorage();
        showLoading(false);
        
        // מעבר לשלב הבא
        await renderCharacterApprovalUI();
        renderPlanEditorUI();
        showScreen('approval-section');

    } catch (error) {
        console.error("יצירת התוכנית נכשלה:", error);
        showLoading(false);
        alert(`שגיאה ביצירת התוכנית: ${error.message}`);
    }
}

// --- 6. שלב 2: אישור דמויות ועורך JSON ---

async function renderCharacterApprovalUI() {
    if (!currentProject.jsonPlan?.characters) return;

    const characters = currentProject.jsonPlan.characters;
    dom.characterApprovalContainer.innerHTML = ''; 
    
    // אם זו פעם ראשונה, אתחל את מערך הדמויות מהתוכנית
    if (currentProject.characters.length === 0) {
         currentProject.characters = characters.map(char => ({
            name: char.name,
            description: char.description,
            referenceImageB64: null,
        }));
    } else {
        // אם הדמויות כבר קיימות (למשל מטעינה), בדוק אם יש להן תמונות
        const allImagesExist = currentProject.characters.every(c => c.referenceImageB64);
        if (allImagesExist) {
            currentProject.characters.forEach((char, i) => renderCharacterCard(char, i));
            return;
        }
    }

    showLoading(true, `יוצר תמונות ייחוס לדמויות... (שלב 2/3)`);

    try {
        for (let i = 0; i < currentProject.characters.length; i++) {
            const char = currentProject.characters[i];
            
            // אם כבר יש תמונה, דלג
            if (char.referenceImageB64) {
                 renderCharacterCard(char, i);
                 continue;
            }

            showLoading(true, `יוצר תמונת ייחוס עבור: ${char.name}... (${i + 1}/${characters.length})`);

            // הנחיה ליצירת דמות
            const prompt = `
                צור תמונת פורטרט-ייחוס (portrait reference photo) עבור דמות קומיקס בשם ${char.name}.
                תיאור: "${char.description}".
                רקע ניטרלי ואחיד (לבן). סגנון: "${currentProject.jsonPlan.globalStyle}".
            `;

            const result = await generateWithRetry(modelArtist, {}, [prompt]);
            const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
            
            if (part && part.inlineData) {
                char.referenceImageB64 = part.inlineData.data;
                renderCharacterCard(char, i);
            }
            saveProjectToStorage();
        }
        showLoading(false);
    } catch (error) {
        console.error("שגיאה ביצירת תמונות דמויות:", error);
        showLoading(false);
        dom.characterApprovalContainer.innerHTML += `<p class="error-msg">שגיאה חלקית ביצירה. בדוק מכסות.</p>`;
    }
}

function renderCharacterCard(char, index) {
    const imageSrc = `data:image/png;base64,${char.referenceImageB64}`;
    const cardHTML = `
        <div class="character-card" data-character-index="${index}">
            <img src="${imageSrc}" alt="${char.name}">
            <div class="card-content">
                <h4>${char.name}</h4>
                <p>${char.description.substring(0, 100)}...</p>
                <button class="secondary-btn edit-character-btn">ערוך דמות</button>
            </div>
        </div>
    `;
    dom.characterApprovalContainer.insertAdjacentHTML('beforeend', cardHTML);
    
    // רישום מאזין לכפתור שנוצר דינמית
    const newBtn = dom.characterApprovalContainer.lastElementChild.querySelector('.edit-character-btn');
    newBtn.addEventListener('click', () => showEditModal('character', index));
}

// עורך התוכנית (JSON Visual Editor)
function renderPlanEditorUI() {
    if (!currentProject.jsonPlan?.pages) return;
    const plan = currentProject.jsonPlan;
    dom.planEditorContainer.innerHTML = '';

    // שדות גלובליים
    dom.planEditorContainer.innerHTML += `
        <div class="form-group">
            <label>כותרת:</label>
            <input type="text" class="plan-edit-field" data-key="title" value="${escapeHTML(plan.title)}">
        </div>
        <div class="form-group">
            <label>סגנון:</label>
            <input type="text" class="plan-edit-field" data-key="globalStyle" value="${escapeHTML(plan.globalStyle)}">
        </div>
    `;

    // עמודים
    plan.pages.forEach((page, index) => {
        const pageHTML = `
            <div class="plan-page-item" data-page-index="${index}">
                <h4 class="plan-page-header">עמוד ${page.pageNumber}</h4>
                <div class="plan-page-content">
                    <div class="form-group"><label>סצנה:</label><textarea class="plan-edit-field" data-key="sceneDescription">${escapeHTML(page.sceneDescription)}</textarea></div>
                    <div class="form-group"><label>קומפוזיציה:</label><input type="text" class="plan-edit-field" data-key="compositionSuggestion" value="${escapeHTML(page.compositionSuggestion || '')}"></div>
                    <div class="form-group"><label>רגש:</label><input type="text" class="plan-edit-field" data-key="suggestedEmotion" value="${escapeHTML(page.suggestedEmotion || '')}"></div>
                    <div class="form-group"><label>קריינות:</label><input type="text" class="plan-edit-field" data-key="narration" value="${escapeHTML(page.narration || '')}"></div>
                </div>
            </div>
        `;
        dom.planEditorContainer.innerHTML += pageHTML;
    });

    dom.planEditorContainer.querySelectorAll('.plan-edit-field').forEach(field => {
        field.addEventListener('input', handlePlanChange);
    });
}

function handlePlanChange(e) {
    const field = e.target;
    const key = field.dataset.key;
    const value = field.value;
    const pageItem = field.closest('.plan-page-item');
    
    if (pageItem) {
        const pageIndex = parseInt(pageItem.dataset.pageIndex, 10);
        currentProject.jsonPlan.pages[pageIndex][key] = value;
    } else {
        currentProject.jsonPlan[key] = value;
    }
    saveProjectToStorage();
}

async function handleImprovePlan() {
    if (!currentProject.jsonPlan) return;
    showLoading(true, "ה-AI משפר את התוכנית...");
    try {
        const prompt = `שפר את תוכנית הקומיקס הבאה (JSON): ${JSON.stringify(currentProject.jsonPlan)}. 
                       התמקד בשיפור הדרמה, הקומפוזיציה והזרימה. החזר JSON חוקי בלבד.`;
        
        const result = await generateWithRetry(modelPlanner, { responseMimeType: "application/json", responseSchema: getComicPlanSchema() }, [prompt]);
        currentProject.jsonPlan = JSON.parse(result.response.candidates[0].content.parts[0].text);
        
        saveProjectToStorage();
        renderPlanEditorUI();
        showLoading(false);
        alert("התוכנית שופרה בהצלחה!");
    } catch (e) {
        showLoading(false);
        alert("שגיאה בשיפור: " + e.message);
    }
}

// --- 7. שלב 3: יצירת הקומיקס (Generation Logic) ---

async function handleApprovePlan() {
    // בדיקה שכל הדמויות מוכנות
    if (!currentProject.jsonPlan || !currentProject.characters.every(c => c.referenceImageB64)) {
        alert("התוכנית או הדמויות אינן מוכנות. ודא שלכל הדמויות יש תמונות.");
        return;
    }
    
    // בדיקת מכסות פשוטה
    const requiredCalls = currentProject.jsonPlan.pages.length;
    if (apiKeyPool.length * 10 < requiredCalls) { // הערכה: 10 תמונות למפתח
        showKeyPoolModal(`נדרשות כ-${requiredCalls} קריאות.`, 1);
        return;
    }

    showScreen('generation-section');
    await startGenerationProcess();
}

async function startGenerationProcess() {
    dom.comicViewerContainer.innerHTML = '';
    dom.generationProgress.classList.remove('hidden');
    const pages = currentProject.jsonPlan.pages;
    currentProject.generatedPages = [];

    try {
        for (let i = 0; i < pages.length; i++) {
            updateGenerationProgress(i, pages.length);
            
            // בנה הנחיה מורכבת (תמונה + טקסט)
            const promptParts = buildPagePrompt(pages[i]);
            
            // יצירה
            const result = await generateWithRetry(modelArtist, {}, promptParts);
            
            const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
            if (part) {
                const pageData = {
                    pageNumber: pages[i].pageNumber,
                    imageB64: part.inlineData.data,
                    mimeType: part.inlineData.mimeType
                };
                currentProject.generatedPages.push(pageData);
                renderGeneratedPage(pageData, i);
                saveProjectToStorage();
            }
        }
        updateGenerationProgress(pages.length, pages.length);
    } catch (error) {
        console.error("שגיאה ביצירה:", error);
        updateGenerationProgress(0, 0, true);
        alert("שגיאה ביצירה: " + error.message);
    }
}

// מוצא דמויות שמופיעות בעמוד ספציפי
function findCharactersInPage(page) {
    if (!page.dialogue) return [];
    const characters = new Set();
    page.dialogue.forEach(diag => {
        const charName = diag.character ? diag.character.trim() : null;
        if (charName) characters.add(charName);
    });
    return Array.from(characters);
}

// בונה את ההנחיה המולטי-מודאלית (טקסט + תמונות דמויות)
function buildPagePrompt(page) {
    const promptParts = [];
    const requiredCharacters = findCharactersInPage(page);
    
    // 1. הוספת תמונות ייחוס של הדמויות הרלוונטיות
    requiredCharacters.forEach(name => {
        const char = currentProject.characters.find(c => c.name === name);
        if (char?.referenceImageB64) {
            promptParts.push({ inlineData: { data: char.referenceImageB64, mimeType: "image/png" } });
        }
    });

    // 2. בניית הטקסט
    let text = `צור עמוד קומיקס מספר ${page.pageNumber}. סגנון: ${currentProject.jsonPlan.globalStyle}.\n`;
    text += `תיאור הסצנה: ${page.sceneDescription}\n`;
    if (page.compositionSuggestion) text += `הצעת קומפוזיציה: ${page.compositionSuggestion}\n`;
    if (page.suggestedEmotion) text += `רגש מרכזי: ${page.suggestedEmotion}\n`;
    if (page.narration) text += `קריינות (Narration): "${page.narration}"\n`;
    if (page.dialogue) {
        text += "דיאלוגים:\n" + page.dialogue.map(d => `- ${d.character} (${d.type}): "${d.text}"`).join('\n');
    }
    text += "\nהשתמש בתמונות הייחוס שסופקו כדי לשמור על עקביות ומראה הדמויות. ודא שהתמונה מפורטת, צנועה ואיכותית.";
    
    promptParts.push({ text: text });
    return promptParts;
}

function renderGeneratedPage(pageData, index) {
    const imgSrc = `data:${pageData.mimeType};base64,${pageData.imageB64}`;
    const div = document.createElement('div');
    div.className = 'comic-page';
    div.setAttribute('data-page-index', index);
    div.innerHTML = `
        <img src="${imgSrc}">
        <div class="page-overlay">
            <span class="page-number">עמוד ${pageData.pageNumber}</span>
            <button class="secondary-btn edit-page-btn">ערוך עמוד</button>
        </div>
    `;
    div.querySelector('.edit-page-btn').addEventListener('click', () => showEditModal('page', index));
    dom.comicViewerContainer.appendChild(div);
}

function updateGenerationProgress(current, total, error = false) {
    if (error) {
        dom.progressText.textContent = "שגיאה ביצירה.";
        dom.progressBarFill.style.backgroundColor = 'var(--color-danger)';
        return;
    }
    const pct = Math.round((current / total) * 100);
    dom.progressBarFill.style.width = `${pct}%`;
    dom.progressText.textContent = pct === 100 ? "הושלם!" : `מייצר... ${pct}%`;
}

// --- 8. עריכה חכמה (Smart Editing) ---

function showEditModal(type, index) {
    let base64Data = "";
    let title = "";
    
    if (type === 'character') {
        const char = currentProject.characters[index];
        base64Data = char.referenceImageB64;
        title = char.name;
    } else if (type === 'page') {
        const page = currentProject.generatedPages[index];
        base64Data = page.imageB64;
        title = `עמוד ${page.pageNumber}`;
    }

    if (!base64Data) return alert("אין תמונה לעריכה");

    dom.editModal.dataset.editType = type;
    dom.editModal.dataset.editIndex = index;
    if (dom.editModalTitle) dom.editModalTitle.textContent = `עריכה חכמה: ${title}`;
    dom.editModalImage.src = `data:image/png;base64,${base64Data}`;
    dom.editModalPrompt.value = '';
    dom.editModal.classList.add('visible');
}

async function handleApplyEdit() {
    const type = dom.editModal.dataset.editType;
    const index = parseInt(dom.editModal.dataset.editIndex);
    const promptText = dom.editModalPrompt.value.trim();

    if (!promptText) return alert("הזן הנחיה.");
    
    let currentB64 = "";
    if (type === 'character') {
        currentB64 = currentProject.characters[index].referenceImageB64;
    } else {
        currentB64 = currentProject.generatedPages[index].imageB64;
    }

    showLoading(true, "מבצע עריכה חכמה (תמונה+טקסט)...");
    try {
        const promptParts = [
            { inlineData: { data: currentB64, mimeType: "image/png" } },
            { text: `בצע את השינוי הבא בתמונה: "${promptText}". שמור על הסגנון המקורי. החזר תמונה מלאה.` }
        ];

        const result = await generateWithRetry(modelArtist, {}, promptParts);
        const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
        
        if (part) {
            const newB64 = part.inlineData.data;
            const newSrc = `data:${part.inlineData.mimeType};base64,${newB64}`;
            
            if (type === 'character') {
                currentProject.characters[index].referenceImageB64 = newB64;
                const img = document.querySelector(`.character-card[data-character-index="${index}"] img`);
                if (img) img.src = newSrc;
            } else {
                currentProject.generatedPages[index].imageB64 = newB64;
                const img = document.querySelector(`.comic-page[data-page-index="${index}"] img`);
                if (img) img.src = newSrc;
            }
            dom.editModalImage.src = newSrc; // עדכן את המודאל עצמו
            saveProjectToStorage();
        }
        showLoading(false);
        alert("עריכה בוצעה בהצלחה.");
    } catch (e) {
        showLoading(false);
        alert("שגיאה בעריכה: " + e.message);
    }
}

// --- 9. ניהול אחסון וייצוא ---

function saveKeysToStorage(keys) { localStorage.setItem(STORAGE_KEYS_KEY, JSON.stringify(keys)); }
function loadKeysFromStorage() { return JSON.parse(localStorage.getItem(STORAGE_KEYS_KEY) || "[]"); }

function saveProjectToStorage() { 
    localStorage.setItem(STORAGE_PROJECT_KEY, JSON.stringify(currentProject)); 
    updateStorageUsageDisplay();
}

function saveInitialStateToStorage(key, pool) {
    localStorage.setItem('panalixApiKey', key);
    localStorage.setItem('panalixApiKeyPool', JSON.stringify(pool));
}

function handleClearStorage() {
    if (confirm("האם אתה בטוח שברצונך למחוק הכל? הפעולה בלתי הפיכה.")) {
        localStorage.clear();
        location.reload();
    }
}

function updateStorageUsageDisplay() {
    let total = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) total += localStorage[key].length * 2;
    }
    dom.storageUsageDisplay.textContent = `${(total / 1024 / 1024).toFixed(2)} MB`;
}

function loadInitialState() {
    const keys = loadKeysFromStorage();
    const proj = localStorage.getItem(STORAGE_PROJECT_KEY);

    if (keys.length > 0) {
        initializeApi(keys);
        if (proj) {
            currentProject = JSON.parse(proj);
            // ניתוב למסך הנכון לפי המצב
            if (currentProject.generatedPages?.length > 0) {
                showScreen('generation-section');
                currentProject.generatedPages.forEach((p, i) => renderGeneratedPage(p, i));
            } else if (currentProject.jsonPlan) {
                showScreen('approval-section');
                renderCharacterApprovalUI();
                renderPlanEditorUI();
            } else {
                showScreen('story-input-section');
            }
        } else {
            showScreen('story-input-section');
        }
    } else {
        showScreen('api-key-screen');
    }
    updateStorageUsageDisplay();
}

// --- פונקציות עזר UI ---

function showScreen(id) {
    document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active-screen'));
    document.getElementById(id).classList.add('active-screen');
}

function showLoading(show, text) {
    dom.loadingText.textContent = text || "טוען...";
    show ? dom.loadingModal.classList.add('visible') : dom.loadingModal.classList.remove('visible');
}

function showKeyPoolModal(msg, count) {
    dom.keyPoolMessage.textContent = `${msg} (נדרשים עוד ${count} מפתחות)`;
    dom.keyPoolModal.classList.add('visible');
}

function escapeHTML(str) {
    return (str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}

// ייצוא פשוט לקובץ טקסט
function handleExportPdf() {
    if (!currentProject.generatedPages.length) return alert("אין עמודים לייצוא.");
    let content = `Comic: ${currentProject.jsonPlan.title}\n==================\n`;
    currentProject.generatedPages.forEach((p, i) => {
        content += `\n[Page ${i+1}]\nData Size: ${Math.round(p.imageB64.length/1024)}KB\n`;
    });
    downloadFile(content, 'text/plain', 'comic_data.txt');
    alert("הורד קובץ נתונים (PDF דורש ספריה חיצונית).");
}

function handleExportCbz() { handleExportPdf(); }

function downloadFile(content, type, name) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    a.click();
    URL.revokeObjectURL(url);
}
