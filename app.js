// ===== IndexedDB Helpers =====

const DB_NAME = 'alphabet-reading';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

function saveRecording(letter, blob) {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(blob, letter);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    });
}

function getRecording(letter) {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(letter);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    });
}

function getAllRecordedLetters() {
    return openDB().then(db => {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAllKeys();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    });
}

// ===== Letter Grid =====

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const gridEl = document.getElementById('letter-grid');

function createLetterCard(letter) {
    const card = document.createElement('div');
    card.className = 'letter-card';
    card.id = `card-${letter}`;
    card.innerHTML = `
        <div class="letter">${letter}</div>
        <div class="recorded-badge" id="badge-${letter}"></div>
        <div class="buttons">
            <button class="btn-record" id="rec-${letter}">Record</button>
            <button class="btn-play" id="play-${letter}">Play</button>
        </div>
    `;
    return card;
}

function renderGrid() {
    LETTERS.forEach(letter => {
        gridEl.appendChild(createLetterCard(letter));
    });
}

// Mark cards that already have recordings on load
function refreshRecordingStates() {
    getAllRecordedLetters().then(keys => {
        LETTERS.forEach(letter => {
            const key = letter.toLowerCase();
            const card = document.getElementById(`card-${letter}`);
            const badge = document.getElementById(`badge-${letter}`);
            const playBtn = document.getElementById(`play-${letter}`);
            if (keys.includes(key)) {
                card.classList.add('has-recording');
                badge.textContent = '✓ recorded';
                playBtn.classList.add('visible');
            } else {
                card.classList.remove('has-recording');
                badge.textContent = '';
                playBtn.classList.remove('visible');
            }
        });
    });
}

renderGrid();
refreshRecordingStates();
