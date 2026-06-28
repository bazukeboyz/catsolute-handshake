const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let lanes = {}; 

function broadcastLaneUpdate(memberId) {
    if (!lanes[memberId]) return;

    io.emit('lane_updated', {
        memberId: memberId,
        data: { 
            totalSeconds: lanes[memberId].totalSeconds, 
            status: lanes[memberId].status, 
            queueStack: lanes[memberId].queueStack
        }
    });
}

io.on('connection', (socket) => {
    let initData = {};
    Object.keys(lanes).forEach(id => {
        initData[id] = lanes[id];
    });
    socket.emit('init_all_lanes', initData);

    // 💡 2. สตาฟกดปุ่มเพิ่ม/ลดตั๋ว หรือคีย์ตัวเลข ระบบจะอัปเดตยอดตั๋วและยอดวินาทีให้สดๆ ทันที
    socket.on('update_input_stack', (data) => {
        const { memberId, tickets, name } = data;
        const targetAmount = parseInt(tickets) || 0;

        if (!lanes[memberId]) {
            lanes[memberId] = { name, totalSeconds: 0, isRunning: false, status: 'idle', queueStack: 0, intervalId: null };
        }

        lanes[memberId].queueStack = targetAmount >= 0 ? targetAmount : 0;
        
        // 💡 1. ระบบทำงานแบบแปรผันตามวินาทีจริง:
        // ถ้าเวลาลู่นับถอยหลังกำลังวิ่งอยู่ ให้ปรับยอดเวลาถอยหลังเพิ่ม/ลด ตามยอดตั๋วที่สตาฟฟ์แก้ไขแบบ Real-time
        if (lanes[memberId].isRunning) {
            lanes[memberId].totalSeconds = lanes[memberId].queueStack * 30;
            if (lanes[memberId].totalSeconds <= 0) {
                clearInterval(lanes[memberId].intervalId);
                lanes[memberId].isRunning = false;
                lanes[memberId].status = 'idle';
            }
        }
        
        broadcastLaneUpdate(memberId);
    });

    // ปุ่ม START เริ่มนับถอยหลังเวลารวมม้วนเดียวจบ
    socket.on('trigger_manual_start', (data) => {
        const { memberId } = data;
        if (!lanes[memberId] || lanes[memberId].queueStack <= 0 || lanes[memberId].isRunning) return;

        lanes[memberId].totalSeconds = lanes[memberId].queueStack * 30;
        lanes[memberId].isRunning = true;
        lanes[memberId].status = 'running';

        if (lanes[memberId].intervalId) clearInterval(lanes[memberId].intervalId);

        lanes[memberId].intervalId = setInterval(() => {
            if (lanes[memberId].totalSeconds > 0) {
                lanes[memberId].totalSeconds--;
                // อัปเดตสัดส่วนตั๋วที่เหลือคร่าวๆ กลับไปฟีดบนหน้าจอ (30 วินาทีคิดเป็น 1 ใบ)
                lanes[memberId].queueStack = Math.ceil(lanes[memberId].totalSeconds / 30);
            } else {
                // เวลาหมดแถวเรียบร้อย เคลียร์เลนเป็น 0
                clearInterval(lanes[memberId].intervalId);
                lanes[memberId].isRunning = false;
                lanes[memberId].status = 'timeout';
                lanes[memberId].queueStack = 0;
                lanes[memberId].totalSeconds = 0;
            }
            broadcastLaneUpdate(memberId);
        }, 1000);

        broadcastLaneUpdate(memberId);
    });

    // ปุ่ม PAUSE หยุดเวลาชั่วคราว
    socket.on('pause_queue', (data) => {
        const { memberId } = data;
        if (lanes[memberId] && lanes[memberId].isRunning) {
            clearInterval(lanes[memberId].intervalId);
            lanes[memberId].isRunning = false;
            lanes[memberId].status = 'paused';
            broadcastLaneUpdate(memberId);
        }
    });

    // ปุ่ม RESET เคลียร์คิวคนนั้นเป็น 0
    socket.on('reset_queue', (data) => {
        const { memberId } = data;
        if (lanes[memberId]) { 
            clearInterval(lanes[memberId].intervalId); 
            delete lanes[memberId]; 
        }
        io.emit('lane_reseted', { memberId });
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`Grand Countdown Server running on port ${PORT}`); });
