// --- FIREBASE CONFIGURATION ---
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

// Generate a Unique ID for this device/player
const myId = localStorage.getItem('amongUsPlayerId') || "p_" + Math.floor(Math.random() * 10000);
localStorage.setItem('amongUsPlayerId', myId);

let myData = null;

// --- ROOM LIST ---
const ROOMS = [
    "Living Room", "Boy's Bedroom", "Bathroom", 
    "Laundry Room", "Mya's Room", "Parents' Room", "Kitchen"
];

// --- TASK LIST ---
const TASK_POOL = [
    { name: "Fix Wires", icon: "🔌" },
    { name: "Download Data", icon: "💾" },
    { name: "Empty Trash", icon: "🗑️" },
    { name: "Divert Power", icon: "⚡" },
    { name: "Clean Filter", icon: "🧹" },
    { name: "Asteroids", icon: "☄️" }
];

// --- HOST: ROLE ASSIGNMENT ---
function startGame() {
    db.ref('players').once('value', snapshot => {
        const players = snapshot.val();
        if (!players) return alert("No players joined!");
        
        const ids = Object.keys(players);
        const pCount = ids.length;

        // Determine Impostor count
        let impCount = 1;
        if (pCount >= 9) impCount = 3;
        else if (pCount >= 6) impCount = 2;

        // Shuffle and Assign
        const shuffled = ids.sort(() => 0.5 - Math.random());
        const updates = {};
        
        shuffled.forEach((id, index) => {
            const role = index < impCount ? 'impostor' : 'crewmate';
            // Assign 4 random tasks from the pool to different rooms
            const myTasks = [];
            for(let i=0; i<4; i++) {
                myTasks.push({
                    id: 't' + i,
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
        db.ref().update(updates);
    });
}

// --- PLAYER: ACTIONS ---
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
                alert("Kill Successful!");
                return;
            }
        }
        alert("No one nearby to kill!");
    });
}

function callMeeting() {
    db.ref('meeting').set(true);
    setTimeout(() => db.ref('meeting').set(false), 10000); // Reset after 10s
}

// --- TABLET: TASK COMPLETION ---
function completeTask(playerId, taskId) {
    db.ref(`players/${playerId}/tasks`).once('value', snap => {
        const tasks = snap.val();
        const updatedTasks = tasks.map(t => {
            if (t.id === taskId) return { ...t, done: true };
            return t;
        });
        db.ref(`players/${playerId}/tasks`).set(updatedTasks);
    });
}