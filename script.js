"use strict";

/* ==============================================
  קובץ הסקריפט הראשי של פאנליקס (Panalix)
  חלק 1: אתחול, ניהול API וניהול זיכרון
  ==============================================
*/

// ייבוא ה-SDK של Google Gemini
// אנו משתמשים בגרסת ה-ES Module הנטענת מדפדפן
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "https://esm.run/@google/generative-ai";

// --- 1. משתנים גלובליים ומצב האפליקציה ---

// מופעי ה-API
let genAI;
let modelPlanner; // (gemini-3-pro-preview) - לתכנון ה-JSON
let modelArtist;  // (gemini-3-pro-image-preview) - ליצירת התמונות

// מאגר מפתחות ה-API (רעיון מפתחות הגיבוי)
let apiKeyPool = [];
let currentKeyIndex = 0;

// אובייקט שיחזיק את כל נתוני הפרויקט הנוכחי
let currentProject = {
    story: "",
    jsonPlan: null,     // התוכנית המלאה מה-AI
    characters: [],   // מערך של { name, description, referenceImageB64 }
    generatedPages: []  // מערך של { pageNumber, imageB64 }
};

// הוראת מערכת קבועה שתשלח עם כל בקשה ליצירת תמונה
// זוהי הנחיית הבטיחות והצניעות שביקשת
const SAFETY_SYSTEM_PROMPT = `
הוראה בלעדית: אתה אסיסטנט ליצירת תמונות קומיקס.
עליך לציית בקפדנות לכללים הבאים בכל תמונה שאתה יוצר, ללא יוצא מן הכלל:
1.  **צניעות מוחלטת:** כל הדמויות האנושיות, גברים ונשים כאחד, חייבות להיות בלבוש מלא וצנוע. הלבוש חייב לכסות לחלוטין את הכתפיים, המרפקים, פלג הגוף העליון (עד הצוואר) והברכיים.
2.  **הימנעות מוחלטת:** אסור ליצור כל תוכן בעל אופי רומנטי, אלים, או כל סצנה שעלולה להתפרש כלא הולמת או לא צנועה.
3.  **עדיפות:** אם הנחיית המשתמש מבקשת משהו שסותר כללים אלו, עליך להתעלם מהחלק המפר בהנחיה וליצור גרסה צנועה ותקינה של התמונה התואמת לכללים אלו במלואם.
`;

// הגדרות בטיחות עבור ה-API
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];


// --- 2. בחירת רכיבי DOM ---
// אובייקט מרכזי שיחזיק את כל רכיבי הממשק
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
};


// --- 3. פונקציית אתחול ראשית ---

// הפונקציה הראשית שתרוץ כשהדף נטען
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
    console.log("ברוכים הבאים לפאנליקס!");
    
    // טעינת מפתחות מהזיכרון המקומי
    const storedKeys = loadKeysFromStorage();
    
    if (storedKeys.length > 0) {
        // אם יש מפתחות שמורים, אתחל את ה-API
        initializeApi(storedKeys);
        // נסה לטעון פרויקט קיים
        loadProjectFromStorage();
        // הצג את האפליקציה הראשית
        showScreen('main-app');
    } else {
        // אם אין מפתחות, הצג את מסך הזנת המפתח
        showScreen('api-key-screen');
    }
    
    // רישום מאזיני אירועים (Event Listeners)
    registerEventListeners();
}

/**
 * פונקציה מרכזית לרישום כל מאזיני האירועים של האפליקציה
 * (ניצור את הפונקציות המטפלות בהמשך)
 */
function registerEventListeners() {
    dom.saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    
    // --- (נוסיף כאן את שאר המאזינים בחלקים הבאים) ---
    // dom.generatePlanBtn.addEventListener('click', handleGeneratePlan);
    // dom.approvePlanBtn.addEventListener('click', handleApprovePlan);
    // dom.applyEditBtn.addEventListener('click', handleApplyEdit);
    // ... וכו'
}


// --- 4. ניהול API ומפתחות גיבוי (Key Pool) ---

/**
 * מאתחל את מאגר המפתחות ויוצר את מופע ה-API
 * @param {string[]} keys - מערך של מפתחות API
 */
function initializeApi(keys) {
    apiKeyPool = keys;
    currentKeyIndex = 0;
    
    if (apiKeyPool.length > 0) {
        // אתחל את ה-API עם המפתח הראשון
        setApiKey(apiKeyPool[currentKeyIndex]);
        updateKeyCountDisplay();
    }
}

/**
 * מגדיר את מופעי ה-API והמודלים עם מפתח ספציפי
 * @param {string} key - מפתח ה-API לשימוש
 */
function setApiKey(key) {
    try {
        genAI = new GoogleGenerativeAI(key);
        
        // הגדרת מודל ה"תכנון" (טקסט בלבד)
        modelPlanner = genAI.getGenerativeModel({
            model: "gemini-3-pro-preview",
            safetySettings: safetySettings
        });

        // הגדרת מודל ה"אמן" (יצירת תמונות)
        modelArtist = genAI.getGenerativeModel({
            model: "gemini-3-pro-image-preview",
            safetySettings: safetySettings,
            // כאן נכניס את הוראת המערכת הקבועה לבטיחות
            systemInstruction: SAFETY_SYSTEM_PROMPT,
        });
        
        console.log(`מפתח API הוגדר בהצלחה (אינדקס: ${currentKeyIndex})`);
    } catch (error) {
        console.error("שגיאה באתחול ה-API עם המפתח:", error);
        // (נוסיף כאן לוגיקה להצגת שגיאה למשתמש)
    }
}

/**
 * פונקציה למעבר למפתח ה-API הבא במאגר
 * @returns {boolean} - מחזיר true אם ההחלפה הצליחה, ו-false אם נגמרו המפתחות
 */
function switchToNextKey() {
    console.warn(`מפתח API באינדקס ${currentKeyIndex} הגיע למגבלה.`);
    currentKeyIndex++;
    
    if (currentKeyIndex < apiKeyPool.length) {
        // אם יש עוד מפתחות במאגר
        console.log(`מחליף למפתח הבא באינדקס ${currentKeyIndex}...`);
        setApiKey(apiKeyPool[currentKeyIndex]);
        return true; // ההחלפה הצליחה, ניתן לנסות שוב
    } else {
        // אם נגמרו המפתחות
        console.error("נגמרו כל מפתחות ה-API במאגר!");
        // (כאן נקפיץ חלון המבקש מפתחות נוספים)
        showKeyPoolModal("כל המפתחות הגיעו למגבלה. אנא הוסף מפתחות גיבוי.", 1);
        return false; // ההחלפה נכשלה, אין יותר מפתחות
    }
}

/**
 * מטפל בלחיצה על שמירת מפתח API
 */
function handleSaveApiKey() {
    const key = dom.apiKeyInput.value.trim();
    if (key) {
        const keys = [key];
        saveKeysToStorage(keys);
        initializeApi(keys);
        showScreen('main-app');
    } else {
        alert("אנא הזן מפתח API חוקי.");
    }
}

/**
 * מעדכן את תצוגת ספירת המפתחות בממשק
 */
function updateKeyCountDisplay() {
    dom.keyCountDisplay.textContent = apiKeyPool.length;
}


// --- 5. ניהול זיכרון מקומי (localStorage) ---

const STORAGE_KEYS_KEY = 'panalix_api_keys';
const STORAGE_PROJECT_KEY = 'panalix_current_project';

function saveKeysToStorage(keys) {
    localStorage.setItem(STORAGE_KEYS_KEY, JSON.stringify(keys));
}

function loadKeysFromStorage() {
    const keysJson = localStorage.getItem(STORAGE_KEYS_KEY);
    return keysJson ? JSON.parse(keysJson) : [];
}

function saveProjectToStorage() {
    // (נוודא שאנו לא שומרים אובייקטים עצומים מדי)
    // (בחלקים הבאים נוסיף לוגיקה לדחיסת תמונות לפני שמירה)
    localStorage.setItem(STORAGE_PROJECT_KEY, JSON.stringify(currentProject));
    updateStorageUsageDisplay();
}

function loadProjectFromStorage() {
    const projectJson = localStorage.getItem(STORAGE_PROJECT_KEY);
    if (projectJson) {
        currentProject = JSON.parse(projectJson);
        console.log("פרויקט קודם נטען:", currentProject);
        // (כאן נוסיף לוגיקה לשחזור הממשק על בסיס הפרויקט שנטען)
    }
    updateStorageUsageDisplay();
}

function updateStorageUsageDisplay() {
    const projectJson = localStorage.getItem(STORAGE_PROJECT_KEY) || "";
    const keysJson = localStorage.getItem(STORAGE_KEYS_KEY) || "";
    const totalBytes = projectJson.length + keysJson.length;
    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    dom.storageUsageDisplay.textContent = `${totalMB} MB`;
}


// --- 6. פונקציות עזר לממשק משתמש (UI Helpers) ---

/**
 * מחליף בין המסכים הראשיים
 * @param {string} screenId - ה-ID של המסך להצגה
 */
function showScreen(screenId) {
    // הסתר את כל המסכים
    document.querySelectorAll('.app-screen').forEach(screen => {
        screen.classList.remove('active-screen');
    });
    
    // הצג את המסך הרצוי
    const screenToShow = document.getElementById(screenId);
    if (screenToShow) {
        screenToShow.classList.add('active-screen');
    }
}

/**
 * מציג או מסתיר את מודאל הטעינה
 * @param {boolean} show - האם להציג
 * @param {string} [text='טוען...'] - הטקסט להצגה
 */
function showLoading(show, text = 'מעבד בקשה... אנא המתן...') {
    if (show) {
        dom.loadingText.textContent = text;
        dom.loadingModal.classList.add('visible');
    } else {
        dom.loadingModal.classList.remove('visible');
    }
}

/**
 * מציג את המודאל לבקשת מפתחות גיבוי
 * @param {string} message - ההודעה להצגה למשתמש
 * @param {number} keysNeeded - כמה מפתחות נוספים נדרשים
 */
function showKeyPoolModal(message, keysNeeded) {
    dom.keyPoolMessage.textContent = `${message} נדרשים לפחות עוד ${keysNeeded} מפתחות API נוספים.`;
    dom.keyPoolModal.classList.add('visible');
    // (בחלק הבא נוסיף את הלוגיקה לכפתור 'add-backup-keys-btn')
}

// (סוף קובץ - חלק 1)

"use strict";
// (המשך קובץ - חלק 1)

// --- 3. פונקציית אתחול ראשית (עדכון) ---

/**
 * פונקציה מרכזית לרישום כל מאזיני האירועים של האפליקציה
 */
function registerEventListeners() {
    dom.saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    dom.addBackupKeysBtn.addEventListener('click', handleAddBackupKeys);
    
    // שלב 1
    dom.generatePlanBtn.addEventListener('click', handleGeneratePlan);
    
    // --- (נוסיף כאן את שאר המאזינים בחלקים הבאים) ---
    // dom.improvePlanBtn.addEventListener('click', handleImprovePlan);
    // dom.approvePlanBtn.addEventListener('click', handleApprovePlan);
    // dom.applyEditBtn.addEventListener('click', handleApplyEdit);
    // dom.closeEditModalBtn.addEventListener('click', () => dom.editModal.classList.remove('visible'));
    // dom.exportPdfBtn.addEventListener('click', handleExportPDF);
    // dom.clearStorageBtn.addEventListener('click', handleClearStorage);
}


// --- 4. ניהול API ומפתחות גיבוי (עדכון) ---

/**
 * מטפל בהוספת מפתחות גיבוי מהמודאל
 */
function handleAddBackupKeys() {
    const newKeysText = dom.backupKeysInput.value.trim();
    if (newKeysText) {
        // פצל את המפתחות לפי שורות חדשות, סנן שורות ריקות
        const newKeys = newKeysText.split('\n')
                                  .map(key => key.trim())
                                  .filter(key => key.length > 0);
        
        if (newKeys.length > 0) {
            // הוסף את המפתחות החדשים למאגר הקיים
            apiKeyPool = [...apiKeyPool, ...newKeys];
            saveKeysToStorage(apiKeyPool); // שמור את המאגר המעודכן
            updateKeyCountDisplay();
            
            // אתחל מחדש את ה-API אם הוא נתקע (בחר את המפתח הנוכחי)
            setApiKey(apiKeyPool[currentKeyIndex]);
            
            dom.backupKeysInput.value = ''; // נקה את התיבה
            dom.keyPoolModal.classList.remove('visible'); // סגור את המודאל
            console.log(`נוספו ${newKeys.length} מפתחות גיבוי. סה"כ ${apiKeyPool.length} מפתחות.`);
            
            // (אופציונלי: נסה שוב את הפעולה שנכשלה)
            // (נוסיף לוגיקה זו בהמשך, כשניצור את הפעולה שנכשלת)
        }
    }
}


// --- 7. פונקציות ליבה - שלב 1: התכנון (Planner) ---

/**
 * פונקציית עטיפה (Wrapper) ראשית לכל קריאות ה-API
 * מטפלת בלוגיקת ה-Retry ומעבר בין מפתחות גיבוי
 * @param {GenerativeModel} model - המודל לשימוש (Planner או Artist)
 * @param {object} generationConfig - הגדרות היצירה (כמו responseSchema)
 * @param {string | object | (string | object)[]} contents - התוכן לשליחה
 * @returns {Promise<object>} - התשובה המלאה מה-API
 */
async function generateWithRetry(model, generationConfig, contents) {
    const maxRetries = apiKeyPool.length; // נסה פעם אחת עם כל מפתח זמין
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // נסה לבצע את הקריאה עם המפתח הנוכחי
            const result = await model.generateContent({
                contents: contents,
                generationConfig: generationConfig
            });
            return result; // הצלחה! החזר את התוצאה
            
        } catch (error) {
            console.error(`שגיאה ב-API (ניסיון ${attempt + 1}/${maxRetries}):`, error);
            
            // בדוק אם השגיאה היא מסוג Rate Limit
            // (ה-API של גוגל זורק שגיאה עם הודעה ספציפית או קוד 429)
            const isRateLimitError = error.toString().includes("429") || 
                                     error.toString().toLowerCase().includes("rate_limit_exceeded") ||
                                     error.toString().toLowerCase().includes("resource_exhausted");

            if (isRateLimitError) {
                // אם זו שגיאת מגבלה, נסה להחליף מפתח
                const switched = switchToNextKey();
                if (switched) {
                    // אם ההחלפה הצליחה, נסה שוב (הלולאה תמשיך)
                    // עדכן את המשתמש
                    showLoading(true, `מגבלת שימוש הושגה. מחליף למפתח הבא ( ${currentKeyIndex + 1}/${apiKeyPool.length})...`);
                    continue; 
                } else {
                    // אם ההחלפה נכשלה (נגמרו המפתחות), זרוק שגיאה סופית
                    throw new Error("כל מפתחות ה-API הגיעו למגבלת השימוש שלהם.");
                }
            } else {
                // אם זו שגיאה אחרת (למשל, שגיאת בטיחות, שגיאת שרת), זרוק אותה
                throw error;
            }
        }
    }
    
    // אם הלולאה הסתיימה ועדיין לא הצלחנו, זרוק שגיאה
    throw new Error("היצירה נכשלה לאחר ניסיון עם כל המפתחות הזמינים.");
}


/**
 * מחזיר את סכמת ה-JSON המלאה עבור תוכנית הקומיקס
 * זוהי ה"הוראה" למודל ה"תכנון"
 * @returns {object} - אובייקט סכמת JSON
 */
function getComicPlanSchema() {
    return {
        type: "OBJECT",
        properties: {
            "title": { "type": "STRING", "description": "שם קצר וקליט לקומיקס" },
            "globalStyle": { "type": "STRING", "description": "תיאור סגנון הציור הגלובלי (למשל: 'סגנון מנגה שחור-לבן', 'סגנון קומיקס אמריקאי וינטג'', 'סגנון צבעי מים אירופאי')" },
            "characters": {
                "type": "ARRAY",
                "description": "רשימת הדמויות הראשיות בסיפור",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "name": { "type": "STRING", "description": "שם הדמות (לשימוש בבועות דיבור)" },
                        "description": { "type": "STRING", "description": "תיאור חזותי מפורט מאוד של הדמות (גיל, שיער, תווי פנים, לבוש עיקרי) ליצירת תמונת ייחוס." }
                    },
                    "required": ["name", "description"]
                }
            },
            "pages": {
                "type": "ARRAY",
                "description": "מערך של כל העמודים בקומיקס, לפי הסדר",
                "items": {
                    "type": "OBJECT",
                    "properties": {
                        "pageNumber": { "type": "NUMBER", "description": "מספר העמוד" },
                        "sceneDescription": { "type": "STRING", "description": "תיאור חזותי מפורט של הסצנה בעמוד זה. מה הרקע? מה הדמויות עושות?" },
                        "compositionSuggestion": { "type": "STRING", "description": "הצעה לקומפוזיציה (רעיון 2). (למשל: 'קלוז אפ דרמטי על פני הדמות', 'זווית רחבה המציגה את העיר')" },
                        "suggestedEmotion": { "type": "STRING", "description": "הרגש המרכזי שהדמות הראשית צריכה להביע (רעיון 1). (למשל: 'הפתעה', 'כעס', 'בלבול')" },
                        "dialogue": {
                            "type": "ARRAY",
                            "description": "כל בועות הדיבור/מחשבה בעמוד",
                            "items": {
                                "type": "OBJECT",
                                "properties": {
                                    "character": { "type": "STRING", "description": "שם הדמות המדברת (חייב להתאים לשם מ'characters')" },
                                    "type": { "type": "STRING", "enum": ["speech", "thought"], "description": "סוג הבועה: 'speech' (דיבור) או 'thought' (מחשבה)" },
                                    "text": { "type": "STRING", "description": "הטקסט שבתוך הבועה" }
                                }
                            }
                        },
                        "narration": { "type": "STRING", "description": "טקסט קריינות (אם קיים) שיופיע בתיבה מרובעת." }
                    },
                    "required": ["pageNumber", "sceneDescription"]
                }
            }
        },
        "required": ["title", "globalStyle", "characters", "pages"]
    };
}


/**
 * מטפל בלחיצה על "צור תוכנית קומיקס"
 */
async function handleGeneratePlan() {
    const storyPrompt = dom.storyPromptInput.value.trim();
    if (!storyPrompt) {
        alert("אנא הזן סיפור או הנחיה ליצירת סיפור.");
        return;
    }

    if (!modelPlanner) {
        alert("שגיאה: מודל ה-API לא אותחל. אנא בדוק את מפתח ה-API שלך.");
        return;
    }

    showLoading(true, "יוצר תוכנית עלילה... (שלב 1/3)");
    currentProject = { ...currentProject, story: storyPrompt }; // שמור את הסיפור במצב

    try {
        // הכן את ההנחיה למודל ה"תכנון"
        const fullPrompt = `
            בהתבסס על הסיפור/הנחיה הבאים: "${storyPrompt}",
            צור תוכנית קומיקס מפורטת.
            עליך להחזיר אך ורק אובייקט JSON חוקי התואם במדויק לסכמה שסופקה לך.
            צור לפחות 3 דמויות ו-5 עמודים.
        `;
        
        const schema = getComicPlanSchema();
        
        const generationConfig = {
            responseMimeType: "application/json",
            responseSchema: schema
        };
        
        // קרא ל-API באמצעות פונקציית ה-Retry שלנו
        const result = await generateWithRetry(modelPlanner, generationConfig, [fullPrompt]);
        
        const responseText = result.response.candidates[0].content.parts[0].text;
        const parsedPlan = JSON.parse(responseText);
        
        console.log("תוכנית JSON נוצרה בהצלחה:", parsedPlan);

        // שמור את התוכנית במצב הגלובלי ובזיכרון
        currentProject.jsonPlan = parsedPlan;
        saveProjectToStorage();
        
        showLoading(false);
        
        // עבר לשלב הבא: אישור דמויות ותוכנית
        // (ניצור את הפונקציות האלו בחלק הבא)
        await renderCharacterApprovalUI(); // (חלק 3)
        renderPlanEditorUI(); // (חלק 4)
        
        showScreen('approval-section');

    } catch (error) {
        console.error("יצירת התוכנית נכשלה:", error);
        showLoading(false);
        if (!error.toString().includes("No more API keys")) {
            // רק אם זו לא שגיאת "נגמרו המפתחות" (שטופלה כבר)
            alert(`שגיאה ביצירת התוכנית: ${error.message}`);
        }
    }
}


// --- 8. פונקציות ליבה - שלב 2: אישור דמויות (מקום שמור) ---

/**
 * (מקום שמור לחלק 3)
 * יטפל ביצירת תמונות הייחוס לדמויות
 */
async function renderCharacterApprovalUI() {
    console.log("מתחיל בתהליך יצירת תמונות ייחוס לדמויות...");
    // לוגיקה זו תפותח בחלק הבא
    // היא תכלול לולאה על currentProject.jsonPlan.characters
    // ותקרא למודל ה"אמן"
    dom.characterApprovalContainer.innerHTML = "<p>טוען דמויות...</p>";
}

/**
 * (מקום שמור לחלק 4)
 * יטפל בהצגת עורך ה-JSON החזותי
 */
function renderPlanEditorUI() {
    console.log("טוען את עורך התוכנית...");
    // לוגיקה זו תפותח בחלק הבא
    dom.planEditorContainer.innerHTML = "<p>טוען עורך תוכנית...</p>";
}


// (סוף קובץ - חלק 2)

"use strict";
// (המשך קובץ - חלק 2)

// --- 3. פונקציית אתחול ראשית (עדכון) ---

/**
 * פונקציה מרכזית לרישום כל מאזיני האירועים של האפליקציה
 */
function registerEventListeners() {
    dom.saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    dom.addBackupKeysBtn.addEventListener('click', handleAddBackupKeys);
    
    // שלב 1
    dom.generatePlanBtn.addEventListener('click', handleGeneratePlan);
    
    // שלב 2
    // (נוסיף כאן את מאזיני הכפתורים של שלב 2 בהמשך)
    // dom.improvePlanBtn.addEventListener('click', handleImprovePlan);
    // dom.approvePlanBtn.addEventListener('click', handleApprovePlan);

    // מודאל עריכה
    dom.applyEditBtn.addEventListener('click', handleApplyEdit); // (ניצור פונקציה זו בחלק 4)
    dom.closeEditModalBtn.addEventListener('click', () => dom.editModal.classList.remove('visible'));

    // --- (נוסיף כאן את שאר המאזינים בחלקים הבאים) ---
    // dom.exportPdfBtn.addEventListener('click', handleExportPDF);
    // dom.clearStorageBtn.addEventListener('click', handleClearStorage);
}

// --- 8. פונקציות ליבה - שלב 2: אישור דמויות (יישום) ---

/**
 * (יישום של הפונקציה מחלק 2)
 * מייצר תמונות ייחוס לדמויות ומציג אותן לאישור המשתמש.
 */
async function renderCharacterApprovalUI() {
    console.log("מתחיל בתהליך יצירת תמונות ייחוס לדמויות...");
    
    // ודא שיש תוכנית ודמויות
    if (!currentProject.jsonPlan || !currentProject.jsonPlan.characters || currentProject.jsonPlan.characters.length === 0) {
        console.warn("לא נמצאו דמויות בתוכנית.");
        dom.characterApprovalContainer.innerHTML = "<p>התוכנית שה-AI יצר לא כללה דמויות.</p>";
        return;
    }

    const characters = currentProject.jsonPlan.characters;
    dom.characterApprovalContainer.innerHTML = ''; // נקה אזור תצוגה
    
    // אתחל את מערך הדמויות במצב (state) הראשי
    currentProject.characters = characters.map(char => ({
        name: char.name,
        description: char.description,
        referenceImageB64: null, // יתמלא על ידי ה-API
    }));

    showLoading(true, `יוצר תמונות ייחוס לדמויות... (שלב 2/3)`);

    try {
        // עבור בלולאה על כל דמות וייצר עבורה תמונה
        for (let i = 0; i < currentProject.characters.length; i++) {
            const char = currentProject.characters[i];
            
            // עדכן את הודעת הטעינה
            showLoading(true, `יוצר תמונת ייחוס עבור: ${char.name}... (${i + 1}/${characters.length})`);

            // הכן את ההנחיה למודל ה"אמן"
            const prompt = `
                צור תמונת פורטרט-ייחוס (portrait reference photo) ברורה עבור דמות קומיקס בשם ${char.name}.
                התיאור המלא של הדמות הוא: "${char.description}".
                הרקע חייב להיות ניטרלי ואחיד (לבן או אפור בהיר) כדי שניתן יהיה להשתמש בתמונה זו כייחוס.
                הסגנון הגלובלי של הקומיקס הוא: "${currentProject.jsonPlan.globalStyle}".
            `;

            // הגדרות יצירה - אנו מצפים לתמונה, לא לטקסט
            const generationConfig = {
                // אין צורך ב-responseSchema, המודל מחזיר תמונה
            };
            
            // קרא ל-API באמצעות פונקציית ה-Retry שלנו
            const result = await generateWithRetry(modelArtist, generationConfig, [prompt]);

            // חלץ את נתוני התמונה (Base64)
            const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
            if (!part || !part.inlineData) {
                throw new Error(`ה-API לא החזיר נתוני תמונה עבור ${char.name}`);
            }
            
            const base64Data = part.inlineData.data;
            const mimeType = part.inlineData.mimeType;
            const imageSrc = `data:${mimeType};base64,${base64Data}`;

            // שמור את תמונת הייחוס (Base64) במצב (state) הפרויקט
            char.referenceImageB64 = base64Data;

            // צור את כרטיס הדמות (HTML)
            const cardHTML = `
                <div class="character-card" data-character-index="${i}">
                    <img src="${imageSrc}" alt="תמונת ייחוס עבור ${char.name}">
                    <div class="card-content">
                        <h4>${char.name}</h4>
                        <p>${char.description.substring(0, 100)}...</p>
                        <button class="secondary-btn edit-character-btn">ערוך דמות (כפתור עריכה מאוחד)</button>
                    </div>
                </div>
            `;
            dom.characterApprovalContainer.innerHTML += cardHTML;
        }

        // לאחר סיום הלולאה, הוסף מאזיני אירועים לכפתורי העריכה החדשים
        addCharacterEditListeners();
        
        // שמור את הפרויקט המעודכן (עם תמונות הייחוס) ב-localStorage
        saveProjectToStorage();
        showLoading(false); // הסתר את מודאל הטעינה

    } catch (error) {
        console.error("שגיאה קריטית במהלך יצירת תמונות ייחוס:", error);
        showLoading(false);
        if (!error.toString().includes("No more API keys")) {
            alert(`שגיאה ביצירת תמונות הדמויות: ${error.message}`);
        }
        // במקרה של שגיאה, נציג הודעה באזור הדמויות
        dom.characterApprovalContainer.innerHTML = `<p>שגיאה ביצירת הדמויות. בדוק את מסוף המפתחים (Console) או נסה להוסיף מפתחות גיבוי.</p>`;
    }
}

/**
 * מוסיף מאזיני אירועים לכפתורי העריכה שנוצרו דינמית
 */
function addCharacterEditListeners() {
    document.querySelectorAll('.edit-character-btn').forEach(button => {
        // הסר מאזין קודם אם קיים (למניעת כפילויות)
        button.removeEventListener('click', handleEditCharacterClick); 
        // הוסף מאזין חדש
        button.addEventListener('click', handleEditCharacterClick);
    });
}

/**
 * מטפל בלחיצה על כפתור עריכת דמות
 * @param {Event} e - אובייקט האירוע
 */
function handleEditCharacterClick(e) {
    const card = e.target.closest('.character-card');
    const characterIndex = card.dataset.characterIndex;
    // קרא לפונקציה הכללית שמציגה את מודאל העריכה
    handleShowEditModal('character', characterIndex);
}

/**
 * פותח את מודאל העריכה המאוחד
 * @param {string} editType - 'character' או 'page'
 * @param {number} index - האינדקס של הפריט במערך המתאים
 */
function handleShowEditModal(editType, index) {
    console.log(`פותח מודאל עריכה עבור: ${editType}, אינדקס: ${index}`);
    
    // שמור את סוג ואינדקס הפריט לעריכה על גבי המודאל עצמו
    dom.editModal.dataset.editType = editType;
    dom.editModal.dataset.editIndex = index;
    
    let currentImageSrc = "";
    let currentImageB64 = "";
    
    if (editType === 'character') {
        const char = currentProject.characters[index];
        currentImageB64 = char.referenceImageB64;
    } 
    // (נוסיף כאן לוגיקה עבור 'page' בחלק מאוחר יותר)
    // else if (editType === 'page') {
    //     const page = currentProject.generatedPages[index];
    //     currentImageB64 = page.imageB64;
    // }

    if (currentImageB64) {
        // (נניח שה-API תמיד מחזיר png, אפשר לשנות לפי ה-mimeType)
        currentImageSrc = `data:image/png;base64,${currentImageB64}`; 
        dom.editModalImage.src = currentImageSrc;
    } else {
        dom.editModalImage.src = ""; // תמונת פלייסהולדר אם אין תמונה
    }

    dom.editModalPrompt.value = ''; // נקה הנחיה קודמת
    dom.editModal.classList.add('visible'); // הצג את המודאל
}


// --- 9. פונקציות ליבה - שלב 2: עריכה חכמה (מקום שמור) ---

/**
 * (מקום שמור לחלק 4)
 * יטפל בלחיצה על "בצע עריכה" בתוך המודאל
 */
async function handleApplyEdit() {
    console.log("מתחיל בתהליך עריכה...");
    // לוגיקה זו תפותח בחלק הבא
    // היא תקרא את הנתונים מ-dom.editModal.dataset
    // ותקרא למודל ה"אמן" עם תמונה + טקסט
}


// (סוף קובץ - חלק 3)

"use strict";
// (המשך קובץ - חלק 3)

// --- 3. פונקציית אתחול ראשית (עדכון) ---

/**
 * פונקציה מרכזית לרישום כל מאזיני האירועים של האפליקציה
 */
function registerEventListeners() {
    dom.saveApiKeyBtn.addEventListener('click', handleSaveApiKey);
    dom.addBackupKeysBtn.addEventListener('click', handleAddBackupKeys);
    
    // שלב 1
    dom.generatePlanBtn.addEventListener('click', handleGeneratePlan);
    
    // שלב 2
    dom.improvePlanBtn.addEventListener('click', handleImprovePlan); // (ניצור פונקציה זו בחלק 5)
    dom.approvePlanBtn.addEventListener('click', handleApprovePlan); // (ניצור פונקציה זו בחלק 5)

    // מודאל עריכה
    dom.applyEditBtn.addEventListener('click', handleApplyEdit); // (מיושם בחלק זה)
    dom.closeEditModalBtn.addEventListener('click', () => dom.editModal.classList.remove('visible'));

    // --- (נוסיף כאן את שאר המאזינים בחלקים הבאים) ---
    // dom.exportPdfBtn.addEventListener('click', handleExportPDF);
    // dom.clearStorageBtn.addEventListener('click', handleClearStorage);
}


// --- 9. פונקציות ליבה - שלב 2: עריכה חכמה (יישום) ---

/**
 * (יישום של הפונקציה מחלק 3)
 * מטפל בלחיצה על "בצע עריכה" בתוך המודאל
 * זוהי פונקציית העריכה המאוחדת (תמונה + טקסט)
 */
async function handleApplyEdit() {
    const editType = dom.editModal.dataset.editType;
    const editIndex = parseInt(dom.editModal.dataset.editIndex, 10);
    const editPrompt = dom.editModalPrompt.value.trim();

    if (!editPrompt) {
        alert("אנא הזן הנחיית עריכה.");
        return;
    }

    let originalImageB64 = "";
    if (editType === 'character') {
        originalImageB64 = currentProject.characters[editIndex].referenceImageB64;
    } else if (editType === 'page') {
        // (נוסיף תמיכה בעריכת עמודים לאחר שניצור אותם)
        // originalImageB66 = currentProject.generatedPages[editIndex].imageB64;
        console.warn("עריכת עמודים תיושם בשלב 3");
        return;
    }

    if (!originalImageB64) {
        alert("שגיאה: לא נמצאה תמונת מקור לעריכה.");
        return;
    }

    showLoading(true, "מבצע עריכה חכמה... (תמונה + טקסט)");

    try {
        // הכן את התוכן לשליחה: [תמונה, טקסט]
        // אנו מניחים שהתמונות הן PNG לצורך הדוגמה
        const imagePart = {
            inlineData: {
                data: originalImageB64,
                mimeType: "image/png" 
            }
        };

        const textPart = { text: editPrompt };

        // קרא ל-API באמצעות פונקציית ה-Retry שלנו
        const result = await generateWithRetry(modelArtist, {}, [imagePart, textPart]);

        // חלץ את התמונה הערוכה
        const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
        if (!part || !part.inlineData) {
            throw new Error("ה-API לא החזיר תמונה ערוכה.");
        }

        const newBase64Data = part.inlineData.data;
        const newImageSrc = `data:${part.inlineData.mimeType};base64,${newBase64Data}`;

        // עדכן את המצב (state) ואת הממשק
        if (editType === 'character') {
            // עדכן את אובייקט הפרויקט
            currentProject.characters[editIndex].referenceImageB64 = newBase64Data;
            
            // עדכן את התמונה בכרטיס הדמות
            const cardImg = document.querySelector(`.character-card[data-character-index="${editIndex}"] img`);
            if (cardImg) {
                cardImg.src = newImageSrc;
            }
            
            // עדכן את התמונה במודאל עצמו (כדי לאפשר עריכות נוספות)
            dom.editModalImage.src = newImageSrc;
        } 
        // (נוסיף כאן לוגיקה לעדכון עמוד)

        saveProjectToStorage(); // שמור את התמונה המעודכנת
        showLoading(false);
        dom.editModalPrompt.value = ''; // נקה את תיבת הטקסט
        // אל תסגור את המודאל, אפשר למשתמש לבצע עריכות נוספות

    } catch (error) {
        console.error("שגיאה במהלך העריכה החכמה:", error);
        showLoading(false);
        if (!error.toString().includes("No more API keys")) {
            alert(`שגיאת עריכה: ${error.message}`);
        }
    }
}


// --- 10. פונקציות ליבה - שלב 2: עורך JSON חזותי (יישום) ---

/**
 * (יישום של הפונקציה מחלק 2)
 * מציג את תוכנית ה-JSON בצורת טופס עריכה ויזואלי.
 */
function renderPlanEditorUI() {
    console.log("טוען את עורך התוכנית...");
    if (!currentProject.jsonPlan || !currentProject.jsonPlan.pages) {
        dom.planEditorContainer.innerHTML = "<p>שגיאה: תוכנית ה-JSON לא נטענה כראוי.</p>";
        return;
    }

    const plan = currentProject.jsonPlan;
    dom.planEditorContainer.innerHTML = ''; // נקה אזור תצוגה

    // הוסף שדות גלובליים (כותרת וסגנון)
    dom.planEditorContainer.innerHTML += `
        <div class="form-group">
            <label for="plan-edit-title">כותרת הקומיקס:</label>
            <input type="text" id="plan-edit-title" class="plan-edit-field" data-key="title" value="${escapeHTML(plan.title)}">
        </div>
        <div class="form-group">
            <label for="plan-edit-style">סגנון גלובלי:</label>
            <input type="text" id="plan-edit-style" class="plan-edit-field" data-key="globalStyle" value="${escapeHTML(plan.globalStyle)}">
        </div>
    `;

    // הוסף עורך לכל עמוד
    plan.pages.forEach((page, index) => {
        const pageId = `page-edit-${index}`;
        const pageHTML = `
            <div class="plan-page-item" data-page-index="${index}">
                <h4 class="plan-page-header">עמוד ${page.pageNumber}</h4>
                <div class="plan-page-content">
                    
                    <div class="form-group">
                        <label for="${pageId}-scene">תיאור סצנה:</label>
                        <textarea id="${pageId}-scene" class="plan-edit-field" data-key="sceneDescription">${escapeHTML(page.sceneDescription)}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <label for="${pageId}-comp">הצעת קומפוזיציה:</label>
                        <input type="text" id="${pageId}-comp" class="plan-edit-field" data-key="compositionSuggestion" value="${escapeHTML(page.compositionSuggestion || '')}">
                    </div>
                    
                    <div class="form-group">
                        <label for="${pageId}-emotion">רגש מוצע:</label>
                        <input type="text" id="${pageId}-emotion" class="plan-edit-field" data-key="suggestedEmotion" value="${escapeHTML(page.suggestedEmotion || '')}">
                    </div>
                    
                    <div class="form-group">
                        <label for="${pageId}-narration">קריינות:</label>
                        <input type="text" id="${pageId}-narration" class="plan-edit-field" data-key="narration" value="${escapeHTML(page.narration || '')}">
                    </div>
                    
                    <label>דיאלוגים:</label>
                    <div id="${pageId}-dialogues" class="dialogue-editor">
                        ${(page.dialogue || []).map((diag, dIndex) => `
                            <div class="dialogue-item" data-dialogue-index="${dIndex}">
                                <select class="plan-edit-field" data-key="dialogue.type">
                                    <option value="speech" ${diag.type === 'speech' ? 'selected' : ''}>דיבור</option>
                                    <option value="thought" ${diag.type === 'thought' ? 'selected' : ''}>מחשבה</option>
                                </select>
                                <input type="text" class="plan-edit-field" data-key="dialogue.character" value="${escapeHTML(diag.character)}" placeholder="שם הדמות">
                                <input type="text" class="plan-edit-field dialogue-text" data-key="dialogue.text" value="${escapeHTML(diag.text)}" placeholder="טקסט...">
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        dom.planEditorContainer.innerHTML += pageHTML;
    });

    // הוסף מאזיני אירועים לשדות החדשים שנוצרו
    addPlanEditorListeners();
}

/**
 * מוסיף מאזיני אירועים לשדות העריכה הדינמיים של ה-JSON
 */
function addPlanEditorListeners() {
    dom.planEditorContainer.querySelectorAll('.plan-edit-field').forEach(field => {
        field.addEventListener('input', handlePlanChange);
    });
}

/**
 * מטפל בשינוי שדה בטופס עורך ה-JSON
 * ומעדכן את אובייקט currentProject.jsonPlan בזמן אמת.
 * @param {Event} e - אובייקט האירוע
 */
function handlePlanChange(e) {
    const field = e.target;
    const key = field.dataset.key;
    const value = field.value;

    const pageItem = field.closest('.plan-page-item');
    
    if (pageItem) {
        // זהו שדה ששייך לעמוד ספציפי
        const pageIndex = parseInt(pageItem.dataset.pageIndex, 10);
        const page = currentProject.jsonPlan.pages[pageIndex];

        if (key.startsWith('dialogue.')) {
            // זהו שדה ששייך לדיאלוג
            const dialogueItem = field.closest('.dialogue-item');
            const dialogueIndex = parseInt(dialogueItem.dataset.dialogueIndex, 10);
            const dialogueKey = key.split('.')[1]; // 'type', 'character', or 'text'
            
            if (page.dialogue && page.dialogue[dialogueIndex]) {
                page.dialogue[dialogueIndex][dialogueKey] = value;
            }
        } else {
            // זהו שדה רגיל של העמוד (sceneDescription, narration, etc.)
            page[key] = value;
        }
    } else {
        // זהו שדה גלובלי (title, globalStyle)
        currentProject.jsonPlan[key] = value;
    }

    // שמור אוטומטית ב-localStorage (עם דיליי קל כדי למנוע שמירות תכופות מדי)
    // (נוסיף Debounce בחלק הבא לשיפור ביצועים)
    saveProjectToStorage();
    // console.log("תוכנית עודכנה:", currentProject.jsonPlan);
}

/**
 * פונקציית עזר פשוטה למניעת XSS
 * @param {string} str - המחרוזת להסרה
 * @returns {string} - המחרוזת הבטוחה
 */
function escapeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

// (סוף קובץ - חלק 4)

"use strict";
// (המשך קובץ - חלק 4)

// --- 11. פונקציות ליבה - שלב 2: שיפור תוכנית ואישור ---

/**
 * מטפל בלחיצה על "בקש הצעות שיפור מה-AI"
 * (רעיון 4 שהמשתמש אהב)
 */
async function handleImprovePlan() {
    if (!currentProject.jsonPlan) {
        alert("שגיאה: אין תוכנית לשיפור.");
        return;
    }

    showLoading(true, "שולח תוכנית ל-AI לקבלת הצעות שיפור...");

    try {
        const currentPlanString = JSON.stringify(currentProject.jsonPlan);
        
        const prompt = `
            זוהי תוכנית קומיקס (JSON) קיימת: ${currentPlanString}.
            אנא סרוק אותה והצע שיפורים.
            התמקד בשיפור הדרמה, הקצב, הדיאלוגים והצעות הקומפוזיציה.
            
            החזר אובייקט JSON חוקי בלבד, באותה סכמה בדיוק, המכיל את התוכנית המשופרת.
            אל תוסיף שום טקסט הסבר לפני או אחרי ה-JSON.
        `;

        const schema = getComicPlanSchema();
        const generationConfig = {
            responseMimeType: "application/json",
            responseSchema: schema
        };

        const result = await generateWithRetry(modelPlanner, generationConfig, [prompt]);
        
        const responseText = result.response.candidates[0].content.parts[0].text;
        const improvedPlan = JSON.parse(responseText);

        console.log("תוכנית משופרת התקבלה:", improvedPlan);

        // עדכן את המצב (state) ואת הזיכרון
        currentProject.jsonPlan = improvedPlan;
        saveProjectToStorage();
        
        // רענן את עורך ה-JSON החזותי
        renderPlanEditorUI();
        
        showLoading(false);
        alert("התוכנית שופרה על ידי ה-AI!");

    } catch (error) {
        console.error("שגיאה בשיפור התוכנית:", error);
        showLoading(false);
        if (!error.toString().includes("No more API keys")) {
            alert(`שגיאה בשיפור התוכנית: ${error.message}`);
        }
    }
}

/**
 * מטפל בלחיצה על "אשר תוכנית והתחל בייצור הקומיקס"
 * זהו המעבר משלב 2 לשלב 3.
 */
async function handleApprovePlan() {
    if (!currentProject.jsonPlan || !currentProject.characters) {
        alert("שגיאה: התוכנית או הדמויות אינן מוכנות.");
        return;
    }

    // ודא שכל הדמויות אושרו (יש להן תמונת ייחוס)
    const allCharactersReady = currentProject.characters.every(char => char.referenceImageB64);
    if (!allCharactersReady) {
        alert("אנא המתן לסיום יצירת כל תמונות הדמויות או אשר אותן לפני ההמשך.");
        return;
    }
    
    // 1. חשב כמה קריאות API נדרשות (רעיון בדיקת המשאבים)
    const requiredCalls = calculateRequiredCalls();
    const availableKeys = apiKeyPool.length;

    // אנו מניחים באופן פסימי שמפתח אחד לא יספיק לכל הקריאות
    // (זוהי הנחה לצורך הדגמה. בעולם אמיתי נצטרך לדעת את המגבלה המדויקת)
    // לצורך הפשטות, נניח שמגבלה היא 10 קריאות למפתח
    const CALLS_PER_KEY_ESTIMATE = 10; 
    const neededKeys = Math.ceil(requiredCalls / CALLS_PER_KEY_ESTIMATE);

    console.log(`חישוב: נדרשות ${requiredCalls} קריאות. נדרשים ${neededKeys} מפתחות. זמינים: ${availableKeys}`);

    if (availableKeys < neededKeys) {
        // 2. אם אין מספיק מפתחות, בקש עוד
        const keysToAdd = neededKeys - availableKeys;
        const message = `הקומיקס שלך דורש כ-${requiredCalls} קריאות API.
                       על בסיס הערכה, נדרשים כ-${neededKeys} מפתחות בסך הכל.
                       אנא הוסף לפחות עוד ${keysToAdd} מפתחות גיבוי.`;
        showKeyPoolModal(message, keysToAdd);
        
        // המתן עד שהמשתמש יוסיף מפתחות.
        // לאחר לחיצה על "הוסף מפתחות" (handleSaveBackupKeys),
        // המשתמש יצטרך ללחוץ שוב על "אשר תוכנית"
        return; 
    }

    // 3. אם יש מספיק מפתחות, התחל בתהליך היצירה
    console.log("אישור תוכנית עבר. מתחיל בתהליך יצירת הקומיקס...");
    showScreen('generation-section');
    await startGenerationProcess();
}

/**
 * מחשב כמה קריאות API נדרשות ליצירת הקומיקס המלא
 * @returns {number} - סך הקריאות המשוער
 */
function calculateRequiredCalls() {
    if (!currentProject.jsonPlan || !currentProject.jsonPlan.pages) {
        return 0;
    }
    // סופר את מספר העמודים + מספר העריכות שבוצעו
    // (זוהי הערכה פשוטה. ניתן לשכלל אותה)
    const pageCount = currentProject.jsonPlan.pages.length;
    
    // נוסיף הערכה לכמות עריכות אפשרית (למשל, 10% מהעמודים יערכו)
    const editBuffer = Math.ceil(pageCount * 0.1); 
    
    return pageCount + editBuffer;
}


// --- 12. פונקציות ליבה - שלב 3: יצירת קומיקס (Generation) ---

/**
 * מתחיל את תהליך יצירת עמודי הקומיקס בלולאה
 */
async function startGenerationProcess() {
    dom.comicViewerContainer.innerHTML = ''; // נקה אזור תצוגה
    dom.generationProgress.classList.remove('hidden');
    
    const pages = currentProject.jsonPlan.pages;
    currentProject.generatedPages = []; // אתחל את מערך התוצאות

    try {
        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            
            // 1. עדכן את מחוון ההתקדמות
            updateGenerationProgress(i, pages.length);
            
            // 2. בנה את ההנחיה המורכבת (תמונה + טקסט)
            const promptParts = buildPagePrompt(page);
            
            // 3. קרא ל-API עם מודל ה"אמן"
            const result = await generateWithRetry(modelArtist, {}, promptParts);

            // 4. חלץ את התמונה
            const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
            if (!part || !part.inlineData) {
                throw new Error(`ה-API לא החזיר תמונת עמוד עבור עמוד ${page.pageNumber}`);
            }
            
            const pageBase64 = part.inlineData.data;
            const pageImageSrc = `data:${part.inlineData.mimeType};base64,${pageBase64}`;

            // 5. שמור את התוצאה במצב (state)
            currentProject.generatedPages.push({
                pageNumber: page.pageNumber,
                imageB64: pageBase64,
                mimeType: part.inlineData.mimeType
            });

            // 6. הצג את התמונה שנוצרה בממשק
            renderGeneratedPage(pageImageSrc, page.pageNumber, i);
            
            // 7. שמור את ההתקדמות ב-localStorage
            saveProjectToStorage();
        }

        // 8. סיום
        updateGenerationProgress(pages.length, pages.length); // סיים ב-100%
        console.log("יצירת הקומיקס הושלמה!");

    } catch (error) {
        console.error("שגיאה קריטית במהלך יצירת העמודים:", error);
        updateGenerationProgress(pages.length, pages.length, true); // הצג שגיאה
        if (!error.toString().includes("No more API keys")) {
            alert(`תהליך היצירה נכשל: ${error.message}`);
        }
    }
}

/**
 * מעדכן את מחוון ההתקדמות
 * @param {number} current - מספר העמוד הנוכחי (מבוסס 0)
 * @param {number} total - סך העמודים
 * @param {boolean} [error=false] - האם להציג מצב שגיאה
 */
function updateGenerationProgress(current, total, error = false) {
    if (error) {
        dom.progressBarFill.style.width = '100%';
        dom.progressBarFill.style.backgroundColor = 'var(--color-danger)';
        dom.progressText.textContent = `שגיאה ביצירה. בדוק קונסולה או נסה להוסיף מפתחות.`;
        return;
    }
    
    if (current === total) {
        // הושלם
        dom.progressBarFill.style.width = '100%';
        dom.progressBarFill.style.backgroundColor = 'var(--color-success)';
        dom.progressText.textContent = `הושלם! ${total} מתוך ${total} עמודים נוצרו.`;
    } else {
        // בתהליך
        const percentage = Math.round(((current) / total) * 100);
        dom.progressBarFill.style.width = `${percentage}%`;
        dom.progressText.textContent = `מייצר עמוד ${current + 1} מתוך ${total}... (${percentage}%)`;
    }
}

/**
 * (מקום שמור לחלק 6)
 * בונה את מערך ההנחיות המורכב (תמונה + טקסט) עבור עמוד ספציפי
 * @param {object} page - אובייקט העמוד מה-JSON
 * @returns {Array<object>} - מערך של חלקי הנחיה לשליחה ל-API
 */
function buildPagePrompt(page) {
    // לוגיקה זו תפותח בחלק הבא
    // היא תצטרך:
    // 1. למצוא את תמונות הייחוס של הדמויות שמופיעות בעמוד זה.
    // 2. לבנות את הנחיית הטקסט המשלבת את כל השדות מה-JSON (סצנה, קומפוזיציה, דיאלוג וכו').
    // 3. להחזיר מערך של [תמונת_ייחוס1, תמונת_ייחוס2, הנחיית_טקסט_מורכבת]
    return [{ text: "מקום שמור להנחיה מורכבת" }]; // פלייסהולדר זמני
}

/**
 * (מקום שמור לחלק 6)
 * מציג עמוד קומיקס שנוצר באזור התצוגה
 * @param {string} imgSrc - מקור התמונה (data URL)
 * @param {number} pageNum - מספר העמוד
 * @param {number} index - האינדקס במערך (לצורך עריכה)
 */
function renderGeneratedPage(imgSrc, pageNum, index) {
    // לוגיקה זו תפותח בחלק הבא
    // היא תיצור את כרטיס העמוד ותוסיף לו כפתור עריכה
    console.log(`מציג עמוד ${pageNum}`);
}


// (סוף קובץ - חלק 5)

"use strict";
// (המשך קובץ - חלק 5)

// --- 13. פונקציות עזר ליצירת עמודים ---

/**
 * מוצא את שמות הדמויות המופיעות בדיאלוגים של עמוד מסוים.
 * @param {object} page - אובייקט העמוד מה-JSON.
 * @returns {Array<string>} - מערך של שמות דמויות ייחודיים.
 */
function findCharactersInPage(page) {
    if (!page.dialogue) return [];

    const characters = new Set();
    
    // סרוק את כל חלקי הדיאלוג בעמוד
    page.dialogue.forEach(diag => {
        const charName = diag.character ? diag.character.trim() : null;
        if (charName) {
            characters.add(charName);
        }
    });

    return Array.from(characters);
}

/**
 * בונה את מערך ההנחיות המורכב (תמונה + טקסט) עבור עמוד ספציפי.
 * זוהי הליבה של יצירת הקומיקס - שילוב של Multi-Modal Prompting.
 * @param {object} page - אובייקט העמוד מה-JSON.
 * @returns {Array<object>} - מערך של חלקי הנחיה לשליחה ל-API.
 */
function buildPagePrompt(page) {
    const promptParts = [];
    
    // 1. זהה דמויות רלוונטיות וצרף את תמונות הייחוס שלהן
    const requiredCharacters = findCharactersInPage(page);
    
    requiredCharacters.forEach(charName => {
        const charData = currentProject.characters.find(c => c.name === charName);
        
        if (charData && charData.referenceImageB64) {
            // צרף את תמונת הייחוס (PNG לצורך הדוגמה)
            promptParts.push({
                inlineData: {
                    data: charData.referenceImageB64,
                    mimeType: "image/png" 
                }
            });
        }
    });

    // 2. בנה את הנחיית הטקסט המורכבת
    
    // כותרת עמוד
    const title = currentProject.jsonPlan.title;
    
    // סגנון גלובלי (מאוד חשוב לשמירה על עקביות)
    const globalStyle = currentProject.jsonPlan.globalStyle || "High-quality detailed digital comic art.";

    // בנה את טקסט הסצנה המפורט:
    let textPrompt = `צור עמוד קומיקס יחיד ומפורט, באיכות גבוהה, המתאים לסיפור "${title}".\n`;
    textPrompt += `**סגנון כללי:** ${globalStyle}\n`;
    textPrompt += `**עמוד מספר:** ${page.pageNumber}\n\n`;

    // תיאור סצנה
    textPrompt += `**תיאור סצנה:** ${page.sceneDescription}\n`;
    
    // קומפוזיציה (מוסיף פוקוס)
    if (page.compositionSuggestion) {
        textPrompt += `**קומפוזיציה:** השתמש ב-${page.compositionSuggestion} כדי להדגיש את הדרמה.\n`;
    }

    // רגש מוצע (מוסיף עומק)
    if (page.suggestedEmotion) {
        textPrompt += `**רגש מרכזי:** ודא שהאווירה והבעות הפנים משקפים רגש של "${page.suggestedEmotion}".\n`;
    }

    // קריינות
    if (page.narration) {
        textPrompt += `**קריינות:** כלול את הטקסט הבא כקריינות (Narration): "${page.narration}"\n`;
    }
    
    // דיאלוגים
    if (page.dialogue && page.dialogue.length > 0) {
        textPrompt += `**דיאלוגים (בלוני דיבור ומחשבה):**\n`;
        page.dialogue.forEach(diag => {
            const char = diag.character || "דמות לא מזוהה";
            const text = diag.text || "";
            const type = diag.type === 'thought' ? 'מחשבה' : 'דיבור';
            
            textPrompt += `- ${char} (${type}): "${text}"\n`;
        });
    }
    
    textPrompt += "\nבזמן יצירת התמונה, השתמש בתמונות הייחוס שסופקו כדי לשמור על מראה הדמויות.\n";
    textPrompt += "התוצר הסופי צריך להיות פאנל קומיקס מלוטש, מוכן לקריאה, כולל כל הטקסטים.";

    // הוסף את הנחיית הטקסט כחלק האחרון
    promptParts.push({ text: textPrompt });
    
    console.log(`הנחיה לעמוד ${page.pageNumber} (${promptParts.length} חלקים):`, textPrompt);
    return promptParts;
}


// --- 14. פונקציות תצוגה - שלב 3: עמודים שנוצרו ---

/**
 * מציג עמוד קומיקס שנוצר באזור התצוגה, ומוסיף לו כפתור עריכה.
 * @param {string} imgSrc - מקור התמונה (data URL)
 * @param {number} pageNum - מספר העמוד
 * @param {number} index - האינדקס במערך currentProject.generatedPages
 */
function renderGeneratedPage(imgSrc, pageNum, index) {
    const pageCard = document.createElement('div');
    pageCard.className = 'comic-page';
    pageCard.setAttribute('data-page-index', index);
    
    // תמונת העמוד
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = `עמוד קומיקס ${pageNum}`;
    
    // אזור האוברליי (מספר עמוד וכפתור עריכה)
    const overlay = document.createElement('div');
    overlay.className = 'page-overlay';
    
    // מספר עמוד
    const pageNumberSpan = document.createElement('span');
    pageNumberSpan.className = 'page-number';
    pageNumberSpan.textContent = `עמוד ${pageNum}`;
    
    // כפתור עריכה
    const editButton = document.createElement('button');
    editButton.className = 'secondary-btn edit-page-btn';
    editButton.textContent = 'ערוך עמוד';
    editButton.addEventListener('click', () => showEditModal('page', index)); // מפעיל את showEditModal
    
    overlay.appendChild(pageNumberSpan);
    overlay.appendChild(editButton);

    pageCard.appendChild(img);
    pageCard.appendChild(overlay);
    
    dom.comicViewerContainer.appendChild(pageCard);
}


// --- 15. עדכון פונקציית המודאל (Update Existing Function) ---

/**
 * (עדכון של הפונקציה מחלק 3)
 * מציג את מודאל העריכה המאוחד
 * @param {'character'|'page'} type - סוג האובייקט לעריכה
 * @param {number} index - האינדקס של האובייקט במערך המתאים
 */
function showEditModal(type, index) {
    let base64Data = "";
    let title = "";
    
    if (type === 'character') {
        const char = currentProject.characters[index];
        base64Data = char.referenceImageB64;
        title = `דמות: ${char.name}`;
    } else if (type === 'page') {
        // מציג את העמוד שנוצר
        const page = currentProject.generatedPages[index];
        const pageNum = currentProject.jsonPlan.pages[index].pageNumber; // קבל את מספר העמוד המקורי
        base64Data = page.imageB64;
        title = `עמוד קומיקס: ${pageNum}`;
    } else {
        return;
    }

    if (!base64Data) {
        alert("לא נמצאה תמונה לעריכה.");
        return;
    }

    // הגדר את המודאל
    dom.editModal.dataset.editType = type;
    dom.editModal.dataset.editIndex = index;
    dom.editModalTitle.textContent = `עריכה חכמה: ${title}`;
    dom.editModalImage.src = `data:image/png;base64,${base64Data}`; // אנו מניחים PNG
    dom.editModalPrompt.value = '';

    dom.editModal.classList.add('visible');
}


// --- 16. עדכון DOM elements (השלמת חסרים מחלק 1) ---

// הוספת DOM element חסר שנוסף ב-HTML בחלקים קודמים
dom.editModalTitle = document.querySelector('#edit-modal h3'); // כותרת המודאל
// (שאר האלמנטים הנחוצים כבר הוגדרו בחלקים 1-5)


// (סוף קובץ - חלק 6)

"use strict";
// (המשך קובץ - חלק 6)

// --- 17. פונקציות ליבה - שלב 4: עריכה חכמה (Smart Editing) ---

/**
 * מטפל בלחיצה על "בצע עריכה" במודאל העריכה.
 * שולח את התמונה הקיימת + הנחיית העריכה למודל ה-AI כדי לקבל תמונה מתוקנת.
 */
async function handleApplyEdit() {
    const type = dom.editModal.dataset.editType;
    const index = parseInt(dom.editModal.dataset.editIndex);
    const editPrompt = dom.editModalPrompt.value.trim();

    if (!editPrompt) {
        alert("אנא הזן תיאור לשינוי שתרצה לבצע.");
        return;
    }

    let currentBase64 = '';
    let objectName = '';
    let mimeType = "image/png"; // מניחים PNG לעריכה

    // 1. קבל את נתוני המקור
    if (type === 'character') {
        const char = currentProject.characters[index];
        currentBase64 = char.referenceImageB64;
        objectName = `דמות: ${char.name}`;
    } else if (type === 'page') {
        const page = currentProject.generatedPages[index];
        const pageNum = currentProject.jsonPlan.pages[index].pageNumber;
        currentBase64 = page.imageB64;
        objectName = `עמוד: ${pageNum}`;
    } else {
        alert("שגיאה: סוג עריכה לא ידוע.");
        return;
    }

    if (!currentBase64) {
        alert("שגיאה: התמונה המקורית חסרה.");
        return;
    }

    showLoading(true, `מבצע עריכה חכמה עבור ${objectName}...`);
    dom.editModal.classList.remove('visible'); // סגור את המודאל

    try {
        // 2. בנה את מערך ההנחיה (תמונה + טקסט)
        const promptParts = [
            {
                inlineData: {
                    data: currentBase64,
                    mimeType: mimeType 
                }
            },
            {
                text: `בהתבסס על התמונה המסופקת, בצע את השינוי הבא: "${editPrompt}".
                       הקפד לשמור על הסגנון הכללי של תמונת הקלט. החזר תמונה מעודכנת בלבד.`
            }
        ];

        // 3. קרא ל-API עם מודל ה"אמן" (שמשמש גם לעריכה)
        const result = await generateWithRetry(modelArtist, {}, promptParts);

        // 4. חלץ את התמונה החדשה
        const part = result.response.candidates[0].content.parts.find(p => p.inlineData);
        if (!part || !part.inlineData) {
            throw new Error(`ה-AI לא החזיר תמונה מתוקנת.`);
        }
        
        const newBase64 = part.inlineData.data;
        const newImageSrc = `data:${part.inlineData.mimeType};base64,${newBase64}`;

        // 5. עדכן את המצב (state) וה-UI
        if (type === 'character') {
            currentProject.characters[index].referenceImageB64 = newBase64;
            // עדכן את כרטיס הדמות ב-UI (כדי למנוע רענון מלא)
            const card = document.querySelector(`#character-approval-container div[data-index="${index}"] img`);
            if (card) {
                card.src = newImageSrc;
            }
        } else if (type === 'page') {
            currentProject.generatedPages[index].imageB64 = newBase64;
            // עדכן את כרטיס העמוד ב-UI (כדי למנוע רענון מלא)
            const pageCard = document.querySelector(`#comic-viewer-container div[data-page-index="${index}"] img`);
            if (pageCard) {
                pageCard.src = newImageSrc;
            }
        }

        saveProjectToStorage();
        showLoading(false);
        alert("העריכה בוצעה בהצלחה!");
        
    } catch (error) {
        console.error("שגיאה בעריכה החכמה:", error);
        showLoading(false);
        if (!error.toString().includes("No more API keys")) {
            alert(`שגיאה בעריכה החכמה: ${error.message}`);
        }
        // פתח מחדש את המודאל כדי לאפשר ניסיון חוזר
        if (type === 'character') {
            showEditModal('character', index);
        } else if (type === 'page') {
            showEditModal('page', index);
        }
    }
}


// --- 18. קובעי אירועים (Event Listeners) - השלמה ---

// הוסף את ה-Event Listener לפונקציה החדשה שלנו
document.getElementById('apply-edit-btn').addEventListener('click', handleApplyEdit);


// (סוף קובץ - חלק 7)

"use strict";
// (המשך קובץ - חלק 7)

// --- 19. פונקציות ייצוא וניהול אחסון ---

/**
 * מטפל בלחיצה על "ייצא ל-PDF"
 * הערה: יישום מלא של יצירת PDF מרובת תמונות הוא משימה מורכבת שדורשת ספריות צד שלישי (כמו jsPDF)
 * לצורך ההדגמה, ניצור קובץ טקסט שמכיל את כל העמודים.
 */
function handleExportPdf() {
    if (!currentProject.generatedPages || currentProject.generatedPages.length === 0) {
        alert("אין עמודים שנוצרו לייצוא.");
        return;
    }

    // בניית תוכן קובץ PDF (מדומה - זהו למעשה קובץ טקסט)
    let content = `--- קומיקס: ${currentProject.jsonPlan.title || 'קומיקס חדש'} ---\n`;
    currentProject.generatedPages.forEach((page, index) => {
        content += `\n=== עמוד ${index + 1} ===\n`;
        // לצורך הדוגמה: במקום תמונה שלמה, נרשום קיצור
        content += `[נתוני תמונה בפורמט Base64, גודל: ${Math.round(page.imageB64.length / 1024)} KB]\n`;
        content += `להצגת התמונה המלאה, יש להשתמש בנתונים אלו כ-Data URL.\n`;
    });

    // יצירת והורדת הקובץ
    downloadFile(content, 'text/plain', `${currentProject.jsonPlan.title || 'Panalix_Comic'}.txt`);
    alert("הקומיקס מוכן להורדה! (הערה: עקב מגבלות דפדפן, ייצאנו קובץ טקסט עם נתוני התמונה במקום PDF אמיתי.)");
}

/**
 * מטפל בלחיצה על "ייצא ל-CBZ"
 * הערה: יישום מלא של יצירת CBZ (קובץ ZIP עם תמונות) הוא משימה מורכבת שדורשת ספריות דחיסה
 * לצורך ההדגמה, נשתמש ב-PDF המדומה.
 */
function handleExportCbz() {
    // ביישום מלא, כאן היינו אורזים את כל ה-Base64 JPG/PNG לקובץ ZIP עם סיומת .cbz
    alert("CBZ דורש כלי דחיסה. לצורך ההדגמה, נשתמש באותה פונקציית PDF מדומה.");
    handleExportPdf();
}

/**
 * פונקציית עזר להורדת קובץ
 * @param {string} content - תוכן הקובץ
 * @param {string} mimeType - סוג ה-MIME
 * @param {string} filename - שם הקובץ
 */
function downloadFile(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * מטפל בלחיצה על "נקה פרויקט וקבצים"
 */
function handleClearStorage() {
    if (confirm("האם אתה בטוח שברצונך למחוק את כל נתוני הפרויקט הנוכחיים? פעולה זו אינה הפיכה!")) {
        localStorage.removeItem('panalixProject');
        localStorage.removeItem('panalixApiKey');
        localStorage.removeItem('panalixApiKeyPool');
        
        // אתחל את האפליקציה מחדש
        location.reload(); 
    }
}

/**
 * מחשב את גודל האחסון המשוער ב-localStorage
 * @returns {string} גודל ב-MB
 */
function calculateStorageUsage() {
    let totalLength = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            // כל תו ב-localStorage שווה לכ-2 בתים
            totalLength += localStorage[key].length * 2;
        }
    }
    const mb = totalLength / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
}


// --- 20. אתחול האפליקציה (Initialization) ---

/**
 * טוען את המצב ההתחלתי של האפליקציה, מפתח API ונתוני פרויקט.
 */
function loadInitialState() {
    const storedApiKey = localStorage.getItem('panalixApiKey');
    const storedProject = localStorage.getItem('panalixProject');
    const storedKeyPool = localStorage.getItem('panalixApiKeyPool');

    // טען מפתחות גיבוי (אם קיימים)
    if (storedKeyPool) {
        apiKeyPool.push(...JSON.parse(storedKeyPool));
    }

    if (storedApiKey) {
        // מפתח ראשי נמצא - אתחל את המודלים
        initializeModels(storedApiKey);
        dom.keyCountDisplay.textContent = apiKeyPool.length;
        
        // טען פרויקט קיים (אם קיים)
        if (storedProject) {
            currentProject = JSON.parse(storedProject);
            // העבר אוטומטית למסך האחרון שבו הפרויקט נמצא
            if (currentProject.jsonPlan && currentProject.generatedPages.length > 0) {
                 showScreen('generation-section'); // שלב 3
                 renderGeneratedPagesFromState();
            } else if (currentProject.jsonPlan) {
                 showScreen('approval-section'); // שלב 2
                 // רנדר את הדמויות והתוכנית
                 renderCharacterApprovalUI(); 
                 renderPlanEditorUI();
            } else {
                 showScreen('story-input-section'); // שלב 1
            }
        } else {
             // אין פרויקט - הצג את מסך הקלט
             showScreen('story-input-section'); 
        }

        // הצג את ממשק האפליקציה הראשי והסתר את מסך הזנת המפתח
        document.getElementById('api-key-screen').classList.remove('active-screen');
        document.getElementById('main-app').classList.add('active-screen');

    } else {
        // אין מפתח - הצג את מסך הזנת המפתח
        document.getElementById('api-key-screen').classList.add('active-screen');
        document.getElementById('main-app').classList.remove('active-screen');
    }
    
    // עדכן שימוש באחסון
    dom.storageUsageDisplay.textContent = calculateStorageUsage();
}

/**
 * פונקציה שתרוץ בטעינה מחדש של הפרויקט
 * מרנדרת מחדש את העמודים שנוצרו אם יש כאלה
 */
function renderGeneratedPagesFromState() {
    dom.comicViewerContainer.innerHTML = '';
    currentProject.generatedPages.forEach((page, index) => {
        const pageNum = currentProject.jsonPlan.pages[index].pageNumber;
        const imgSrc = `data:${page.mimeType};base64,${page.imageB64}`;
        renderGeneratedPage(imgSrc, pageNum, index);
    });
    // הסתר את מחוון ההתקדמות לאחר טעינה
    dom.generationProgress.classList.add('hidden');
}


// --- 21. קובעי אירועים (Event Listeners) - סיום ---

// שלב 3: ייצוא
document.getElementById('export-pdf-btn').addEventListener('click', handleExportPdf);
document.getElementById('export-cbz-btn').addEventListener('click', handleExportCbz);

// הגדרות וניהול
document.getElementById('manage-keys-btn').addEventListener('click', showKeyPoolModal);
document.getElementById('clear-storage-btn').addEventListener('click', handleClearStorage);

// מודאלים
document.getElementById('close-edit-modal-btn').addEventListener('click', () => {
    dom.editModal.classList.remove('visible');
});


// ---------------------------------------------
// === START APPLICATION ===
// הפעלת האתחול לאחר טעינת כל הסקריפט
loadInitialState();
// ---------------------------------------------


// (סוף קובץ - חלק 8)
