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

const PROXIMITY_LIMIT = 4; // Distance in meters to activate tasks or actions

// --- 3. GEOLOCATION MATH (HAVERSINE FORMULA) ---
function getDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Returns distance in meters
}

// --- 4. PLAYER POSITION TRACKING ---
function startLocationTracking() {
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(position => {
            const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                accuracy: position.coords.accuracy,
                timestamp: Date.now()
            };
            db.ref(`players/${myId}/coords`).set(coords);
        }, err => {
            console.error("GPS Error: ", err.message);
        }, {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 5000
        });
    } else {
        alert("Geolocation is not supported on this device.");
    }
}

// --- 5. PLAYER GAMEPLAY LOGIC ---
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

// Continuous Proximity Check for Impostors to Kill
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
                        const dist = getDistance(myCoords.lat, myCoords.lng, pCoords.lat, pCoords.lng);
                        if (dist <= PROXIMITY_LIMIT) {
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
                const dist = getDistance(me.coords.lat, me.coords.lng, allPlayers[id].coords.lat, allPlayers[id].coords.lng);
                if (dist <= PROXIMITY_LIMIT) {
                    db.ref(`players/${id}/status`).set('ghost');
                    alert(`Eliminated ${allPlayers[id].name}!`);
                    return;
                }
            }
        }
        alert("No targets close enough!");
    });
}

// --- 6. MEETING & VOTING LOGIC ---
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

// --- 7. HOST LOGIC ---
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
                    <td>GPS Active</td>
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
        if (!players || Object.keys(players).length < 2) return alert("Need more players!");
        
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

// --- 8. TABLET & PROXIMITY TASK MONITORING ---
function monitorRoomTasks(roomName) {
    // Listen for changes on both players and station coordinates
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
                // Calculate distance between player and this station
                const distance = getDistance(station.coords.lat, station.coords.lng, p.coords.lat, p.coords.lng);
                
                // If player is within proximity limit
                if (distance <= PROXIMITY_LIMIT) {
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