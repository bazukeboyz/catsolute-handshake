const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let lanes = {}; 

function getQueueStackCount(memberId) {
    if (!lanes[memberId] || !lanes[memberId].queueArray) return 0;
    return lanes[memberId].queueArray.reduce((a, b) => a + b, 0);
}

function startLaneCountdown(memberId) {
    if (!lanes[memberId] || lanes[memberId].isRunning) return;
    if (!lanes[memberId].queueArray || lanes[memberId].queueArray.length === 0) return;
    
    const currentTicket = lanes[memberId].queueArray[0];
    lanes[memberId].tickets = currentTicket;
    lanes[memberId].totalSeconds = currentTicket * 30;
    lanes[memberId].isRunning = true;
    lanes[memberId].status = 'running';

    if (lanes[memberId].intervalId) clearInterval(lanes[memberId].intervalId);

    lanes[memberId].intervalId = setInterval(() => {
        if (lanes[memberId].totalSeconds > 0) {
            lanes[memberId].totalSeconds--;
        } else {
            // หมดเวลาคิวก้อนปัจจุบัน -> หักออกจากถาดสะสม
            lanes[memberId].queueArray.shift();
            clearInterval(lanes[memberId].intervalId);
            lanes[memberId].isRunning = false;
            lanes[memberId].status = 'timeout';
            lanes[memberId].tickets = 0;
            lanes[memberId].totalSeconds = 0;
        }
        broadcastLaneUpdate(memberId);
    }, 1000);
}

function broadcastLaneUpdate(memberId) {
    if (!lanes[memberId]) return;
    const totalStack = getQueueStackCount(memberId);

    io.emit('lane_updated', {
        memberId: memberId,
        data: { 
            totalSeconds: lanes[memberId].totalSeconds, 
            status: lanes[memberId].status, 
            tickets: lanes[memberId].tickets,
            queueArray: lanes[memberId].queueArray,
            queueStack: totalStack
        }
    });
}

io.on('connection', (socket) => {
    let initData = {};
    Object.keys(lanes).forEach(id => {
        initData[id] = { ...lanes[id], queueStack: getQueueStackCount(id) };
    });
    socket.emit('init_all_lanes', initData);

    // สตาฟกดปุ่มสเต็ปเปอร์บวกตั๋ว
    socket.on('add_to_stack', (data) => {
        const { memberId, tickets, name } = data;
        if (!lanes[memberId]) {
            lanes[memberId] = { name, totalSeconds: 0, isRunning: false, tickets: 0, status: 'idle', queueArray: [], intervalId: null };
        }
        lanes[memberId].queueArray.push(parseInt(tickets) || 1);
        broadcastLaneUpdate(memberId);
    });

    // สตาฟกดปุ่มสเต็ปเปอร์ลบตั๋ว
    socket.on('remove_from_stack', (data) => {
        const { memberId, tickets } = data;
        if (lanes[memberId] && lanes[memberId].queueArray.length > 0) {
            let lastIdx = lanes[memberId].queueArray.length - 1;
            if (lastIdx === 0 && lanes[memberId].isRunning) return; // ล็อกไม่ให้ลบก้อนที่เวลากำลังวิ่งอยู่

            lanes[memberId].queueArray[lastIdx] -= (parseInt(tickets) || 1);
            if (lanes[memberId].queueArray[lastIdx] <= 0) lanes[memberId].queueArray.pop();
            broadcastLaneUpdate(memberId);
        }
    });

    // สตาฟฟ์พิมพ์ตัวเลขลงในช่องตรงๆ
    socket.on('update_input_stack', (data) => {
        const { memberId, tickets, name } = data;
        const targetAmount = parseInt(tickets) || 0;

        if (!lanes[memberId]) {
            lanes[memberId] = { name, totalSeconds: 0, isRunning: false, tickets: 0, status: 'idle', queueArray: [], intervalId: null };
        }

        // จัดระบบเซฟตี้: ถ้าเวลากำลังวิ่งอยู่ ให้ล็อกก้อนแรกไว้ แล้วไปแก้ตัวเลขตั๋วก้อนถัดไปแทน
        if (lanes[memberId].isRunning && lanes[memberId].queueArray.length > 0) {
            const runningTicket = lanes[memberId].queueArray[0];
            lanes[memberId].queueArray = [runningTicket];
            if (targetAmount > runningTicket) {
                lanes[memberId].queueArray.push(targetAmount - runningTicket);
            }
        } else {
            lanes[memberId].queueArray = targetAmount > 0 ? [targetAmount] : [];
        }
        broadcastLaneUpdate(memberId);
    });

    // ปุ่มแมนนวลรันเวลาจับเวลาประจำตัวศิลปิน
    socket.on('trigger_manual_start', (data) => {
        const { memberId } = data;
        if (lanes[memberId] && lanes[memberId].queueArray.length > 0 && !lanes[memberId].isRunning) {
            startLaneCountdown(memberId);
        }
    });

    // ปุ่มหยุดชั่วคราวประจำตัวศิลปิน
    socket.on('pause_queue', (data) => {
        if (lanes[data.memberId] && lanes[data.memberId].isRunning) {
            clearInterval(lanes[data.memberId].intervalId);
            lanes[data.memberId].isRunning = false;
            lanes[data.memberId].status = 'paused';
            broadcastLaneUpdate(data.memberId);
        }
    });

    // ปุ่มล้างคิวของคนนั้นๆ
    socket.on('reset_queue', (data) => {
        const { memberId } = data;
        if (lanes[memberId]) { clearInterval(lanes[memberId].intervalId); delete lanes[memberId]; }
        io.emit('lane_reseted', { memberId });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Countdown Central Server running on port ${PORT}`); });
