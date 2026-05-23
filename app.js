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

const KILL_LIMIT = 1.524; // 5 feet
const TASK_LIMIT = 3.0;   // 10 feet

// --- 3. DGPS MATHEMATICS ---

// Converts Latitude/Longitude to relative meters (X, Y) from the Host Computer (0,0)
function getRelativeXY(lat, lon, baseLat, baseLon) {
    const latRad = baseLat * Math.PI / 180;
    const metersPerLatDegree = 111139; 
    const metersPerLonDegree = 111139 * Math.cos(latRad);

    const x = (lon - baseLon) * metersPerLonDegree;
    const y = (lat - baseLat) * metersPerLatDegree;
    
    return { x: x, y: y };
}

function getPythagoreanDistance(x1, y1, x2, y2) {
    return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

// --- 4. PLAYER SENSOR WITH ACTIVE DGPS CORRECTION ---
let gpsWatcherId = null;

function startLocationTracking() {
    // Listen to BOTH base coordinates and live drift corrections
    db.ref().on('value', snap => {
        const data = snap.val() || {};
        const base = data.baseCoords;
        const drift = data.gpsDrift || { lat: 0, lng: 0 }; // Current atmospheric/indoor drift

        if (!base) return;

        if (gpsWatcherId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatcherId);
        }

        if (navigator.geolocation) {
            gpsWatcherId = navigator.geolocation.watchPosition(position => {
                // Apply the DGPS correction factor
                const correctedLat = position.coords.latitude - drift.lat;
                const correctedLng = position.coords.longitude - drift.lng;

                const relativeCoords = getRelativeXY(correctedLat, correctedLng, base.lat, base.lng);
                
                db.ref(`players/${myId}/coords`).set({
                    x: relativeCoords.x,
                    y: relativeCoords.y,
                    timestamp: Date.now()
                });

                const statusText = document.getElementById('radar-status-text');
                if (statusText) {
                    statusText.innerText = `Corrected Pos: (${relativeCoords.x.toFixed(1)}m, ${relativeCoords.y.toFixed(1)}m)`;
                }
            }, err => {
                console.error("GPS Watcher Error: ", err.message);
            }, {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            });
        }
    });
}

// Manual Beacon Calibration: Snaps player coordinates directly to the nearest active beacon/host
function calibratePosition() {
    db.ref().once('value', snap => {
        const data = snap.val() || {};
        const stations = data.stations || {};
        
        let nearestBeacon = "Host";
        let minDist = getPythagoreanDistance(0, 0, myCurrentX, myCurrentY); // distance to host

        // Check if player is closer to a stationary tablet beacon
        for (let room in stations) {
            const s = stations[room];
            if (s.coords) {
                const dist = getPythagoreanDistance(s.coords.x, s.coords.y, myCurrentX, myCurrentY);
                if (dist < minDist) {
                    minDist = dist;
                    nearestBeacon = room;
                }
            }
        }

        if (nearestBeacon === "Host") {
            // Force reset coordinates to exactly 0,0
            db.ref(`players/${myId}/coords`).set({ x: 0, y: 0, timestamp: Date.now() });
            alert("Calibration Complete! Synced position directly to Host Computer (0,0).");
        } else {
            // Force snap coordinates to match the tablet coordinates
            const sCoords = stations[nearestBeacon].coords;
            db.ref(`players/${myId}/coords`).set({ x: sCoords.x, y: sCoords.y, timestamp: Date.now() });
            alert(`Calibration Complete! Synced position directly to ${nearestBeacon} Tablet Beacon.`);
        }
    });
}

// --- 5. PLAYER GAMEPLAY CONTROLS ---
function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : "Player";
    if (!name) return alert("Please enter a name!");
    
    db.ref(`players/${myId}`).set({ name: name, status: 'alive', role: 'crewmate' });
    startLocationTracking();
}

function startKillProximityCheck() {
    db.ref('players').on('value', snap => {
        const players = snap.val() || {};
        const me = players[myId];
        
        if (!me || me.role !== 'impostor' || me.status !== 'alive') return;
        
        let targetNearby = false;
        if (me.coords) {
            for (let id in players) {
                if (id !== myId && players[id].status === 'alive' && players[id].coords) {
                    const dist = getPythagoreanDistance(me.coords.x, me.coords.y, players[id].coords.x, players[id].coords.y);
                    if (dist <= KILL_LIMIT) {
                        targetNearby = true;
                        break;
                    }
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
        if (me.role !== 'impostor' || me.status !== 'alive' || !me.coords) return;

        for (let id in allPlayers) {
            if (id !== myId && allPlayers[id].status === 'alive' && allPlayers[id].coords) {
                const dist = getPythagoreanDistance(me.coords.x, me.coords.y, allPlayers[id].coords.x, allPlayers[id].coords.y);
                if (dist <= KILL_LIMIT) {
                    db.ref(`players/${id}/status`).set('ghost');
                    alert(`Eliminated ${allPlayers[id].name}!`);
                    return;
                }
            }
        }
    });
}

// --- 6. VOTING SYSTEM ---
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

// --- 7. HOST DATABASE SYSTEM & DGPS WATCHER ---
let hostGpsWatchId = null;

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
                <td>${p.coords ? `${p.coords.x.toFixed(1)}m, ${p.coords.y.toFixed(1)}m` : "No Data"}</td>
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
            gameState: 'lobby', meeting: false, cameras: null, votes: null, ejectionMessage: null, stations: null, gpsDrift: null
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

// --- 8. TABLET PROXIMITY ---
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