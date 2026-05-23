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

// --- 2. GAME CONSTANTS & SETTINGS ---
const ROOMS = [
    "Living Room", "Boy's Bedroom", "Bathroom", 
    "Laundry Room", "Mya's Room", "Parents' Room", "Kitchen"
];

const TASK_POOL = [
    { name: "Fix Wires", icon: "🔌" },
    { name: "Download Data", icon: "💾" },
    { name: "Empty Trash", icon: "🗑️" },
    { name: "Divert Power", icon: "⚡" },
    { name: "Clean Filter", icon: "🧹" },
    { name: "Asteroids", icon: "☄️" },
    { name: "Swipe Card", icon: "💳" },
    { name: "Manifold", icon: "🔢" }
];

const KILL_LIMIT = 1.524; 
const TASK_LIMIT = 3.0;   

// --- 3. COORDINATE PROJECTION & PYTHAGOREAN MATH ---
function getRelativeXY(lat, lon, baseLat, baseLon) {
    const latRad = baseLat * Math.PI / 180;
    const metersPerLatDegree = 111139; 
    const metersPerLonDegree = 111139 * Math.cos(latRad);

    const x = (lon - baseLon) * metersPerLonDegree;
    const y = (lat - baseLat) * metersPerLatDegree;
    
    return { x: x, y: y };
}

function getPythagoreanDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt((dx * dx) + (dy * dy));
}

// --- 4. PLAYER POSITION SENSOR (REAL-TIME SYNC) ---
let gpsWatcherId = null;

function startLocationTracking() {
    // Listen for coordinates instead of checking once
    db.ref('baseCoords').on('value', snap => {
        const base = snap.val();
        if (!base) {
            console.log("Waiting for Host to publish base coordinates...");
            return;
        }

        // Clear existing watch loops to avoid memory leaks
        if (gpsWatcherId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(gpsWatcherId);
        }

        if (navigator.geolocation) {
            gpsWatcherId = navigator.geolocation.watchPosition(position => {
                const relativeCoords = getRelativeXY(
                    position.coords.latitude,
                    position.coords.longitude,
                    base.lat,
                    base.lng
                );
                
                db.ref(`players/${myId}/coords`).set({
                    x: relativeCoords.x,
                    y: relativeCoords.y,
                    timestamp: Date.now()
                });
            }, err => {
                console.error("GPS Watch Error: ", err.message);
            }, {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000
            });
        } else {
            console.error("Geolocation not supported on this browser context.");
        }
    });
}

// --- 5. PLAYER GAMEPLAY & ACTION CONTROLS ---
function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    const name = nameInput ? nameInput.value.trim() : "Player";
    if (!name) return alert("Please enter a name!");
    
    db.ref(`players/${myId}`).set({ 
        name: name, 
        status: 'alive', 
        role: 'crewmate'
    });
    startLocationTracking();
}

function startKillProximityCheck() {
    db.ref().on('value', snap => {
        const data = snap.val() || {};
        const players = data.players || {};
        const me = players[myId];
        
        if (!me || me.role !== 'impostor' || me.status !== 'alive') return;
        
        let targetNearby = false;
        const myCoords = me.coords;
        
        if (myCoords) {
            for (let id in players) {
                if (id !== myId && players[id].status === 'alive') {
                    const pCoords = players[id].coords;
                    if (pCoords) {
                        const dist = getPythagoreanDistance(myCoords.x, myCoords.y, pCoords.x, pCoords.y);
                        if (dist <= KILL_LIMIT) {
                            targetNearby = true;
                            break;
                        }
                    }
                }
            }
        }
        
        const killBtn = document.getElementById('kill-btn');
        if (killBtn) {
            killBtn.style.display = targetNearby ? 'block' : 'none';
        }
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
        alert("No crewmates physically close enough (within 5 feet) to strike!");
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
        const me = snap.val();
        if(me && me.status === 'alive') {
            db.ref(`votes/${myId}`).set(targetId);
        } else {
            alert("Ghosts cannot vote!");
        }
    });
}

function tallyVotes() {
    db.ref().once('value', snap => {
        const data = snap.val();
        const votes = data.votes || {};
        const players = data.players || {};

        let counts = {};
        for (let voter in votes) {
            let target = votes[voter];
            counts[target] = (counts[target] || 0) + 1;
        }

        let maxVotes = 0;
        let ejectedId = null;
        let tie = false;

        for (let target in counts) {
            if (counts[target] > maxVotes) {
                maxVotes = counts[target];
                ejectedId = target;
                tie = false;
            } else if (counts[target] === maxVotes) {
                tie = true;
            }
        }

        let message = "";
        if (!tie && ejectedId && ejectedId !== 'skip') {
            message = `${players[ejectedId].name} was ejected.`;
            db.ref(`players/${ejectedId}/status`).set('ghost');
        } else {
            message = "No one was ejected (Tie or Skipped).";
        }

        db.ref('ejectionMessage').set(message);
        db.ref('meeting').set(false);
    });
}

// --- 7. HOST DASHBOARD MANAGEMENT ---
db.ref('players').on('value', snap => {
    const players = snap.val() || {};
    const tableBody = document.getElementById('player-list-body');
    const countSpan = document.getElementById('player-count');
    
    if (tableBody && countSpan) {
        countSpan.innerText = Object.keys(players).length;
        tableBody.innerHTML = "";

        for (let id in players) {
            const p = players[id];
            tableBody.innerHTML += `
                <tr>
                    <td>${p.name}</td>
                    <td style="color:${p.status === 'alive' ? '#00ff00' : '#ff3333'}">${p.status.toUpperCase()}</td>
                    <td>Tracker Ready</td>
                    <td><button style="background:#550000; color:white; border:none; padding:5px; cursor:pointer;" onclick="kickPlayer('${id}')">KICK</button></td>
                </tr>
            `;
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
        const pCount = ids.length;

        let impCount = 1;
        if (impLogic === 'auto') {
            if (pCount >= 9) impCount = 3;
            else if (pCount >= 6) impCount = 2;
        } else {
            impCount = parseInt(impLogic);
        }

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
        updates['ejectionMessage'] = null;
        updates['votes'] = null;
        db.ref().update(updates);
    });
}

function kickPlayer(id) {
    if(confirm("Kick this player?")) {
        db.ref(`players/${id}`).remove();
    }
}

function resetGame() {
    if(confirm("Reset the game?")) {
        db.ref('gameState').set('lobby');
        db.ref('meeting').set(false);
        db.ref('cameras').remove();
        db.ref('votes').remove();
        db.ref('ejectionMessage').remove();
        db.ref('stations').remove();
        
        db.ref('players').once('value', snap => {
            const players = snap.val();
            if(players) {
                for(let id in players) {
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

    let total = 0;
    let done = 0;
    let html = "";
    
    for(let id in players) {
        const p = players[id];
        const statusColor = p.status === 'alive' ? '#00ff00' : '#ff0000';
        html += `<div style="background:#333; padding:10px; margin-bottom:5px; border-left:5px solid ${statusColor};">
                    <b>${p.name}</b>: ${p.status.toUpperCase()}
                 </div>`;
        
        (p.tasks || []).forEach(t => {
            total++;
            if(t.done) done++;
        });
    }
    board.innerHTML = html;

    const percent = total === 0 ? 0 : (done / total) * 100;
    progress.style.width = percent + "%";
}

// --- 8. TABLET PROXIMITY MONITORING ---
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
                    const playerDiv = document.createElement('div');
                    playerDiv.className = "player-task-card";
                    
                    let html = `<h3>${p.name} ${p.status === 'ghost' ? '👻' : ''}</h3>`;
                    const roomTasks = (p.tasks || []).filter(t => t.room === roomName);
                    
                    if (roomTasks.length > 0) {
                        roomTasks.forEach(t => {
                            const btnClass = t.done ? 'task-btn done-btn' : 'task-btn';
                            const check = t.done ? '✅' : '';
                            html += `
                                <button class="${btnClass}" onclick="completeTask('${id}', '${t.id}')">
                                    ${t.name} ${check}
                                </button>`;
                        });
                    } else {
                        html += `<p style="color:#aaa;">No tasks at this station.</p>`;
                    }
                    
                    playerDiv.innerHTML = html;
                    container.appendChild(playerDiv);
                }
            }
        }

        if (!playersPresent) {
            container.innerHTML = `<p style="color:#666; font-style:italic;">No crewmates nearby...</p>`;
        }
    });
}

function completeTask(playerId, taskId) {
    db.ref(`players/${playerId}/tasks`).once('value', snap => {
        const tasks = snap.val() || [];
        const updated = tasks.map(t => {
            if(t.id === taskId) return {...t, done: true};
            return t;
        });
        db.ref(`players/${playerId}/tasks`).set(updated);
    });
}

// --- 9. CAMERA STREAMING ---
async function startCameraFeed(roomName) {
    document.getElementById('camera-setup').style.display = 'none';
    document.getElementById('camera-active').style.display = 'block';
    document.getElementById('cam-display-name').innerText = roomName + " Camera";

    try {
        const video = document.getElementById('localVideo');
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        video.srcObject = stream;

        const peerId = 'among-us-cam-' + roomName.replace(/\s+/g, '-').toLowerCase();
        const peer = new Peer(peerId);

        peer.on('open', (id) => {
            db.ref(`cameras/${roomName}`).set({ peerId: id, status: 'online' });
        });

        peer.on('call', call => call.answer(stream));
        window.onbeforeunload = () => db.ref(`cameras/${roomName}`).remove();
        
    } catch (err) {
        alert("Camera Error: " + err.message);
        location.reload();
    }
}

function initHostCameras() {
    const hostPeer = new Peer('among-us-host-computer');
    
    db.ref('cameras').on('value', snap => {
        const cameras = snap.val() || {};
        const grid = document.getElementById('camera-grid');
        if(!grid) return;
        
        grid.innerHTML = "";

        for(let room in cameras) {
            const cam = cameras[room];
            const div = document.createElement('div');
            div.style = "width: 250px; height: 180px; background: black; border: 2px solid #555; position: relative; margin: 10px;";
            div.innerHTML = `
                <span style="position:absolute; top:5px; left:5px; background:rgba(0,0,0,0.7); color:white; padding:2px 5px; font-size:12px;">${room}</span>
                <video id="v-${cam.peerId}" autoplay playsinline style="width:100%; height:100%; object-fit:cover;"></video>
            `;
            grid.appendChild(div);

            const call = hostPeer.call(cam.peerId, null);
            if(call) {
                call.on('stream', remoteStream => {
                    const v = document.getElementById(`v-${cam.peerId}`);
                    if(v) v.srcObject = remoteStream;
                });
            }
        }
    });
}