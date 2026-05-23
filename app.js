// --- 1. FIREBASE CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDQx8YaruuiDUbHUa9EBgbdzRv7cuiiY-k",
    authDomain: "among-us-irl-88209.firebaseapp.com",
    databaseURL: "https://among-us-irl-88209-default-rtdb.firebaseio.com",
    projectId: "among-us-irl-88209",
    storageBucket: "among-us-irl-88209.firebasestorage.app",
    messagingSenderId: "389772075889",
    appId: "1:389772075889:web:928fce03e94940f8b90cd0",
    measurementId: "G-WLKJG2Z4GY"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

const myId = localStorage.getItem('amongUsPlayerId') || "p_" + Math.floor(Math.random() * 100000);
localStorage.setItem('amongUsPlayerId', myId);

// --- 2. GAME CONSTANTS & ACOUSTIC CHANNEL MAP ---
const ROOMS = ["Living Room", "Boy's Bedroom", "Bathroom", "Laundry Room", "Mya's Room", "Parents' Room", "Kitchen"];
const TASK_POOL = [
    { name: "Fix Wires", icon: "🔌" }, { name: "Download Data", icon: "💾" },
    { name: "Empty Trash", icon: "🗑️" }, { name: "Divert Power", icon: "⚡" }
];

// Frequencies assigned to each Tablet Station (all ultra-high, safe, human-inaudible)
const STATION_FREQUENCIES = {
    "Kitchen": 18200,
    "Living Room": 18600,
    "Bathroom": 19000,
    "Laundry Room": 19400,
    "Mya's Room": 19800,
    "Parents' Room": 20200,
    "Boy's Bedroom": 20600
};

// Player Transmit Frequency (all players broadcast on 21000 Hz)
const PLAYER_FREQUENCY = 21000;

// Volume threshold (0-255 scale from FFT analysis). 
// Higher means they have to be closer. ~80 is usually around 5 feet.
const ACOUSTIC_PROXIMITY_THRESHOLD = 80; 

// --- 3. SONAR ENGINE (WEB AUDIO API) ---
let audioCtx = null;
let beaconOscillator = null;
let audioAnalyser = null;
let micStream = null;
let frequencyDataArray = null;

// Starts broadcasting your device's unique ultrasonic locator beacon
function startBeaconTransmission(frequency) {
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        beaconOscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        beaconOscillator.type = 'sine';
        beaconOscillator.frequency.value = frequency; 
        
        // Very low gain (quiet) is safe and easily picked up by nearby mics
        gainNode.gain.value = 0.05; 

        beaconOscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        beaconOscillator.start();
        console.log(`Sonar Beacon Active: Broadcasting on ${frequency}Hz`);
    } catch (e) {
        console.error("Failed to start Audio Transmitter: ", e);
    }
}

// Starts analyzing nearby audio frequencies via the microphone
function startSonarReceiver(onAnalysisFrame) {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false })
            .then(stream => {
                micStream = stream;
                const rxCtx = new (window.AudioContext || window.webkitAudioContext)();
                const source = rxCtx.createMediaStreamSource(stream);
                
                audioAnalyser = rxCtx.createAnalyser();
                audioAnalyser.fftSize = 2048; // Clean frequency resolution
                
                const bufferLength = audioAnalyser.frequencyBinCount;
                frequencyDataArray = new Uint8Array(bufferLength);
                
                source.connect(audioAnalyser);

                // Run the analysis loop
                const runAnalysis = () => {
                    if (audioAnalyser) {
                        audioAnalyser.getByteFrequencyData(frequencyDataArray);
                        onAnalysisFrame(rxCtx.sampleRate);
                        requestAnimationFrame(runAnalysis);
                    }
                };
                runAnalysis();
            }).catch(err => {
                alert("Microphone access is required for Device-to-Device Sonar range tracking!");
            });
    }
}

// Returns the raw volume (0-255) of a specific frequency index in the room
function getVolumeAtFrequency(targetFrequency, sampleRate) {
    if (!audioAnalyser || !frequencyDataArray) return 0;
    
    const binCount = audioAnalyser.frequencyBinCount;
    const nyquist = sampleRate / 2;
    const targetBinIndex = Math.round(targetFrequency / (nyquist / binCount));
    
    // Check target bin and immediate surrounding bins to account for minor hardware pitch variances
    const val1 = frequencyDataArray[targetBinIndex] || 0;
    const val2 = frequencyDataArray[targetBinIndex - 1] || 0;
    const val3 = frequencyDataArray[targetBinIndex + 1] || 0;
    
    return Math.max(val1, val2, val3);
}

// --- 4. PLAYER CONTROL & RADAR LOOPS ---
function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : "Player";
    if (!name) return alert("Please enter a name!");
    
    db.ref(`players/${myId}`).set({ name: name, status: 'alive', role: 'crewmate' });
    
    // Initialize Sonar tracking
    startBeaconTransmission(PLAYER_FREQUENCY);
    startPlayerRadarReceiver();
}

function startPlayerRadarReceiver() {
    startSonarReceiver((sampleRate) => {
        // Players continuously listen to determine if they are standing next to a tablet station
        let nearestStation = "None";
        let maxVolume = 0;

        for (let stationName in STATION_FREQUENCIES) {
            const freq = STATION_FREQUENCIES[stationName];
            const vol = getVolumeAtFrequency(freq, sampleRate);
            
            if (vol > ACOUSTIC_PROXIMITY_THRESHOLD && vol > maxVolume) {
                maxVolume = vol;
                nearestStation = stationName;
            }
        }

        // Write our current detected room location to the database based on Sonar volume
        db.ref(`players/${myId}/currentRoom`).set(nearestStation);

        const statusText = document.getElementById('radar-status-text');
        if (statusText) {
            statusText.innerText = nearestStation !== "None" 
                ? `📍 STATION RANGE: ${nearestStation.toUpperCase()}` 
                : `🔍 Scanning for Station Beacons...`;
        }
    });
}

function startKillProximityCheck() {
    db.ref().on('value', snap => {
        const data = snap.val() || {};
        const players = data.players || {};
        const me = players[myId];
        
        if (!me || me.role !== 'impostor' || me.status !== 'alive') return;
        
        let targetNearby = false;

        // The impostor reads Firebase to see if any alive player is currently in their room
        for (let id in players) {
            if (id !== myId && players[id].status === 'alive' && players[id].currentRoom === me.currentRoom && me.currentRoom !== "None") {
                targetNearby = true;
                break;
            }
        }
        
        const killBtn = document.getElementById('kill-btn');
        if (killBtn) killBtn.style.display = targetNearby ? 'block' : 'none';
    });
}

function tryKill() {
    db.ref('players').once('value', snap => {
        const allPlayers = snap.val();
        const me = allPlayers[myId];
        if (me.role !== 'impostor' || me.status !== 'alive' || me.currentRoom === "None") return;

        for (let id in allPlayers) {
            if (id !== myId && allPlayers[id].status === 'alive' && allPlayers[id].currentRoom === me.currentRoom) {
                db.ref(`players/${id}/status`).set('ghost');
                alert(`Eliminated ${allPlayers[id].name}!`);
                return;
            }
        }
    });
}

// --- 5. VOTING SYSTEM ---
function callMeeting() {
    db.ref('votes').remove();
    db.ref('ejectionMessage').remove();
    db.ref('meeting').set(true);
}
function castVote(targetId) {
    db.ref(`players/${myId}`).once('value', snap => {
        if(snap.val() && snap.val().status === 'alive') db.ref(`votes/${myId}`).set(targetId);
    });
}
function tallyVotes() {
    db.ref().once('value', snap => {
        const data = snap.val();
        const votes = data.votes || {};
        const players = data.players || {};
        let counts = {};
        for (let v in votes) { counts[votes[v]] = (counts[votes[v]] || 0) + 1; }
        
        let max = 0, ejected = null, tie = false;
        for (let t in counts) {
            if (counts[t] > max) { max = counts[t]; ejected = t; tie = false; }
            else if (counts[t] === max) { tie = true; }
        }

        let msg = (!tie && ejected && ejected !== 'skip') ? `${players[ejected].name} was ejected.` : "No one was ejected.";
        if(!tie && ejected && ejected !== 'skip') db.ref(`players/${ejected}/status`).set('ghost');
        
        db.ref('ejectionMessage').set(msg);
        db.ref('meeting').set(false);
    });
}

// --- 6. HOST DATABASE MONITORING ---
db.ref('players').on('value', snap => {
    const players = snap.val() || {};
    const tableBody = document.getElementById('player-list-body');
    const countSpan = document.getElementById('player-count');
    if (tableBody && countSpan) {
        countSpan.innerText = Object.keys(players).length;
        tableBody.innerHTML = "";
        for (let id in players) {
            const p = players[id];
            tableBody.innerHTML += `<tr>
                <td>${p.name}</td>
                <td style="color:${p.status === 'alive' ? '#00ff00' : '#ff3333'}">${p.status.toUpperCase()}</td>
                <td>${p.currentRoom || "Scanning..."}</td>
                <td><button onclick="kickPlayer('${id}')">KICK</button></td>
            </tr>`;
        }
    }
    updateHostDashboard(players);
});

function startGame() {
    const impLogicSelect = document.getElementById('setting-imp-logic');
    const taskCountInput = document.getElementById('setting-task-count');
    const impLogic = impLogicSelect ? impLogicSelect.value : 'auto';
    const taskCount = taskCountInput ? parseInt(taskCountInput.value) : 4;

    db.ref('players').once('value', snapshot => {
        const players = snapshot.val();
        if (!players || Object.keys(players).length < 2) return alert("Need at least 2 players!");
        const ids = Object.keys(players);
        
        let impCount = 1;
        if (impLogic === 'auto') {
            if (ids.length >= 9) impCount = 3;
            else if (ids.length >= 6) impCount = 2;
        } else impCount = parseInt(impLogic);

        const shuffled = ids.sort(() => 0.5 - Math.random());
        const updates = {};
        
        shuffled.forEach((id, index) => {
            const role = index < impCount ? 'impostor' : 'crewmate';
            const myTasks = [];
            for(let i=0; i < taskCount; i++) {
                myTasks.push({
                    id: 't' + Math.floor(Math.random() * 10000),
                    name: TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)].name,
                    room: ROOMS[Math.floor(Math.random() * ROOMS.length)],
                    done: false
                });
            }
            updates[`players/${id}/role`] = role;
            updates[`players/${id}/status`] = 'alive';
            updates[`players/${id}/tasks`] = myTasks;
        });

        updates['gameState'] = 'playing';
        updates['meeting'] = false;
        db.ref().update(updates);
    });
}

function kickPlayer(id) { if(confirm("Kick?")) db.ref(`players/${id}`).remove(); }
function resetGame() {
    if(confirm("Reset game?")) {
        db.ref().update({
            gameState: 'lobby', meeting: false, cameras: null, votes: null, ejectionMessage: null, stations: null
        });
        db.ref('players').once('value', snap => {
            const p = snap.val();
            if(p) {
                for(let id in p) {
                    db.ref(`players/${id}/status`).set('alive');
                    db.ref(`players/${id}/role`).set('crewmate');
                    db.ref(`players/${id}/tasks`).remove();
                    db.ref(`players/${id}/currentRoom`).remove();
                }
            }
        });
        location.reload();
    }
}

function updateHostDashboard(players) {
    const board = document.getElementById('status-board');
    const progress = document.getElementById('task-progress-bar');
    if(!board || !progress) return;

    let total = 0, done = 0, html = "";
    
    for(let id in players) {
        const p = players[id];
        html += `<div style="background:#333; padding:10px; margin-bottom:5px; border-left:5px solid ${p.status === 'alive' ? '#00ff00' : '#ff0000'};">
                    <b>${p.name}</b>: ${p.status.toUpperCase()} <br>
                    <small style="color:#aaa;">Location: ${p.currentRoom || "Unknown"}</small>
                 </div>`;
        (p.tasks || []).forEach(t => { total++; if(t.done) done++; });
    }
    board.innerHTML = html;
    progress.style.width = (total === 0 ? 0 : (done / total) * 100) + "%";
}

// --- 7. TABLET PROXIMITY ---
function monitorRoomTasks(roomName) {
    // Start listening for player locator beacon (21000 Hz)
    startSonarReceiver((sampleRate) => {
        db.ref().once('value', snap => {
            const data = snap.val() || {};
            const players = data.players || {};
            const container = document.getElementById('active-tasks-container');
            if (!container) return;
            
            container.innerHTML = "";
            let playersPresent = false;

            // Check if any player's beacon signal is being picked up loudly by this tablet's microphone
            for (let id in players) {
                const p = players[id];
                
                // If this player is alive and is registered as physically inside our room via sonar
                if (p.currentRoom === roomName && p.status === 'alive') {
                    playersPresent = true;
                    let html = `<h3>${p.name}</h3>`;
                    (p.tasks || []).filter(t => t.room === roomName).forEach(t => {
                        html += `<button class="${t.done ? 'task-btn done-btn' : 'task-btn'}" onclick="completeTask('${id}', '${t.id}')">${t.name} ${t.done ? '✅' : ''}</button>`;
                    });
                    const div = document.createElement('div');
                    div.className = "player-task-card";
                    div.innerHTML = html;
                    container.appendChild(div);
                }
            }
            if (!playersPresent) container.innerHTML = `<p>No crewmates nearby...</p>`;
        });
    });
}

function completeTask(pId, tId) {
    db.ref(`players/${pId}/tasks`).once('value', snap => {
        db.ref(`players/${pId}/tasks`).set((snap.val()||[]).map(t => t.id === tId ? {...t, done: true} : t));
    });
}