// --- CONFIGURAZIONE (dinamica per responsive) ---
let TILE_SIZE = 16; // iniziale, verrà ricalcolato
const COLS = 25;  // nuova mappa 25x25
const ROWS = 25;  // nuova mappa 25x25
let CANVAS_WIDTH = 400; // aggiornato dinamicamente
let CANVAS_HEIGHT = 400;

function resizeCanvas() {
    const uiBar = document.getElementById('ui-bar');
    const uiHeight = uiBar ? uiBar.offsetHeight : 40;
    const padding = 20; // margine
    const availHeight = window.innerHeight - uiHeight - padding;
    const availWidth = window.innerWidth - padding;
    // Calcola tile size basato sia su altezza che larghezza per evitare overflow orizzontale
    const tileByH = Math.floor(availHeight / ROWS);
    const tileByW = Math.floor(availWidth / COLS);
    let newTile = Math.min(tileByH, tileByW);
    if (newTile < 10) newTile = 10; // limite minimo
    if (newTile > 48) newTile = 48; // limite massimo per evitare canvas enorme
    TILE_SIZE = newTile;
    CANVAS_WIDTH = TILE_SIZE * COLS;
    CANVAS_HEIGHT = TILE_SIZE * ROWS;
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.style.width = CANVAS_WIDTH + 'px';
    canvas.style.height = CANVAS_HEIGHT + 'px';
    if (uiBar) uiBar.style.width = CANVAS_WIDTH + 'px';
    // Ridimensiona overlay start / game over / popup messaggi se presenti
    const startScreen = document.getElementById('start-screen');
    const gameOver = document.getElementById('game-over-screen');
    [startScreen, gameOver].forEach(el => {
        if (el) {
            el.style.width = CANVAS_WIDTH + 'px';
            el.style.height = CANVAS_HEIGHT + 'px';
        }
    });
}

window.addEventListener('resize', () => {
    resizeCanvas();
});

// --- STATO DEL GIOCO ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Giocatore
let player = { 
    x: Math.floor(COLS/2), // centro mappa 25x25
    y: ROWS - 3, 
    lives: 3,
    isInvulnerable: false,
    invulnerableTimer: 0
};

let score = 0;
let winMessage = "Hai vinto!";

// Audio Context
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();

function playSound(type) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    if (type === 'correct') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(500, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1000, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'wrong') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.linearRampToValueAtTime(100, audioCtx.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } else if (type === 'win') {
        osc.type = 'square';
        // Melodia semplice
        const now = audioCtx.currentTime;
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.setValueAtTime(500, now + 0.1);
        osc.frequency.setValueAtTime(600, now + 0.2);
        osc.frequency.setValueAtTime(800, now + 0.4);
        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 1);
        osc.start();
        osc.stop(now + 1);
    }
}

// --- MUSICA DI GIOCO ---
let bgMusicOscillators = [];
let victoryPlayed = false;

function startGameMusic() {
    stopGameMusic();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const root = 220; // A3
    const pattern = [0, 3, 7, 10]; // intervalli
    for (let i = 0; i < pattern.length; i++) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = root * Math.pow(2, pattern[i] / 12);
        gain.gain.value = 0.05;
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        bgMusicOscillators.push({ osc, gain });
    }
    // Leggera modulazione ritmica
    let t = 0;
    bgMusicOscillators.forEach((o, idx) => {
        setInterval(() => {
            const v = 0.04 + 0.01 * Math.sin((t + idx) * 0.5);
            o.gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.2);
            t += 0.05;
        }, 300);
    });
}

function stopGameMusic() {
    bgMusicOscillators.forEach(o => {
        try { o.osc.stop(); } catch(e) {}
    });
    bgMusicOscillators = [];
}

function playVictoryMusic() {
    stopGameMusic();
    if (victoryPlayed) return;
    victoryPlayed = true;
    const tempo = audioCtx.currentTime;
    const notes = [440, 523, 659, 880, 659, 880, 987];
    notes.forEach((f, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0, tempo + i * 0.25);
        gain.gain.linearRampToValueAtTime(0.12, tempo + i * 0.25 + 0.02);
        gain.gain.linearRampToValueAtTime(0.0, tempo + i * 0.25 + 0.23);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(tempo + i * 0.25);
        osc.stop(tempo + i * 0.25 + 0.25);
    });
}

// Nemici e Proiettili
let enemies = [];
let projectiles = [];

// Stato di pausa (quando il popup è aperto o game over)
let isPaused = true; // Inizia in pausa per la schermata iniziale
let isGameOver = false;

// Array delle domande caricate
let questions = [];

// Set per tracciare le coordinate dei trigger già visitati ("x,y")
const visitedTriggers = new Set();

// Mappa dei filosofi: "x,y" -> index domanda
const philosopherMap = {};

// --- DEFINIZIONE TILE MAPPA ---
// 0: Pavimento Marmo (Camminabile)
// 1: Muro/Colonna (Bloccato)
// 2: Trigger Filosofo (Camminabile, attiva evento)
// 3: Scale (Camminabile, solo visivo)
// 4: Vuoto/Abisso (Bloccato)

// Generiamo una mappa "Monastero" procedurale/manuale per semplicità di lettura
// Creiamo un array vuoto e poi lo riempiamo
let map = [];

function createMonasteryMap() {
    map = [];
    for (let y = 0; y < ROWS; y++) {
        const row = [];
        for (let x = 0; x < COLS; x++) row.push(0);
        map.push(row);
    }

    function drawRect(x, y, w, h, type) {
        for (let iy = y; iy < y + h; iy++) {
            for (let ix = x; ix < x + w; ix++) {
                if (iy >= 0 && iy < ROWS && ix >= 0 && ix < COLS) map[iy][ix] = type;
            }
        }
    }

    // Muri perimetrali
    drawRect(0, 0, COLS, 1, 1);
    drawRect(0, ROWS - 1, COLS, 1, 1);
    drawRect(0, 0, 1, ROWS, 1);
    drawRect(COLS - 1, 0, 1, ROWS, 1);

    // Scalinata centrale (più grande per 25x25)
    drawRect(9, 7, 7, 4, 3);

    // Colonne decorative centrali (due file)
    for (let y = 4; y <= 20; y += 4) {
        map[y][7] = 1;
        map[y][17] = 1;
    }

    // Stanze laterali (superiori + inferiori) ridimensionate
    drawRect(0, 3, 6, 1, 1); // alto sx
    drawRect(COLS - 6, 3, 6, 1, 1); // alto dx
    drawRect(0, ROWS - 6, 6, 1, 1); // basso sx
    drawRect(COLS - 6, ROWS - 6, 6, 1, 1); // basso dx

    // Posizionamento Filosofi (distribuiti simmetricamente)
    const philLocations = [
        { x: Math.floor(COLS/2), y: 5, id: 0 },            // Socrate vicino scalinata
        { x: 4, y: 5, id: 1 },                              // Platone
        { x: COLS - 5, y: 5, id: 2 },                       // Aristotele
        { x: 4, y: ROWS - 7, id: 3 },                       // Cartesio
        { x: COLS - 5, y: ROWS - 7, id: 4 }                 // Nietzsche
    ];

    philLocations.forEach(loc => {
        map[loc.y][loc.x] = 2;
        philosopherMap[`${loc.x},${loc.y}`] = loc.id;
    });

    // 6. Aggiungiamo Nemici (Diavoletti)
    enemies = [];
    // Pattuglie centrali
    enemies.push({ x: 8, y: 10, type: 'horizontal', dir: 1, min: 7, max: 17, cooldown: 0 });
    enemies.push({ x: 16, y: 10, type: 'horizontal', dir: -1, min: 7, max: 17, cooldown: 0 });
    // Verticali laterali
    enemies.push({ x: 6, y: 12, type: 'vertical', dir: 1, min: 8, max: 18, cooldown: 0 });
    enemies.push({ x: 18, y: 12, type: 'vertical', dir: -1, min: 8, max: 18, cooldown: 0 });
    // Guardiano scalinata
    enemies.push({ x: Math.floor(COLS/2), y: 8, type: 'horizontal', dir: 1, min: Math.floor(COLS/2)-2, max: Math.floor(COLS/2)+2, cooldown: 0 });
}

createMonasteryMap();


// --- INIZIALIZZAZIONE ---
async function initGame() {
    try {
        // Carica domande
        const qResponse = await fetch('questions.json');
        if (!qResponse.ok) throw new Error("Impossibile caricare questions.json");
        questions = await qResponse.json();

        // Carica messaggio vittoria
        const wResponse = await fetch('win.json');
        if (wResponse.ok) {
            const wData = await wResponse.json();
            winMessage = wData.message;
        }
    } catch (error) {
        console.error("Errore:", error);
        questions = [{ id: 99, question: "Errore caricamento (CORS?)", options: ["OK"], correctIndex: 0 }];
    }

    // Gestione bottone Inizia
    document.getElementById('start-btn').onclick = () => {
        document.getElementById('start-screen').classList.add('hidden');
        // Avvia audio context su interazione utente
        if (audioCtx.state === 'suspended') audioCtx.resume();
        resizeCanvas(); // inizializza dimensioni responsive
        startGameMusic(); // musica di gioco
        isPaused = false;
    };

    requestAnimationFrame(gameLoop);
}

// --- GESTIONE INPUT ---
document.addEventListener('keydown', (e) => {
    if (isPaused || isGameOver) return;

    let dx = 0;
    let dy = 0;

    switch(e.key) {
        case 'ArrowUp': case 'w': case 'W': dy = -1; break;
        case 'ArrowDown': case 's': case 'S': dy = 1; break;
        case 'ArrowLeft': case 'a': case 'A': dx = -1; break;
        case 'ArrowRight': case 'd': case 'D': dx = 1; break;
        default: return;
    }

    movePlayer(dx, dy);
});

// --- LOGICA DI GIOCO ---

function movePlayer(dx, dy) {
    const newX = player.x + dx;
    const newY = player.y + dy;

    // Limiti e Collisioni Muri
    if (newX < 0 || newX >= COLS || newY < 0 || newY >= ROWS) return;
    const tileType = map[newY][newX];
    if (tileType === 1 || tileType === 4) return; // 1=Muro, 4=Vuoto

    player.x = newX;
    player.y = newY;

    // Trigger Domanda
    const tileKey = `${newX},${newY}`;
    if (tileType === 2 && !visitedTriggers.has(tileKey)) {
        triggerQuestion(tileKey);
    }
}

function updateEnemies() {
    const now = Date.now();
    enemies.forEach(enemy => {
        if (!enemy.moveTimer) enemy.moveTimer = 0;
        enemy.moveTimer++;

        if (enemy.moveTimer > 30) {
            enemy.moveTimer = 0;
            let nextX = enemy.x;
            let nextY = enemy.y;
            if (enemy.type === 'horizontal') {
                nextX = enemy.x + enemy.dir;
                if (nextX >= enemy.max || nextX <= enemy.min) {
                    enemy.dir *= -1;
                    nextX = enemy.x + enemy.dir; // prova nuova direzione
                }
            } else {
                nextY = enemy.y + enemy.dir;
                if (nextY >= enemy.max || nextY <= enemy.min) {
                    enemy.dir *= -1;
                    nextY = enemy.y + enemy.dir;
                }
            }
            // Collisione con muro
            if (map[nextY] && map[nextY][nextX] !== undefined && map[nextY][nextX] !== 1) {
                enemy.x = nextX;
                enemy.y = nextY;
            } else {
                enemy.dir *= -1; // Inverte se muro
            }
        }

        // Timer sparo
        if (!enemy.shootTimer) enemy.shootTimer = 0;
        enemy.shootTimer++;
        if (enemy.shootTimer > 120) {
            enemy.shootTimer = 0;
            shootProjectile(enemy);
        }

        // Animazione stato (per blinking occhi)
        enemy.blink = (Math.floor(now / 400) % 2) === 0; // true/false alterna
        enemy.hoverOffset = Math.sin(now / 500) * (TILE_SIZE * 0.05); // piccolo bobbing
    });
}

function shootProjectile(enemy) {
    // Il proiettile parte dalla posizione del nemico
    // Direzione: spara verso il giocatore o nella direzione di movimento?
    // Facciamo che spara nella direzione perpendicolare al movimento (più difficile)
    // O nella direzione del movimento. Facciamo 4 direzioni cardinali.
    
    // Semplificazione: Spara verso il giocatore (approssimato agli assi)
    let pdx = 0;
    let pdy = 0;
    
    // Calcola differenza
    let diffX = player.x - enemy.x;
    let diffY = player.y - enemy.y;

    // Scegli l'asse dominante
    if (Math.abs(diffX) > Math.abs(diffY)) {
        pdx = diffX > 0 ? 1 : -1;
    } else {
        pdy = diffY > 0 ? 1 : -1;
    }

    projectiles.push({
        x: enemy.x, // Coordinate tile (float per fluidità)
        y: enemy.y,
        dx: pdx * 0.1, // Velocità (0.1 tile per frame)
        dy: pdy * 0.1,
        life: 100 // Durata in frame
    });
}

function updateProjectiles() {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += p.dx;
        p.y += p.dy;
        p.life--;

        // Collisione Muri
        // Arrotondiamo per controllare il tile
        let tx = Math.round(p.x);
        let ty = Math.round(p.y);
        
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS || map[ty][tx] === 1) {
            projectiles.splice(i, 1);
            continue;
        }

        // Collisione Player
        // Distanza semplice
        let dist = Math.sqrt((p.x - player.x)**2 + (p.y - player.y)**2);
        if (dist < 0.5) { // Se molto vicino
            hitPlayer();
            projectiles.splice(i, 1);
            continue;
        }

        if (p.life <= 0) projectiles.splice(i, 1);
    }
}

function hitPlayer() {
    if (player.isInvulnerable) return;

    player.lives--;
    document.getElementById('lives-display').textContent = player.lives;
    
    // Effetto colpo
    player.isInvulnerable = true;
    player.invulnerableTimer = 60; // 1 secondo invulnerabilità

    if (player.lives <= 0) {
        gameOver();
    }
}

function gameOver() {
    isGameOver = true;
    document.getElementById('game-over-screen').classList.remove('hidden');
}

// --- GESTIONE DOMANDE ---
function triggerQuestion(tileKey) {
    isPaused = true;
    
    // Recupera l'ID del filosofo dalla mappa
    const questionIndex = philosopherMap[tileKey];
    
    // Se esiste una domanda per questo indice, usala, altrimenti random
    let questionData;
    if (questionIndex !== undefined && questions[questionIndex]) {
        questionData = questions[questionIndex];
    } else {
        // Fallback random
        const randomIndex = Math.floor(Math.random() * questions.length);
        questionData = questions[randomIndex];
    }

    showPopup(questionData, tileKey);
}

function showPopup(data, tileKey) {
    const overlay = document.getElementById('popup-overlay');
    const qText = document.getElementById('popup-question');
    const optionsDiv = document.getElementById('popup-options');
    const feedback = document.getElementById('popup-feedback');
    const closeBtn = document.getElementById('close-btn');

    overlay.classList.remove('hidden');
    closeBtn.classList.add('hidden');
    feedback.textContent = "";
    feedback.className = "";
    optionsDiv.innerHTML = "";
    qText.textContent = data.question;

    data.options.forEach((opt, index) => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.onclick = () => checkAnswer(index, data.correctIndex, tileKey);
        optionsDiv.appendChild(btn);
    });
}

function showMessagePopup(title, text, onOk) {
    const popup = document.getElementById('message-popup');
    document.getElementById('popup-title').textContent = title;
    document.getElementById('popup-text').textContent = text;
    const btn = document.getElementById('popup-btn');
    
    popup.classList.remove('hidden');
    
    // Rimuovi vecchi listener per evitare duplicazioni
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    
    newBtn.onclick = () => {
        popup.classList.add('hidden');
        if (onOk) onOk();
    };
}

function checkAnswer(selectedIndex, correctIndex, tileKey) {
    const optionsDiv = document.getElementById('popup-options');
    
    if (selectedIndex === correctIndex) {
        // Corretto
        playSound('correct');
        
        // Mostra popup successo
        showMessagePopup("CORRETTO!", "Risposta esatta!", () => {
            // Chiudi popup domanda
            document.getElementById('popup-overlay').classList.add('hidden');
            isPaused = false;
            visitedTriggers.add(tileKey);
            
            // Aggiorna punteggio
            score++;
            document.getElementById('score-display').textContent = score;
            
            // Controllo vittoria
            if (score >= 5) {
                playSound('win');
                playVictoryMusic();
                isPaused = true; // Ferma il gioco
                showMessagePopup("COMPLIMENTI!", winMessage, () => {
                    location.reload(); // Riavvia
                });
            }
        });
        
    } else {
        // Sbagliato
        playSound('wrong');
        
        // Mostra popup errore
        showMessagePopup("SBAGLIATO!", "Riprova, non arrenderti!", () => {
            // Disabilita solo il bottone sbagliato
            const buttons = optionsDiv.querySelectorAll('button');
            if(buttons[selectedIndex]) buttons[selectedIndex].disabled = true;
        });
    }
}

// --- RENDERING ---
function gameLoop() {
    if (!isPaused && !isGameOver) {
        updateEnemies();
        updateProjectiles();
        
        // Gestione invulnerabilità
        if (player.isInvulnerable) {
            player.invulnerableTimer--;
            if (player.invulnerableTimer <= 0) player.isInvulnerable = false;
        }
    }
    draw();
    requestAnimationFrame(gameLoop);
}

// --- Nuovo Rendering Nemico: Diavoletto Professore ---
function drawDevilProfessor(x, y) {
    const s = TILE_SIZE / 16;
    // Recupera entità per animazione (hover/blink)
    const enemy = enemies.find(e => e.x * TILE_SIZE === x && e.y * TILE_SIZE === y);
    const hoverOffset = enemy ? enemy.hoverOffset || 0 : 0;
    const blink = enemy ? enemy.blink : false;

    // Ombra
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 8*s, y + 15*s, 6*s, 3*s, 0, 0, Math.PI*2);
    ctx.fill();

    // Corpo
    ctx.fillStyle = '#7b1f1f';
    ctx.fillRect(x + 4*s, y + 6*s + hoverOffset, 8*s, 8*s);

    // Testa
    ctx.fillStyle = '#f8d4b4';
    ctx.fillRect(x + 5*s, y + 2*s + hoverOffset, 6*s, 6*s);

    // Corna
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(x + 5*s, y + 1*s + hoverOffset, 2*s, 2*s);
    ctx.fillRect(x + 9*s, y + 1*s + hoverOffset, 2*s, 2*s);

    // Occhi (lampeggio)
    ctx.fillStyle = blink ? '#ff5252' : '#000';
    ctx.fillRect(x + 6*s, y + 4*s + hoverOffset, 1*s, 1*s);
    ctx.fillRect(x + 8*s, y + 4*s + hoverOffset, 1*s, 1*s);
    ctx.fillStyle = '#333';
    ctx.fillRect(x + 6*s, y + 5*s + hoverOffset, 3*s, 1*s);

    // Libro
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(x + 2*s, y + 8*s + hoverOffset, 3*s, 4*s);
    ctx.fillStyle = '#d7ccc8';
    ctx.fillRect(x + 2*s, y + 8*s + hoverOffset, 3*s, 1*s);
}

// --- Nuovo Rendering Proiettile: "ESAMI" ---
function drawExamProjectile(x, y) {
    const w = TILE_SIZE * 0.7;
    const h = TILE_SIZE * 0.5;
    const cx = x + TILE_SIZE/2 - w/2;
    const cy = y + TILE_SIZE/2 - h/2;
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(cx, cy, w, h);
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = Math.max(1, TILE_SIZE * 0.08);
    ctx.strokeRect(cx, cy, w, h);
    ctx.fillStyle = '#ffd700';
    const fontPx = Math.min(14, Math.max(6, Math.floor(TILE_SIZE / 2.6)));
    ctx.font = `${fontPx}px Courier New`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = TILE_SIZE < 20 ? 'ES' : 'ESAMI';
    ctx.fillText(label, x + TILE_SIZE/2, y + TILE_SIZE/2);
}

function draw() {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 1. Disegna Mappa
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const tile = map[y][x];
            const posX = x * TILE_SIZE;
            const posY = y * TILE_SIZE;

            if (tile === 1) {
                // Muro/Colonna (Pietra scura)
                ctx.fillStyle = "#1a1a1a"; 
                ctx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);
                // Dettaglio
                ctx.fillStyle = "#333";
                ctx.fillRect(posX + 4, posY + 4, TILE_SIZE - 8, TILE_SIZE - 8);
            } else if (tile === 3) {
                // Scale (Grigio scuro)
                ctx.fillStyle = "#424242"; 
                ctx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);
                ctx.fillStyle = "#212121"; 
                ctx.fillRect(posX, posY + TILE_SIZE*0.5, TILE_SIZE, 2);
            } else if (tile === 2) {
                // Trigger Filosofo
                const key = `${x},${y}`;
                const philId = philosopherMap[key];

                // Pavimento sotto
                ctx.fillStyle = "#263238";
                ctx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);

                if (visitedTriggers.has(key)) {
                    ctx.globalAlpha = 0.5;
                    drawPhilosopher(posX, posY, philId);
                    ctx.globalAlpha = 1.0;
                } else {
                    drawPhilosopher(posX, posY, philId);
                }
            } else {
                // Pavimento (Scuro)
                ctx.fillStyle = "#263238"; // Blue Grey Dark
                ctx.fillRect(posX, posY, TILE_SIZE, TILE_SIZE);
                
                // Texture
                if ((x + y) % 2 === 0) {
                    ctx.fillStyle = "#37474f";
                    ctx.fillRect(posX + 8, posY + 8, 16, 16);
                }
            }
        }
    }

    // 2. Disegna Nemici
    enemies.forEach(en => {
        drawDevilProfessor(en.x * TILE_SIZE, en.y * TILE_SIZE);
    });

    // 3. Disegna Proiettili
    projectiles.forEach(p => {
        drawExamProjectile(p.x * TILE_SIZE, p.y * TILE_SIZE);
    });

    // 4. Disegna Giocatore
    if (!player.isInvulnerable || Math.floor(Date.now() / 100) % 2 === 0) {
        drawNichoSprite(player.x * TILE_SIZE, player.y * TILE_SIZE);
    }
}

function drawPhilosopher(x, y, id) {
    const s = TILE_SIZE / 16; // scala dinamica
    // Colori per ID
    const colors = [
        "#eeeeee", // 0: Socrate (Bianco)
        "#42a5f5", // 1: Platone (Blu)
        "#66bb6a", // 2: Aristotele (Verde)
        "#ab47bc", // 3: Cartesio (Viola)
        "#8d6e63"  // 4: Nietzsche (Marrone)
    ];
    const robeColor = colors[id] || "#fff";

    // Ombra
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(x + 8*s, y + 15*s, 6*s, 3*s, 0, 0, Math.PI*2);
    ctx.fill();

    // Corpo (Toga)
    ctx.fillStyle = robeColor;
    ctx.fillRect(x + 4*s, y + 8*s, 8*s, 7*s);
    
    // Testa
    ctx.fillStyle = "#ffccbc"; // Pelle
    ctx.fillRect(x + 5*s, y + 2*s, 6*s, 6*s);

    // Capelli/Barba (Bianchi per tutti i filosofi saggi)
    ctx.fillStyle = "#e0e0e0";
    // Capelli lati
    ctx.fillRect(x + 4*s, y + 2*s, 1*s, 4*s);
    ctx.fillRect(x + 11*s, y + 2*s, 1*s, 4*s);
    // Barba
    ctx.fillRect(x + 5*s, y + 6*s, 6*s, 3*s);

    // Occhi
    ctx.fillStyle = "#000";
    ctx.fillRect(x + 6*s, y + 4*s, 1*s, 1*s);
    ctx.fillRect(x + 9*s, y + 4*s, 1*s, 1*s);
}

function drawNichoSprite(x, y) {
    const s = TILE_SIZE / 16; // scala dinamica

    // Ombra
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(x + 8*s, y + 15*s, 6*s, 3*s, 0, 0, Math.PI*2);
    ctx.fill();

    // --- Sprite Stile Pokemon Trainer ---
    
    // 1. Capelli (Neri, ciuffo)
    ctx.fillStyle = "#212121";
    ctx.fillRect(x + 3*s, y + 1*s, 10*s, 4*s); // Top
    ctx.fillRect(x + 2*s, y + 2*s, 1*s, 5*s); // Lato Sx
    ctx.fillRect(x + 13*s, y + 2*s, 1*s, 5*s); // Lato Dx
    ctx.fillRect(x + 3*s, y + 2*s, 2*s, 2*s); // Frangia

    // 2. Testa
    ctx.fillStyle = "#ffe0b2"; // Pelle chiara
    ctx.fillRect(x + 3*s, y + 3*s, 10*s, 6*s);

    // 3. Occhi
    ctx.fillStyle = "#3e2723";
    ctx.fillRect(x + 4*s, y + 5*s, 2*s, 2*s);
    ctx.fillRect(x + 10*s, y + 5*s, 2*s, 2*s);

    // 4. Corpo (Maglietta Bianca)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + 4*s, y + 9*s, 8*s, 5*s);
    // Maniche
    ctx.fillRect(x + 2*s, y + 9*s, 2*s, 3*s);
    ctx.fillRect(x + 12*s, y + 9*s, 2*s, 3*s);

    // 5. Pantaloni (Jeans Scuri)
    ctx.fillStyle = "#1a237e"; // Blu scuro
    ctx.fillRect(x + 4*s, y + 13*s, 8*s, 3*s); // Bacino
    ctx.fillRect(x + 4*s, y + 14*s, 3*s, 2*s); // Gamba Sx
    ctx.fillRect(x + 9*s, y + 14*s, 3*s, 2*s); // Gamba Dx

    // 6. Scarpe
    ctx.fillStyle = "#333";
    ctx.fillRect(x + 3*s, y + 15*s, 4*s, 1*s);
    ctx.fillRect(x + 9*s, y + 15*s, 4*s, 1*s);
}

// Avvia tutto
initGame();