// ===== IndexedDB Helpers =====

const DB_NAME = 'alphabet-reading';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

let dbInstance = null;

function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => {
            dbInstance = e.target.result;
            resolve(dbInstance);
        };
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
    }).catch(err => {
        console.error('Failed to load recording states:', err);
    });
}

renderGrid();
refreshRecordingStates();

// ===== Audio Trimming =====

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function trimSilence(blob) {
    return blob.arrayBuffer()
        .then(buf => audioCtx.decodeAudioData(buf))
        .then(audioBuffer => {
            const channel = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;
            const threshold = 0.01;
            const margin = Math.floor(sampleRate * 0.02); // 20ms margin

            // Find first sample above threshold
            let start = 0;
            for (let i = 0; i < channel.length; i++) {
                if (Math.abs(channel[i]) > threshold) {
                    start = Math.max(0, i - margin);
                    break;
                }
            }

            // Find last sample above threshold
            let end = channel.length;
            for (let i = channel.length - 1; i >= start; i--) {
                if (Math.abs(channel[i]) > threshold) {
                    end = Math.min(channel.length, i + margin);
                    break;
                }
            }

            // Encode trimmed audio as WAV
            const numChannels = audioBuffer.numberOfChannels;
            const length = end - start;
            const wavBuffer = new ArrayBuffer(44 + length * numChannels * 2);
            const view = new DataView(wavBuffer);

            // WAV header
            const writeStr = (offset, str) => {
                for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
            };
            writeStr(0, 'RIFF');
            view.setUint32(4, 36 + length * numChannels * 2, true);
            writeStr(8, 'WAVE');
            writeStr(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true); // PCM
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true);
            view.setUint16(32, numChannels * 2, true);
            view.setUint16(34, 16, true); // 16-bit
            writeStr(36, 'data');
            view.setUint32(40, length * numChannels * 2, true);

            // Interleave and write samples
            let offset = 44;
            for (let i = 0; i < length; i++) {
                for (let ch = 0; ch < numChannels; ch++) {
                    const sample = audioBuffer.getChannelData(ch)[start + i];
                    const clamped = Math.max(-1, Math.min(1, sample));
                    view.setInt16(offset, clamped * 0x7FFF, true);
                    offset += 2;
                }
            }

            return new Blob([wavBuffer], { type: 'audio/wav' });
        });
}

// ===== Recording =====

let currentRecorder = null;
let currentRecordingLetter = null;

function stopCurrentRecording() {
    if (currentRecorder && currentRecorder.state === 'recording') {
        currentRecorder.stop();
    }
}

function startRecording(letter) {
    // If already recording this letter, stop it
    if (currentRecordingLetter === letter) {
        stopCurrentRecording();
        return;
    }

    // Stop any other active recording first
    stopCurrentRecording();

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        const recorder = new MediaRecorder(stream);
        const chunks = [];

        currentRecorder = recorder;
        currentRecordingLetter = letter;

        // Update UI to recording state
        const btn = document.getElementById(`rec-${letter}`);
        btn.textContent = 'Stop';
        btn.classList.add('recording');

        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: recorder.mimeType });
            trimSilence(blob).then(trimmed => {
                return saveRecording(letter.toLowerCase(), trimmed);
            }).then(() => {
                refreshRecordingStates();
            }).catch(err => {
                // If trimming fails, save the original
                console.error('Trim failed, saving original:', err);
                saveRecording(letter.toLowerCase(), blob).then(() => refreshRecordingStates());
            });

            // Reset UI
            btn.textContent = 'Record';
            btn.classList.remove('recording');
            currentRecorder = null;
            currentRecordingLetter = null;
        };

        recorder.start();
    }).catch(err => {
        console.error('Microphone access denied:', err);
        alert('Microphone access is needed to record letter sounds.');
    });
}

// ===== Play Single Letter =====

function playRecording(letter) {
    getRecording(letter.toLowerCase()).then(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play().catch(() => URL.revokeObjectURL(url));
    });
}

// ===== Event Delegation for Grid Buttons =====

gridEl.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('btn-record')) {
        const letter = target.id.replace('rec-', '');
        startRecording(letter);
    } else if (target.classList.contains('btn-play')) {
        const letter = target.id.replace('play-', '');
        playRecording(letter);
    }
});

// ===== Word Player =====

const wordInput = document.getElementById('word-input');
const playWordBtn = document.getElementById('play-word-btn');
const speedSlider = document.getElementById('speed-slider');
const wordMessage = document.getElementById('word-message');

let isPlayingWord = false;

function playWord() {
    if (isPlayingWord) return;

    const raw = wordInput.value.trim();
    if (!raw) return;

    // Extract only letters, lowercase
    const letters = raw.toLowerCase().split('').filter(c => /[a-z]/.test(c));
    if (letters.length === 0) return;

    wordMessage.textContent = '';
    isPlayingWord = true;
    playWordBtn.disabled = true;

    // Delay between the START of each letter (not gap after end)
    // At low values letters overlap, at high values they play sequentially
    const delay = parseInt(speedSlider.value, 10);
    const missing = [];

    // Pre-fetch all recordings, then schedule playback on timers
    Promise.all(letters.map(letter => getRecording(letter))).then(blobs => {
        let lastEndTime = 0;

        blobs.forEach((blob, i) => {
            if (!blob) {
                missing.push(letters[i].toUpperCase());
                return;
            }

            const startAt = i * delay;

            setTimeout(() => {
                const url = URL.createObjectURL(blob);
                const audio = new Audio(url);
                audio.onended = () => {
                    URL.revokeObjectURL(url);
                };
                audio.onerror = () => {
                    URL.revokeObjectURL(url);
                };
                audio.play().catch(() => URL.revokeObjectURL(url));
            }, startAt);

            // Estimate when the last sound finishes (delay + ~1s per letter max)
            lastEndTime = Math.max(lastEndTime, startAt + 1500);
        });

        // Re-enable the button after all sounds should be done
        setTimeout(() => {
            isPlayingWord = false;
            playWordBtn.disabled = false;
            if (missing.length > 0) {
                wordMessage.textContent = `Missing recordings for: ${[...new Set(missing)].join(', ')}`;
            }
        }, lastEndTime);
    }).catch(err => {
        console.error('Word playback error:', err);
        isPlayingWord = false;
        playWordBtn.disabled = false;
    });
}

playWordBtn.addEventListener('click', playWord);

// Also allow pressing Enter in the text input
wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') playWord();
});
