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

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.database();

// Persistent Device ID
const myId = localStorage.getItem('amongUsPlayerId') || "p_" + Math.floor(Math.random() * 10000);
localStorage.setItem('amongUsPlayerId', myId);

// --- 2. GAME CONSTANTS ---
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

// --- 3. SHARED GAME LOGIC ---

// Start Game (Host only)
function startGame() {
    db.ref('players').once('value', snapshot => {
        const players = snapshot.val();
        if (!players) return alert("No players joined!");
        
        const ids = Object.keys(players);
        const pCount = ids.length;

        // Role Logic: 4+ players = 1 imp, 6+ = 2 imp, 9+ = 3 imp
        let impCount = 1;
        if (pCount >= 9) impCount = 3;
        else if (pCount >= 6) impCount = 2;

        const shuffled = ids.sort(() => 0.5 - Math.random());
        const updates = {};
        
        shuffled.forEach((id, index) => {
            const role = index < impCount ? 'impostor' : 'crewmate';
            const myTasks = [];
            // Assign 4 random tasks across random rooms
            for(let i=0; i<4; i++) {
                myTasks.push({
                    id: 't' + i + "_" + Math.floor(Math.random()*100),
                    name: TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)].name,
                    room: ROOMS[Math.floor(Math.random() * ROOMS.length)],
                    done: false
                });
            }
            
            updates[`players/${id}/role`] = role;
            updates[`players/${id}/status`] = 'alive';
            updates[`players/${id}/tasks`] = myTasks;
            updates[`players/${id}/currentRoom`] = 'Lobby';
        });

        updates['gameState'] = 'playing';
        updates['meeting'] = false;
        updates['gameStats/completedTasks'] = 0;
        db.ref().update(updates);
    });
}

// Kill Action (Impostor only)
function tryKill() {
    db.ref('players').once('value', snap => {
        const allPlayers = snap.val();
        const me = allPlayers[myId];
        
        if (me.role !== 'impostor' || me.status !== 'alive') return;

        for (let id in allPlayers) {
            if (id !== myId && 
                allPlayers[id].currentRoom === me.currentRoom && 
                allPlayers[id].status === 'alive') {
                
                db.ref(`players/${id}/status`).set('ghost');
                alert("Target Neutralized.");
                return;
            }
        }
        alert("No crewmates in this room!");
    });
}

// Emergency Meeting
function callMeeting() {
    db.ref('meeting').set(true);
}

function endMeeting() {
    db.ref('meeting').set(false);
}

// --- 4. TABLET & TASK TRACKING ---

function monitorRoomTasks(roomName) {
    db.ref('players').on('value', snap => {
        const players = snap.val();
        const container = document.getElementById('active-tasks-container');
        if(!container) return;
        container.innerHTML = "";
        
        for(let id in players) {
            const p = players[id];
            // Only show if player is in this room
            if(p.currentRoom === roomName) {
                const playerDiv = document.createElement('div');
                playerDiv.className = "player-task-card";
                
                let html = `<h3>${p.name} ${p.status === 'ghost' ? '(GHOST)' : ''}</h3>`;
                
                // Show tasks (Real or Fake)
                const roomTasks = (p.tasks || []).filter(t => t.room === roomName);
                if(roomTasks.length > 0) {
                    roomTasks.forEach(t => {
                        html += `
                            <button class="${t.done ? 'done-btn' : 'task-btn'}" 
                                    onclick="completeTask('${id}', '${t.id}')">
                                ${t.name} ${t.done ? '✅' : ''}
                            </button>`;
                    });
                } else {
                    html += `<p>No tasks in this room.</p>`;
                }
                playerDiv.innerHTML = html;
                container.appendChild(playerDiv);
            }
        }
    });
}

function completeTask(playerId, taskId) {
    db.ref(`players/${playerId}/tasks`).once('value', snap => {
        const tasks = snap.val();
        const updated = tasks.map(t => {
            if(t.id === taskId) return {...t, done: true};
            return t;
        });
        db.ref(`players/${playerId}/tasks`).set(updated);
    });
}

// --- 5. HOST DASHBOARD LOGIC ---

function updateHostDashboard(players) {
    const board = document.getElementById('status-board');
    if(!board) return;

    let total = 0;
    let done = 0;
    
    let html = "<h3>Crew Status</h3>";
    for(let id in players) {
        const p = players[id];
        html += `<div class="status-row ${p.status}">
                    ${p.name}: ${p.status.toUpperCase()} (${p.currentRoom || 'Lobby'})
                 </div>`;
        
        (p.tasks || []).forEach(t => {
            total++;
            if(t.done) done++;
        });
    }
    board.innerHTML = html;

    const progress = document.getElementById('task-progress-bar');
    if(progress) {
        const percent = total === 0 ? 0 : (done / total) * 100;
        progress.style.width = percent + "%";
    }
}

// --- 6. CAMERA STREAMING LOGIC ---

// Start local camera (Camera View)
async function startCameraFeed(roomName) {
    document.getElementById('camera-setup').style.display = 'none';
    document.getElementById('camera-active').style.display = 'block';
    document.getElementById('cam-display-name').innerText = roomName + " Camera";

    const video = document.getElementById('localVideo');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = stream;

    const peerId = 'among-us-cam-' + roomName.replace(/\s+/g, '-').toLowerCase();
    const peer = new Peer(peerId);

    peer.on('open', (id) => {
        db.ref(`cameras/${roomName}`).set({ peerId: id, status: 'online' });
    });

    peer.on('call', call => call.answer(stream));
}

// Host connects to all cameras (Host View)
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
            div.className = "camera-box";
            div.innerHTML = `<span>${room}</span><video id="v-${cam.peerId}" autoplay playsinline></video>`;
            grid.appendChild(div);

            const call = hostPeer.call(cam.peerId, null);
            call.on('stream', remoteStream => {
                const v = document.getElementById(`v-${cam.peerId}`);
                if(v) v.srcObject = remoteStream;
            });
        }
    });
}