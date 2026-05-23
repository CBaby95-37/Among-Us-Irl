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

// --- 2. GAME CONSTANTS ---
const ROOMS = ["Living Room", "Boy's Bedroom", "Bathroom", "Laundry Room", "Mya's Room", "Parents' Room", "Kitchen"];
const TASK_POOL = [
    { name: "Fix Wires", icon: "🔌" }, { name: "Download Data", icon: "💾" },
    { name: "Empty Trash", icon: "🗑️" }, { name: "Divert Power", icon: "⚡" }
];

const KILL_LIMIT = 2.0; // 2 meters (~6.5 feet) for kill
const TASK_LIMIT = 3.0; // 3 meters (~10 feet) for tasks
const STEP_LENGTH = 0.7; // Average human step length in meters

// --- 3. DEAD RECKONING ENGINE (ACCELEROMETER + COMPASS) ---
let myCurrentX = 0;
let myCurrentY = 0;
let currentHeading = 0;
let isTracking = false;

// Step detection threshold variables
let lastAccelZ = 0;
let stepCooldown = false;

function startDeadReckoning() {
    isTracking = true;
    
    // Request permission for iOS 13+ devices
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(permissionState => {
            if (permissionState === 'granted') {
                attachSensors();
            } else {
                alert("Motion sensors are required to track your physical movement!");
            }
        }).catch(console.error);
    } else {
        attachSensors();
    }
}

function attachSensors() {
    // 1. Compass / Heading
    window.addEventListener("deviceorientation", (event) => {
        // Use webkitCompassHeading for iOS, alpha for Android
        if (event.webkitCompassHeading) {
            currentHeading = event.webkitCompassHeading;
        } else if (event.alpha !== null) {
            currentHeading = 360 - event.alpha;
        }
    }, true);

    // 2. Accelerometer (Pedometer step detection)
    window.addEventListener('devicemotion', (event) => {
        const accelZ = event.accelerationIncludingGravity.z;
        if (!accelZ) return;

        // Simple Peak Detection for a "Step"
        const delta = Math.abs(accelZ - lastAccelZ);
        
        // If device jerks up/down violently enough (a step)
        if (delta > 3.5 && !stepCooldown) {
            stepCooldown = true;
            registerStep();
            
            // Prevent multiple rapid fires for a single step
            setTimeout(() => { stepCooldown = false; }, 400); 
        }
        lastAccelZ = accelZ;
    });

    // Sync position to Firebase every second so other devices can see you
    setInterval(() => {
        if(isTracking) {
            db.ref(`players/${myId}/coords`).set({
                x: myCurrentX,
                y: myCurrentY,
                timestamp: Date.now()
            });
        }
    }, 1000);
}

function registerStep() {
    // Convert heading from degrees to radians
    const headingRad = currentHeading * (Math.PI / 180);
    
    // Calculate X and Y distance moved based on the direction the phone is pointing
    const dx = STEP_LENGTH * Math.sin(headingRad);
    const dy = STEP_LENGTH * Math.cos(headingRad);
    
    myCurrentX += dx;
    myCurrentY += dy; // Positive Y is "North" in this system
    
    const radarStatus = document.getElementById('radar-status-text');
    if(radarStatus) {
        radarStatus.innerText = `Pos: (${myCurrentX.toFixed(1)}m, ${myCurrentY.toFixed(1)}m) | Hdg: ${Math.round(currentHeading)}°`;
    }
}

// Resets your position back to (0,0) when standing at the host
function calibratePosition() {
    myCurrentX = 0;
    myCurrentY = 0;
    alert("Calibrated! You are now at origin (0,0).");
}

function getPythagoreanDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt((dx * dx) + (dy * dy));
}

// --- 4. PLAYER GAMEPLAY CONTROLS ---
function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : "Player";
    if (!name) return alert("Please enter a name!");
    
    db.ref(`players/${myId}`).set({ name: name, status: 'alive', role: 'crewmate' });
    startDeadReckoning();
}

function startKillProximityCheck() {
    db.ref('players').on('value', snap => {
        const players = snap.val() || {};
        const me = players[myId];
        
        if (!me || me.role !== 'impostor' || me.status !== 'alive') return;
        
        let targetNearby = false;
        for (let id in players) {
            if (id !== myId && players[id].status === 'alive' && players[id].coords) {
                const dist = getPythagoreanDistance(myCurrentX, myCurrentY, players[id].coords.x, players[id].coords.y);
                if (dist <= KILL_LIMIT) {
                    targetNearby = true;
                    break;
                }
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
        if (me.role !== 'impostor' || me.status !== 'alive') return;

        for (let id in allPlayers) {
            if (id !== myId && allPlayers[id].status === 'alive' && allPlayers[id].coords) {
                const dist = getPythagoreanDistance(myCurrentX, myCurrentY, allPlayers[id].coords.x, allPlayers[id].coords.y);
                if (dist <= KILL_LIMIT) {
                    db.ref(`players/${id}/status`).set('ghost');
                    alert(`Eliminated ${allPlayers[id].name}!`);
                    return;
                }
            }
        }
    });
}

// --- 5. VOTING & MEETING SYSTEM ---
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

// --- 6. HOST LOGIC ---
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
                <td>${p.coords ? `${p.coords.x.toFixed(1)}, ${p.coords.y.toFixed(1)}` : "No Data"}</td>
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
                    db.ref(`players/${id}/coords`).remove();
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
        let distMsg = "Unknown";
        if(p.coords) {
            const d = getPythagoreanDistance(0,0, p.coords.x, p.coords.y).toFixed(1);
            distMsg = `${d}m from base`;
        }
        html += `<div style="background:#333; padding:10px; margin-bottom:5px; border-left:5px solid ${p.status === 'alive' ? '#00ff00' : '#ff0000'};">
                    <b>${p.name}</b>: ${p.status.toUpperCase()} <br>
                    <small style="color:#aaa;">${distMsg}</small>
                 </div>`;
        (p.tasks || []).forEach(t => { total++; if(t.done) done++; });
    }
    board.innerHTML = html;
    progress.style.width = (total === 0 ? 0 : (done / total) * 100) + "%";
}

// --- 7. TABLET PROXIMITY ---
function monitorRoomTasks(roomName) {
    db.ref().on('value', snap => {
        const data = snap.val() || {};
        const players = data.players || {};
        const station = data.stations ? data.stations[roomName] : null;
        const container = document.getElementById('active-tasks-container');
        if (!container || !station || !station.coords) return;
        
        container.innerHTML = "";
        let playersPresent = false;

        for (let id in players) {
            const p = players[id];
            if (p.coords) {
                const distance = getPythagoreanDistance(station.coords.x, station.coords.y, p.coords.x, p.coords.y);
                if (distance <= TASK_LIMIT) {
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
        }
        if (!playersPresent) container.innerHTML = `<p>No crewmates nearby (within ${TASK_LIMIT}m)...</p>`;
    });
}
function completeTask(pId, tId) {
    db.ref(`players/${pId}/tasks`).once('value', snap => {
        db.ref(`players/${pId}/tasks`).set((snap.val()||[]).map(t => t.id === tId ? {...t, done: true} : t));
    });
}