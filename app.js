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

// --- 2. GAME CONSTANTS & SENSITIVITY ---
const ROOMS = ["Living Room", "Boy's Bedroom", "Bathroom", "Laundry Room", "Mya's Room", "Parents' Room", "Kitchen"];
const TASK_POOL = [
    { name: "Fix Wires", icon: "🔌" }, { name: "Download Data", icon: "💾" },
    { name: "Empty Trash", icon: "🗑️" }, { name: "Divert Power", icon: "⚡" }
];

const KILL_LIMIT = 1.524; // 5 feet
const TASK_LIMIT = 3.0;   // 10 feet
const PASSIVE_SNAP_LIMIT = 2.0; // 2 meters (Auto-snaps to landmarks)
const STEP_LENGTH = 0.7; // Stride length in meters

// --- 3. HYBRID POSITION FUSION VARIABLE MATRIX ---
let fusedX = 0;
let fusedY = 0;
let currentHeading = 0;
let isTracking = false;

// Step Detector State
let stepCooldown = false;
let isTurning = false;
let turnTimer = null;
let lastHeading = 0;

// GPS Sensor Watcher
let gpsWatcherId = null;

// --- 4. COORDINATE PROJECTION & PYTHAGOREAN MATH ---
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

// --- 5. INITIALIZE FUSION SENSORS (GPS + MOTION) ---
function startFusionTracking() {
    isTracking = true;

    // 1. iOS Permission Check for Motion Sensors
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().then(permissionState => {
            if (permissionState === 'granted') {
                attachSensors();
            } else {
                alert("Motion permissions are required for tracking!");
            }
        }).catch(console.error);
    } else {
        attachSensors();
    }
}

function attachSensors() {
    // 2. Compass Sensor (iOS & Android absolute wrapper)
    if ('ondeviceorientationabsolute' in window) {
        window.addEventListener("deviceorientationabsolute", handleCompassInput, true);
    } else if ('ondeviceorientation' in window) {
        window.addEventListener("deviceorientation", handleCompassInput, true);
    }

    // 3. Accelerometer (Step Detector)
    window.addEventListener('devicemotion', (event) => {
        let accelZ = 0;
        if (event.acceleration && event.acceleration.z !== null) {
            accelZ = event.acceleration.z;
        } else if (event.accelerationIncludingGravity) {
            accelZ = event.accelerationIncludingGravity.z - 9.81;
        }
        
        if (accelZ === null) return;

        // Step peak detection
        if (Math.abs(accelZ) > 2.5 && !stepCooldown && !isTurning) {
            stepCooldown = true;
            registerPedometerStep();
            setTimeout(() => { stepCooldown = false; }, 500); 
        }
    });

    // 4. DGPS Correction Receiver & complementary filter loop
    db.ref().on('value', snap => {
        const data = snap.val() || {};
        const base = data.baseCoords;
        const drift = data.gpsDrift || { lat: 0, lng: 0 };

        if (!base) return;

        if (gpsWatcherId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatcherId);
        }

        if (navigator.geolocation) {
            gpsWatcherId = navigator.geolocation.watchPosition(position => {
                const correctedLat = position.coords.latitude - drift.lat;
                const correctedLng = position.coords.longitude - drift.lng;
                const dgpsCoords = getRelativeXY(correctedLat, correctedLng, base.lat, base.lng);

                // --- COMPLEMENTARY FILTER FUSION ---
                // If DGPS coordinates are extremely far from our current step estimation (e.g. >15m), 
                // we treat it as an indoor satellite reflection glitch and ignore it.
                const offsetToGps = getPythagoreanDistance(fusedX, fusedY, dgpsCoords.x, dgpsCoords.y);

                if (offsetToGps <= 15.0) {
                    // Slowly converge step-based calculations toward the true DGPS position over time (85/15 split)
                    fusedX = (fusedX * 0.85) + (dgpsCoords.x * 0.15);
                    fusedY = (fusedY * 0.85) + (dgpsCoords.y * 0.15);
                } else {
                    console.log("GPS Glitch detected! Discarding jump of: " + offsetToGps.toFixed(1) + "m");
                }

                evaluatePassiveLandmarkSnapping(data.stations || {});

            }, null, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
        }
    });

    // Publish coordinate matrix to Firebase every second
    setInterval(() => {
        if(isTracking) {
            db.ref(`players/${myId}/coords`).set({
                x: fusedX,
                y: fusedY,
                timestamp: Date.now()
            });
        }
    }, 1000);
}

// Compass direction parsing
function handleCompassInput(event) {
    let heading = 0;
    if (event.webkitCompassHeading) {
        heading = event.webkitCompassHeading;
    } else if (event.alpha !== null) {
        heading = 360 - event.alpha;
    }
    currentHeading = heading;

    if (Math.abs(heading - lastHeading) > 12) {
        isTurning = true;
        clearTimeout(turnTimer);
        turnTimer = setTimeout(() => { isTurning = false; }, 500);
    }
    lastHeading = heading;
}

// Dead reckoning step execution
function registerPedometerStep() {
    const headingRad = currentHeading * (Math.PI / 180);
    const dx = STEP_LENGTH * Math.sin(headingRad);
    const dy = STEP_LENGTH * Math.cos(headingRad);
    
    // Add physical steps instantly to coordinates (smooth on-screen movements)
    fusedX += dx;
    fusedY += dy;
    
    const statusText = document.getElementById('radar-status-text');
    if (statusText) {
        statusText.innerText = `FUSED Pos: (${fusedX.toFixed(1)}m, ${fusedY.toFixed(1)}m)`;
    }
}

// Passive Landmark Snapping: Resets coordinate drift when passing stationary tablets or host
function evaluatePassiveLandmarkSnapping(stations) {
    let nearestName = "Host";
    let targetX = 0;
    let targetY = 0;
    let minDist = getPythagoreanDistance(0, 0, fusedX, fusedY); // distance to host

    for (let room in stations) {
        const s = stations[room];
        if (s.coords) {
            const dist = getPythagoreanDistance(s.coords.x, s.coords.y, fusedX, fusedY);
            if (dist < minDist) {
                minDist = dist;
                nearestName = room;
                targetX = s.coords.x;
                targetY = s.coords.y;
            }
        }
    }

    // Auto-snap coordinates exactly to landmark if within 2 meters
    if (minDist <= PASSIVE_SNAP_LIMIT) {
        fusedX = targetX;
        fusedY = targetY;
        console.log(`PASSIVE SNAP: Locked coordinates to ${nearestName.toUpperCase()}`);
    }
}

// Manual calibration reset
function calibratePosition() {
    fusedX = 0;
    fusedY = 0;
    const statusText = document.getElementById('radar-status-text');
    if (statusText) statusText.innerText = `FUSED Pos: (0.0m, 0.0m)`;
    alert("Synced with Host Computer! Relative position reset to (0,0).");
}

// --- 6. PLAYER CONTROLS ---
function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : "Player";
    if (!name) return alert("Please enter a name!");
    
    db.ref(`players/${myId}`).set({ 
        name: name, 
        status: 'alive', 
        role: 'crewmate',
        coords: { x: 0, y: 0, timestamp: Date.now() } // Assumed start at origin
    });
    
    startFusionTracking();
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
                    const dist = getPythagoreanDistance(fusedX, fusedY, players[id].coords.x, players[id].coords.y);
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
        if (me.role !== 'impostor' || me.status !== 'alive') return;

        for (let id in allPlayers) {
            if (id !== myId && allPlayers[id].status === 'alive' && allPlayers[id].coords) {
                const dist = getPythagoreanDistance(fusedX, fusedY, allPlayers[id].coords.x, allPlayers[id].coords.y);
                if (dist <= KILL_LIMIT) {
                    db.ref(`players/${id}/status`).set('ghost');
                    alert(`Eliminated ${allPlayers[id].name}!`);
                    return;
                }
            }
        }
    });
}

// --- 7. VOTING SYSTEM ---
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

// --- 8. HOST DASHBOARD MANAGEMENT ---
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

// --- 9. TABLET PROXIMITY ---
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